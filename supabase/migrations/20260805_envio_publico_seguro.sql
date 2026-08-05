-- FS Delivery — envio público seguro, idempotente e com endereço estruturado

alter table public.pedidos
  add column if not exists checkout_token uuid;

create unique index if not exists pedidos_checkout_token_uidx
  on public.pedidos(estabelecimento_id, checkout_token)
  where checkout_token is not null;

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
  v_mesa uuid;
  v_regiao public.taxas_entrega_regioes%rowtype;
  v_cupom public.cupons%rowtype;
  v_nome text := trim(coalesce(payload->>'nome',''));
  v_telefone text := public.normalizar_whatsapp(coalesce(payload->>'telefone',''));
  v_pagamento text := trim(coalesce(payload->>'pagamento',''));
  v_end jsonb := coalesce(payload->'endereco_dados','{}'::jsonb);
  v_cep text := regexp_replace(coalesce(payload->>'cep', v_end->>'cep',''), '\D', '', 'g');
  v_logradouro text := trim(coalesce(v_end->>'logradouro',''));
  v_numero text := trim(coalesce(v_end->>'numero',''));
  v_bairro_endereco text := trim(coalesce(v_end->>'bairro',''));
  v_complemento text := trim(coalesce(v_end->>'complemento',''));
  v_cidade text := trim(coalesce(v_end->>'cidade',''));
  v_estado text := trim(coalesce(v_end->>'estado',''));
  v_texto_endereco text := trim(coalesce(v_end->>'texto', payload->>'endereco',''));
  v_checkout uuid;
  v_endereco_id uuid;
  v_primeiro_endereco boolean;
  v_troco numeric;
begin
  select * into v_est from public.estabelecimentos where slug = trim(payload->>'slug');
  if not found then raise exception 'Estabelecimento não encontrado'; end if;
  if not v_est.aberto or not public.loja_disponivel(v_est.id) then raise exception 'A loja está fechada e não está recebendo pedidos'; end if;

  if char_length(v_nome) < 2 then raise exception 'Informe um nome válido'; end if;
  if char_length(v_telefone) < 10 or char_length(v_telefone) > 13 then raise exception 'Informe um WhatsApp válido'; end if;

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

  select * into v_cfg from public.configuracoes_operacionais where estabelecimento_id = v_est.id;
  v_tem_cfg := found;
  v_tipo := case payload->>'tipo'
    when 'pickup' then 'retirada'
    when 'retirada' then 'retirada'
    when 'mesa' then 'mesa'
    when 'local' then 'local'
    else 'entrega'
  end;

  if v_tipo <> 'mesa' and v_pagamento = '' then raise exception 'Selecione a forma de pagamento'; end if;
  if v_tem_cfg and jsonb_array_length(coalesce(v_cfg.formas_pagamento,'[]'::jsonb)) > 0
     and not (coalesce(v_cfg.formas_pagamento,'[]'::jsonb) ? v_pagamento) then
    raise exception 'Forma de pagamento indisponível';
  end if;

  if v_tipo = 'mesa' then
    select id into v_mesa from public.mesas
    where estabelecimento_id = v_est.id and codigo_qr = payload->>'mesa_token' and ativo = true;
    if v_mesa is null then raise exception 'Mesa inválida ou indisponível'; end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'itens','[]'::jsonb)) loop
    begin
      v_qtd := greatest(1, least(99, coalesce((v_item->>'quantidade')::integer,1)));
      select * into v_prod from public.produtos
      where id = (v_item->>'produto_id')::uuid and estabelecimento_id = v_est.id and ativo = true;
    exception when others then
      raise exception 'Item do pedido inválido';
    end;
    if not found then raise exception 'Produto inválido ou indisponível'; end if;
    v_subtotal := v_subtotal + (v_prod.preco * v_qtd);
  end loop;

  if v_subtotal <= 0 then raise exception 'Pedido sem itens'; end if;
  if v_tipo in ('entrega','retirada') and v_subtotal < v_est.pedido_minimo then raise exception 'Pedido abaixo do mínimo'; end if;

  if v_tipo = 'entrega' then
    if char_length(v_cep) <> 8 then raise exception 'Informe um CEP válido'; end if;
    if char_length(v_logradouro) < 3 then raise exception 'Informe a rua da entrega'; end if;
    if v_numero = '' then raise exception 'Informe o número do endereço'; end if;
    if char_length(v_bairro_endereco) < 2 then raise exception 'Informe o bairro da entrega'; end if;
    if v_texto_endereco = '' then
      v_texto_endereco := concat_ws(', ',v_logradouro,v_numero,nullif(v_complemento,''),v_bairro_endereco,nullif(v_cidade,''),nullif(v_estado,''),'CEP '||v_cep);
    end if;

    if exists(select 1 from public.taxas_entrega_regioes where estabelecimento_id=v_est.id and ativo=true) then
      select * into v_regiao from public.taxas_entrega_regioes
      where estabelecimento_id=v_est.id and ativo=true and lower(nome)=lower(trim(coalesce(payload->>'bairro','')))
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
    select * into v_cupom from public.cupons
    where estabelecimento_id=v_est.id and upper(codigo)=upper(payload->>'cupom') and ativo=true
      and (valido_de is null or valido_de<=now()) and (valido_ate is null or valido_ate>=now())
      and (limite_usos is null or usos<limite_usos)
    limit 1;
    if not found then raise exception 'Cupom inválido ou expirado'; end if;
    if v_subtotal < v_cupom.pedido_minimo then raise exception 'Pedido abaixo do mínimo do cupom'; end if;
    v_desconto := case when v_cupom.tipo='percentual'
      then round(v_subtotal * least(v_cupom.valor,100) / 100,2)
      else least(v_cupom.valor,v_subtotal) end;
    update public.cupons set usos=usos+1 where id=v_cupom.id;
  end if;

  insert into public.clientes(estabelecimento_id,nome,telefone)
  values(v_est.id,left(v_nome,120),left(v_telefone,30))
  on conflict(estabelecimento_id,telefone_normalizado)
  where telefone_normalizado is not null and telefone_normalizado <> ''
  do update set nome=excluded.nome, telefone=excluded.telefone, updated_at=now()
  returning id into v_cliente;

  if v_tipo='entrega' then
    if nullif(v_end->>'id','') is not null then
      begin
        select id into v_endereco_id from public.cliente_enderecos
        where id=(v_end->>'id')::uuid and cliente_id=v_cliente and estabelecimento_id=v_est.id and ativo=true;
      exception when invalid_text_representation then
        v_endereco_id := null;
      end;
    end if;

    if v_endereco_id is null then
      select id into v_endereco_id from public.cliente_enderecos
      where cliente_id=v_cliente and estabelecimento_id=v_est.id and ativo=true
        and coalesce(cep,'')=v_cep and lower(trim(logradouro))=lower(v_logradouro)
        and lower(trim(numero))=lower(v_numero)
      order by principal desc, updated_at desc limit 1;
    end if;

    if v_endereco_id is null then
      select not exists(select 1 from public.cliente_enderecos where cliente_id=v_cliente and ativo=true) into v_primeiro_endereco;
      insert into public.cliente_enderecos(
        estabelecimento_id,cliente_id,apelido,cep,logradouro,numero,complemento,bairro,cidade,estado,referencia,principal,ativo
      ) values(
        v_est.id,v_cliente,case when v_primeiro_endereco then 'Principal' else 'Endereço' end,
        v_cep,left(v_logradouro,250),left(v_numero,30),nullif(left(v_complemento,180),''),
        nullif(left(v_bairro_endereco,120),''),nullif(left(v_cidade,120),''),nullif(left(v_estado,30),''),
        nullif(left(v_complemento,180),''),v_primeiro_endereco,true
      ) returning id into v_endereco_id;
    else
      update public.cliente_enderecos set
        cep=v_cep,logradouro=left(v_logradouro,250),numero=left(v_numero,30),
        complemento=nullif(left(v_complemento,180),''),bairro=nullif(left(v_bairro_endereco,120),''),
        cidade=nullif(left(v_cidade,120),''),estado=nullif(left(v_estado,30),''),updated_at=now()
      where id=v_endereco_id;
    end if;
  end if;

  insert into public.pedidos(
    estabelecimento_id,cliente_id,codigo,status,tipo,subtotal,taxa_entrega,taxa_servico,desconto,desconto_cupom,total,
    forma_pagamento,troco_para,endereco_entrega,observacoes,mesa_id,bairro_entrega,cupom_codigo,cliente_endereco_id,checkout_token
  ) values(
    v_est.id,v_cliente,'PED-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS'),'novo',v_tipo,v_subtotal,v_taxa,v_taxa_servico,
    v_desconto,v_desconto,greatest(0,v_subtotal+v_taxa+v_taxa_servico-v_desconto),left(v_pagamento,50),v_troco,
    case when v_tipo='entrega' then jsonb_build_object(
      'texto',left(v_texto_endereco,500),'endereco',left(v_texto_endereco,500),'cep',v_cep,
      'logradouro',left(v_logradouro,250),'numero',left(v_numero,30),'complemento',left(v_complemento,180),
      'bairro',left(v_bairro_endereco,120),'regiao',left(coalesce(payload->>'bairro',''),120),
      'cidade',left(v_cidade,120),'estado',left(v_estado,30)
    ) else null end,
    left(coalesce(payload->>'observacoes',''),500),v_mesa,left(coalesce(payload->>'bairro',v_bairro_endereco),120),
    nullif(upper(payload->>'cupom'),''),v_endereco_id,v_checkout
  ) returning id,codigo into v_pedido,v_codigo;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_qtd:=greatest(1,least(99,coalesce((v_item->>'quantidade')::integer,1)));
    select * into v_prod from public.produtos where id=(v_item->>'produto_id')::uuid and estabelecimento_id=v_est.id and ativo=true;
    insert into public.itens_pedido(pedido_id,produto_id,nome_produto,quantidade,valor_unitario,observacoes,total)
    values(v_pedido,v_prod.id,v_prod.nome,v_qtd,v_prod.preco,left(coalesce(v_item->>'observacoes',''),300),v_prod.preco*v_qtd);
  end loop;

  return v_codigo;
exception
  when unique_violation then
    if v_checkout is not null then
      select codigo into v_codigo from public.pedidos where estabelecimento_id=v_est.id and checkout_token=v_checkout limit 1;
      if v_codigo is not null then return v_codigo; end if;
    end if;
    raise;
end;
$$;

grant execute on function public.criar_pedido_publico(jsonb) to anon, authenticated;
