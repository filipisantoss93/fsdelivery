# Auditoria de Clientes — FS Delivery

## Objetivo

Consolidar o cadastro de clientes usando o WhatsApp como identificador operacional, criar o cliente automaticamente ao realizar pedidos, permitir múltiplos endereços e reutilizar endereços salvos em novos pedidos.

## Situação atual

- O cliente já é criado automaticamente em pedidos públicos e pedidos internos quando nome e telefone são informados.
- A identificação atual usa a combinação `estabelecimento_id + telefone`.
- O endereço é salvo somente dentro de `pedidos.endereco_entrega`.
- A página Clientes reconstrói clientes a partir dos pedidos, em vez de usar a tabela `clientes` como fonte principal.
- Não existe tabela própria para endereços do cliente.
- Não existe seleção de endereço salvo no novo pedido.

## Regras funcionais aprovadas

### Identificação do cliente

- O número do WhatsApp será o identificador visível do cliente.
- O banco manterá o `id` UUID interno para relacionamentos.
- O telefone deverá ser normalizado para conter apenas números.
- A unicidade será por estabelecimento e telefone normalizado.
- O mesmo WhatsApp poderá existir em estabelecimentos diferentes.

### Cadastro automático

Ao criar um pedido com nome e WhatsApp:

1. normalizar o telefone;
2. procurar cliente no estabelecimento;
3. criar o cliente caso não exista;
4. atualizar dados básicos quando necessário;
5. vincular o `cliente_id` ao pedido;
6. atualizar `ultimo_pedido_em`.

### Endereços

- Um cliente poderá possuir vários endereços.
- Cada endereço poderá receber um apelido, como Casa, Trabalho ou Outro.
- Apenas um endereço poderá ser principal por cliente.
- Endereços antigos poderão ser desativados sem apagar o histórico.
- O pedido continuará guardando uma cópia do endereço usado no momento da compra.

### Novo pedido

Ao informar um WhatsApp já conhecido:

- carregar os endereços salvos;
- selecionar inicialmente o endereço principal;
- permitir escolher outro endereço;
- permitir cadastrar um novo endereço;
- salvar o novo endereço para pedidos futuros quando autorizado pelo operador ou cliente.

## Estrutura de dados

### Alterações em `clientes`

- `telefone_normalizado text`
- `primeiro_pedido_em timestamptz`
- `ultimo_pedido_em timestamptz`
- `updated_at timestamptz`

### Nova tabela `cliente_enderecos`

- `id uuid`
- `estabelecimento_id uuid`
- `cliente_id uuid`
- `apelido text`
- `cep text`
- `logradouro text`
- `numero text`
- `complemento text`
- `bairro text`
- `cidade text`
- `estado text`
- `referencia text`
- `latitude double precision`
- `longitude double precision`
- `principal boolean`
- `ativo boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

### Alterações em `pedidos`

- `cliente_endereco_id uuid`
- manter `endereco_entrega` como snapshot histórico.

## Segurança

A loja pública não deverá retornar todos os endereços cadastrados somente com a digitação do WhatsApp. A reutilização pública deverá usar uma estratégia segura, como sessão local do aparelho, código de pedido anterior ou validação do número.

No painel autenticado, balcão e garçom, os endereços poderão ser consultados conforme as permissões do estabelecimento.

## Plano de implementação

### Etapa 1 — Banco de dados

- [x] Criar auditoria técnica.
- [x] Criar migration inicial de clientes e endereços.
- [ ] Executar migration no Supabase.
- [ ] Validar dados existentes e possíveis telefones duplicados.

### Etapa 2 — Backend de pedidos

- [ ] Centralizar normalização do WhatsApp no PostgreSQL.
- [ ] Atualizar `criar_pedido_publico`.
- [ ] Atualizar `criar_pedido_garcom`.
- [ ] Atualizar fluxo do balcão.
- [ ] Vincular endereço salvo ao pedido.
- [ ] Preservar snapshot do endereço no pedido.

### Etapa 3 — Novo pedido

- [ ] Consultar cliente pelo WhatsApp no painel autenticado.
- [ ] Exibir endereços salvos.
- [ ] Permitir selecionar endereço principal.
- [ ] Permitir cadastrar outro endereço.
- [ ] Evitar campos de endereço para retirada e atendimento local.

### Etapa 4 — Página Clientes

- [ ] Usar `clientes` como fonte principal.
- [ ] Criar ficha do cliente.
- [ ] Exibir histórico de pedidos.
- [ ] Exibir total gasto e ticket médio.
- [ ] Gerenciar múltiplos endereços.
- [ ] Definir endereço principal.
- [ ] Desativar endereço sem apagar histórico.

### Etapa 5 — Loja pública

- [ ] Definir método seguro para reutilização de endereço.
- [ ] Carregar endereço salvo no mesmo aparelho.
- [ ] Permitir adicionar endereço novo.
- [ ] Não expor endereços apenas pela consulta do WhatsApp.

## Critérios de aceite

- Um novo pedido cria automaticamente o cliente.
- Pedidos seguintes reutilizam o mesmo cliente pelo WhatsApp normalizado.
- Um cliente pode possuir mais de um endereço.
- O endereço selecionado fica vinculado ao pedido.
- Alterar um endereço salvo não modifica pedidos antigos.
- Retirada, mesa e consumo local não exigem endereço.
- A página Clientes não cria registros duplicados ao agrupar pedidos.
- Telefones com máscara diferente são reconhecidos como o mesmo número.
