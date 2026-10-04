-- Corrige os limites operacionais no servidor, além dos controles da interface.
-- Consumo no local é sempre um pedido de mesa (QR ou garçom); "local" não é tipo público.
alter function public.criar_pedido_publico(jsonb) rename to criar_pedido_publico_base_20261004;
revoke all on function public.criar_pedido_publico_base_20261004(jsonb) from public, anon, authenticated;

create or replace function public.criar_pedido_publico(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
begin
  if lower(coalesce(payload->>'tipo','')) = 'local' then
    raise exception 'Para consumo local, faça o pedido pelo QR Code da mesa.';
  end if;
  return public.criar_pedido_publico_base_20261004(payload);
end;
$function$;

revoke all on function public.criar_pedido_publico(jsonb) from public;
grant execute on function public.criar_pedido_publico(jsonb) to anon, authenticated;

-- O garçom recebe somente pedidos de mesa e não precisa de dados de contato do cliente.
alter function public.carregar_operacao_garcom(text, text) rename to carregar_operacao_garcom_base_20261004;
revoke all on function public.carregar_operacao_garcom_base_20261004(text, text) from public, anon, authenticated;

create or replace function public.carregar_operacao_garcom(p_telefone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  v_result := public.carregar_operacao_garcom_base_20261004(p_telefone, p_pin);
  return jsonb_set(
    v_result,
    '{pedidos}',
    coalesce((
      select jsonb_agg(
        pedido - 'cliente_nome' - 'cliente_telefone'
        order by item.ordinalidade
      )
      from jsonb_array_elements(coalesce(v_result->'pedidos', '[]'::jsonb))
        with ordinality as item(pedido, ordinalidade)
      where pedido->>'tipo' = 'mesa'
    ), '[]'::jsonb),
    true
  );
end;
$function$;

revoke all on function public.carregar_operacao_garcom(text, text) from public;
grant execute on function public.carregar_operacao_garcom(text, text) to anon, authenticated;

-- O endpoint autenticado do garçom também só pode criar pedidos vinculados a mesa.
alter function public.criar_pedido_equipe_garcom(text, text, jsonb) rename to criar_pedido_equipe_garcom_base_20261004;
revoke all on function public.criar_pedido_equipe_garcom_base_20261004(text, text, jsonb) from public, anon, authenticated;

create or replace function public.criar_pedido_equipe_garcom(p_telefone text, p_pin text, payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
begin
  if lower(coalesce(payload->>'tipo','')) <> 'mesa'
     or nullif(payload->>'mesa_id','') is null then
    raise exception 'O garçom deve selecionar uma mesa antes de enviar o pedido.';
  end if;
  return public.criar_pedido_equipe_garcom_base_20261004(p_telefone, p_pin, payload);
end;
$function$;

revoke all on function public.criar_pedido_equipe_garcom(text, text, jsonb) from public;
grant execute on function public.criar_pedido_equipe_garcom(text, text, jsonb) to anon, authenticated;
