-- Impede que identificadores numéricos de sandbox e produção sejam aplicados
-- fora do ambiente em que a cobrança foi criada.

alter table public.cobrancas_cartao
  add column if not exists efi_ambiente text;

update public.cobrancas_cartao c
set efi_ambiente = a.efi_ambiente
from public.assinaturas a
where a.id = c.assinatura_id
  and c.efi_ambiente is null
  and a.efi_ambiente is not null;

alter table public.cobrancas_cartao
  drop constraint if exists cobrancas_cartao_efi_ambiente_check;

alter table public.cobrancas_cartao
  add constraint cobrancas_cartao_efi_ambiente_check
  check (efi_ambiente is null or efi_ambiente in ('homologacao', 'producao'));

create or replace function public.fsdelivery_aplicar_evento_pagamento_pedido(
  p_evento_id text,
  p_charge_id bigint,
  p_status_efi text,
  p_payload jsonb,
  p_ambiente text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ambiente text;
  v_ambiente_cobranca text;
  v_pedido_id bigint;
begin
  v_ambiente := case lower(coalesce(trim(p_ambiente), ''))
    when 'production' then 'producao'
    when 'producao' then 'producao'
    when 'sandbox' then 'homologacao'
    when 'homologacao' then 'homologacao'
    else null
  end;
  if v_ambiente is null then
    raise exception 'Ambiente Efí inválido';
  end if;

  select c.ambiente,c.pedido_id
    into v_ambiente_cobranca,v_pedido_id
  from public.cobrancas_pedido_cartao c
  where c.efi_charge_id = p_charge_id;

  if not found then
    return jsonb_build_object('ignorado', true, 'motivo', 'cobranca_nao_encontrada');
  end if;

  if v_ambiente_cobranca <> v_ambiente then
    insert into public.pagamento_eventos (
      provedor,evento_id,pedido_id,efi_charge_id,tipo,payload,processado_em,erro_processamento
    ) values (
      'efi',left(p_evento_id,300),v_pedido_id,p_charge_id,
      left(lower(coalesce(nullif(p_status_efi,''),'unknown')),80),
      coalesce(p_payload,'{}'::jsonb),now(),'ambiente_efi_divergente'
    ) on conflict (provedor,evento_id) do nothing;
    return jsonb_build_object('ignorado', true, 'motivo', 'ambiente_efi_divergente');
  end if;

  return public.fsdelivery_aplicar_evento_pagamento_pedido(
    p_evento_id,p_charge_id,p_status_efi,p_payload
  );
end;
$function$;

revoke all on function public.fsdelivery_aplicar_evento_pagamento_pedido(
  text,bigint,text,jsonb,text
) from public,anon,authenticated;
grant execute on function public.fsdelivery_aplicar_evento_pagamento_pedido(
  text,bigint,text,jsonb,text
) to service_role;

create or replace function public.fsdelivery_registrar_cobranca_cartao(
  p_subscription_id bigint,
  p_charge_id bigint,
  p_status text,
  p_valor_centavos integer,
  p_payload jsonb,
  p_recebido_em timestamptz,
  p_ambiente text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ambiente text;
  v_ambiente_assinatura text;
  v_assinatura_id uuid;
  v_resultado jsonb;
begin
  v_ambiente := case lower(coalesce(trim(p_ambiente), ''))
    when 'production' then 'producao'
    when 'producao' then 'producao'
    when 'sandbox' then 'homologacao'
    when 'homologacao' then 'homologacao'
    else null
  end;
  if v_ambiente is null then
    raise exception 'Ambiente Efí inválido';
  end if;

  select a.id,a.efi_ambiente
    into v_assinatura_id,v_ambiente_assinatura
  from public.assinaturas a
  where a.efi_subscription_id = p_subscription_id
    and a.meio_pagamento = 'cartao';

  if not found then
    return jsonb_build_object('ignorado', true, 'motivo', 'assinatura_nao_encontrada');
  end if;
  if v_ambiente_assinatura is distinct from v_ambiente then
    return jsonb_build_object('ignorado', true, 'motivo', 'ambiente_efi_divergente');
  end if;

  v_resultado := public.fsdelivery_registrar_cobranca_cartao(
    p_subscription_id,p_charge_id,p_status,p_valor_centavos,p_payload,p_recebido_em
  );

  update public.cobrancas_cartao
  set efi_ambiente = v_ambiente
  where assinatura_id = v_assinatura_id
    and efi_charge_id = p_charge_id
    and efi_ambiente is distinct from v_ambiente;

  return v_resultado;
end;
$function$;

revoke all on function public.fsdelivery_registrar_cobranca_cartao(
  bigint,bigint,text,integer,jsonb,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.fsdelivery_registrar_cobranca_cartao(
  bigint,bigint,text,integer,jsonb,timestamptz,text
) to service_role;
