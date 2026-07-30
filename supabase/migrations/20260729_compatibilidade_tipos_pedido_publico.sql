-- FS Delivery — compatibilidade entre a interface pública e o domínio do banco
-- A interface usa delivery/pickup; o banco opera com entrega/retirada.

begin;

do $$
begin
  if to_regprocedure('public.criar_pedido_publico_legacy(jsonb)') is null
     and to_regprocedure('public.criar_pedido_publico(jsonb)') is not null then
    alter function public.criar_pedido_publico(jsonb)
      rename to criar_pedido_publico_legacy;
  end if;
end;
$$;

create or replace function public.criar_pedido_publico(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_tipo text;
  v_resultado text;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do pedido inválidos.';
  end if;

  if to_regprocedure('public.criar_pedido_publico_legacy(jsonb)') is null then
    raise exception 'A função base de criação de pedidos não está instalada.';
  end if;

  v_tipo := lower(trim(coalesce(payload->>'tipo', '')));
  v_tipo := case v_tipo
    when 'delivery' then 'entrega'
    when 'pickup' then 'retirada'
    when 'entrega' then 'entrega'
    when 'retirada' then 'retirada'
    when 'local' then 'local'
    when 'mesa' then 'mesa'
    else null
  end;

  if v_tipo is null then
    raise exception 'Tipo de pedido inválido.';
  end if;

  v_payload := jsonb_set(payload, '{tipo}', to_jsonb(v_tipo), true);

  -- Mantém compatibilidade com versões que nomeavam o token da mesa de forma diferente.
  if nullif(v_payload->>'mesa_token', '') is null
     and nullif(v_payload->>'codigo_qr', '') is not null then
    v_payload := jsonb_set(v_payload, '{mesa_token}', to_jsonb(v_payload->>'codigo_qr'), true);
  end if;

  execute 'select public.criar_pedido_publico_legacy($1)'
    into v_resultado
    using v_payload;

  return v_resultado;
end;
$$;

revoke all on function public.criar_pedido_publico(jsonb) from public;
grant execute on function public.criar_pedido_publico(jsonb) to anon, authenticated;

comment on function public.criar_pedido_publico(jsonb) is
  'Normaliza delivery/pickup para entrega/retirada antes de executar a criação pública validada e idempotente.';

commit;
