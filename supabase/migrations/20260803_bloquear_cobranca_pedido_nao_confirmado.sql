-- FS Delivery: impede cobrança de pedidos on-line ainda não confirmados
create or replace function public.validar_pagamento_pedido_confirmado()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_origem text;
begin
  select status, origem into v_status, v_origem
  from public.pedidos
  where id = new.pedido_id;

  if v_status is null then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_status in ('aguardando_aprovacao','novo') and coalesce(v_origem,'publico') = 'publico' then
    raise exception 'Confirme o pedido on-line antes de registrar o pagamento.';
  end if;

  if v_status in ('cancelado','rejeitado') then
    raise exception 'Pedidos cancelados ou rejeitados não podem receber pagamento.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_pagamento_pedido_confirmado on public.pagamentos;
create trigger trg_validar_pagamento_pedido_confirmado
before insert or update on public.pagamentos
for each row execute function public.validar_pagamento_pedido_confirmado();

-- Pedidos aguardando aprovação não devem ser tratados como cobrança pendente.
create index if not exists idx_pedidos_confirmacao_caixa
on public.pedidos(estabelecimento_id, status, origem, created_at desc);