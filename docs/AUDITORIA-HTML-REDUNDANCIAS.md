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

## Página inicial

### Problemas identificados

1. As métricas da página inicial ainda são calculadas em `js/app.js` usando todo o histórico de pedidos, embora os rótulos indiquem período diário.
2. O JavaScript ainda depende de elementos ocultos ou seções antigas para executar sem erros.
3. As áreas de Cardápio, Clientes, Financeiro e Configurações permanecem incorporadas em `app.html`, mesmo com páginas dedicadas para parte dessas funções.
4. `setupAccount()` ainda inicializa a antiga seção interna de configurações.
5. `render()` ainda executa `renderProducts()`, `renderCustomers()` e `renderFinance()` em toda atualização da página inicial.
6. O botão **Novo pedido** gerado na página de pedidos direciona para `cardapio.html`, enquanto o fluxo interno atual utiliza `garcom.html`.
7. O status da loja depende de um observador inline em `app.html`, além da função `setupLabels()` existente em `app.js`.
8. A navegação antiga ainda permanece escrita no HTML e é substituída em tempo de execução por `navigation.js`.

## Correções recomendadas

### 1. Tornar `app.js` tolerante a componentes opcionais

Antes de remover seções antigas do HTML, todas as funções devem verificar se seus elementos existem.

Funções prioritárias:

- `renderProducts()`;
- `renderCustomers()`;
- `renderFinance()`;
- `setupAccount()`;
- `saveSettings()`;
- `bindActions()`;
- `setupLabels()`.

Nenhuma função deve interromper a inicialização da página por ausência de um componente que não pertence mais ao painel principal.

### 2. Corrigir as métricas diárias

Manter quatro indicadores:

- **Pedidos hoje**;
- **Em preparo**;
- **Vendas hoje**;
- **Ticket médio hoje**.

Regras:

- considerar somente pedidos criados no dia local atual;
- excluir pedidos cancelados;
- calcular o ticket médio sobre os pedidos válidos do dia;
- manter **Em preparo** como quantidade operacional do dia.

### 3. Remover seções órfãs de `app.html`

Após o endurecimento do JavaScript, remover do painel principal:

- seção interna de Cardápio;
- seção interna de Clientes;
- seção interna de Financeiro;
- seção interna de Configurações;
- modal de produto, quando não houver mais uso no painel;
- elementos ocultos usados apenas como compatibilidade.

As páginas dedicadas devem permanecer como fonte única para essas operações.

### 4. Consolidar o status da loja

A função `setupLabels()` deve atualizar diretamente:

- texto **Loja aberta** ou **Loja fechada**;
- classe visual do status;
- `aria-label`;
- controle de abertura e fechamento, quando existente.

Depois disso, remover o `MutationObserver` inline de `app.html`.

### 5. Consolidar a navegação no HTML

O HTML não deve manter um menu completo que será descartado e recriado pelo JavaScript.

A solução final deve utilizar uma destas estratégias:

1. marcação mínima com `data-fs-navigation`, preenchida por `navigation.js`; ou
2. navegação HTML definitiva, com `navigation.js` responsável apenas pelo estado ativo.

A primeira opção reduz duplicidade entre páginas e é a recomendada para o padrão atual.

### 6. Corrigir o fluxo de novo pedido

Todos os acessos internos para criação de pedidos devem apontar para:

`garcom.html`

O arquivo `cardapio.html` não deve ser usado como destino interno sem que sua finalidade esteja definida e validada.

## Ordem segura de execução

1. Endurecer `app.js` para elementos opcionais.
2. Corrigir métricas e estado vazio da página inicial.
3. Corrigir o destino do botão **Novo pedido**.
4. Consolidar o status da loja em `setupLabels()`.
5. Remover seções órfãs e marcações antigas de `app.html`.
6. Validar Início, Pedidos, Novo pedido, Caixa, Mesas e Configurações.
7. Comparar a branch com a `main` antes do merge.
8. Fazer um único merge final para reduzir deploys de produção.

## Critérios de aceite

- [x] A navegação não está mais implementada dentro de `notifications.js`.
- [x] Existe uma fonte compartilhada para a navegação principal.
- [x] O acesso duplicado de configurações no cabeçalho fica oculto.
- [x] O acesso a `garcom.html` possui nome operacional correto.
- [ ] As métricas financeiras usam claramente o período diário.
- [ ] Pedidos cancelados não entram nos indicadores.
- [ ] O estado vazio de pedidos recentes apresenta mensagem e ação útil.
- [ ] `app.js` funciona sem seções internas de Cardápio, Clientes, Financeiro e Configurações.
- [ ] O status textual da loja é controlado por uma única implementação.
- [ ] A navegação antiga não permanece duplicada no HTML.
- [ ] O botão **Novo pedido** direciona para `garcom.html`.
- [ ] A página inicial fica mais curta e focada na operação diária.
- [ ] O padrão visual consolidado do FS Delivery é preservado.
- [ ] Nenhum arquivo CSS adicional ou regra de override é criado.
- [ ] As alterações reutilizam componentes, fontes de dados e estilos existentes.
