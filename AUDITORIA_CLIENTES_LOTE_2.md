# Auditoria de clientes — lote operacional 2

## Implementado

- normalização automática do WhatsApp em inserções e atualizações de clientes;
- token seguro por cliente para reconhecer o aparelho após um pedido validado;
- captura automática do endereço usado em pedidos de entrega;
- reaproveitamento do endereço quando o texto coincide com um endereço salvo;
- cadastro de múltiplos endereços, mantendo um endereço principal;
- vínculo do endereço salvo ao pedido por `cliente_endereco_id`;
- atualização de primeiro e último pedido do cliente;
- carregamento de endereços salvos na loja pública após validação do aparelho;
- carregamento de endereços no balcão e no portal do garçom autenticado;
- resumo da página Clientes diretamente da tabela real e dos pedidos vinculados.

## Arquivos

- `supabase/migrations/20260803_clientes_enderecos_operacao.sql`
- `js/clientes-enderecos.js`
- `js/supabase.js`

## Aplicação

Executar no Supabase, nesta ordem:

1. `20260803_clientes_enderecos.sql`
2. `20260803_clientes_enderecos_operacao.sql`

## Segurança da loja pública

A consulta pública não libera endereços apenas pelo número de telefone. O aparelho recebe um token somente depois de comprovar um pedido recente com o mesmo WhatsApp e código do pedido. O token fica armazenado localmente e é exigido nas consultas futuras.

## Validações pendentes

- testar a migration em uma cópia do banco com dados reais;
- verificar clientes duplicados antes da criação do índice único;
- testar primeiro pedido e segundo pedido no mesmo aparelho;
- testar novo endereço e seleção de endereço salvo;
- testar balcão, garçom e página Clientes em celular e desktop.
