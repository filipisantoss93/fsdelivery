-- FS Delivery — rastreamento seguro de pedidos do cliente
begin;

create or replace function public.consultar_pedidos_cliente(
  p_slug text,
  p_telefone text
)
returns table (
  id bigint,
  codigo text,
  status text,
  tipo text,
  total numeric,
  forma_pagamento text,
  endereco_entrega jsonb,
  created_at timestamptz,
  itens jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estabelecimento_id uuid;
  v_telefone text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  if length(v_telefone) not between 10 and 11 then
    raise exception 'WhatsApp inválido.';
  end if;

  select e.id into v_estabelecimento_id
  from public.estabelecimentos e
  where e.slug = trim(p_slug)
  limit 1;

  if v_estabelecimento_id is null then
    raise exception 'Loja não encontrada.';
  end if;

  return query
  select
    p.id,
    p.codigo,
    p.status,
    p.tipo,
    p.total,
    p.forma_pagamento,
    p.endereco_entrega,
    p.created_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'quantidade', i.quantidade,
        'nome', i.nome_produto,
        'valor_unitario', i.valor_unitario,
        'total', i.total,
        'observacoes', i.observacoes
      ) order by i.id)
      from public.itens_pedido i
      where i.pedido_id = p.id
    ), '[]'::jsonb) as itens
  from public.pedidos p
  join public.clientes c on c.id = p.cliente_id
  where p.estabelecimento_id = v_estabelecimento_id
    and regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g') = v_telefone
    and p.created_at >= now() - interval '90 days'
  order by p.created_at desc
  limit 30;
end;
$$;

revoke all on function public.consultar_pedidos_cliente(text, text) from public;
grant execute on function public.consultar_pedidos_cliente(text, text) to anon, authenticated;

comment on function public.consultar_pedidos_cliente(text, text) is
  'Retorna somente pedidos recentes da loja e do WhatsApp informados, sem liberar SELECT direto nas tabelas.';

commit;