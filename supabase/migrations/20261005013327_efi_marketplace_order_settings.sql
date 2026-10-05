-- Comissão de marketplace administrada pelo FS e pagamento Pix por Bolix.
-- Comerciantes podem solicitar meios de pagamento, mas não definir sua comissão.

alter table public.cobrancas_pedido_cartao
  add column if not exists qrcode_pix text,
  add column if not exists qrcode_pix_image text,
  add column if not exists link_bolix text;

comment on column public.cobrancas_pedido_cartao.qrcode_pix is
  'Pix copia e cola da cobrança Bolix; armazenado sem os dados cadastrais do pagador.';

create or replace function public.fsdelivery_proteger_comissao_marketplace()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is not null and not public.fs_admin_autorizado() then
    if tg_op = 'INSERT' then
      new.percentual_comissao_bps := 0;
      new.modo_tarifa := 1;
    else
      new.percentual_comissao_bps := old.percentual_comissao_bps;
      new.modo_tarifa := old.modo_tarifa;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fsdelivery_proteger_comissao_marketplace() from public, anon, authenticated;
drop trigger if exists trg_fsdelivery_proteger_comissao_marketplace
  on public.integracoes_pagamento_estabelecimento;
create trigger trg_fsdelivery_proteger_comissao_marketplace
before insert or update on public.integracoes_pagamento_estabelecimento
for each row execute function public.fsdelivery_proteger_comissao_marketplace();

create or replace function public.fsdelivery_sincronizar_formas_efi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_habilitado boolean;
begin
  v_habilitado := new.conta_validada and new.status = 'ativo' and new.split_ativo;
  insert into public.configuracoes_operacionais(estabelecimento_id, formas_pagamento)
  values(new.estabelecimento_id, '[]'::jsonb)
  on conflict (estabelecimento_id) do nothing;

  update public.configuracoes_operacionais c
  set formas_pagamento = (
    select coalesce(jsonb_agg(x.value order by x.ordinality), '[]'::jsonb)
    from jsonb_array_elements(coalesce(c.formas_pagamento,'[]'::jsonb)) with ordinality x(value,ordinality)
    where x.value not in ('"Cartão on-line"'::jsonb,'"Pix on-line"'::jsonb)
  ) || case when v_habilitado and new.cartao_online_ativo then '["Cartão on-line"]'::jsonb else '[]'::jsonb end
    || case when v_habilitado and new.pix_online_ativo then '["Pix on-line"]'::jsonb else '[]'::jsonb end,
      updated_at = now()
  where c.estabelecimento_id = new.estabelecimento_id;
  return new;
end;
$$;

revoke all on function public.fsdelivery_sincronizar_formas_efi() from public, anon, authenticated;
drop trigger if exists trg_fsdelivery_sincronizar_formas_efi
  on public.integracoes_pagamento_estabelecimento;
create trigger trg_fsdelivery_sincronizar_formas_efi
after insert or update of conta_validada,status,cartao_online_ativo,pix_online_ativo,split_ativo
on public.integracoes_pagamento_estabelecimento
for each row execute function public.fsdelivery_sincronizar_formas_efi();

create or replace function public.fsdelivery_proteger_pedido_pix_online()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.forma_pagamento = 'Pix on-line' then
    if tg_op = 'INSERT' then
      new.pagamento_status := 'aguardando';
      if new.status not in ('cancelado','finalizado','entregue') then
        new.status := 'aguardando_aprovacao';
      end if;
    elsif new.status is distinct from old.status
      and coalesce(new.pagamento_status,'nao_iniciado') <> 'pago'
      and new.status not in ('aguardando_aprovacao','cancelado') then
      raise exception 'Pedido com Pix on-line só pode avançar após confirmação do pagamento';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fsdelivery_proteger_pedido_pix_online() from public, anon, authenticated;
drop trigger if exists trg_fsdelivery_proteger_pedido_pix_online on public.pedidos;
create trigger trg_fsdelivery_proteger_pedido_pix_online
before insert or update on public.pedidos
for each row execute function public.fsdelivery_proteger_pedido_pix_online();
