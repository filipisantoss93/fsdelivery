# Homologação do Módulo de Pedidos — FS Delivery

**Status:** pronto para execução manual  
**Escopo:** loja pública, QR de mesa, garçom, balcão, cozinha, caixa, cliente e entregador.

## Preparação

- Aplicar todas as migrations pendentes no Supabase.
- Confirmar deploy da branch `main` na Vercel.
- Limpar cache do navegador e abrir em aba anônima.
- Cadastrar ao menos 1 mesa, 1 entregador, produtos ativos e taxa de entrega.

## 1. Loja pública — Retirada

- Adicionar produto ao carrinho.
- Confirmar que a taxa de entrega não aparece antes da modalidade.
- Selecionar Retirada.
- Confirmar ausência de mesa e endereço.
- Informar nome, WhatsApp e pagamento.
- Enviar pedido.
- Confirmar mensagem “Aguardando confirmação do restaurante”.
- Confirmar total sem taxa de entrega.
- Confirmar link funcional para acompanhar o pedido.

## 2. Loja pública — Entrega

- Selecionar Entrega.
- Confirmar exibição de região, rua, número, bairro e complemento.
- Confirmar cálculo da taxa somente após a modalidade.
- Tentar enviar sem endereço e validar bloqueio.
- Enviar com endereço completo.
- Confirmar status inicial `aguardando_aprovacao`.
- Confirmar ausência de mesa no banco e nas telas.

## 3. QR Code da mesa

- Abrir link com token `mesa` válido.
- Confirmar identificação da mesa no cabeçalho e checkout.
- Confirmar ausência de endereço, região e taxa de entrega.
- Criar pedido.
- Confirmar vínculo com `mesa_id`.
- Confirmar status interno inicial `confirmado`.

## 4. Portal do garçom

- Confirmar que somente pedidos de mesa podem ser criados.
- Confirmar mesa obrigatória.
- Confirmar ausência de entrega, retirada e endereço.
- Adicionar itens e observações.
- Confirmar exibição do pedido na mesa correta.

## 5. Balcão — Local

- Abrir `balcao.html` pelo botão Novo pedido.
- Selecionar Local.
- Confirmar mesa obrigatória.
- Confirmar ausência de endereço e taxa.
- Criar pedido e validar origem/tipo.

## 6. Balcão — Retirada

- Selecionar Retirada.
- Confirmar nome e WhatsApp obrigatórios.
- Confirmar ausência de mesa e endereço.
- Validar pagamento e troco somente para dinheiro.

## 7. Balcão — Entrega

- Selecionar Entrega.
- Confirmar ausência de mesa.
- Confirmar endereço estruturado obrigatório.
- Validar taxa, pagamento e troco.
- Confirmar disponibilização para o entregador apenas após ficar pronto.

## 8. Confirmação de pedido on-line

- Confirmar que pedido público não entra automaticamente na cozinha.
- Em cartão on-line, confirmar `approved → autorizado` e `paid/settled → pago`.
- Confirmar que `autorizado` permite ao estabelecimento aceitar o pedido sem marcar a cobrança como liquidada.
- Confirmar que webhooks atrasados `new` ou `waiting` não regridem `autorizado` ou `pago`.
- Confirmar que eventos de homologação não alteram cobranças de produção, e vice-versa.
- Aceitar pedido e validar transição para `confirmado`.
- Rejeitar outro pedido e validar motivo/status.
- Confirmar bloqueio de cobrança antes da aceitação.

## 9. Cozinha

- Confirmar que exibe apenas pedidos confirmados ou em preparo.
- Confirmar ausência de endereço completo e dados financeiros desnecessários.
- Avançar `confirmado → preparo → pronto`.
- Confirmar atualização em tempo real nas demais telas.

## 10. Caixa

- Confirmar separação entre mesas e pedidos externos.
- Confirmar que pedidos aguardando aprovação não podem ser cobrados.
- Registrar pagamento parcial e integral.
- Confirmar liberação da mesa após quitação e encerramento correto.

## 11. Portal do entregador

- Confirmar grupos Em preparo, Aguardando retirada, Em rota e Concluídas.
- Aceitar e retirar pedido pronto.
- Abrir rota individual no Google Maps.
- Testar rota estratégica com múltiplos endereços.
- Confirmar ligação, WhatsApp e cópia de endereço.
- Confirmar entrega e validar atualização do cliente.

## 12. Acompanhamento do cliente

- Consultar pelo WhatsApp.
- Confirmar timeline específica para retirada e entrega.
- Confirmar endereço somente em entrega.
- Confirmar status aguardando aprovação, preparo, pronto, rota e concluído.
- Confirmar tratamento de rejeição e cancelamento.

## 13. Mobile e iPhone

- Testar Safari em largura 390–430 px.
- Confirmar que modais não ficam atrás da barra inferior.
- Confirmar rolagem interna do checkout.
- Confirmar botões acessíveis com teclado aberto.
- Confirmar que o carrinho não cobre conteúdo.
- Confirmar preservação do carrinho ao recarregar antes do envio.

## 14. Critério de aprovação

O módulo pode ser considerado homologado quando todos os fluxos abaixo funcionarem sem mistura de campos:

- Mesa: mesa e itens, sem endereço.
- Retirada: cliente e pagamento, sem mesa/endereço.
- Entrega: cliente, endereço, pagamento e taxa, sem mesa.
- On-line: sempre aguarda confirmação do restaurante; cartão exige antes autorização da operadora.
- Interno: entra confirmado conforme o fluxo operacional.

Registrar qualquer falha com página, modalidade, pedido, horário, captura de tela e mensagem do console.
