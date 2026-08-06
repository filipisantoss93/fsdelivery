create or replace function public.consultar_pedidos_cliente(p_slug text, p_telefone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estabelecimento uuid;
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone,''));
  v_resultado jsonb;
begin
  if char_length(v_telefone) < 10 or char_length(v_telefone) > 13 then
    raise exception 'WhatsApp inválido';
  end if;

  select id into v_estabelecimento
  from public.estabelecimentos
  where slug = trim(p_slug)
  limit 1;

  if v_estabelecimento is null then
    raise exception 'Estabelecimento não encontrado';
  end if;

  select coalesce(jsonb_agg(pedido order by (pedido->>'created_at')::timestamptz desc), '[]'::jsonb)
  into v_resultado
  from (
    select jsonb_build_object(
      'id', p.id,
      'codigo', p.codigo,
      'status', p.status,
      'status_entrega', p.status_entrega,
      'tipo', p.tipo,
      'subtotal', p.subtotal,
      'taxa_entrega', p.taxa_entrega,
      'taxa_servico', p.taxa_servico,
      'desconto', p.desconto,
      'total', p.total,
      'forma_pagamento', p.forma_pagamento,
      'troco_para', p.troco_para,
      'endereco_entrega', p.endereco_entrega,
      'observacoes', p.observacoes,
      'created_at', p.created_at,
      'atualizado_em', p.atualizado_em,
      'saiu_para_entrega_em', p.saiu_para_entrega_em,
      'entregue_em', p.entregue_em,
      'origem', 'publico',
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'produto_id', i.produto_id,
          'nome', i.nome_produto,
          'quantidade', i.quantidade,
          'valor_unitario', i.valor_unitario,
          'observacoes', i.observacoes,
          'total', i.total
        ) order by i.id)
        from public.itens_pedido i
        where i.pedido_id = p.id
      ), '[]'::jsonb)
    ) as pedido
    from public.pedidos p
    join public.clientes c on c.id = p.cliente_id
    where p.estabelecimento_id = v_estabelecimento
      and c.estabelecimento_id = v_estabelecimento
      and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
      and p.created_at >= now() - interval '90 days'
    order by p.created_at desc
    limit 50
  ) dados;

  return v_resultado;
end;
$$;

revoke all on function public.consultar_pedidos_cliente(text,text) from public;
grant execute on function public.consultar_pedidos_cliente(text,text) to anon, authenticated;