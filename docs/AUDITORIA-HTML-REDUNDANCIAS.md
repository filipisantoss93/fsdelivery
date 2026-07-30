# Auditoria HTML — Redundâncias e correções

## Objetivo

Revisar as páginas HTML do FS Delivery para eliminar informações duplicadas, reduzir ruído visual e priorizar dados operacionais relevantes sem quebrar os fluxos atuais.

## Situação da implementação

A auditoria passou a ser executada na branch `auditoria-html-redundancias-v2`, criada diretamente da versão atual da `main`.

A branch anterior não deve ser mesclada porque ficou divergente em relação ao projeto.

### Concluído nesta branch

- [x] Separar a navegação da lógica de notificações.
- [x] Manter `js/notifications.js` responsável somente pelo sino e pela lista de notificações.
- [x] Criar `js/navigation.js` como fonte única para a navegação principal.
- [x] Carregar a navegação compartilhada pelo arquivo global `js/supabase.js`.
- [x] Remover visualmente o acesso duplicado de configurações no cabeçalho.
- [x] Corrigir o nome do acesso para `garcom.html` de **Cardápio** para **Novo pedido**.
- [x] Consolidar `app.html` para manter somente Início, Pedidos e o modal de pedido.
- [x] Simplificar `js/app.js` para o fluxo operacional do painel.
- [x] Corrigir métricas para considerar somente pedidos válidos do dia atual.
- [x] Remover o módulo temporário de correções após consolidar a implementação.

## Página inicial

### Estado atual

A página inicial foi simplificada e agora mantém apenas os elementos operacionais necessários:

- quatro indicadores diários;
- lista de pedidos recentes do dia;
- ação para abrir a página de pedidos;
- estado textual da loja;
- notificações;
- navegação compartilhada.

As áreas de Cardápio, Clientes, Financeiro e Configurações foram removidas do painel principal e permanecem em páginas dedicadas.

## Regras implementadas

### Métricas diárias

Indicadores mantidos:

- **Pedidos hoje**;
- **Em preparo**;
- **Vendas hoje**;
- **Ticket médio hoje**.

Regras aplicadas:

- considerar somente pedidos criados no dia local atual;
- excluir pedidos cancelados;
- calcular o ticket médio sobre os pedidos válidos do dia;
- manter **Em preparo** como quantidade operacional do dia.

### Navegação

- `js/navigation.js` é a fonte compartilhada da navegação principal;
- a navegação mobile duplicada foi removida de `app.html`;
- o acesso operacional **Novo pedido** aponta para `garcom.html`;
- configurações permanecem em `configuracoes.html`.

### Status da loja

A lógica foi consolidada em `js/app.js`, responsável por atualizar:

- texto **Loja aberta** ou **Loja fechada**;
- classe visual do status;
- `aria-label`;
- confirmação antes da alteração.

O observador inline anteriormente presente em `app.html` foi removido.

### Estrutura removida do painel principal

Foram removidos:

- seção interna de Cardápio;
- seção interna de Clientes;
- seção interna de Financeiro;
- seção interna de Configurações;
- modal de produto;
- navegação mobile duplicada;
- elementos ocultos de compatibilidade sem uso operacional.

## Páginas responsáveis por cada operação

- `app.html`: visão inicial e acompanhamento dos pedidos;
- `garcom.html`: criação de pedido;
- `caixa.html`: aprovação e operação do caixa;
- `mesas-operacao.html`: operação das mesas;
- `configuracoes.html`: dados e funcionamento do estabelecimento.

## Validação antes do merge

1. Abrir o preview atualizado da branch.
2. Validar login e carregamento de `app.html`.
3. Validar métricas do dia atual.
4. Alternar entre Início e Pedidos.
5. Abrir `garcom.html` pelo botão **Novo pedido**.
6. Abrir detalhes de um pedido.
7. Avançar, cancelar e excluir pedidos de teste.
8. Alternar o status da loja.
9. Validar sino e painel de notificações.
10. Validar navegação em desktop e mobile.
11. Confirmar ausência de erros no console.
12. Comparar novamente a branch com a `main`.

## Critérios de aceite

- [x] A navegação não está mais implementada dentro de `notifications.js`.
- [x] Existe uma fonte compartilhada para a navegação principal.
- [x] O acesso duplicado de configurações no cabeçalho fica oculto.
- [x] O acesso a `garcom.html` possui nome operacional correto.
- [x] As métricas financeiras usam claramente o período diário.
- [x] Pedidos cancelados não entram nos indicadores.
- [x] O estado vazio de pedidos recentes apresenta mensagem e ação útil.
- [x] `app.js` funciona sem seções internas de Cardápio, Clientes, Financeiro e Configurações.
- [x] O status textual da loja é controlado por uma única implementação.
- [x] A navegação antiga não permanece duplicada no HTML.
- [x] O botão **Novo pedido** direciona para `garcom.html`.
- [x] A página inicial fica mais curta e focada na operação diária.
- [x] O padrão visual consolidado do FS Delivery é preservado.
- [x] Nenhum arquivo CSS adicional ou regra de override é criado.
- [x] As alterações reutilizam componentes, fontes de dados e estilos existentes.
- [ ] Preview final validado sem regressões.
- [ ] Branch aprovada para merge na `main`.
