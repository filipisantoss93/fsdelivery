-- Torna cobranças recorrentes monotônicas, idempotentes e compatíveis com os
-- estados finais documentados pela Efí.

create or replace function public.fsdelivery_registrar_cobranca_cartao(
  p_subscription_id bigint,
  p_charge_id bigint,
  p_status text,
  p_valor_centavos integer,
  p_payload jsonb default null,
  p_recebido_em timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assinatura public.assinaturas%rowtype;
  v_cobranca public.cobrancas_cartao%rowtype;
  v_status text;
  v_status_anterior text;
  v_rank_recebido integer;
  v_rank_anterior integer;
  v_aplicar boolean;
  v_ja_pago boolean := false;
  v_estava_pago boolean := false;
  v_novo_acesso timestamptz;
begin
  if p_subscription_id is null or p_subscription_id <= 0
    or p_charge_id is null or p_charge_id <= 0 then
    raise exception 'Identificadores Efí inválidos';
  end if;

  v_status := lower(coalesce(nullif(trim(p_status), ''), 'unknown'));
  if v_status not in (
    'new', 'waiting', 'identified', 'approved', 'paid', 'settled',
    'unpaid', 'expired', 'canceled', 'refunded', 'contested'
  ) then
    return jsonb_build_object('ignorado', true, 'motivo', 'status_efi_desconhecido');
  end if;

  select a.* into v_assinatura
  from public.assinaturas a
  where a.efi_subscription_id = p_subscription_id
    and a.meio_pagamento = 'cartao'
  for update;

  if not found then
    return jsonb_build_object('ignorado', true, 'motivo', 'assinatura_nao_encontrada');
  end if;

  select c.* into v_cobranca
  from public.cobrancas_cartao c
  where c.efi_charge_id = p_charge_id
  for update;

  if found and v_cobranca.assinatura_id <> v_assinatura.id then
    raise exception 'Cobrança Efí já vinculada a outra assinatura';
  end if;

  v_status_anterior := case when found then lower(v_cobranca.status) else null end;
  v_ja_pago := found and v_cobranca.pago_em is not null;
  v_estava_pago := found and v_status_anterior in ('paid', 'settled');

  v_rank_recebido := case v_status
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
  v_rank_anterior := case v_status_anterior
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
  v_aplicar := not found or v_rank_recebido >= v_rank_anterior;

  if not v_aplicar then
    return jsonb_build_object(
      'ignorado', true,
      'motivo', 'evento_atrasado',
      'status_recebido', v_status,
      'status_atual', v_status_anterior
    );
  end if;

  if v_cobranca.id is null then
    insert into public.cobrancas_cartao (
      assinatura_id, usuario_id, plano_id, efi_subscription_id, efi_charge_id,
      status, valor_centavos, pago_em, payload_efi
    ) values (
      v_assinatura.id, v_assinatura.usuario_id, v_assinatura.plano_id,
      p_subscription_id, p_charge_id, v_status,
      greatest(coalesce(p_valor_centavos, v_assinatura.preco_contratado_centavos), 0),
      case when v_status in ('paid', 'settled') then coalesce(p_recebido_em, now()) else null end,
      p_payload
    );
  else
    update public.cobrancas_cartao
    set status = v_status,
        valor_centavos = greatest(coalesce(p_valor_centavos, valor_centavos), 0),
        payload_efi = p_payload,
        pago_em = case
          when pago_em is not null then pago_em
          when v_status in ('paid', 'settled') then coalesce(p_recebido_em, now())
          else null
        end,
        updated_at = now()
    where id = v_cobranca.id;
  end if;

  if v_status in ('paid', 'settled') then
    if not v_ja_pago then
      v_novo_acesso := greatest(now(), coalesce(v_assinatura.acesso_valido_ate, now()))
        + make_interval(months => greatest(coalesce(v_assinatura.periodicidade_meses, 1), 1));
    else
      v_novo_acesso := v_assinatura.acesso_valido_ate;
    end if;

    update public.assinaturas
    set status = case when renovacao_automatica then 'ativa' else 'cancelada' end,
        ultima_cobranca_status = v_status,
        efi_charge_id = p_charge_id,
        acesso_valido_ate = v_novo_acesso,
        proxima_cobranca_em = case when renovacao_automatica then v_novo_acesso else null end,
        updated_at = now()
    where id = v_assinatura.id;

    update public.estabelecimentos
    set plano = 'premium',
        assinatura_status = 'ativa',
        updated_at = now()
    where id = v_assinatura.estabelecimento_id;
  elsif v_status in ('unpaid', 'expired', 'canceled') then
    update public.assinaturas
    set ultima_cobranca_status = v_status,
        efi_charge_id = p_charge_id,
        status = case
          when acesso_valido_ate is null or acesso_valido_ate <= now() then 'vencida'
          else status
        end,
        updated_at = now()
    where id = v_assinatura.id;

    update public.estabelecimentos
    set assinatura_status = case
          when v_assinatura.acesso_valido_ate is null or v_assinatura.acesso_valido_ate <= now()
            then 'vencida'
          else assinatura_status
        end,
        updated_at = now()
    where id = v_assinatura.estabelecimento_id;
  elsif v_status in ('refunded', 'contested') then
    v_novo_acesso := v_assinatura.acesso_valido_ate;
    if v_estava_pago and v_novo_acesso is not null then
      v_novo_acesso := greatest(
        now(),
        v_novo_acesso - make_interval(months => greatest(coalesce(v_assinatura.periodicidade_meses, 1), 1))
      );
    end if;

    update public.assinaturas
    set ultima_cobranca_status = v_status,
        efi_charge_id = p_charge_id,
        acesso_valido_ate = v_novo_acesso,
        proxima_cobranca_em = case
          when renovacao_automatica and v_novo_acesso > now() then v_novo_acesso
          else null
        end,
        status = case when v_novo_acesso is null or v_novo_acesso <= now() then 'vencida' else status end,
        updated_at = now()
    where id = v_assinatura.id;

    update public.estabelecimentos
    set assinatura_status = case
          when v_novo_acesso is null or v_novo_acesso <= now() then 'vencida'
          else assinatura_status
        end,
        updated_at = now()
    where id = v_assinatura.estabelecimento_id;
  else
    update public.assinaturas
    set ultima_cobranca_status = v_status,
        efi_charge_id = p_charge_id,
        updated_at = now()
    where id = v_assinatura.id;
  end if;

  return jsonb_build_object(
    'ignorado', false,
    'assinatura_id', v_assinatura.id,
    'cobranca_id', p_charge_id,
    'status_anterior', v_status_anterior,
    'status_aplicado', v_status,
    'novo_acesso_valido_ate', v_novo_acesso
  );
end;
$function$;

revoke all on function public.fsdelivery_registrar_cobranca_cartao(
  bigint, bigint, text, integer, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.fsdelivery_registrar_cobranca_cartao(
  bigint, bigint, text, integer, jsonb, timestamptz
) to service_role;
