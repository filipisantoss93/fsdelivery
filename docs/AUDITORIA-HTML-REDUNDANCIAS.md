# Auditoria HTML — Redundâncias e correções

## Objetivo

Revisar as páginas HTML do FS Delivery para eliminar informações duplicadas, reduzir ruído visual e priorizar dados operacionais relevantes.

## Página inicial

### Problemas identificados

1. **Faturamento** e **Vendas no mês** eram exibidos na mesma tela sem deixar claro o período considerado em cada indicador.
2. **Pedidos hoje** e **Pedidos em preparo** eram métricas válidas, mas estavam distribuídas em blocos diferentes.
3. **Clientes** possuía baixa relevância operacional na página inicial.
4. O bloco **Resumo rápido** repetia informações já apresentadas nos cards superiores.
5. **Produtos ativos** ocupava espaço permanente mesmo quando não havia pendência no cardápio.
6. O acesso **Config** aparecia no cabeçalho e novamente na navegação principal.
7. O status da loja era representado apenas por um interruptor, sem texto explicando o estado atual.
8. O card **Pedidos recentes** ocupava uma área grande mesmo quando não existiam pedidos.

### Correções aplicadas

- Indicadores consolidados em **Pedidos hoje**, **Em preparo**, **Vendas hoje** e **Ticket médio hoje**.
- Todos os indicadores da página inicial agora usam pedidos do dia atual.
- Pedidos cancelados não participam das métricas.
- Bloco **Resumo rápido** removido.
- Card **Clientes** removido da página inicial.
- Status textual **Loja aberta** ou **Loja fechada** adicionado ao cabeçalho.
- Botão duplicado de configuração removido visualmente do cabeçalho.
- Pedidos recentes limitados ao dia atual.
- Estado vazio alterado para **Nenhum pedido recebido hoje**.
- Ação **Criar pedido** adicionada.
- Alerta de produtos aparece apenas quando não existem produtos ativos.

## Navegação e páginas internas

### Problemas identificados

1. `app.html` ainda contém seções internas completas para **Cardápio**, **Clientes**, **Financeiro** e **Configurações**.
2. `js/notifications.js` substitui a navegação original e direciona parte dessas funções para páginas HTML independentes, como `garcom.html`, `caixa.html` e `configuracoes.html`.
3. A seção `configuracoes` incorporada em `app.html` é removida em tempo de execução, mas ainda é carregada, preenchida e manipulada antes da remoção.
4. O JavaScript continua renderizando dados em seções que podem não fazer parte da navegação final.
5. Existem duas definições de menu: uma no HTML e outra criada dinamicamente por JavaScript.
6. A nomenclatura **Cardápio** no menu aponta para `garcom.html`, cuja função principal é realizar pedidos, podendo gerar expectativa incorreta para o usuário.

### Correção planejada

- Consolidar uma única fonte de navegação.
- Definir claramente quais funções permanecem dentro de `app.html`.
- Remover seções órfãs somente após tornar `app.js` tolerante à ausência desses elementos.
- Evitar preencher e renderizar componentes que são removidos logo após o carregamento.
- Corrigir o nome do acesso a `garcom.html` para representar a ação operacional real.
- Preservar as páginas independentes já consolidadas para **Caixa**, **Garçom**, **Mesas** e **Configurações**.

## Próxima etapa técnica

1. Tornar `app.js` seguro para componentes opcionais.
2. Remover dependências dos elementos ocultos usados apenas para compatibilidade.
3. Eliminar a seção incorporada de configurações após validar `configuracoes.html` como fonte única.
4. Revisar se Cardápio, Clientes e Financeiro devem permanecer como seções internas ou páginas próprias.
5. Consolidar o menu diretamente em uma única implementação.

## Estrutura final esperada

1. Cabeçalho com título, status da loja e notificações.
2. Quatro indicadores operacionais do dia.
3. Lista de pedidos recentes do dia.
4. Alertas contextuais somente quando houver pendências.
5. Uma única fonte de navegação.
6. Nenhuma seção HTML carregada sem uso funcional.
7. Uma única página de configuração do estabelecimento.

## Critérios de aceite

- [x] Não existe duplicidade visual de acesso à página de configurações no cabeçalho.
- [x] O status da loja possui texto explícito.
- [x] O bloco **Resumo rápido** foi removido.
- [x] As métricas financeiras indicam claramente o período.
- [x] O card **Clientes** não aparece na página inicial.
- [x] O estado vazio de pedidos recentes apresenta mensagem e ação útil.
- [x] A página inicial fica mais curta e focada na operação diária.
- [ ] Existe apenas uma implementação do menu principal.
- [ ] Seções internas sem acesso pela navegação foram removidas ou reintegradas.
- [ ] `configuracoes.html` é a única fonte de configuração do estabelecimento.
- [ ] O JavaScript não depende de elementos ocultos apenas para evitar erros.
- [ ] Os nomes dos itens de navegação representam corretamente sua função.
- [x] O padrão visual consolidado do FS Delivery foi preservado.
- [x] Nenhum arquivo CSS adicional ou regra de override foi criado.
- [x] As alterações reutilizam os componentes, fontes de dados e estilos existentes.
