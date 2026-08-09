-- Índices de apoio às chaves estrangeiras do rastreamento de pedidos.

create index if not exists pedido_rastreamento_credenciais_cliente_fk_idx
  on public.pedido_rastreamento_credenciais (cliente_id);

create index if not exists pedido_rastreamento_credenciais_dispositivo_fk_idx
  on public.pedido_rastreamento_credenciais (dispositivo_inicial_id);
