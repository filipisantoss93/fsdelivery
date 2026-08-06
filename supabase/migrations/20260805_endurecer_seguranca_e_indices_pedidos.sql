-- Funções internas exigem sessão; não devem ser expostas ao papel anon.
revoke execute on function public.abrir_caixa(uuid,numeric) from anon;
revoke execute on function public.fechar_caixa(uuid,numeric,text) from anon;
revoke execute on function public.concluir_pedido_cozinha(bigint) from anon;

-- Funções auxiliares usadas pelo fluxo de pedidos precisam de search_path fixo.
alter function public.normalizar_regiao_entrega(text) set search_path = public;
alter function public.sincronizar_mesa_qr() set search_path = public;

-- Índices para relacionamentos usados nos painéis, caixa, notificações e histórico.
create index if not exists pedidos_cliente_id_idx on public.pedidos(cliente_id);
create index if not exists itens_pedido_produto_id_idx on public.itens_pedido(produto_id);
create index if not exists pagamentos_recebido_por_idx on public.pagamentos(recebido_por);
create index if not exists movimentacoes_financeiras_pedido_id_idx on public.movimentacoes_financeiras(pedido_id);
create index if not exists notificacoes_operacionais_pedido_id_idx on public.notificacoes_operacionais(pedido_id);
