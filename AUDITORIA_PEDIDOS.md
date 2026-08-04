# Auditoria do Módulo de Pedidos — FS Delivery

**Status:** Planejamento técnico  
**Prioridade geral:** Alta  
**Objetivo:** separar corretamente os fluxos de pedidos por origem, evitar campos incompatíveis e padronizar a navegação operacional.

---

## 1. Problema identificado

O módulo atual mistura dados e comportamentos de pedidos de mesa, balcão e pedidos on-line.

Isso provoca:

- exibição de campos desnecessários;
- risco de preenchimento incorreto;
- dificuldade para identificar a origem do pedido;
- navegação inconsistente entre garçom e balcão;
- regras de status pouco claras;
- maior complexidade para manutenção do frontend e backend.

---

## 2. Regra principal de arquitetura

Todos os pedidos podem utilizar a mesma tabela e a mesma fonte de dados, porém cada origem deve possuir regras próprias de interface, validação e status.

### Origens recomendadas

- `mesa`
- `balcao_local`
- `balcao_retirada`
- `balcao_entrega`
- `online_retirada`
- `online_entrega`

### Campo recomendado

```text
origem_pedido
```

Esse campo deve ser obrigatório e utilizado para controlar:

- campos exibidos;
- validações;
- filtros;
- ícones ou identificadores visuais;
- impressão;
- notificações;
- transições de status.

---

## 3. Pedidos na mesa

Pedidos vinculados a uma mesa não devem exibir dados relacionados a entrega.

### Exibir

- número ou identificação da mesa;
- itens do pedido;
- quantidade;
- observações dos itens;
- observação geral;
- garçom responsável, quando aplicável;
- horário de abertura;
- subtotal e total;
- status do pedido.

### Exibir opcionalmente

- nome do cliente;
- quantidade de pessoas;
- identificação da comanda.

### Não exibir

- CEP;
- rua;
- número do endereço;
- bairro;
- cidade;
- complemento;
- ponto de referência;
- taxa de entrega;
- entregador;
- previsão de entrega.

### Regra de pagamento

A forma de pagamento pode ser informada somente no fechamento da conta, salvo quando o estabelecimento adotar pagamento antecipado.

---

## 4. Pedidos on-line

Pedidos realizados pela loja pública não devem exibir mesa nem informações específicas do garçom.

### Não exibir

- mesa;
- número da comanda;
- garçom responsável;
- campos exclusivos de consumo local.

### Exibir sempre

- nome do cliente;
- WhatsApp;
- itens;
- observações;
- modalidade do pedido;
- forma de pagamento;
- valor total.

### Para retirada

Exibir:

- nome do cliente;
- WhatsApp;
- horário estimado para retirada;
- forma de pagamento.

Não exibir endereço.

### Para entrega

Exibir:

- CEP;
- rua;
- número;
- bairro;
- cidade;
- complemento;
- ponto de referência;
- taxa de entrega;
- forma de pagamento;
- troco, quando necessário.

### Status inicial obrigatório

Todo pedido on-line deve iniciar como:

```text
aguardando_confirmacao
```

O pedido não deve entrar automaticamente em preparo.

### Fluxo recomendado

```text
Aguardando confirmação
→ Confirmado
→ Em preparo
→ Pronto
→ Saiu para entrega ou Aguardando retirada
→ Entregue ou Retirado
→ Finalizado
```

### Ações do restaurante

Na etapa de confirmação, permitir:

- aceitar pedido;
- rejeitar pedido;
- ajustar previsão;
- informar indisponibilidade;
- registrar motivo da rejeição.

---

## 5. Pedidos criados pelo garçom e pelo balcão

Os fluxos devem ser separados por finalidade.

---

### 5.1 Garçom

A página do garçom deve ser focada em atendimento no salão.

#### Exibir

- mesas;
- comandas abertas;
- cardápio;
- inclusão de itens;
- observações;
- acompanhamento de pedidos da mesa;
- solicitação de fechamento.

#### Não usar para

- retirada no balcão;
- entrega;
- cadastro completo de endereço;
- pedidos externos sem mesa.

---

### 5.2 Balcão — Local

Utilizado para pedidos feitos no balcão e consumidos no estabelecimento.

#### Exibir

- mesa, quando houver;
- nome do cliente, opcional;
- itens;
- observações;
- forma de pagamento, conforme regra do estabelecimento.

#### Não exibir

- endereço de entrega;
- taxa de entrega;
- entregador.

---

### 5.3 Balcão — Retirada

Utilizado para pedidos feitos diretamente no estabelecimento, por telefone ou WhatsApp, com retirada posterior.

#### Exibir

- nome do cliente;
- WhatsApp;
- itens;
- observações;
- previsão de retirada;
- forma de pagamento;
- troco, quando aplicável.

#### Não exibir

- mesa;
- endereço;
- taxa de entrega;
- entregador.

---

### 5.4 Balcão — Entrega

Utilizado para pedidos de entrega cadastrados manualmente pela equipe.

#### Exibir

- nome do cliente;
- WhatsApp;
- CEP;
- rua;
- número;
- bairro;
- cidade;
- complemento;
- ponto de referência;
- taxa de entrega;
- forma de pagamento;
- troco;
- previsão de entrega.

#### Não exibir

- mesa;
- campos específicos do salão.

---

## 6. Botões de novo pedido

Os botões de novo pedido existentes nas páginas administrativas não devem abrir a página do garçom.

### Comportamento correto

```text
Novo pedido
→ abrir página do balcão
```

A página do balcão deve permitir selecionar inicialmente:

- Local;
- Retirada;
- Entrega.

Após a seleção, somente os campos relacionados à modalidade escolhida devem ser renderizados.

### Recomendação de rota

```text
balcao.html
```

Ou, caso a página já exista, manter uma única rota oficial e remover duplicações.

---

## 7. Menu inferior da página balcão

A página do balcão deve receber o menu inferior no padrão visual consolidado do FS Delivery.

### Itens recomendados

- Pedidos;
- Novo pedido;
- Histórico;
- Perfil ou Mais.

### Regras

- destacar a página ativa;
- usar os mesmos ícones e dimensões das demais áreas;
- respeitar área segura do iPhone;
- não cobrir botões ou conteúdo;
- permanecer fixo em dispositivos móveis;
- ocultar opções sem permissão para o usuário atual.

---

## 8. Cards de pedidos

Cada card deve destacar a origem do pedido sem depender da leitura de todos os campos.

### Informações essenciais

- número do pedido;
- origem;
- cliente ou mesa;
- horário;
- valor;
- status;
- forma de pagamento, quando relevante.

### Identificação visual

Utilizar ícones padronizados e texto, evitando depender somente de cores.

Exemplos:

- Mesa;
- Local;
- Retirada;
- Entrega;
- On-line.

### Evitar

- excesso de dados no card;
- endereço completo antes de expandir;
- botões duplicados;
- status com nomenclaturas diferentes para a mesma etapa;
- ícones coloridos sem padrão.

---

## 9. Filtros recomendados

### Por origem

- Todos;
- Mesa;
- Balcão;
- Retirada;
- Entrega;
- On-line.

### Por status

- Aguardando confirmação;
- Novos;
- Confirmados;
- Em preparo;
- Prontos;
- Aguardando retirada;
- Saiu para entrega;
- Finalizados;
- Cancelados.

### Regra

Os filtros devem utilizar os valores reais persistidos no banco, evitando traduções inconsistentes ou comparações por texto exibido na interface.

---

## 10. Padronização de status

Recomenda-se centralizar os status em uma única configuração JavaScript ou enum equivalente no backend.

### Status sugeridos

```text
aguardando_confirmacao
confirmado
em_preparo
pronto
aguardando_retirada
saiu_para_entrega
entregue
retirado
finalizado
cancelado
rejeitado
```

### Regras importantes

- pedidos on-line começam em `aguardando_confirmacao`;
- pedidos internos podem começar em `confirmado` ou `em_preparo`, conforme configuração;
- pedido de mesa não deve receber `saiu_para_entrega`;
- pedido de retirada não deve receber `entregue`;
- pedido de entrega não deve receber `retirado`;
- status finalizados não devem voltar para preparo sem ação administrativa explícita.

---

## 11. Validação de campos

A validação deve depender da modalidade selecionada.

### Mesa

Obrigatórios:

- mesa;
- pelo menos um item.

### Retirada

Obrigatórios:

- nome;
- WhatsApp;
- pelo menos um item.

### Entrega

Obrigatórios:

- nome;
- WhatsApp;
- endereço mínimo válido;
- forma de pagamento;
- pelo menos um item.

### Pagamento em dinheiro

Exibir campo de troco somente quando a opção selecionada for dinheiro.

---

## 12. Banco de dados

Revisar a tabela de pedidos para evitar depender de inferência por campos nulos.

### Campos recomendados

```text
id
estabelecimento_id
numero_pedido
origem_pedido
modalidade
status
mesa_id
garcom_id
cliente_nome
cliente_whatsapp
endereco_json
forma_pagamento
troco_para
taxa_entrega
subtotal
total
observacoes
criado_em
confirmado_em
finalizado_em
```

### Regras

- `origem_pedido` deve ser obrigatório;
- `mesa_id` deve ser nulo para entrega e retirada;
- `endereco_json` deve ser nulo para mesa, local e retirada;
- `taxa_entrega` deve ser zero ou nula fora de entrega;
- transições de status devem ser validadas;
- consultas devem sempre filtrar por `estabelecimento_id`.

---

## 13. Segurança e permissões

Revisar RLS e permissões por perfil.

### Garçom

- visualizar mesas e pedidos permitidos;
- criar pedidos de mesa;
- adicionar itens;
- não alterar configurações administrativas.

### Balcão

- criar pedidos local, retirada e entrega;
- confirmar pedidos on-line;
- atualizar status operacionais.

### Cozinha

- visualizar somente dados necessários para produção;
- não visualizar endereço completo ou informações financeiras desnecessárias.

### Entregador

- visualizar somente pedidos atribuídos;
- acessar endereço e contato após atribuição;
- confirmar saída e entrega.

---

## 14. Impressão e visualização por setor

### Cozinha

Exibir:

- número do pedido;
- itens;
- quantidades;
- observações;
- origem resumida;
- horário.

Não exibir endereço completo ou dados financeiros.

### Balcão

Exibir:

- cliente;
- modalidade;
- pagamento;
- total;
- retirada ou entrega.

### Entregador

Exibir:

- cliente;
- WhatsApp;
- endereço;
- referência;
- forma de pagamento necessária para cobrança;
- valor a receber.

---

## 15. Notificações

### Novo pedido on-line

- tocar alerta sonoro opcional;
- exibir badge;
- destacar pedido aguardando confirmação;
- impedir que o pedido passe despercebido;
- evitar alertas repetidos após confirmação.

### Pedido pronto

- notificar balcão;
- disponibilizar para retirada ou entrega;
- encaminhar ao portal do entregador quando aplicável.

---

## 16. Melhorias de experiência do usuário

- manter a modalidade visível durante todo o cadastro;
- limpar campos incompatíveis ao trocar de modalidade;
- solicitar confirmação antes de descartar um pedido iniciado;
- preservar o carrinho ao navegar dentro do fluxo;
- mostrar resumo antes de salvar;
- desabilitar o botão de concluir enquanto houver campos obrigatórios inválidos;
- aplicar máscara de WhatsApp e moeda;
- buscar endereço por CEP sem bloquear preenchimento manual;
- exibir mensagens de erro próximas ao campo;
- evitar modais longos para criação completa de pedido;
- priorizar fluxo em página dedicada no celular.

---

## 17. Critérios de aceite

### Pedido de mesa

- não apresenta campos de endereço;
- exige mesa;
- salva origem correta;
- aparece nos filtros de mesa;
- não recebe status de entrega.

### Pedido on-line

- não apresenta mesa;
- solicita dados conforme retirada ou entrega;
- inicia aguardando confirmação;
- só avança após ação do restaurante.

### Pedido de balcão local

- permite selecionar mesa quando necessário;
- não apresenta endereço.

### Pedido de retirada

- exige nome e WhatsApp;
- não apresenta endereço nem mesa.

### Pedido de entrega

- exige dados do cliente, endereço e pagamento;
- não apresenta mesa.

### Navegação

- todos os botões administrativos de novo pedido abrem o balcão;
- a página do balcão possui menu inferior funcional;
- a opção ativa do menu é destacada.

---

## 18. Ordem recomendada de implementação

### Prioridade alta

1. Mapear páginas, scripts e consultas atuais de pedidos.
2. Definir `origem_pedido`, `modalidade` e status oficiais.
3. Separar os formulários por modalidade.
4. Corrigir pedidos na mesa.
5. Corrigir pedidos on-line.
6. Corrigir o redirecionamento dos botões de novo pedido.
7. Consolidar a página do balcão.
8. Adicionar menu inferior ao balcão.

### Prioridade média

9. Padronizar cards e filtros.
10. Centralizar regras de status.
11. Ajustar validações de formulário.
12. Revisar impressão por setor.
13. Revisar notificações.

### Prioridade futura

14. Integrar portal do entregador.
15. Adicionar atribuição de entregas.
16. Integrar Google Maps.
17. Implementar organização estratégica de rotas.
18. Adicionar rastreamento e confirmação de entrega.

---

## 19. Resultado esperado

O módulo deve operar como fluxos independentes sobre uma estrutura de dados compartilhada:

1. pedido na mesa;
2. pedido no balcão para consumo local;
3. pedido para retirada;
4. pedido para entrega;
5. pedido on-line aguardando confirmação.

Cada fluxo deve exibir somente os campos necessários, aplicar validações próprias e permitir identificação imediata da origem e do estágio operacional do pedido.
