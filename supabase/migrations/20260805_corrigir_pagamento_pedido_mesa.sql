-- Pedidos de mesa são cobrados depois do atendimento e não exigem forma de pagamento no envio.
do $$
declare
  definicao text;
  corrigida text;
begin
  select pg_get_functiondef('public.criar_pedido_publico(jsonb)'::regprocedure) into definicao;
  corrigida := replace(
    definicao,
    E'  if v_tem_cfg\n     and jsonb_array_length(coalesce(v_cfg.formas_pagamento,''[]''::jsonb)) > 0',
    E'  if v_tipo <> ''mesa'' and v_tem_cfg\n     and jsonb_array_length(coalesce(v_cfg.formas_pagamento,''[]''::jsonb)) > 0'
  );
  if corrigida = definicao then
    raise exception 'Trecho de validação de pagamento não encontrado';
  end if;
  execute corrigida;
end;
$$;

grant execute on function public.criar_pedido_publico(jsonb) to anon,authenticated;
