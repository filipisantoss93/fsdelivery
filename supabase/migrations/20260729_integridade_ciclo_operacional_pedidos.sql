-- FS Delivery — integridade do ciclo operacional dos pedidos
begin;

create or replace function public.atualizar_status_pedido_operacional(
  p_pedido_id bigint,
  p_novo_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_usuario uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_novo_status, '')));
begin
  if v_usuario is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;

  if p_pedido_id is null or p_pedido_id <= 0 then
    raise exception 'Pedido inválido.';
  end if;

  if v_status not in ('preparo', 'pronto', 'cancelado') then
    raise exception 'Status operacional inválido.';
  end if;

  select p.*
    into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  where p.id = p_pedido_id
    and e.usuario_id = v_usuario
  for update of p;

  if v_pedido.id is null then
    raise exception 'Pedido não encontrado para este estabelecimento.';
  end if;

  if v_pedido.status = v_status then
    return jsonb_build_object(
      'pedido_id', v_pedido.id,
      'status', v_pedido.status,
      'alterado', false
    );
  end if;

  if v_pedido.status in ('entregue', 'cancelado') then
    raise exception 'Pedido finalizado não pode ser alterado.';
  end if;

  if v_status = 'preparo' and v_pedido.status not in ('novo', 'confirmado') then
    raise exception 'Somente pedidos novos ou confirmados podem iniciar o preparo.';
  end if;

  if v_status = 'pronto' and v_pedido.status <> 'preparo' then
    raise exception 'O pedido precisa estar em preparo antes de ficar pronto.';
  end if;

  if v_status = 'cancelado' and v_pedido.status not in ('novo', 'confirmado', 'preparo') then
    raise exception 'Este pedido não pode mais ser cancelado nesta etapa.';
  end if;

  update public.pedidos
  set status = v_status,
      atualizado_em = now()
  where id = v_pedido.id;

  return jsonb_build_object(
    'pedido_id', v_pedido.id,
    'status_anterior', v_pedido.status,
    'status', v_status,
    'alterado', true
  );
end;
$$;

-- Compatibilidade com a interface atual da cozinha.
create or replace function public.concluir_pedido_cozinha(p_pedido_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.pedidos where id = p_pedido_id;

  if v_status in ('novo', 'confirmado') then
    return public.atualizar_status_pedido_operacional(p_pedido_id, 'preparo');
  elsif v_status = 'preparo' then
    return public.atualizar_status_pedido_operacional(p_pedido_id, 'pronto');
  end if;

  raise exception 'O pedido não está em uma etapa válida da cozinha.';
end;
$$;

revoke all on function public.atualizar_status_pedido_operacional(bigint, text) from public;
revoke all on function public.concluir_pedido_cozinha(bigint) from public;
grant execute on function public.atualizar_status_pedido_operacional(bigint, text) to authenticated;
grant execute on function public.concluir_pedido_cozinha(bigint) to authenticated;

comment on function public.atualizar_status_pedido_operacional(bigint, text) is
  'Valida propriedade e permite apenas transições operacionais coerentes do pedido.';

commit;
