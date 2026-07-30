# Auditoria HTML — Redundâncias e correções

## Objetivo

Revisar as páginas HTML do FS Delivery para eliminar informações duplicadas, reduzir ruído visual e priorizar dados operacionais relevantes.

## Página inicial

### Problemas identificados

1. **Faturamento** e **Vendas no mês** são exibidos na mesma tela sem deixar claro o período considerado em cada indicador.
2. **Pedidos hoje** e **Pedidos em preparo** são métricas válidas, mas estão distribuídas em blocos diferentes.
3. **Clientes** possui baixa relevância operacional na página inicial e pode ficar restrito à área de clientes ou relatórios.
4. O bloco **Resumo rápido** repete informações já apresentadas nos cards superiores.
5. **Produtos ativos** não precisa ocupar espaço permanente na tela inicial quando não existe problema no cardápio.
6. O acesso **Config** aparece no cabeçalho e novamente na navegação inferior.
7. O status da loja é representado apenas por um interruptor, sem texto explicando o estado atual.
8. O card **Pedidos recentes** ocupa uma área grande mesmo quando não existem pedidos.

## Correções recomendadas

### 1. Consolidar os indicadores principais

Manter apenas quatro cards na parte superior:

- **Pedidos hoje**
- **Em preparo**
- **Vendas hoje**
- **Ticket médio hoje**

Todos os indicadores devem utilizar o mesmo período de referência para evitar ambiguidade.

### 2. Remover o bloco "Resumo rápido"

O bloco deve ser removido da página inicial porque repete métricas já exibidas nos indicadores principais.

Informações como **Produtos ativos** devem aparecer somente como alerta contextual, por exemplo:

> Nenhum produto ativo no cardápio.

### 3. Ajustar "Pedidos recentes"

Quando não houver pedidos, exibir um estado vazio útil:

> Nenhum pedido recebido hoje.

Adicionar uma ação contextual:

- **Criar pedido**

Manter o botão **Ver todos** direcionando para a página de pedidos.

### 4. Corrigir o cabeçalho

O cabeçalho deve conter:

- título **Início**;
- status textual **Loja aberta** ou **Loja fechada**;
- interruptor de alteração do status;
- sino de notificações.

Remover o botão grande **Config** do cabeçalho, pois a configuração já está disponível na barra de navegação inferior.

### 5. Reposicionar a métrica de clientes

Remover o card **Clientes** da página inicial.

A quantidade total de clientes pode ser exibida em:

- página de clientes;
- relatórios;
- painel administrativo detalhado.

## Estrutura final esperada

1. Cabeçalho com título, status da loja e notificações.
2. Quatro indicadores operacionais.
3. Lista de pedidos recentes.
4. Alertas contextuais somente quando houver pendências.
5. Navegação inferior sem ações duplicadas no cabeçalho.

## Critérios de aceite

- [ ] Não existe duplicidade de acesso à página de configurações.
- [ ] O status da loja possui texto explícito.
- [ ] O bloco **Resumo rápido** foi removido.
- [ ] As métricas financeiras indicam claramente o período.
- [ ] O card **Clientes** não aparece na página inicial.
- [ ] O estado vazio de pedidos recentes apresenta mensagem e ação útil.
- [ ] A página inicial fica mais curta e focada na operação diária.
- [ ] O padrão visual consolidado do FS Delivery é preservado.
- [ ] Nenhum arquivo CSS adicional ou regra de override é criado.
- [ ] As alterações reutilizam os componentes, fontes de dados e estilos existentes.
