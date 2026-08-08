-- Separa autorização da liquidação do cartão e protege os campos financeiros.
-- `approved` autoriza a operação do pedido; `paid`/`settled` continuam
-- representando a liquidação confirmada pela Efí.

alter table public.pedidos
  add column if not exists pagamento_autorizado_em timestamptz;

alter table public.pedidos
  drop constraint if exists pedidos_pagamento_status_check;

alter table public.pedidos
  add constraint pedidos_pagamento_status_check
  check (pagamento_status in (
    'nao_iniciado', 'aguardando', 'em_analise', 'autorizado', 'pago',
    'recusado', 'cancelado', 'estornado', 'chargeback'
  ));

drop index if exists public.pedidos_pagamento_pendente_idx;
create index pedidos_pagamento_pendente_idx
  on public.pedidos(estabelecimento_id, pagamento_status, created_at desc)
  where pagamento_status in ('aguardando', 'em_analise', 'autorizado');

create or replace function public.fsdelivery_mapear_status_efi_pedido(p_status text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case lower(coalesce(p_status, ''))
    when 'new' then 'aguardando'
    when 'waiting' then 'aguardando'
    when 'identified' then 'em_analise'
    when 'approved' then 'autorizado'
    when 'paid' then 'pago'
    when 'settled' then 'pago'
    when 'unpaid' then 'recusado'
    when 'expired' then 'cancelado'
    when 'canceled' then 'cancelado'
    when 'refunded' then 'estornado'
    when 'contested' then 'chargeback'
    else 'em_analise'
  end
$function$;

revoke all on function public.fsdelivery_mapear_status_efi_pedido(text)
  from public, anon, authenticated;
grant execute on function public.fsdelivery_mapear_status_efi_pedido(text)
  to service_role;

create or replace function public.fsdelivery_proteger_pedido_cartao_online()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_role text := coalesce(auth.role(), '');
begin
  if tg_op = 'INSERT' and v_request_role in ('anon', 'authenticated') then
    new.pagamento_status := 'nao_iniciado';
    new.pagamento_provedor := null;
    new.efi_charge_id := null;
    new.pagamento_autorizado_em := null;
    new.pagamento_confirmado_em := null;
  elsif tg_op = 'UPDATE' and v_request_role in ('anon', 'authenticated') then
    if new.pagamento_status is distinct from old.pagamento_status
      or new.pagamento_provedor is distinct from old.pagamento_provedor
      or new.efi_charge_id is distinct from old.efi_charge_id
      or new.pagamento_autorizado_em is distinct from old.pagamento_autorizado_em
      or new.pagamento_confirmado_em is distinct from old.pagamento_confirmado_em then
      raise exception 'Campos financeiros do pedido são controlados exclusivamente pelo backend de pagamentos'
        using errcode = '42501';
    end if;
    if old.forma_pagamento = 'Cartão on-line'
      and new.forma_pagamento is distinct from old.forma_pagamento then
      raise exception 'A forma de pagamento de um pedido com cartão on-line não pode ser alterada'
        using errcode = '42501';
    end if;
  end if;

  if new.forma_pagamento = 'Cartão on-line' then
    if tg_op = 'INSERT' then
      new.pagamento_status := case
        when new.pagamento_status in ('autorizado', 'pago') then new.pagamento_status
        else 'aguardando'
      end;
      if new.pagamento_status not in ('autorizado', 'pago')
        and new.status not in ('cancelado', 'finalizado', 'entregue') then
        new.status := 'aguardando_aprovacao';
      end if;
    elsif new.status is distinct from old.status
      and coalesce(old.pagamento_status, 'nao_iniciado') not in ('autorizado', 'pago')
      and new.status not in ('aguardando_aprovacao', 'cancelado') then
      raise exception 'Pedido com cartão on-line só pode avançar após autorização do pagamento';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.fsdelivery_proteger_pedido_cartao_online()
  from public, anon, authenticated;

create or replace function public.fsdelivery_aplicar_evento_pagamento_pedido(
  p_evento_id text,
  p_charge_id bigint,
  p_status_efi text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tentativa public.cobrancas_pedido_cartao%rowtype;
  v_pedido public.pedidos%rowtype;
  v_evento uuid;
  v_status_efi text;
  v_recebido text;
  v_atual text;
  v_aplicado text;
  v_rank_recebido integer;
  v_rank_tentativa integer;
  v_aplicar_tentativa boolean;
  v_agora timestamptz := now();
begin
  if p_evento_id is null or length(p_evento_id) < 3 or length(p_evento_id) > 300 then
    raise exception 'Identificador de evento inválido';
  end if;
  if p_charge_id is null or p_charge_id <= 0 then
    raise exception 'Identificador de cobrança inválido';
  end if;

  select c.* into v_tentativa
  from public.cobrancas_pedido_cartao c
  where c.efi_charge_id = p_charge_id
  for update;

  if not found then
    return jsonb_build_object('ignorado', true, 'motivo', 'cobranca_nao_encontrada');
  end if;

  v_status_efi := lower(coalesce(nullif(trim(p_status_efi), ''), 'unknown'));

  insert into public.pagamento_eventos (
    provedor, evento_id, pedido_id, efi_charge_id, tipo, payload
  ) values (
    'efi', p_evento_id, v_tentativa.pedido_id, p_charge_id,
    left(v_status_efi, 80), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provedor, evento_id) do nothing
  returning id into v_evento;

  if v_evento is null then
    return jsonb_build_object('ignorado', true, 'motivo', 'evento_duplicado');
  end if;

  if v_status_efi not in (
    'new', 'waiting', 'identified', 'approved', 'paid', 'settled',
    'unpaid', 'expired', 'canceled', 'refunded', 'contested'
  ) then
    update public.pagamento_eventos
    set processado_em = v_agora,
        erro_processamento = 'status_efi_desconhecido'
    where id = v_evento;
    return jsonb_build_object('ignorado', true, 'motivo', 'status_efi_desconhecido');
  end if;

  select p.* into v_pedido
  from public.pedidos p
  where p.id = v_tentativa.pedido_id
  for update;

  if not found then
    update public.pagamento_eventos
    set processado_em = v_agora,
        erro_processamento = 'pedido_nao_encontrado'
    where id = v_evento;
    return jsonb_build_object('ignorado', true, 'motivo', 'pedido_nao_encontrado');
  end if;

  v_recebido := public.fsdelivery_mapear_status_efi_pedido(v_status_efi);
  v_atual := coalesce(v_pedido.pagamento_status, 'nao_iniciado');

  v_aplicado := case
    when v_atual = 'chargeback' then 'chargeback'
    when v_recebido = 'chargeback' then 'chargeback'
    when v_atual = 'estornado' then 'estornado'
    when v_recebido = 'estornado' then 'estornado'
    when v_recebido = 'pago' then 'pago'
    when v_atual = 'pago' then 'pago'
    when v_atual in ('recusado', 'cancelado') then v_atual
    when v_recebido in ('recusado', 'cancelado') then v_recebido
    when array_position(
      array['nao_iniciado', 'aguardando', 'em_analise', 'autorizado'], v_recebido
    ) >= array_position(
      array['nao_iniciado', 'aguardando', 'em_analise', 'autorizado'], v_atual
    ) then v_recebido
    else v_atual
  end;

  v_rank_recebido := case v_status_efi
    when 'new' then 10
    when 'waiting' then 20
    when 'identified' then 30
    when 'approved' then 40
    when 'unpaid' then 50
    when 'expired' then 50
    when 'canceled' then 50
    when 'paid' then 60
    when 'settled' then 60
    when 'refunded' then 70
    when 'contested' then 80
    else 0
  end;
  v_rank_tentativa := case lower(coalesce(v_tentativa.status, ''))
    when 'criando' then 5
    when 'new' then 10
    when 'pagando' then 15
    when 'erro' then 15
    when 'waiting' then 20
    when 'identified' then 30
    when 'approved' then 40
    when 'unpaid' then 50
    when 'expired' then 50
    when 'canceled' then 50
    when 'paid' then 60
    when 'settled' then 60
    when 'refunded' then 70
    when 'contested' then 80
    else 0
  end;
  v_aplicar_tentativa := v_aplicado = v_recebido
    and v_rank_recebido >= v_rank_tentativa;

  update public.cobrancas_pedido_cartao
  set status = case when v_aplicar_tentativa then left(v_status_efi, 40) else status end,
      payload_pagamento = case
        when v_aplicar_tentativa then coalesce(p_payload, '{}'::jsonb)
        else payload_pagamento
      end,
      erro = case when v_aplicar_tentativa then null else erro end,
      updated_at = case when v_aplicar_tentativa then v_agora else updated_at end
  where id = v_tentativa.id;

  update public.pedidos
  set pagamento_status = v_aplicado,
      pagamento_provedor = 'efi',
      pagamento_autorizado_em = case
        when v_aplicado in ('autorizado', 'pago')
          then coalesce(pagamento_autorizado_em, v_agora)
        else pagamento_autorizado_em
      end,
      pagamento_confirmado_em = case
        when v_aplicado = 'pago' then coalesce(pagamento_confirmado_em, v_agora)
        else pagamento_confirmado_em
      end,
      status = case
        when v_aplicado in ('recusado', 'cancelado', 'estornado', 'chargeback')
          and status not in ('cancelado', 'finalizado', 'entregue') then 'cancelado'
        when v_aplicado in ('autorizado', 'pago')
          and v_atual in ('recusado', 'cancelado')
          and status = 'cancelado' then 'aguardando_aprovacao'
        else status
      end,
      atualizado_em = v_agora
  where id = v_pedido.id;

  update public.pagamento_eventos
  set processado_em = v_agora,
      erro_processamento = null
  where id = v_evento;

  return jsonb_build_object(
    'ignorado', false,
    'pedido_id', v_pedido.id,
    'cobranca_id', p_charge_id,
    'status_recebido', v_recebido,
    'status_anterior', v_atual,
    'status_aplicado', v_aplicado,
    'status_tentativa_preservado', not v_aplicar_tentativa
  );
end;
$function$;

revoke all on function public.fsdelivery_aplicar_evento_pagamento_pedido(text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fsdelivery_aplicar_evento_pagamento_pedido(text, bigint, text, jsonb)
  to service_role;

update public.pedidos p
set pagamento_status = 'autorizado',
    pagamento_autorizado_em = coalesce(p.pagamento_autorizado_em, c.updated_at, p.atualizado_em, now()),
    atualizado_em = now()
from (
  select distinct on (pedido_id) pedido_id, updated_at
  from public.cobrancas_pedido_cartao
  where status = 'approved'
  order by pedido_id, updated_at desc
) c
where p.id = c.pedido_id
  and p.forma_pagamento = 'Cartão on-line'
  and p.pagamento_status = 'em_analise';

comment on column public.pedidos.pagamento_autorizado_em is
  'Instante da autorização do cartão pela operadora; não implica liquidação financeira.';
