# Auditoria do Módulo de Pedidos — FS Delivery

**Status:** Implementação avançada  
**Última atualização:** 03/08/2026  
**Objetivo:** separar corretamente mesa, balcão, pedidos on-line, cozinha, caixa e entrega.

---

## Concluído

- [x] Balcão separado em **Local**, **Retirada** e **Entrega**.
- [x] Campos condicionais por modalidade.
- [x] Pedido local exige mesa.
- [x] Retirada não exibe endereço nem mesa.
- [x] Entrega exige cliente, WhatsApp, endereço e pagamento.
- [x] Botões administrativos de **Novo pedido** abrem `balcao.html`.
- [x] Menu inferior incluído no balcão.
- [x] Portal do garçom restrito ao atendimento de mesas.
- [x] Loja pública sem opção de consumo local fora do QR Code.
- [x] Pedido por QR Code permanece vinculado exclusivamente à mesa.
- [x] Pedido on-line inicia em `aguardando_aprovacao`.
- [x] Pedidos internos iniciam em `confirmado`.
- [x] Endereço e taxa de entrega exclusivos para entrega.
- [x] Cards não exibem endereço para mesa e retirada.
- [x] Filtros por modalidade e por status.
- [x] Timeline do cliente adaptada por modalidade.
- [x] Cozinha recebe somente pedidos confirmados.
- [x] Caixa bloqueia cobrança antes da confirmação.
- [x] Portal do entregador com retirada, rota, contato e confirmação de entrega.
- [x] Rota estratégica com múltiplos endereços no Google Maps.
- [x] Migration de consolidação dos fluxos criada.

---

## Fluxos oficiais

### Mesa

`confirmado → preparo → pronto → servido → finalizado`

Regras:

- exige mesa;
- não possui endereço;
- não possui taxa de entrega;
- pagamento pode ocorrer no fechamento da conta.

### Retirada

`aguardando_aprovacao → confirmado → preparo → pronto → finalizado`

Regras:

- exige nome e WhatsApp;
- não possui mesa;
- não possui endereço;
- não entra no portal do entregador.

### Entrega

`aguardando_aprovacao → confirmado → preparo → pronto → saiu_entrega → finalizado`

Regras:

- exige nome, WhatsApp, endereço e pagamento;
- não possui mesa;
- aparece no portal do entregador após ficar pronta.

### Balcão interno

Pedidos criados manualmente entram diretamente em `confirmado`.

### Loja pública

Pedidos externos aguardam aprovação do restaurante antes de entrar na cozinha.

---

## Arquivos principais alterados

- `balcao.html`
- `js/balcao-fluxos.js`
- `js/app-orders-operational.js`
- `js/app-orders-type-filters.js`
- `js/loja.js`
- `js/loja-fluxo-online.js`
- `cardapio.html`
- `js/garcom.js`
- `js/garcom-salao.js`
- `js/cliente.js`
- `js/cozinha.js`
- `js/caixa.js`
- `js/entregador-core.js`
- `js/entregador-operational.js`
- `supabase/migrations/20260803_consolidar_fluxos_pedidos.sql`
- `supabase/migrations/20260803_proteger_cobranca_pedidos.sql`

---

## Pendências de validação

- [ ] Executar as migrations novas no Supabase de produção.
- [ ] Testar pedido de mesa pelo QR Code em aparelho real.
- [ ] Testar pedido on-line de retirada.
- [ ] Testar pedido on-line de entrega.
- [ ] Testar aprovação e rejeição no painel.
- [ ] Testar impressão da cozinha.
- [ ] Testar pagamento parcial e integral no caixa.
- [ ] Testar liberação automática da mesa.
- [ ] Testar portal do entregador com dois ou mais endereços.
- [ ] Validar funcionamento após o próximo deploy da Vercel.

---

## Melhorias futuras

- atribuição explícita de pedido por entregador;
- previsão individual de retirada ou entrega;
- busca automática de endereço por CEP;
- geocodificação e distância real por API;
- comprovante de entrega com foto ou código;
- impressão automática por setor;
- relatório de tempo médio por etapa;
- alerta de pedido parado acima do tempo esperado.

---

## Critério final de aceite

A auditoria será considerada concluída quando os três fluxos abaixo forem testados de ponta a ponta em produção:

1. Mesa por QR Code.
2. Retirada on-line.
3. Entrega on-line com portal do entregador.
