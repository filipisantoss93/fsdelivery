# Checkout de cartão à vista

O checkout público usa cartão on-line somente em 1x.

Campos visíveis:
- número do cartão;
- validade MM/AA;
- CVV;
- nome no cartão;
- CPF do titular;
- e-mail.

Dados reaproveitados do pedido:
- nome do comprador;
- telefone.

Não solicitar no cartão:
- parcelas;
- nascimento;
- endereço de cobrança.

Os dados do cartão são tokenizados pela Efí no navegador e não são persistidos pelo FS Delivery.

## Estados financeiros

- `new` e `waiting` → `aguardando`;
- `identified` → `em_analise`;
- `approved` → `autorizado`: libera o pedido para a operação, mas ainda não representa liquidação;
- `paid` e `settled` → `pago`: confirmam a liquidação;
- `unpaid` → `recusado`;
- `expired` e `canceled` → `cancelado`;
- `refunded` → `estornado`;
- `contested` → `chargeback`.

Eventos atrasados não podem regredir a cobrança. A autorização possui timestamp próprio
(`pagamento_autorizado_em`) e a liquidação continua registrada separadamente em
`pagamento_confirmado_em`.

Os campos financeiros do pedido são controlados somente pelo backend de pagamentos.
Atualizações diretas por sessões `anon` ou `authenticated` são rejeitadas pelo banco.

## Ambientes

Tokenização, cobrança e webhook usam o ambiente configurado para o estabelecimento.
Eventos de homologação e produção são validados contra o ambiente em que a cobrança foi
criada; uma divergência é auditada e ignorada.
