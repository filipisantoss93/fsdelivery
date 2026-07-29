-- FS Delivery — pedidos internos criados pelo garçom
create or replace function public.criar_pedido_garcom(payload jsonb)
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
  v_tipo text;
  v_subtotal numeric(10,2) := 0;
  v_taxa numeric(10,2) := 0;
  v_item jsonb;
  v_produto public.produtos%rowtype;
  v_quantidade integer;
  v_nome text;
  v_telefone text;
begin
  if auth.uid() is null then
    raise exception 'Acesso não autorizado.';
  end if;

  select * into v_estabelecimento
  from public.estabelecimentos
  where usuario_id = auth.uid()
  limit 1;

  if v_estabelecimento.id is null then
    raise exception 'Estabelecimento não encontrado.';
  end if;

  v_tipo := coalesce(payload->>'tipo','mesa');
  if v_tipo not in ('mesa','entrega','retirada','local') then
    raise exception 'Tipo de atendimento inválido.';
  end if;

  if v_tipo = 'mesa' then
    select * into v_mesa
    from public.mesas
    where id = (payload->>'mesa_id')::uuid
      and estabelecimento_id = v_estabelecimento.id
      and ativo = true
    limit 1;
    if v_mesa.id is null then raise exception 'Mesa inválida ou inativa.'; end if;
  end if;

  if jsonb_array_length(coalesce(payload->'itens','[]'::jsonb)) = 0 then
    raise exception 'Adicione ao menos um produto.';
  end if;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_quantidade := greatest(coalesce((v_item->>'quantidade')::integer,0),0);
    if v_quantidade <= 0 then raise exception 'Quantidade inválida.'; end if;

    select * into v_produto
    from public.produtos
    where id = (v_item->>'produto_id')::uuid
      and estabelecimento_id = v_estabelecimento.id
      and ativo = true;

    if v_produto.id is null then raise exception 'Produto inválido ou indisponível.'; end if;
    v_subtotal := v_subtotal + (v_produto.preco * v_quantidade);
  end loop;

  if v_tipo = 'entrega' then
    if nullif(trim(payload->>'endereco'),'') is null then raise exception 'Informe o endereço completo.'; end if;
    v_taxa := coalesce(v_estabelecimento.taxa_entrega,0);
  end if;

  v_nome := nullif(trim(payload->>'nome'),'');
  v_telefone := nullif(trim(payload->>'telefone'),'');

  if v_tipo in ('entrega','retirada') and (v_nome is null or v_telefone is null) then
    raise exception 'Informe nome e WhatsApp do cliente.';
  end if;

  if v_nome is not null and v_telefone is not null then
    insert into public.clientes(estabelecimento_id,nome,telefone)
    values (v_estabelecimento.id,v_nome,v_telefone)
    on conflict (estabelecimento_id,telefone) do update set nome=excluded.nome
    returning id into v_cliente_id;
  end if;

  v_codigo := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.pedidos(
    estabelecimento_id,cliente_id,codigo,status,tipo,subtotal,taxa_entrega,total,
    forma_pagamento,endereco_entrega,observacoes,mesa_id,origem
  ) values (
    v_estabelecimento.id,v_cliente_id,v_codigo,'novo',v_tipo,v_subtotal,v_taxa,
    v_subtotal+v_taxa,payload->>'pagamento',
    case when v_tipo='entrega' then jsonb_build_object('texto',payload->>'endereco') else null end,
    nullif(payload->>'observacoes',''),v_mesa.id,'painel'
  ) returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_quantidade := (v_item->>'quantidade')::integer;
    select * into v_produto from public.produtos where id=(v_item->>'produto_id')::uuid;
    insert into public.itens_pedido(
      pedido_id,produto_id,nome_produto,quantidade,valor_unitario,observacoes,total
    ) values (
      v_pedido_id,v_produto.id,v_produto.nome,v_quantidade,v_produto.preco,
      nullif(v_item->>'observacoes',''),v_produto.preco*v_quantidade
    );
  end loop;

  return v_codigo;
end;
$$;

grant execute on function public.criar_pedido_garcom(jsonb) to authenticated;