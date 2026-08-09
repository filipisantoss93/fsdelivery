# Caixa FS Delivery

O caixa usa `caixa.html`, `js/caixa.js` e `css/caixa.css`. O contrato financeiro está na migração `20260809211109_profissionalizar_fluxo_caixa.sql`.

## Fluxos homologados

- Abertura: somente uma sessão pode permanecer aberta por estabelecimento.
- Recebimento: cada lançamento fica vinculado à sessão aberta e pode ser parcial.
- Conta de mesa: todos os pedidos abertos da mesa aparecem na mesma conta; um pagamento pode ser distribuído entre eles.
- Pagamento on-line: pedidos com `pagamento_status` igual a `autorizado` ou `pago` são tratados como quitados e não podem ser cobrados novamente.
- Finalização: mesa servida e retirada pronta são finalizadas após quitação; pedidos ainda em produção continuam abertos mesmo se pagos.
- Venda rápida: cria, recebe e finaliza uma venda avulsa sem cliente, endereço ou mesa.
- Fechamento: o dinheiro esperado considera valor inicial mais recebimentos em dinheiro. Pix, cartões e vale ficam fora da gaveta, mas aparecem no resumo.

## Garantias no banco

- bloqueio concorrente e índice parcial impedem dois caixas abertos;
- preços da venda rápida são validados nos produtos ativos do estabelecimento;
- a chave idempotente evita venda duplicada em reenvios;
- pagamentos on-line autorizados ou pagos bloqueiam novo lançamento manual;
- cobranças agrupadas travam os pedidos em ordem estável e são atômicas;
- funções financeiras exigem sessão autenticada e propriedade do estabelecimento.
