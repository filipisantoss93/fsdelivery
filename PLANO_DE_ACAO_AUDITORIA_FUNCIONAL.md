# FS Delivery — Plano de ação da auditoria funcional

Documento criado a partir da auditoria dos fluxos de página pública, carrinho, pedidos, cardápio, caixa, financeiro, entregas, mesas, QR Codes, acesso do garçom e acesso do entregador.

## Objetivo

Corrigir falhas de acesso, segurança, consistência de dados e operação antes de considerar a plataforma pronta para uso comercial.

## Status geral por módulo

| Módulo | Situação atual | Prioridade |
|---|---|---|
| Página pública | Funcional com riscos de segurança e duplicidade | Alta |
| Carrinho | Funcional, precisa validação server-side | Alta |
| Pedidos | Parcialmente funcional | Alta |
| Cardápio administrativo | Funcional, com nomenclatura confusa | Média |
| Caixa | Estrutura funcional | Alta |
| Financeiro | Incompleto | Alta |
| Entregas administrativas | Incompleto | Alta |
| Mesas | Estrutura funcional | Alta |
| QR Code das mesas | Implementado, requer consolidação de token | Alta |
| Garçom | Parcial, com falhas críticas de sessão e logout | Crítica |
| Entregador | Parcial, com falhas críticas de redirecionamento | Crítica |

---

# Fase 1 — Correções críticas de acesso e sessão

## 1.1 Corrigir redirecionamento do entregador

### Problema

`js/entregador.js` redireciona sessões inválidas ou encerradas para `equipe-acesso.html`, enquanto o login existente é `entrega.html`.

### Ação

- Substituir todos os redirecionamentos de `equipe-acesso.html` por `entrega.html` no fluxo do entregador.
- Validar acesso direto a `entregador.html` sem sessão.
- Validar expiração após 12 horas.
- Validar logout.

### Critério de aceite

- Usuário sem sessão é enviado para `entrega.html`.
- Logout remove `fsdelivery_team` do `sessionStorage`.
- Sessão expirada não permanece ativa.

## 1.2 Corrigir redirecionamento do garçom

### Problema

`js/garcom.js` redireciona o usuário sem sessão para `equipe-acesso.html`, mas o login atual do garçom é `garcom.html`.

### Ação

- Redirecionar para `garcom.html`.
- Validar acesso direto a `cardapio.html` sem sessão.
- Validar sessão do proprietário separadamente da sessão da equipe.

### Critério de aceite

- Garçom sem sessão é enviado para `garcom.html`.
- Proprietário autenticado continua podendo acessar a operação, quando essa regra for intencional.

## 1.3 Implementar logout do garçom

### Problema

O botão `#waiter-logout` existe no HTML, mas não possui evento no JavaScript.

### Ação

- Adicionar evento de clique.
- Remover `fsdelivery_team` do `sessionStorage`.
- Redirecionar para `garcom.html`.
- Tratar corretamente o caso de proprietário autenticado.

### Critério de aceite

- O botão Sair encerra a sessão da equipe.
- O garçom não consegue voltar à página usando o botão do navegador sem autenticar novamente.

## 1.4 Validar função, estabelecimento e expiração da sessão da equipe

### Problema

A página do garçom verifica apenas se existe `estabelecimento_id`. Não confirma função nem validade temporal.

### Ação

Criar uma função central para validar:

- existência da sessão;
- `funcao` esperada;
- `estabelecimento_id`;
- telefone;
- PIN ou token de sessão;
- `authenticated_at`;
- limite de expiração;
- funcionário ativo.

### Critério de aceite

- Sessão de entregador não abre a página do garçom.
- Sessão de garçom não abre a página do entregador.
- Sessão expirada é rejeitada.

---

# Fase 2 — Segurança e isolamento por estabelecimento

## 2.1 Revisar RLS do acesso de equipe

### Problema

O login por WhatsApp e PIN não cria uma sessão Supabase autenticada. Mesmo assim, a página do garçom consulta diretamente:

- `estabelecimentos`;
- `produtos`;
- `mesas`;
- `pedidos`.

Isso pode causar bloqueio por RLS ou exposição excessiva de dados anônimos.

### Ação recomendada

- Evitar consultas diretas anônimas para dados operacionais.
- Criar RPCs específicas para equipe.
- Gerar um token temporário de sessão de equipe no servidor.
- Validar função, estabelecimento e expiração em cada RPC.
- Nunca confiar apenas em dados armazenados no navegador.

### Critério de aceite

- Garçom acessa somente dados do próprio estabelecimento.
- Entregador acessa somente entregas permitidas.
- Usuário anônimo não consulta pedidos administrativos.

## 2.2 Sanitizar conteúdo renderizado

### Problema

Produtos, categorias, descrições e observações são inseridos por `innerHTML` sem sanitização.

### Ação

- Priorizar `textContent` e criação de elementos DOM.
- Quando HTML for necessário, usar sanitização confiável.
- Nunca renderizar observações de clientes diretamente como HTML.
- Revisar página pública, garçom, caixa, mesas e entregador.

### Critério de aceite

- Strings como `<script>` ou atributos com eventos aparecem como texto, sem execução.

## 2.3 Recalcular preços e totais no servidor

### Problema

O navegador calcula subtotal, taxa e total. Esses valores não podem ser considerados confiáveis.

### Ação

Nas RPCs `criar_pedido_publico` e `criar_pedido_garcom`:

- buscar produto pelo ID;
- validar produto ativo;
- validar pertencimento ao estabelecimento;
- usar preço atual do banco;
- validar taxa de entrega;
- validar pedido mínimo;
- recalcular total;
- ignorar valores enviados pelo frontend.

### Critério de aceite

- Alterar preço no navegador não altera o total gravado.
- Produto inativo ou de outro estabelecimento é rejeitado.

---

# Fase 3 — Página pública e carrinho

## 3.1 Impedir pedidos duplicados

### Ação

- Desabilitar botão ao iniciar o envio.
- Exibir estado `Enviando...`.
- Reabilitar apenas em erro.
- Implementar idempotência na RPC, quando possível.

### Critério de aceite

- Toques repetidos não criam dois pedidos.

## 3.2 Persistir referência do pedido

### Ação

Após criação do pedido:

- salvar código, loja, telefone e data localmente;
- disponibilizar botão para acompanhar pedido;
- permitir recuperação da referência após fechar ou atualizar a página.

### Critério de aceite

- Cliente consegue localizar o pedido depois de recarregar a página.

## 3.3 Tratar erros amigavelmente

### Ação

- Não mostrar `error.message` bruto do Supabase.
- Mapear erros técnicos para mensagens compreensíveis.
- Registrar detalhes apenas no console ou sistema de observabilidade.

## 3.4 Validar carrinho antes do checkout

### Ação

- Revalidar produtos quando abrir checkout.
- Remover produtos inativos.
- Atualizar preço caso tenha mudado.
- Avisar o cliente antes do envio.

---

# Fase 4 — Padronização dos pedidos

## 4.1 Consolidar tipos de pedido

### Problema

A página pública usa:

- `delivery`;
- `pickup`;
- `local`;
- `mesa`.

O garçom e outros módulos usam:

- `entrega`;
- `retirada`;
- `local`;
- `mesa`.

### Padrão recomendado

```text
entrega
retirada
local
mesa
```

### Ação

- Padronizar banco, frontend, RPCs, filtros e relatórios.
- Criar migração para registros existentes, se necessário.
- Remover conversões duplicadas espalhadas pelo código.

### Critério de aceite

- O mesmo tipo aparece corretamente em pedidos, caixa, financeiro, mesas e entregas.

## 4.2 Consolidar estados de pedido

### Estados esperados

```text
novo
confirmado
preparo
pronto
saiu_entrega
entregue
cancelado
```

### Ação

- Definir transições permitidas.
- Impedir saltos inválidos.
- Exibir estados ausentes na interface administrativa.
- Criar área de cancelados.

## 4.3 Criar histórico de status

### Estrutura sugerida

Tabela `historico_pedidos` com:

- `id`;
- `pedido_id`;
- `status_anterior`;
- `status_novo`;
- `origem`;
- `usuario_id` ou `equipe_id`;
- `created_at`;
- observação opcional.

### Critério de aceite

- Toda alteração de status possui rastreabilidade.

---

# Fase 5 — Garçom

## 5.1 Consolidar autenticação segura

### Ação

- Não utilizar apenas sessão manipulável no navegador.
- Gerar token temporário no backend.
- Validar o token nas RPCs operacionais.
- Associar cada pedido ao funcionário responsável.

## 5.2 Identificar o garçom no pedido

### Ação

Adicionar ao pedido ou ao histórico:

- `equipe_id`;
- nome do garçom;
- origem `garcom`;
- horário de criação.

### Critério de aceite

- O administrador consegue saber quem lançou cada pedido.

## 5.3 Corrigir navegação e nomenclatura

### Problema

`cardapio.html` funciona como central de atendimento do garçom, enquanto o painel chama a gestão de produtos de Cardápio.

### Padrão sugerido

- `app.html#cardapio`: Gestão do cardápio.
- `cardapio.html`: Atendimento / Novo pedido.
- `loja.html`: Cardápio público.

### Ação

Alterar textos de navegação sem quebrar as rotas atuais.

## 5.4 Revisar criação de pedido por mesa

### Ação

- Validar mesa ativa.
- Validar token da mesa.
- Impedir pedido para mesa de outro estabelecimento.
- Atualizar ocupação da mesa após o pedido.
- Liberar mesa após pagamento ou encerramento.

---

# Fase 6 — Entregador e entregas

## 6.1 Melhorar página do entregador

### Ação

Adicionar:

- endereço completo estruturado;
- bairro, cidade, complemento e referência;
- telefone clicável;
- botão Abrir rota;
- confirmação antes de marcar como entregue;
- indicador de valor a receber;
- forma de pagamento;
- observações do pedido;
- atualização em tempo real.

## 6.2 Criar central administrativa de entregas

### Funções necessárias

- listar pedidos prontos para entrega;
- atribuir entregador;
- reatribuir entregador;
- visualizar aguardando coleta;
- visualizar em rota;
- visualizar atrasadas;
- visualizar concluídas;
- filtrar por entregador e período.

## 6.3 Implementar atribuição de entregador

### Estrutura sugerida

No pedido:

- `entregador_id`;
- `atribuido_em`;
- `saiu_entrega_em`;
- `entregue_em`.

### Critério de aceite

- Um entregador visualiza somente pedidos disponíveis ou atribuídos conforme a regra definida.

## 6.4 Comprovante de entrega

### Opções

- PIN informado pelo cliente;
- assinatura simples;
- foto opcional;
- localização aproximada;
- confirmação manual com auditoria.

---

# Fase 7 — Mesas e QR Codes

## 7.1 Consolidar token de mesa

### Problema

O código utiliza nomes diferentes:

- `token_publico`;
- `codigo_qr`;
- `mesa_token`.

### Ação

Escolher um único campo canônico, preferencialmente:

```text
token_publico
```

- Atualizar consultas.
- Atualizar criação de QR Code.
- Atualizar RPCs.
- Migrar valores existentes.

### Critério de aceite

- QR Code público e pedido do garçom vinculam a mesma mesa.

## 7.2 Corrigir links operacionais

### Problema

Na página de mesas, o botão Cardápio direciona para `garcom.html`, que é o login do garçom.

### Ação

Definir intenção:

- gestão do cardápio: `app.html#cardapio`;
- atendimento: `cardapio.html`.

Corrigir links desktop e mobile.

## 7.3 Estado da mesa

### Regras necessárias

- Livre: sem pedido local aberto.
- Ocupada: possui pedido de mesa ainda não encerrado.
- Aguardando pagamento: pedido pronto/servido, mas aberto.
- Reservada: opcional futuramente.

### Critério de aceite

- O estado da mesa deriva dos pedidos reais, sem depender apenas de alteração manual.

## 7.4 Teste completo do QR Code

Para cada mesa:

1. gerar QR Code;
2. abrir no celular;
3. validar slug e token;
4. adicionar itens;
5. enviar pedido;
6. confirmar vínculo com a mesa;
7. visualizar no garçom;
8. visualizar no painel;
9. visualizar no caixa;
10. pagar e liberar mesa.

---

# Fase 8 — Caixa

## 8.1 Reforçar autenticação e autorização

### Ação

- Permitir apenas proprietário ou função autorizada.
- Derivar estabelecimento da sessão.
- Nunca aceitar estabelecimento por parâmetro público.
- Redirecionar usuário não autenticado.

## 8.2 Concluir fluxo de cobrança

### Requisitos

- valor pendente correto;
- pagamento parcial, se permitido;
- forma de pagamento;
- troco;
- referência de cartão;
- observações;
- cancelamento/estorno;
- comprovante;
- encerramento da mesa.

## 8.3 Sincronizar caixa e pedido

### Critério de aceite

Ao confirmar pagamento:

- pagamento é gravado;
- pedido é marcado como pago;
- financeiro é atualizado;
- mesa é liberada quando aplicável;
- histórico registra operador e horário.

---

# Fase 9 — Financeiro

## 9.1 Substituir dados estáticos por dados reais

### Indicadores mínimos

- receita bruta;
- recebido;
- pendente;
- cancelado;
- taxas de entrega;
- ticket médio;
- vendas por forma de pagamento.

## 9.2 Criar movimentações financeiras

### Estrutura sugerida

Tabela `movimentacoes_financeiras`:

- `id`;
- `estabelecimento_id`;
- `pedido_id`;
- `tipo`;
- `valor`;
- `forma_pagamento`;
- `status`;
- `referencia`;
- `created_at`;
- `usuario_id`.

## 9.3 Fechamento de caixa

### Funções necessárias

- abertura;
- saldo inicial;
- recebimentos;
- sangria;
- suprimento;
- fechamento;
- diferença de caixa;
- operador responsável.

## 9.4 Relatórios

### Ação

- filtro por data;
- filtro por tipo de pedido;
- filtro por pagamento;
- exportação CSV;
- PDF posteriormente.

---

# Fase 10 — Testes integrados

## Cenário A — Pedido público para entrega

- loja aberta;
- adicionar produtos;
- validar pedido mínimo;
- calcular taxa;
- enviar pedido;
- confirmar no painel;
- preparar;
- atribuir entregador;
- iniciar entrega;
- marcar entregue;
- validar financeiro.

## Cenário B — Retirada

- criar pedido;
- sem taxa de entrega;
- acompanhar status;
- pagar;
- concluir retirada.

## Cenário C — Comer no local sem QR Code

- criar pedido pela página pública;
- identificar cliente;
- exibir no painel e caixa;
- receber pagamento.

## Cenário D — Mesa por QR Code

- ler QR Code;
- bloquear tipo de atendimento;
- criar pedido;
- ocupar mesa;
- acompanhar no garçom;
- adicionar novo pedido à mesma mesa;
- receber no caixa;
- liberar mesa.

## Cenário E — Pedido lançado pelo garçom

- autenticar garçom;
- selecionar mesa;
- criar pedido;
- registrar autor;
- validar isolamento por estabelecimento;
- logout.

## Cenário F — Entregador

- autenticar entregador;
- visualizar entrega permitida;
- abrir rota;
- iniciar entrega;
- concluir entrega;
- validar histórico e financeiro;
- logout e expiração.

## Cenário G — Segurança

- tentar acessar outro estabelecimento;
- adulterar preço no navegador;
- reutilizar token expirado;
- usar sessão de entregador no garçom;
- inserir HTML malicioso em descrição e observação;
- enviar pedido duplicado.

---

# Ordem recomendada de execução

## Sprint 1 — Bloqueadores

1. Corrigir redirects do garçom e entregador.
2. Implementar logout do garçom.
3. Validar função e expiração da sessão.
4. Corrigir links incorretos.
5. Consolidar token de mesa.
6. Impedir pedidos duplicados.

## Sprint 2 — Segurança

1. Revisar RLS.
2. Criar RPCs seguras para equipe.
3. Recalcular preços no servidor.
4. Sanitizar renderização.
5. Padronizar tipos e estados.

## Sprint 3 — Operação

1. Histórico de status.
2. Atribuição de entregador.
3. Central de entregas.
4. Fluxo completo do caixa.
5. Estado automático das mesas.

## Sprint 4 — Financeiro

1. Movimentações reais.
2. Indicadores.
3. Fechamento de caixa.
4. Relatórios e exportação.

## Sprint 5 — Homologação

1. Dados fictícios completos.
2. Testes por celular e desktop.
3. Teste dos 7 QR Codes.
4. Teste multiestabelecimento.
5. Teste de permissões.
6. Correção de regressões.

---

# Definição de pronto

A plataforma poderá ser considerada pronta para operação quando:

- acessos de proprietário, garçom e entregador estiverem isolados;
- nenhuma página operacional depender de permissões anônimas excessivas;
- preços e totais forem recalculados no servidor;
- QR Codes vincularem corretamente pedidos às mesas;
- pedidos percorrerem todo o fluxo até pagamento ou entrega;
- caixa atualizar financeiro e estado da mesa;
- entregas tiverem atribuição e rastreabilidade;
- financeiro usar dados reais;
- todos os cenários integrados estiverem homologados;
- não houver falhas críticas abertas.

## Observação final

Não iniciar melhorias apenas estéticas antes de concluir as correções críticas de sessão, RLS, consistência de tipos, token das mesas e cálculo server-side. Essas correções são a base para uma operação confiável.