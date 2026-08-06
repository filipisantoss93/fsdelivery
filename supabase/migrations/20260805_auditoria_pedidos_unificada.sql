-- FS Delivery — contrato unificado dos canais de pedido
-- Canais: público, QR da mesa, garçom, balcão, caixa e painel.

begin;

alter table public.pedidos
  add column if not exists origem text;

update public.pedidos
set origem = case
  when mesa_id is not null then 'garcom'
  else 'publico'
end
where origem is null or trim(origem) = '';

alter table public.pedidos
  alter column origem set default 'publico',
  alter column origem set not null;

alter table public.pedidos
  drop constraint if exists pedidos_origem_check;

alter table public.pedidos
  add constraint pedidos_origem_check
  check (origem in ('publico','qr_mesa','painel','garcom','balcao','caixa'));

create or replace function public.definir_status_inicial_pedido()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.origem is null or new.origem not in ('publico','qr_mesa','painel','garcom','balcao','caixa') then
    new.origem := case when new.tipo = 'mesa' then 'qr_mesa' else 'publico' end;
  end if;

  new.status := case
    when new.origem = 'publico' and new.tipo in ('entrega','retirada') then 'aguardando_aprovacao'
    else 'confirmado'
  end;

  if new.tipo <> 'entrega' then
    new.endereco_entrega := null;
    new.bairro_entrega := null;
    new.taxa_entrega := 0;
    new.cliente_endereco_id := null;
  end if;

  if new.tipo = 'mesa' and new.mesa_id is null then
    raise exception 'Pedido de mesa exige uma mesa válida';
  end if;

  return new;
end;
$$;

create or replace function public.criar_pedido_publico(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est public.estabelecimentos%rowtype;
  v_cfg public.configuracoes_operacionais%rowtype;
  v_tem_cfg boolean := false;
  v_cliente uuid;
  v_pedido bigint;
  v_codigo text;
  v_subtotal numeric := 0;
  v_taxa numeric := 0;
  v_taxa_servico numeric := 0;
  v_desconto numeric := 0;
  v_item jsonb;
  v_prod public.produtos%rowtype;
  v_qtd integer;
  v_tipo text;
  v_origem text;
  v_interno boolean;
  v_mesa uuid;
  v_regiao public.taxas_entrega_regioes%rowtype;
  v_cupom public.cupons%rowtype;
  v_nome text := trim(coalesce(payload->>'nome',''));
  v_telefone text := public.normalizar_whatsapp(coalesce(payload->>'telefone',''));
  v_pagamento text := trim(coalesce(payload->>'pagamento',''));
  v_end jsonb := coalesce(payload->'endereco_dados','{}'::jsonb);
  v_cep text := regexp_replace(coalesce(payload->>'cep',v_end->>'cep',''), '\D', '', 'g');
  v_logradouro text := trim(coalesce(v_end->>'logradouro',''));
  v_numero text := trim(coalesce(v_end->>'numero',''));
  v_bairro_endereco text := trim(coalesce(v_end->>'bairro',''));
  v_complemento text := trim(coalesce(v_end->>'complemento',''));
  v_cidade text := trim(coalesce(v_end->>'cidade',''));
  v_estado text := trim(coalesce(v_end->>'estado',''));
  v_texto_endereco text := trim(coalesce(v_end->>'texto',payload->>'endereco',''));
  v_checkout uuid;
  v_endereco_id uuid;
  v_primeiro boolean;
  v_troco numeric;
begin
  v_tipo := case payload->>'tipo'
    when 'pickup' then 'retirada'
    when 'retirada' then 'retirada'
    when 'mesa' then 'mesa'
    when 'local' then 'local'
    else 'entrega'
  end;

  v_origem := nullif(current_setting('fsdelivery.origem', true), '');
  if v_origem not in ('painel','garcom','balcao','caixa') then
    v_origem := case when v_tipo = 'mesa' and nullif(payload->>'mesa_token','') is not null then 'qr_mesa' else 'publico' end;
  end if;
  v_interno := v_origem in ('painel','garcom','balcao','caixa');

  perform set_config('fsdelivery.origem', v_origem, true);

  select * into v_est
  from public.estabelecimentos
  where slug = trim(payload->>'slug');
  if not found then raise exception 'Estabelecimento não encontrado'; end if;

  if not v_interno and (not v_est.aberto or not public.loja_disponivel(v_est.id)) then
    raise exception 'A loja está fechada e não está recebendo pedidos';
  end if;

  if v_interno and v_tipo in ('mesa','local') and char_length(v_telefone) < 10 then
    v_nome := coalesce(nullif(v_nome,''),'Atendimento local');
    v_telefone := null;
  else
    if char_length(v_nome) < 2 then raise exception 'Informe um nome válido'; end if;
    if char_length(v_telefone) < 10 or char_length(v_telefone) > 13 then raise exception 'Informe um WhatsApp válido'; end if;
  end if;

  begin
    v_checkout := nullif(payload->>'checkout_token','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Identificador do checkout inválido';
  end;

  if v_checkout is not null then
    select codigo into v_codigo
    from public.pedidos
    where estabelecimento_id = v_est.id and checkout_token = v_checkout
    limit 1;
    if v_codigo is not null then return v_codigo; end if;
  end if;

  select * into v_cfg
  from public.configuracoes_operacionais
  where estabelecimento_id = v_est.id;
  v_tem_cfg := found;

  if v_tipo <> 'mesa' and v_pagamento = '' then
    raise exception 'Selecione a forma de pagamento';
  end if;
  if v_tem_cfg
     and jsonb_array_length(coalesce(v_cfg.formas_pagamento,'[]'::jsonb)) > 0
     and not (coalesce(v_cfg.formas_pagamento,'[]'::jsonb) ? v_pagamento) then
    raise exception 'Forma de pagamento indisponível';
  end if;

  if v_tipo = 'mesa' then
    select id into v_mesa
    from public.mesas
    where estabelecimento_id = v_est.id
      and codigo_qr = payload->>'mesa_token'
      and ativo = true;
    if v_mesa is null then raise exception 'Mesa inválida ou indisponível'; end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'itens','[]'::jsonb)) loop
    begin
      v_qtd := greatest(1,least(99,coalesce((v_item->>'quantidade')::integer,1)));
      select * into v_prod
      from public.produtos
      where id = (v_item->>'produto_id')::uuid
        and estabelecimento_id = v_est.id
        and ativo = true;
    exception when others then
      raise exception 'Item do pedido inválido';
    end;
    if not found then raise exception 'Produto inválido ou indisponível'; end if;
    v_subtotal := v_subtotal + (v_prod.preco * v_qtd);
  end loop;

  if v_subtotal <= 0 then raise exception 'Pedido sem itens'; end if;
  if v_tipo in ('entrega','retirada') and v_subtotal < v_est.pedido_minimo then
    raise exception 'Pedido abaixo do mínimo';
  end if;

  if v_tipo = 'entrega' then
    if char_length(v_cep) <> 8 then raise exception 'Informe um CEP válido'; end if;
    if char_length(v_logradouro) < 3 then raise exception 'Informe a rua da entrega'; end if;
    if v_numero = '' then raise exception 'Informe o número do endereço'; end if;
    if char_length(v_bairro_endereco) < 2 then raise exception 'Informe o bairro da entrega'; end if;

    if v_texto_endereco = '' then
      v_texto_endereco := concat_ws(', ',v_logradouro,v_numero,nullif(v_complemento,''),v_bairro_endereco,nullif(v_cidade,''),nullif(v_estado,''),'CEP '||v_cep);
    end if;

    if exists(select 1 from public.taxas_entrega_regioes where estabelecimento_id=v_est.id and ativo=true) then
      select * into v_regiao
      from public.taxas_entrega_regioes
      where estabelecimento_id = v_est.id
        and ativo = true
        and public.normalizar_regiao_entrega(nome) = public.normalizar_regiao_entrega(v_bairro_endereco)
      limit 1;
      if not found then raise exception 'Selecione uma região de entrega válida'; end if;
      v_taxa := v_regiao.taxa;
    else
      v_taxa := coalesce(v_est.taxa_entrega,0);
    end if;
  end if;

  if v_pagamento = 'Dinheiro' and nullif(trim(coalesce(payload->>'troco_para','')),'') is not null then
    begin
      v_troco := replace(payload->>'troco_para',',','.')::numeric;
    exception when invalid_text_representation then
      raise exception 'Valor para troco inválido';
    end;
    if v_troco <= 0 then v_troco := null; end if;
  end if;

  if v_tem_cfg and v_tipo in ('mesa','local') then
    v_taxa_servico := round(v_subtotal * coalesce(v_cfg.taxa_servico_percentual,0) / 100,2);
  end if;

  if coalesce(payload->>'cupom','') <> '' and v_tem_cfg and coalesce(v_cfg.cupons_ativos,false) then
    select * into v_cupom
    from public.cupons
    where estabelecimento_id = v_est.id
      and upper(codigo) = upper(payload->>'cupom')
      and ativo = true
      and (valido_de is null or valido_de <= now())
      and (valido_ate is null or valido_ate >= now())
      and (limite_usos is null or usos < limite_usos)
    limit 1;
    if not found then raise exception 'Cupom inválido ou expirado'; end if;
    if v_subtotal < v_cupom.pedido_minimo then raise exception 'Pedido abaixo do mínimo do cupom'; end if;
    v_desconto := case when v_cupom.tipo='percentual'
      then round(v_subtotal * least(v_cupom.valor,100) / 100,2)
      else least(v_cupom.valor,v_subtotal) end;
    update public.cupons set usos = usos + 1 where id = v_cupom.id;
  end if;

  if v_telefone is not null then
    insert into public.clientes(estabelecimento_id,nome,telefone)
    values(v_est.id,left(v_nome,120),left(v_telefone,30))
    on conflict(estabelecimento_id,telefone_normalizado)
    where telefone_normalizado is not null and telefone_normalizado <> ''
    do update set nome=excluded.nome,telefone=excluded.telefone,updated_at=now()
    returning id into v_cliente;
  end if;

  if v_tipo = 'entrega' and v_cliente is not null then
    if nullif(v_end->>'id','') is not null then
      begin
        select id into v_endereco_id
        from public.cliente_enderecos
        where id=(v_end->>'id')::uuid
          and cliente_id=v_cliente
          and estabelecimento_id=v_est.id
          and ativo=true;
      exception when invalid_text_representation then
        v_endereco_id := null;
      end;
    end if;

    if v_endereco_id is null then
      select id into v_endereco_id
      from public.cliente_enderecos
      where cliente_id=v_cliente
        and estabelecimento_id=v_est.id
        and ativo=true
        and coalesce(cep,'')=v_cep
        and lower(trim(logradouro))=lower(v_logradouro)
        and lower(trim(numero))=lower(v_numero)
      order by principal desc,updated_at desc
      limit 1;
    end if;

    if v_endereco_id is null then
      select not exists(select 1 from public.cliente_enderecos where cliente_id=v_cliente and ativo=true)
      into v_primeiro;
      insert into public.cliente_enderecos(
        estabelecimento_id,cliente_id,apelido,cep,logradouro,numero,complemento,bairro,cidade,estado,referencia,principal,ativo
      ) values(
        v_est.id,v_cliente,case when v_primeiro then 'Principal' else 'Endereço' end,
        v_cep,left(v_logradouro,250),left(v_numero,30),nullif(left(v_complemento,180),''),
        nullif(left(v_bairro_endereco,120),''),nullif(left(v_cidade,120),''),nullif(left(v_estado,30),''),
        nullif(left(v_complemento,180),''),v_primeiro,true
      ) returning id into v_endereco_id;
    else
      update public.cliente_enderecos set
        cep=v_cep,
        logradouro=left(v_logradouro,250),
        numero=left(v_numero,30),
        complemento=nullif(left(v_complemento,180),''),
        bairro=nullif(left(v_bairro_endereco,120),''),
        cidade=nullif(left(v_cidade,120),''),
        estado=nullif(left(v_estado,30),''),
        updated_at=now()
      where id=v_endereco_id;
    end if;
  end if;

  insert into public.pedidos(
    estabelecimento_id,cliente_id,codigo,status,tipo,origem,subtotal,taxa_entrega,taxa_servico,desconto,desconto_cupom,total,
    forma_pagamento,troco_para,endereco_entrega,observacoes,mesa_id,bairro_entrega,cupom_codigo,cliente_endereco_id,checkout_token
  ) values(
    v_est.id,v_cliente,'PED-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),'novo',v_tipo,v_origem,
    v_subtotal,v_taxa,v_taxa_servico,v_desconto,v_desconto,greatest(0,v_subtotal+v_taxa+v_taxa_servico-v_desconto),
    nullif(left(v_pagamento,50),''),v_troco,
    case when v_tipo='entrega' then jsonb_build_object(
      'texto',left(v_texto_endereco,500),'endereco',left(v_texto_endereco,500),'cep',v_cep,
      'logradouro',left(v_logradouro,250),'numero',left(v_numero,30),'complemento',left(v_complemento,180),
      'bairro',left(v_bairro_endereco,120),'regiao',left(coalesce(v_regiao.nome,v_bairro_endereco),120),
      'cidade',left(v_cidade,120),'estado',left(v_estado,30)
    ) else null end,
    left(coalesce(payload->>'observacoes',''),500),v_mesa,left(v_bairro_endereco,120),
    nullif(upper(payload->>'cupom'),''),v_endereco_id,v_checkout
  ) returning id,codigo into v_pedido,v_codigo;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_qtd := greatest(1,least(99,coalesce((v_item->>'quantidade')::integer,1)));
    select * into v_prod
    from public.produtos
    where id=(v_item->>'produto_id')::uuid
      and estabelecimento_id=v_est.id
      and ativo=true;
    insert into public.itens_pedido(pedido_id,produto_id,nome_produto,quantidade,valor_unitario,observacoes,total)
    values(v_pedido,v_prod.id,v_prod.nome,v_qtd,v_prod.preco,left(coalesce(v_item->>'observacoes',''),300),v_prod.preco*v_qtd);
  end loop;

  return v_codigo;
exception when unique_violation then
  if v_checkout is not null then
    select codigo into v_codigo
    from public.pedidos
    where estabelecimento_id=v_est.id and checkout_token=v_checkout
    limit 1;
    if v_codigo is not null then return v_codigo; end if;
  end if;
  raise;
end;
$$;

-- O retorno público é um código textual (PED-0001), então os adaptadores
-- internos precisam falar o mesmo tipo.
drop function if exists public.criar_pedido_garcom(jsonb);
create function public.criar_pedido_garcom(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est public.estabelecimentos%rowtype;
  v_payload jsonb := coalesce(payload,'{}'::jsonb);
  v_token text;
  v_origem text;
begin
  if auth.uid() is null then raise exception 'Sessão administrativa inválida'; end if;

  select * into v_est
  from public.estabelecimentos
  where usuario_id=auth.uid()
  limit 1;
  if not found then raise exception 'Estabelecimento não encontrado para esta conta'; end if;

  v_origem := case v_payload->>'origem'
    when 'garcom' then 'garcom'
    when 'balcao' then 'balcao'
    when 'caixa' then 'caixa'
    else 'painel'
  end;

  perform set_config('fsdelivery.origem',v_origem,true);
  perform set_config('fsdelivery.responsavel_id',auth.uid()::text,true);
  v_payload := (v_payload - 'origem') || jsonb_build_object('slug',v_est.slug);

  if coalesce(v_payload->>'tipo','')='mesa' then
    select codigo_qr into v_token
    from public.mesas
    where id=nullif(v_payload->>'mesa_id','')::uuid
      and estabelecimento_id=v_est.id
      and ativo=true;
    if v_token is null then raise exception 'Mesa inválida ou indisponível'; end if;
    v_payload := v_payload || jsonb_build_object('mesa_token',v_token);
  end if;

  return public.criar_pedido_publico(v_payload);
end;
$$;

-- O portal do garçom sem sessão administrativa também recebe o código textual.
drop function if exists public.criar_pedido_equipe_garcom(text,text,jsonb);
create function public.criar_pedido_equipe_garcom(p_telefone text,p_pin text,payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.equipe_operacional%rowtype;
  v_est public.estabelecimentos%rowtype;
  v_payload jsonb := coalesce(payload,'{}'::jsonb);
  v_token text;
begin
  select * into v_m
  from public.equipe_operacional m
  where regexp_replace(m.telefone,'\D','','g')=regexp_replace(p_telefone,'\D','','g')
    and m.pin=p_pin
    and m.funcao='garcom'
    and m.ativo=true
  limit 1;
  if not found then raise exception 'Acesso do garçom inválido'; end if;

  select * into v_est from public.estabelecimentos where id=v_m.estabelecimento_id;
  v_payload := (v_payload - 'origem') || jsonb_build_object('slug',v_est.slug);

  if coalesce(v_payload->>'tipo','')='mesa' then
    select codigo_qr into v_token
    from public.mesas
    where id=nullif(v_payload->>'mesa_id','')::uuid
      and estabelecimento_id=v_est.id
      and ativo=true;
    if v_token is null then raise exception 'Mesa inválida ou indisponível'; end if;
    v_payload := v_payload || jsonb_build_object('mesa_token',v_token);
  end if;

  perform set_config('fsdelivery.origem','garcom',true);
  perform set_config('fsdelivery.responsavel_id',v_m.id::text,true);
  return public.criar_pedido_publico(v_payload);
end;
$$;

revoke all on function public.criar_pedido_publico(jsonb) from public;
revoke all on function public.criar_pedido_garcom(jsonb) from public;
revoke all on function public.criar_pedido_equipe_garcom(text,text,jsonb) from public;

grant execute on function public.criar_pedido_publico(jsonb) to anon,authenticated;
grant execute on function public.criar_pedido_garcom(jsonb) to authenticated;
grant execute on function public.criar_pedido_equipe_garcom(text,text,jsonb) to anon,authenticated;

create index if not exists pedidos_origem_status_created_idx
  on public.pedidos(estabelecimento_id,origem,status,created_at desc);

commit;
