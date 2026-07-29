-- FS Delivery — idempotência e validação defensiva dos pedidos públicos
-- Aplicar após 20260729_pedidos_mesa.sql.

alter table public.pedidos
  add column if not exists request_fingerprint text;

create index if not exists idx_pedidos_fingerprint_recente
  on public.pedidos(estabelecimento_id, request_fingerprint, created_at desc)
  where request_fingerprint is not null;

create or replace function public.criar_pedido_publico(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estabelecimento public.estabelecimentos%rowtype;
  v_cliente_id uuid;
  v_mesa public.mesas%rowtype;
  v_pedido_id bigint;
  v_codigo text;
  v_codigo_existente text;
  v_tipo text;
  v_subtotal numeric(10,2) := 0;
  v_taxa numeric(10,2) := 0;
  v_item jsonb;
  v_produto public.produtos%rowtype;
  v_quantidade integer;
  v_nome text;
  v_telefone text;
  v_endereco text;
  v_pagamento text;
  v_observacoes text;
  v_fingerprint text;
  v_total_itens integer := 0;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do pedido inválidos.';
  end if;

  select * into v_estabelecimento
  from public.estabelecimentos
  where slug = trim(coalesce(payload->>'slug',''))
  limit 1;

  if v_estabelecimento.id is null then
    raise exception 'Loja não encontrada.';
  end if;

  if not coalesce(v_estabelecimento.aberto, false) then
    raise exception 'A loja está fechada no momento.';
  end if;

  v_tipo := lower(trim(coalesce(payload->>'tipo','retirada')));
  if v_tipo not in ('entrega','retirada','local','mesa') then
    raise exception 'Tipo de pedido inválido.';
  end if;

  v_nome := left(trim(coalesce(payload->>'nome','')),120);
  v_telefone := regexp_replace(coalesce(payload->>'telefone',''),'\D','','g');
  v_endereco := left(trim(coalesce(payload->>'endereco','')),500);
  v_pagamento := left(trim(coalesce(payload->>'pagamento','')),80);
  v_observacoes := nullif(left(trim(coalesce(payload->>'observacoes','')),500),'');

  if length(v_nome) < 2 then
    raise exception 'Informe o nome do cliente.';
  end if;

  if length(v_telefone) not between 10 and 13 then
    raise exception 'Informe um WhatsApp válido com DDD.';
  end if;

  if v_tipo = 'entrega' and length(v_endereco) < 8 then
    raise exception 'Informe o endereço completo.';
  end if;

  if v_tipo = 'mesa' then
    select * into v_mesa
    from public.mesas
    where estabelecimento_id = v_estabelecimento.id
      and token_publico::text = nullif(payload->>'mesa_token','')
      and ativo = true
    limit 1;

    if v_mesa.id is null then
      raise exception 'Mesa inválida ou indisponível.';
    end if;
  elsif nullif(payload->>'mesa_token','') is not null then
    raise exception 'O QR Code de mesa só pode gerar pedido local.';
  end if;

  if jsonb_typeof(coalesce(payload->'itens','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(payload->'itens','[]'::jsonb)) = 0 then
    raise exception 'Adicione ao menos um produto.';
  end if;

  if jsonb_array_length(payload->'itens') > 50 then
    raise exception 'O pedido possui itens demais.';
  end if;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    begin
      v_quantidade := (v_item->>'quantidade')::integer;
    exception when others then
      raise exception 'Quantidade inválida.';
    end;

    if v_quantidade <= 0 or v_quantidade > 99 then
      raise exception 'Quantidade inválida.';
    end if;

    v_total_itens := v_total_itens + v_quantidade;
    if v_total_itens > 200 then
      raise exception 'A quantidade total de itens excede o limite permitido.';
    end if;

    begin
      select * into v_produto
      from public.produtos
      where id = (v_item->>'produto_id')::uuid
        and estabelecimento_id = v_estabelecimento.id
        and ativo = true;
    exception when invalid_text_representation then
      raise exception 'Produto inválido ou indisponível.';
    end;

    if v_produto.id is null then
      raise exception 'Produto inválido ou indisponível.';
    end if;

    v_subtotal := v_subtotal + round(v_produto.preco * v_quantidade,2);
  end loop;

  if v_tipo <> 'mesa' and v_subtotal < coalesce(v_estabelecimento.pedido_minimo,0) then
    raise exception 'O pedido não atingiu o valor mínimo.';
  end if;

  if v_tipo = 'entrega' then
    v_taxa := coalesce(v_estabelecimento.taxa_entrega,0);
  end if;

  -- O fingerprint usa somente dados que definem o pedido. Campos e preços são
  -- normalizados pelo banco antes da comparação.
  v_fingerprint := md5(jsonb_build_object(
    'estabelecimento',v_estabelecimento.id,
    'tipo',v_tipo,
    'mesa',v_mesa.id,
    'nome',lower(v_nome),
    'telefone',v_telefone,
    'endereco',lower(v_endereco),
    'pagamento',lower(v_pagamento),
    'observacoes',v_observacoes,
    'itens',payload->'itens',
    'subtotal',v_subtotal,
    'taxa',v_taxa
  )::text);

  -- Serializa tentativas simultâneas do mesmo pedido. A segunda chamada aguarda
  -- a primeira e reutiliza o código já criado.
  perform pg_advisory_xact_lock(hashtext(v_estabelecimento.id::text),hashtext(v_fingerprint));

  select codigo into v_codigo_existente
  from public.pedidos
  where estabelecimento_id = v_estabelecimento.id
    and request_fingerprint = v_fingerprint
    and created_at >= now() - interval '60 seconds'
  order by created_at desc
  limit 1;

  if v_codigo_existente is not null then
    return v_codigo_existente;
  end if;

  insert into public.clientes(estabelecimento_id,nome,telefone)
  values (v_estabelecimento.id,v_nome,v_telefone)
  on conflict (estabelecimento_id,telefone)
  do update set nome = excluded.nome
  returning id into v_cliente_id;

  v_codigo := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.pedidos(
    estabelecimento_id,cliente_id,codigo,status,tipo,subtotal,taxa_entrega,total,
    forma_pagamento,endereco_entrega,observacoes,mesa_id,origem,request_fingerprint
  ) values (
    v_estabelecimento.id,v_cliente_id,v_codigo,'novo',v_tipo,v_subtotal,v_taxa,
    v_subtotal+v_taxa,v_pagamento,
    case when v_tipo='entrega' then jsonb_build_object('texto',v_endereco) else null end,
    v_observacoes,v_mesa.id,
    case when v_tipo='mesa' then 'qr_mesa' else 'publico' end,
    v_fingerprint
  ) returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_quantidade := (v_item->>'quantidade')::integer;

    select * into v_produto
    from public.produtos
    where id=(v_item->>'produto_id')::uuid
      and estabelecimento_id=v_estabelecimento.id
      and ativo=true;

    insert into public.itens_pedido(
      pedido_id,produto_id,nome_produto,quantidade,valor_unitario,observacoes,total
    ) values (
      v_pedido_id,v_produto.id,v_produto.nome,v_quantidade,v_produto.preco,
      nullif(left(trim(coalesce(v_item->>'observacoes','')),300),''),
      round(v_produto.preco*v_quantidade,2)
    );
  end loop;

  return v_codigo;
end;
$$;

revoke all on function public.criar_pedido_publico(jsonb) from public;
grant execute on function public.criar_pedido_publico(jsonb) to anon, authenticated;
