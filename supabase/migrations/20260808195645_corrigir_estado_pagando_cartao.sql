-- Permite a reserva local da etapa de pagamento e impede que o webhook inicial
-- `new` apague uma falha ou faça uma tentativa em processamento regredir.

alter table public.cobrancas_pedido_cartao
  drop constraint if exists cobrancas_pedido_cartao_status_check;

alter table public.cobrancas_pedido_cartao
  add constraint cobrancas_pedido_cartao_status_check
  check (status in (
    'criando', 'pagando', 'new', 'waiting', 'identified', 'approved', 'paid',
    'unpaid', 'refunded', 'contested', 'canceled', 'erro'
  ));

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
  v_recebido text;
  v_atual text;
  v_aplicado text;
  v_preservar_local boolean;
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

  insert into public.pagamento_eventos (
    provedor, evento_id, pedido_id, efi_charge_id, tipo, payload
  ) values (
    'efi', p_evento_id, v_tentativa.pedido_id, p_charge_id,
    left(lower(coalesce(nullif(p_status_efi, ''), 'unknown')), 80),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provedor, evento_id) do nothing
  returning id into v_evento;

  if v_evento is null then
    return jsonb_build_object('ignorado', true, 'motivo', 'evento_duplicado');
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

  v_recebido := public.fsdelivery_mapear_status_efi_pedido(p_status_efi);
  v_atual := coalesce(v_pedido.pagamento_status, 'nao_iniciado');
  v_preservar_local := lower(coalesce(p_status_efi, '')) = 'new'
    and v_tentativa.status in ('pagando', 'erro');

  v_aplicado := case
    when v_recebido in ('estornado', 'chargeback') then v_recebido
    when v_atual in ('estornado', 'chargeback') then v_atual
    when v_recebido = 'pago' then 'pago'
    when v_atual = 'pago' then 'pago'
    when v_atual in ('recusado', 'cancelado') then v_atual
    when v_recebido in ('recusado', 'cancelado') then v_recebido
    when array_position(array['nao_iniciado', 'aguardando', 'em_analise'], v_recebido)
       >= array_position(array['nao_iniciado', 'aguardando', 'em_analise'], v_atual)
      then v_recebido
    else v_atual
  end;

  update public.cobrancas_pedido_cartao
  set status = case
        when v_preservar_local then status
        when v_aplicado = v_recebido
          then left(lower(coalesce(nullif(p_status_efi, ''), status)), 40)
        else status
      end,
      payload_pagamento = case
        when v_preservar_local then payload_pagamento
        when v_aplicado = v_recebido then coalesce(p_payload, '{}'::jsonb)
        else payload_pagamento
      end,
      erro = case when v_preservar_local then erro else null end,
      updated_at = case when v_preservar_local then updated_at else v_agora end
  where id = v_tentativa.id;

  update public.pedidos
  set pagamento_status = v_aplicado,
      pagamento_provedor = 'efi',
      pagamento_confirmado_em = case
        when v_aplicado = 'pago' then coalesce(pagamento_confirmado_em, v_agora)
        else pagamento_confirmado_em
      end,
      status = case
        when v_aplicado in ('recusado', 'cancelado')
          and status not in ('cancelado', 'finalizado', 'entregue') then 'cancelado'
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
    'estado_local_preservado', v_preservar_local
  );
end;
$function$;

revoke all on function public.fsdelivery_aplicar_evento_pagamento_pedido(text, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fsdelivery_aplicar_evento_pagamento_pedido(text, bigint, text, jsonb)
  to service_role;
