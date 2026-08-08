-- Pagamentos já liquidados também passaram necessariamente por autorização.

update public.pedidos p
set pagamento_autorizado_em = coalesce(
      p.pagamento_autorizado_em,
      p.pagamento_confirmado_em,
      c.updated_at,
      p.atualizado_em,
      now()
    ),
    atualizado_em = now()
from (
  select distinct on (pedido_id) pedido_id, updated_at
  from public.cobrancas_pedido_cartao
  where status in ('approved', 'paid', 'settled')
  order by pedido_id, updated_at desc
) c
where p.id = c.pedido_id
  and p.forma_pagamento = 'Cartão on-line'
  and p.pagamento_status in ('autorizado', 'pago')
  and p.pagamento_autorizado_em is null;
