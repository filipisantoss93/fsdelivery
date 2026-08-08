# Auditoria completa da plataforma — 08/08/2026

## Resultado executivo

**Status: aprovado tecnicamente em preview/homologação, com bloqueios de go-live comercial.**

A base foi estabilizada, os fluxos de cartão foram endurecidos e o checkout público foi validado contra a Efí em homologação. O frontend final ainda não foi promovido para o domínio de produção e a assinatura recorrente ainda precisa de um teste positivo ponta a ponta com restaurante autenticado. Por isso, este relatório não declara a plataforma como “100% em produção”.

| Área | Resultado | Evidência principal |
|---|---|---|
| HTML, CSS e JavaScript | Aprovado | 21 HTML, 56 JS e 20 CSS auditados; sintaxe válida |
| Duplicidade de CSS/JS | Aprovado | `jscpd`: 0 clones, 0 linhas e 0 tokens duplicados |
| Loja pública | Aprovado em preview | Catálogo real, carrinho, entrega, checkout, cartão e modais verificados no navegador |
| Cartão na compra externa | Aprovado em homologação | Tokenização local Efí, criação/cobrança, split, webhook e estados testados |
| Cartão da assinatura | Backend aprovado | Autorização, idempotência, webhook, renovação e reversão testados em transações com rollback |
| Assinatura recorrente ponta a ponta | Pendente | Falta execução positiva com sessão autenticada de restaurante |
| Banco e Edge Functions | Aplicado | Migrações alinhadas e 12 funções financeiras publicadas em novas versões ativas |
| Observabilidade | Aprovado com avisos | Vercel sem erro de runtime em 7 dias; Supabase sem erro PostgreSQL/API ou resposta 5xx observada |
| Produção web | Não promovida | O domínio público continua na versão anterior; a revisão final está apenas em preview |

## Correções realizadas

### Estabilidade e duplicidades

- CSS inline e estilos injetados por JavaScript foram extraídos para folhas próprias.
- Scripts inline de páginas operacionais foram movidos para módulos versionados.
- O módulo legado `js/loja.js` foi removido.
- `js/config-bairros-importacao-segura.js` foi consolidado no módulo atual e removido.
- Helpers repetidos de sessão, estabelecimento, dependências e modais foram centralizados em `window.FSRuntime`.
- A biblioteca Supabase foi atualizada para `2.112.2` e o tokenizador Efí permanece em `3.4.1`; ambos foram fixados localmente, com versão e licença, evitando dependência de CDN em tempo de execução.
- Todos os HTML usam a cópia local do Supabase.
- Cadastro e redefinição de senha exigem no mínimo 8 caracteres também na validação do navegador e do JavaScript.
- O CI passou a verificar HTML, JavaScript, CSS, Edge Functions, migrações e duplicidade.

### Checkout público e cartão do pedido

- A loja pública passou a obter somente o contexto necessário pela RPC protegida `contexto_publico_loja`.
- O CVV usa campo `password`; nenhum dado de cartão é armazenado pelo FS Delivery.
- A cobrança é idempotente por pedido e impede concorrência/repetição durante processamento.
- A tentativa local é reservada antes da chamada à Efí.
- Erros públicos são sanitizados; o diagnóstico detalhado permanece restrito ao backend.
- A integração separa credenciais, URLs, notificações e eventos de homologação e produção.
- Webhooks de ambiente divergente são ignorados e auditados.
- Eventos são deduplicados por identificador do evento, e não apenas pelo token da notificação.
- Eventos atrasados não regridem uma cobrança já autorizada, paga, estornada ou em chargeback.
- Respostas ambíguas do endpoint de pagamento são reconciliadas consultando a cobrança remota.
- O split de marketplace é preservado e o payee é validado antes de habilitar cartão.
- A máquina de estados diferencia autorização de liquidação:
  - `approved` → `autorizado`: libera a operação do pedido, mas ainda não representa liquidação financeira;
  - `paid` ou `settled` → `pago`: liquidação confirmada;
  - `expired`, `canceled`, `refunded` e `contested` aplicam cancelamento, estorno ou chargeback sem regressão indevida.

Essa separação segue a semântica oficial dos [status de cobranças da Efí](https://dev.efipay.com.br/docs/api-cobrancas/status/), além da documentação de [cartão](https://dev.efipay.com.br/docs/api-cobrancas/cartao/), [notificações](https://dev.efipay.com.br/docs/api-cobrancas/notificacoes/) e [split](https://dev.efipay.com.br/docs/api-cobrancas/split-de-pagamento/).

### Assinatura do restaurante

- A criação exige JWT válido e restaurante pertencente ao usuário autenticado.
- Uma reserva local ocorre antes da chamada externa e um índice impede duas assinaturas recorrentes ativas para o mesmo estabelecimento.
- Plano, assinatura e cobrança registram o ambiente Efí.
- Webhooks são idempotentes, ordenados e isolados por ambiente.
- `paid`/`settled` concedem acesso uma única vez.
- `refunded`/`contested` revertem exatamente o período concedido, sem duplicar a reversão.
- Uma cobrança não pode ser aplicada a outra assinatura.
- O plano ativo `fsdelivery_mensal_cartao` está configurado em R$ 29,90/mês; o plano remoto Efí é criado no primeiro uso autenticado.

Referência: [assinaturas na API de Cobranças Efí](https://dev.efipay.com.br/docs/api-cobrancas/assinatura/).

## Validações executadas

### Automação local

- `node tests/auditoria-pedidos-estatica.mjs`: aprovado.
- `node tests/auditoria-estabilidade-frontend.mjs`: aprovado.
- `node tests/auditoria-plataforma.mjs`: aprovado.
- `node --check` em todos os JavaScript: aprovado.
- Parse/bundle de todas as Edge Functions com esbuild: aprovado.
- `git diff --check`: aprovado.
- `jscpd` em CSS e JavaScript com limiar zero: 0 clones.
- Regressão consolidada: 21 HTML, 56 JS, 20 CSS e 12 funções financeiras.

### Implantação técnica

- As 12 Edge Functions financeiras foram republicadas com o Supabase JS `2.112.2` e ficaram em estado `ACTIVE`.
- As regras de JWT foram preservadas: endpoints públicos de configuração/cobrança e webhooks continuam públicos por desenho; operações de conta, assinatura e Pix continuam exigindo JWT.
- O endpoint público `config-pagamento-loja` respondeu HTTP 200 após a implantação, mantendo a loja em homologação, com cartão e split ativos e Pix desativado.
- O histórico local das 11 migrações de auditoria foi alinhado exatamente aos identificadores já aplicados no projeto Supabase.
- Um novo preview foi criado na Vercel e ficou `READY`; o build terminou sem erros.

### Banco de dados e webhooks

Testes transacionais, sempre revertidos ao final, comprovaram:

- `waiting` não permite avanço do pedido;
- `approved` vira `autorizado` e permite avanço operacional;
- `paid`/`settled` viram `pago`;
- eventos `new` atrasados não regridem estados superiores;
- `expired` cancela corretamente;
- status desconhecido é ignorado e auditado;
- webhook de ambiente incorreto é ignorado e auditado;
- assinatura paga não recebe crédito duplicado;
- reembolso/contestação revertem o acesso uma única vez;
- cobrança de assinatura cruzada é bloqueada.

### Navegador e checkout público

No preview final da loja `fs-lanches`:

- 7 produtos e 3 categorias carregaram corretamente;
- o carrinho adicionou o X-Tudo por R$ 29,90;
- a região Residencial Bella Vista II adicionou R$ 8,00;
- o checkout totalizou R$ 37,90;
- a opção “Cartão on-line” permaneceu disponível após a reconstrução do seletor;
- os campos de cartão foram exibidos e o CVV permaneceu protegido;
- o modal abriu e fechou corretamente após a consolidação dos helpers;
- não houve overflow horizontal;
- não houve erro ou aviso originado pelo aplicativo no console.

Um checkout sandbox anterior chegou à Efí e retornou autorização; os pedidos, cobranças, itens, eventos e cliente sintéticos criados pela auditoria foram removidos depois do teste. A consulta final confirmou zero registros dos pedidos sintéticos `PED-0013` e `PED-0014`.

## Migrações financeiras aplicadas em 08/08/2026

- `estabilizar_pagamentos_cartao`
- `index_validacoes_payee`
- `preservar_estado_pagamento_cartao`
- `corrigir_estado_pagando_cartao`
- `proteger_pagamento_contra_webhook_inicial`
- `contexto_publico_loja`
- `finalizar_maquina_estados_cartao`
- `autorizacao_cartao_libera_pedido`
- `estabilizar_assinatura_cartao`
- `backfill_autorizacao_cartao`
- `isolar_webhooks_efi_ambiente`

## Segurança e performance

Os advisors do Supabase não reportaram nenhum item de nível `ERROR`.

### Segurança

Foram reportados 94 avisos/informações: 10 `INFO` e 84 `WARN`.

- 10 tabelas internas têm RLS sem política, bloqueando acesso direto de cliente. Isso é intencional para tabelas de segredo, auditoria, webhook e cobrança. [Referência](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- 5 tabelas de catálogo são visíveis ao papel anônimo no schema GraphQL; essa exposição sustenta o cardápio público, mas deve permanecer limitada por RLS. [Referência](https://supabase.com/docs/guides/database/database-linter?lint=0026_pg_graphql_anon_table_exposed)
- 27 tabelas são descobríveis por usuários autenticados no schema GraphQL; o acesso a linhas continua protegido por RLS, mas os grants devem passar por revisão final de menor privilégio. [Referência](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed)
- 18 funções `SECURITY DEFINER` estão executáveis por `anon` e 33 por `authenticated`. As públicas revisadas são RPCs deliberadas com PIN, token, idempotência ou escopo de loja, mas a lista completa precisa de aceite formal antes do go-live. [Anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) · [Autenticado](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- A proteção contra senhas vazadas do Supabase Auth está desativada e deve ser habilitada antes da venda. [Como habilitar](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

### Performance

Foram reportados 38 itens: 30 índices ainda não usados e 8 casos de políticas permissivas múltiplas. Não há erro de performance. Como a base tem pouco histórico de tráfego, índices novos podem aparecer como não usados; a remoção só deve ocorrer após telemetria real. As políticas duplicadas podem ser consolidadas em uma etapa posterior. [Índices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) · [Políticas](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)

## Estado operacional encontrado

- Configuração da loja auditada: cartão on-line ativo, split ativo, Efí em **homologação** e Pix on-line desativado.
- Assinaturas recorrentes existentes: 0.
- Cobranças recorrentes existentes: 0.
- O registro histórico de homologação `PED-0011`, de 08/08/2026, foi encerrado de forma auditável: pedido e pagamento ficaram `cancelado`, e a tentativa Efí ficou `canceled`. Nenhum registro foi apagado e não houve movimentação real.
- O pedido histórico `PED-0012` permanece `pago` e aguardando aprovação operacional, sem alteração pela auditoria.

## Bloqueios antes da venda

1. **Publicar o código:** as alterações estão no workspace, ainda sem commit, push ou pull request porque o GitHub CLI não está disponível neste ambiente.
2. **Promover o frontend:** o domínio de produção ainda não recebeu esta revisão; a implantação feita foi somente de preview.
3. **Ativar proteção de senha vazada:** habilitar no Supabase Auth.
4. **Concluir homologação da assinatura:** executar uma assinatura positiva com um restaurante de teste autenticado e validar criação, webhook e acesso concedido.
5. **Preparar Efí produção:** confirmar credenciais, payee, URL de notificação e split de produção; trocar a loja de homologação para produção somente depois disso.
6. **Teste financeiro real controlado:** realizar uma compra e uma assinatura de baixo valor em produção, validar `approved`/`paid` e efetuar estorno controlado.
7. **Aceitar ou reduzir os avisos de grants:** revisar formalmente as funções `SECURITY DEFINER` e tabelas descobríveis pelo GraphQL.

## Sequência recomendada de go-live

1. Disponibilizar o GitHub CLI, revisar e publicar um pull request.
2. Habilitar a proteção de senha vazada.
3. Executar o E2E autenticado da assinatura em homologação.
4. Confirmar as credenciais e o cadastro marketplace Efí de produção.
5. Promover o frontend para produção com confirmação explícita.
6. Fazer compra e assinatura reais de baixo valor, validar webhook e estornar.
7. Monitorar Vercel, Supabase e eventos Efí nas primeiras 24 horas.

## Preview auditado

`https://fsdelivery-m2u0p49pm-filipiasantos93-2887s-projects.vercel.app/loja?loja=fs-lanches`

O preview é protegido pela Vercel; um link temporário de acesso deve ser gerado quando necessário. O deployment `dpl_G75As3VvaqhMnmQDPhznqneqKyrm` ficou `READY`, sem erro de build. A promoção desse build para produção não foi executada.
