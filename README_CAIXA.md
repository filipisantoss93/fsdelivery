# Caixa FS Delivery

A página `caixa.html` utiliza exclusivamente o design system global em `css/style.css`.

Antes de usar o caixa, execute no Supabase:

1. `supabase/migrations/20260729_pedidos_mesa.sql`
2. `supabase/migrations/20260729_pedidos_garcom.sql`
3. `supabase/migrations/20260729_caixa_financeiro.sql`

Mesas com pedidos nos status `novo`, `preparo` ou `pronto` são consideradas ocupadas. Ao receber integralmente o pedido no caixa, o status passa para `entregue` e a mesa fica disponível automaticamente.
