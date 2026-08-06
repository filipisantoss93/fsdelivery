# Auditoria unificada de pedidos — 05/08/2026

## Objetivo

Garantir que os pedidos criados pelo garçom, página pública, painel administrativo, balcão, caixa e venda rápida usem o mesmo contrato de dados, os mesmos estados operacionais e as mesmas regras no HTML, JavaScript e Supabase.

## Escopo auditado

| Canal | Entrada | Origem persistida | Tipo aceito | Status inicial esperado |
|---|---|---:|---|---|
| Página pública | `/loja?loja=slug` | `publico` | `entrega`, `retirada` | `aguardando_aprovacao` |
| QR da mesa | `/loja?loja=slug&mesa=token` | `qr_mesa` | `mesa` | `confirmado` |
| Garçom | `/garcom` | `garcom` | `mesa` | `confirmado` |
| Painel principal | `/app` → `/balcao` | `painel` | `mesa`, `retirada`, `entrega` | `confirmado` |
| Balcão | `/balcao` | `balcao` | `mesa`, `retirada`, `entrega` | `confirmado` |
| Venda rápida no caixa | `/balcao?origem=caixa` | `caixa` | `mesa`, `retirada`, `entrega` | `confirmado` |
| Caixa | `/caixa` | mantém a origem do pedido | cobrança e fechamento | conforme evolução operacional |

## Falhas críticas encontradas

### 1. Código textual retornado como número

A RPC pública retorna códigos como `PED-0009`, mas as RPCs do garçom estavam declaradas com retorno `bigint`. O PostgreSQL tentou converter o código textual para número e abortou a venda.

**Evidência de produção:** erros `invalid input syntax for type bigint: "PED-0009"` nos logs do PostgreSQL.

**Correção:** `criar_pedido_garcom` e `criar_pedido_equipe_garcom` agora retornam `text`.

### 2. Banco e repositório não possuíam o mesmo schema

O código versionado trabalhava com a origem do pedido, mas a tabela `pedidos` de produção não possuía a coluna `origem`.

**Correção:** adicionada coluna obrigatória com os valores:

- `publico`
- `qr_mesa`
- `painel`
- `garcom`
- `balcao`
- `caixa`

### 3. Status inicial não distinguia pedido público de pedido interno

O trigger anterior definia o status principalmente pela configuração de abertura do caixa. Assim, um pedido público podia entrar direto na cozinha e um pedido interno podia ficar aguardando aprovação.

**Correção:**

- entrega ou retirada pública: `aguardando_aprovacao`;
- QR de mesa e canais internos: `confirmado`.

### 4. URLs limpas impediam o carregamento dos módulos corretivos

A Vercel usa `cleanUrls: true`, mas o carregador e módulos operacionais verificavam apenas caminhos terminados em `.html`. Nas URLs reais `/app` e `/loja`, os módulos consolidados podiam não carregar.

**Correção:** criado contrato único em `window.FSDeliveryRoute`; todas as verificações passam a aceitar URL limpa e URL legada.

### 5. Entrega criada no balcão enviava contrato incompleto

O balcão enviava endereço em texto, enquanto a RPC exige CEP e endereço estruturado para calcular e validar a região de entrega. O troco também era misturado nas observações.

**Correção:** o payload agora envia:

- `cep`;
- `bairro`;
- `endereco`;
- `endereco_dados`;
- `troco_para`;
- `origem`.

### 6. Pedido de mesa era validado como pagamento antecipado

Pedido de mesa não informa forma de pagamento no envio, mas a RPC ainda comparava um valor vazio com as formas permitidas e recusava o pedido.

**Correção:** validação de forma de pagamento não é aplicada a `tipo='mesa'`.

### 7. Venda rápida do caixa apontava para o fluxo errado

O botão de novo pedido do caixa abria o cardápio do garçom.

**Correção:** o caixa agora possui o comando **Venda rápida**, que abre `/balcao?origem=caixa` e persiste a origem `caixa`.

## Contrato unificado

### Tipos canônicos

- `mesa`
- `retirada`
- `entrega`

`local` permanece apenas como conceito visual do balcão e é convertido para `mesa` antes de chegar ao banco.

### Status canônicos

1. `aguardando_aprovacao`
2. `confirmado`
3. `preparo`
4. `pronto`
5. `servido` para mesa
6. `saiu_entrega` para entrega
7. `finalizado`
8. `cancelado`

Aliases antigos são normalizados pelo módulo `js/pedido-status.js`.

### Endereço

Somente `tipo='entrega'` pode manter:

- `endereco_entrega`;
- `bairro_entrega`;
- `taxa_entrega`;
- `cliente_endereco_id`.

Pedidos de mesa e retirada têm esses campos limpos pelo trigger.

### Aprovação

- Pedidos públicos de entrega e retirada aguardam aprovação do restaurante.
- Pedidos do garçom, QR da mesa, painel, balcão e caixa entram confirmados.

### Pagamento

- Mesa pode ser criada sem forma de pagamento e é cobrada depois de servida.
- Retirada e entrega exigem forma de pagamento válida.
- Troco é persistido em `troco_para`.
- A mesa só é finalizada depois da quitação integral.

## Alterações aplicadas

### Frontend

- `js/supabase.js`
- `js/app-orders-operational.js`
- `js/app-orders-type-filters.js`
- `js/loja-fluxos-pedido.js`
- `js/loja-pos-envio.js`
- `js/balcao-fluxos.js`
- `caixa.html`

### Supabase

- `20260805_auditoria_pedidos_unificada.sql`
- `20260805_corrigir_pagamento_pedido_mesa.sql`
- `20260805_endurecer_seguranca_e_indices_pedidos.sql`

As migrations equivalentes já foram aplicadas ao banco de produção.

## Validação executada no banco

Foi executada uma matriz de seis pedidos dentro de subtransação reversível:

| Cenário | Resultado |
|---|---|
| Retirada pública | `publico` / `retirada` / `aguardando_aprovacao` |
| Entrega pública | `publico` / `entrega` / `aguardando_aprovacao`, endereço e taxa válidos |
| QR da mesa | `qr_mesa` / `mesa` / `confirmado` |
| Garçom | `garcom` / `mesa` / `confirmado` |
| Balcão | `balcao` / `retirada` / `confirmado` |
| Venda rápida | `caixa` / `retirada` / `confirmado`, troco persistido |

Todos os asserts passaram. A subtransação foi revertida e a consulta final confirmou zero pedidos e zero itens residuais.

## Segurança e desempenho

- RPC administrativa de criação de pedido: somente `authenticated`.
- RPC pública: `anon` e `authenticated`, com preço recalculado no banco.
- RPC do garçom por PIN: pública por necessidade operacional, com validação de telefone, PIN, função e vínculo ao estabelecimento.
- Abrir caixa, fechar caixa e função antiga da cozinha deixaram de ser executáveis por `anon`.
- Funções auxiliares receberam `search_path=public`.
- Criados índices para cliente do pedido, produto do item, recebedor do pagamento, movimentação por pedido e notificação por pedido.

## Teste de regressão

O arquivo `tests/auditoria-pedidos-estatica.mjs` passou a verificar:

- rotas limpas;
- carregamento dos módulos consolidados;
- tipos e status canônicos;
- contrato do payload do balcão;
- venda rápida no caixa;
- retorno textual das RPCs;
- origens permitidas;
- separação entre pedido público e interno;
- ausência da dependência inválida `counter-address` no fluxo efetivo.

O workflow `.github/workflows/auditoria-pedidos.yml` executa validação de sintaxe e auditoria estática em pull requests.

## Pendências separadas desta correção

Estas pendências não bloqueiam o contrato corrigido, mas devem compor uma auditoria posterior de consolidação:

1. remover módulos legados que continuam no projeto apenas por compatibilidade;
2. consolidar os estilos específicos de pedidos para reduzir sobreposição de CSS;
3. substituir a consulta pública de histórico baseada apenas em telefone por token de dispositivo obrigatório;
4. revisar globalmente grants e políticas RLS de tabelas fora do fluxo de pedidos;
5. otimizar políticas RLS antigas que recalculam `auth.uid()` por linha;
6. eliminar índices duplicados identificados pelo advisor do Supabase.

## Critério de aceite

A correção é considerada pronta para produção quando:

- o pull request estiver aprovado e mesclado;
- o deploy da Vercel estiver `READY`;
- `/loja`, `/app`, `/balcao`, `/caixa` e `/garcom` abrirem sem erro de console;
- um pedido real controlado de cada canal aparecer no painel com origem, tipo e status corretos;
- a cobrança no caixa finalizar uma mesa somente após pagamento integral.
