# FS Delivery

Plataforma de gestão e pedidos para restaurantes, lanchonetes, pizzarias e operações de delivery.

## Estrutura implementada

- Landing page comercial (`index.html`)
- Painel administrativo responsivo (`app.html`)
- Página pública do estabelecimento (`loja.html`)
- Gestão de pedidos em kanban
- Emissão e impressão de pedido
- Gestão de cardápio, categorias, produtos e adicionais
- Clientes e histórico de compras
- Visão financeira
- Configurações do estabelecimento
- Carrinho e checkout do cliente
- Persistência demonstrativa com `localStorage`
- Schema inicial para Supabase em `supabase/schema.sql`

## Executar localmente

Abra o projeto com um servidor estático, por exemplo:

```bash
npx serve .
```

Depois acesse:

- `/` — site comercial
- `/app.html` — painel do estabelecimento
- `/loja.html` — cardápio público

## Próxima etapa de produção

1. Conectar autenticação e banco Supabase.
2. Criar Edge Function para validar e registrar pedidos públicos.
3. Integrar assinatura recorrente.
4. Configurar notificações de novos pedidos.
5. Publicar na Vercel com domínio próprio.

> O protótipo atual já permite testar o fluxo completo no navegador. Pedidos feitos na página pública aparecem no painel quando as páginas usam o mesmo navegador e domínio.