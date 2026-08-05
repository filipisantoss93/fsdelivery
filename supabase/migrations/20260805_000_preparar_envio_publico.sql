-- Permite alterar o retorno legado bigint para o código textual oficial do pedido.
drop function if exists public.criar_pedido_publico(jsonb);
