-- FS Delivery — pedidos com cartão on-line não entram na operação antes do pagamento

create or replace function public.fsdelivery_proteger_pedido_cartao_online()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.forma_pagamento = 'Cartão on-line' then
    if tg_op = 'INSERT' then
      new.pagamento_status := case when new.pagamento_status = 'pago' then 'pago' else 'aguardando' end;
      if new.pagamento_status <> 'pago' and new.status not in ('cancelado','finalizado','entregue') then
        new.status := 'aguardando_aprovacao';
      end if;
    elsif new.status is distinct from old.status
      and coalesce(new.pagamento_status,'nao_iniciado') <> 'pago'
      and new.status not in ('aguardando_aprovacao','cancelado') then
      raise exception 'Pedido com cartão on-line só pode avançar após confirmação do pagamento';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fsdelivery_proteger_pedido_cartao_online() from public, anon, authenticated;

drop trigger if exists trg_fsdelivery_proteger_pedido_cartao_online on public.pedidos;
create trigger trg_fsdelivery_proteger_pedido_cartao_online
before insert or update on public.pedidos
for each row execute function public.fsdelivery_proteger_pedido_cartao_online();

create or replace function public.fsdelivery_sincronizar_forma_cartao_online()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_habilitado boolean;
begin
  v_habilitado := new.conta_validada
    and new.status = 'ativo'
    and new.cartao_online_ativo
    and new.split_ativo;

  insert into public.configuracoes_operacionais(estabelecimento_id, formas_pagamento)
  values(
    new.estabelecimento_id,
    case when v_habilitado then '["PIX","Cartão de crédito","Cartão de débito","Dinheiro","Cartão on-line"]'::jsonb
         else '["PIX","Cartão de crédito","Cartão de débito","Dinheiro"]'::jsonb end
  )
  on conflict (estabelecimento_id) do update
  set formas_pagamento = case
    when v_habilitado then
      case when coalesce(configuracoes_operacionais.formas_pagamento,'[]'::jsonb) ? 'Cartão on-line'
           then configuracoes_operacionais.formas_pagamento
           else coalesce(configuracoes_operacionais.formas_pagamento,'[]'::jsonb) || '"Cartão on-line"'::jsonb end
    else (
      select coalesce(jsonb_agg(value),'[]'::jsonb)
      from jsonb_array_elements(coalesce(configuracoes_operacionais.formas_pagamento,'[]'::jsonb)) value
      where value <> '"Cartão on-line"'::jsonb
    )
  end,
  updated_at = now();

  return new;
end;
$$;

revoke all on function public.fsdelivery_sincronizar_forma_cartao_online() from public, anon, authenticated;

drop trigger if exists trg_fsdelivery_sincronizar_forma_cartao_online on public.integracoes_pagamento_estabelecimento;
create trigger trg_fsdelivery_sincronizar_forma_cartao_online
after insert or update of conta_validada,status,cartao_online_ativo,split_ativo
on public.integracoes_pagamento_estabelecimento
for each row execute function public.fsdelivery_sincronizar_forma_cartao_online();
