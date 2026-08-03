# FS Delivery — Plano do fluxo operacional completo de pedidos

## Objetivo

Consolidar um fluxo profissional e rastreável para acompanhar cada pedido desde sua criação até a conclusão, com visão adequada para administração, caixa, cozinha, garçom e entregador.

Este documento também registra a correção da aba **Pedidos**, a estratégia de notificações e a criação de uma página própria para pedidos realizados no balcão.

---

## 1. Diagnóstico atual

### 1.1 Aba Pedidos do painel pode ficar vazia

O painel administrativo atualmente trabalha principalmente com os grupos:

- `novo`
- `preparo`
- `pronto`
- `entregue`

Entretanto, o fluxo real também utiliza:

- `aguardando_aprovacao`
- `confirmado`
- `saiu_entrega`
- `cancelado`

Pedidos em `aguardando_aprovacao` ou `confirmado` são carregados, mas não entram em nenhuma aba visível. Isso explica a situação em que existem pedidos no banco e a página **Pedidos** não exibe nenhum registro.

Também há um problema de nomenclatura: o status `pronto` aparece no painel como **Saiu para entrega**, embora um pedido pronto ainda possa ser de mesa, consumo local ou retirada.

### 1.2 Erros de consulta são ocultados

O carregamento do painel transforma resultados sem verificar adequadamente o erro da consulta de pedidos. Quando a consulta falha, a interface pode exibir uma lista vazia em vez de informar o erro real.

### 1.3 Status inicial não respeita completamente o fluxo operacional

A função de banco `definir_status_inicial_pedido()` atualmente força novos pedidos para `aguardando_aprovacao`.

O comportamento correto deve considerar a configuração operacional:

- com aprovação obrigatória pelo caixa: `aguardando_aprovacao`;
- sem aprovação obrigatória: `confirmado` e disponível imediatamente para a cozinha.

### 1.4 Entregador recebe o pedido tarde demais

A função `listar_entregas_equipe` retorna somente pedidos com status:

- `pronto`
- `saiu_entrega`

Assim, o entregador não consegue antecipar as próximas entregas enquanto elas ainda estão em preparo.

### 1.5 Notificações dependem de atualização visual

O garçom atualiza a operação periodicamente e o entregador usa consulta a cada 20 segundos. Não existe um evento persistente e específico por função informando que um pedido mudou de etapa.

---

## 2. Modelo oficial de status

O sistema deve possuir um fluxo principal único, com rótulos adaptados ao tipo de atendimento.

| Status técnico | Significado operacional | Responsável pela próxima ação |
|---|---|---|
| `aguardando_aprovacao` | Pedido criado e aguardando validação | Caixa/administração |
| `confirmado` | Pedido aprovado e liberado para produção | Cozinha |
| `preparo` | Produção iniciada | Cozinha |
| `pronto` | Produção concluída | Garçom, entregador ou caixa |
| `saiu_entrega` | Pedido de entrega em rota | Entregador |
| `finalizado` | Atendimento concluído com sucesso | Nenhuma ação |
| `cancelado` | Pedido encerrado sem conclusão | Nenhuma ação |

### Compatibilidade com estados antigos

Durante a migração:

- `novo` deve ser tratado como equivalente a `confirmado`;
- `entregue` deve ser tratado como equivalente a `finalizado`;
- dados antigos não podem desaparecer das listas;
- a interface deve usar uma função central de normalização de status.

### Rótulo de `pronto` por tipo

- `mesa` ou `local`: **Pronto para servir**;
- `entrega`: **Pronto para entrega**;
- `retirada`: **Pronto para retirada**.

### Conclusão por tipo

- mesa/local: garçom toca em **Marcar como servido** e o pedido vai para `finalizado`;
- retirada: caixa toca em **Confirmar retirada** e o pedido vai para `finalizado`;
- entrega: entregador toca em **Iniciar entrega**, passa para `saiu_entrega`, e depois **Confirmar entrega**, passando para `finalizado`.

---

## 3. Painel central de pedidos

A aba **Pedidos** do painel principal deve ser a visão completa da operação.

### 3.1 Abas obrigatórias

1. **Todos ativos**
2. **Aguardando aprovação**
3. **Na fila da cozinha**
4. **Em preparo**
5. **Prontos**
6. **Em rota**
7. **Finalizados**
8. **Cancelados**

No celular, as abas devem ter rolagem horizontal. No desktop, podem ser exibidas em uma linha ou agrupadas em filtros.

### 3.2 Informações de cada card

Cada pedido deve mostrar:

- código ou número do pedido;
- horário de criação e tempo decorrido;
- tipo: mesa, local, retirada ou entrega;
- mesa vinculada, quando existir;
- nome e telefone do cliente, quando aplicável;
- resumo dos itens;
- total e forma de pagamento;
- status atual;
- responsável atual pela próxima etapa;
- ações permitidas para aquele status.

### 3.3 Linha do tempo

O modal de detalhes deve mostrar uma linha do tempo:

`Criado → Aprovado → Em preparo → Pronto → Em rota/Servido/Retirado → Finalizado`

Cada etapa deve registrar data e hora. Para isso, recomenda-se criar uma tabela de histórico, em vez de depender somente do status atual.

Tabela sugerida: `pedido_eventos`

Campos mínimos:

- `id`
- `pedido_id`
- `estabelecimento_id`
- `status_anterior`
- `status_novo`
- `origem` (`admin`, `caixa`, `cozinha`, `garcom`, `entregador`, `sistema`)
- `responsavel_id`, quando houver
- `observacao`
- `created_at`

### 3.4 Correções obrigatórias no carregamento

- tratar explicitamente erros retornados pelo Supabase;
- não substituir erro por lista vazia;
- incluir relação com `mesas` na consulta do painel;
- preservar o filtro atual após atualização em tempo real;
- atualizar contadores sem recarregar toda a página;
- exibir pedidos legados por meio da normalização de status.

---

## 4. Fluxo do garçom

### 4.1 Funções do garçom

O portal do garçom permanece com três áreas:

- **Mesas**
- **Novo pedido**
- **Pedidos**

### 4.2 Acompanhamento

A aba **Pedidos** do garçom deve exibir prioritariamente pedidos:

- de mesa;
- de consumo local;
- criados pela sessão atual, quando essa identificação estiver disponível.

Filtros:

- aguardando aprovação;
- na cozinha;
- em preparo;
- prontos para servir;
- finalizados.

Pedidos em `aguardando_aprovacao` devem continuar visíveis, com a indicação **Aguardando aprovação do caixa**.

### 4.3 Pedido pronto para mesa

Quando um pedido com `tipo = mesa` ou `tipo = local` mudar para `pronto`:

- incrementar badge em **Pedidos**;
- exibir aviso dentro do sistema;
- tocar som curto, se permitido;
- vibrar no aparelho, quando suportado;
- destacar a mesa e o pedido;
- disponibilizar a ação **Marcar como servido**.

A confirmação do garçom altera o status para `finalizado` e registra o evento no histórico.

---

## 5. Fluxo do entregador

### 5.1 Pedidos visíveis

O entregador deve visualizar pedidos de entrega nos seguintes estados:

- `preparo`: somente leitura, seção **Próximas entregas**;
- `pronto`: disponível para iniciar entrega;
- `saiu_entrega`: entrega em andamento.

Pedidos `confirmado` podem aparecer apenas como contagem opcional, sem endereço completo, para não poluir a fila operacional.

### 5.2 Organização da tela

A página deve ser dividida em:

1. **Em preparo**
   - previsão da próxima demanda;
   - sem botão para iniciar rota.
2. **Prontos para entrega**
   - endereço, cliente, telefone e total;
   - botão **Iniciar entrega**.
3. **Em rota**
   - navegação;
   - botão **Confirmar entrega**.
4. **Concluídas hoje**
   - histórico compacto.

### 5.3 Notificação de pedido pronto

Quando um pedido de entrega passar de `preparo` para `pronto`:

- criar notificação para a função `entregador`;
- atualizar a lista imediatamente por Realtime;
- emitir som, vibração e aviso visual;
- destacar o pedido recém-liberado;
- recalcular a rota estratégica.

### 5.4 Alteração necessária no banco

A função `listar_entregas_equipe` deve passar a retornar também pedidos em `preparo`, mantendo as regras de estabelecimento, função e entregador atribuído.

A ação `atualizar_entrega_equipe` deve continuar aceitando somente transições válidas:

- `pronto → saiu_entrega`;
- `saiu_entrega → finalizado`.

---

## 6. Fluxo da cozinha

A cozinha deve receber somente pedidos liberados:

- `confirmado`/`novo` legado;
- `preparo`.

Ações:

- `confirmado → preparo`: **Iniciar preparo**;
- `preparo → pronto`: **Marcar como pronto**.

Ao marcar como pronto, o sistema decide automaticamente quem será notificado:

- mesa/local: garçom;
- entrega: entregador;
- retirada: caixa/administração.

A cozinha não deve finalizar entrega, retirada ou serviço na mesa.

---

## 7. Sistema de notificações

### 7.1 Estratégia recomendada

Criar uma tabela persistente `notificacoes_operacionais`, alimentada por uma função/trigger de transição de status.

Campos mínimos:

- `id`
- `estabelecimento_id`
- `pedido_id`
- `destinatario_funcao`
- `tipo`
- `titulo`
- `mensagem`
- `lida_em`
- `created_at`
- `chave_deduplicacao`

### 7.2 Eventos iniciais

| Evento | Destinatário |
|---|---|
| Pedido aguardando aprovação | Caixa/administração |
| Pedido confirmado | Cozinha |
| Pedido local pronto | Garçom |
| Pedido de entrega pronto | Entregador |
| Pedido de retirada pronto | Caixa/administração |
| Entrega iniciada | Administração |
| Pedido finalizado | Administração |

### 7.3 Canais de aviso

Primeira etapa:

- badge na navegação;
- aviso interno tipo toast;
- painel de notificações;
- som configurável;
- vibração;
- atualização por Supabase Realtime.

Segunda etapa:

- Web Push com service worker para notificações em segundo plano;
- permissão solicitada somente após uma ação clara do usuário;
- preferência individual para ativar/desativar som e push.

A aplicação não deve depender apenas da Notification API. A notificação precisa permanecer disponível no painel mesmo que o navegador bloqueie avisos do sistema.

---

## 8. Novo pedido no painel principal

## Decisão: criar página própria para balcão

Será adotada a **opção 2**.

Criar:

- `balcao.html`
- `js/balcao.js`

### Justificativa

- separa o trabalho administrativo do portal do garçom;
- evita trocar ou misturar sessões operacionais;
- permite botão **Voltar ao painel**;
- funciona de maneira consistente em desktop, navegador móvel e PWA;
- não depende de o sistema operacional abrir automaticamente outro PWA;
- permite permissões específicas para caixa/balcão;
- facilita manutenção e testes.

### Funcionalidades da página de balcão

- reutilizar a mesma fonte de categorias, produtos, preços e disponibilidade;
- permitir pedido de retirada, consumo local e entrega;
- permitir selecionar mesa somente quando necessário;
- mostrar carrinho e resumo;
- respeitar abertura de caixa e aprovação operacional;
- retornar para `app.html#pedidos` após concluir ou cancelar;
- possuir cabeçalho com **Voltar ao painel**;
- não oferecer menus administrativos que não pertencem ao fluxo de venda.

### Alteração no botão atual

O botão **Novo pedido** do painel deve deixar de abrir `cardapio.html` e passar a abrir `balcao.html`.

`cardapio.html` permanece como portal operacional do garçom.

---

## 9. Contrato central de status no frontend

Criar um módulo compartilhado, por exemplo:

- `js/pedido-status.js`

Responsabilidades:

- normalizar status antigos;
- fornecer rótulos por tipo de atendimento;
- informar grupo de filtro;
- informar próxima ação permitida;
- definir cor e prioridade;
- impedir que cada página invente sua própria interpretação.

Funções sugeridas:

```js
normalizarStatus(status)
rotuloStatus(status, tipo)
grupoStatus(status)
proximaAcao(status, tipo, funcao)
statusFinal(status)
```

O módulo deve ser utilizado por:

- `js/app.js`
- `js/garcom.js`
- `js/cozinha.js`
- `js/entregador.js`
- `js/caixa.js`
- `js/balcao.js`

---

## 10. Regras de transição no backend

Toda mudança operacional deve passar por RPC, não por `update` livre no frontend.

Motivos:

- validar a função do usuário;
- validar o estabelecimento;
- impedir saltos de status;
- registrar histórico;
- criar notificações;
- manter timestamps consistentes;
- evitar divergência entre páginas.

RPCs podem ser especializados por função ou consolidados em uma função segura, desde que preservem permissões.

Transições mínimas permitidas:

```text
aguardando_aprovacao → confirmado | cancelado
confirmado           → preparo | cancelado
preparo               → pronto | cancelado
pronto + mesa/local   → finalizado
pronto + retirada     → finalizado
pronto + entrega      → saiu_entrega
saiu_entrega          → finalizado
```

Qualquer transição fora dessa matriz deve retornar erro operacional compreensível.

---

## 11. Arquivos previstos

### Alterar

- `app.html`
- `js/app.js`
- `cardapio.html`
- `js/garcom.js`
- `cozinha.html`
- `js/cozinha.js`
- `entregador.html`
- `js/entregador.js`
- `caixa.html`
- `js/caixa.js`
- `css/style.css`
- `css/app-polish.css`

### Criar

- `balcao.html`
- `js/balcao.js`
- `js/pedido-status.js`
- migração SQL para status, histórico, notificações e RPCs

Evitar criar folhas CSS paralelas sem necessidade. Os componentes devem permanecer consolidados no design system atual do FS Delivery.

---

## 12. Estratégia de implementação em lote

Para evitar vários deploys de produção na Vercel:

1. implementar todas as mudanças em uma branch única;
2. aplicar e validar a migração do Supabase;
3. testar os cinco fluxos principais;
4. corrigir todos os erros encontrados ainda na mesma branch;
5. realizar um único merge para `main`;
6. gerar um único deploy de produção.

A migração do banco deve ser compatível com o frontend atual durante a transição, evitando período em que páginas antigas parem de funcionar.

---

## 13. Cenários obrigatórios de teste

### Cenário A — pedido de mesa

1. garçom seleciona mesa;
2. cria pedido;
3. caixa aprova, quando exigido;
4. cozinha inicia preparo;
5. cozinha marca pronto;
6. garçom recebe notificação;
7. garçom marca servido;
8. pedido aparece como finalizado em todos os painéis.

### Cenário B — entrega

1. pedido de entrega é criado;
2. pedido entra em preparo;
3. entregador visualiza em **Próximas entregas**;
4. cozinha marca pronto;
5. entregador é notificado;
6. entregador inicia entrega;
7. pedido passa para em rota;
8. entregador confirma entrega;
9. pedido é finalizado.

### Cenário C — retirada

1. pedido de retirada é criado;
2. cozinha prepara e marca pronto;
3. caixa recebe notificação;
4. caixa confirma retirada;
5. pedido é finalizado.

### Cenário D — aprovação desativada

1. pedido é criado;
2. entra diretamente como `confirmado`;
3. aparece imediatamente na cozinha.

### Cenário E — cancelamento

1. pedido ativo é cancelado por função autorizada;
2. desaparece das filas operacionais;
3. permanece no histórico;
4. evento de cancelamento fica registrado.

---

## 14. Critérios de aceite

- nenhum pedido ativo fica fora de uma aba;
- a aba Pedidos nunca mostra lista vazia quando há registros compatíveis;
- erros de consulta são exibidos claramente;
- todos os papéis enxergam somente dados e ações pertinentes;
- o garçom é avisado quando um pedido local fica pronto;
- o entregador enxerga pedidos em preparo e é avisado quando ficam prontos;
- o administrador acompanha o ciclo completo;
- pedidos finalizados permanecem consultáveis;
- todas as mudanças de status são validadas no backend;
- toda mudança gera histórico;
- notificações não são duplicadas;
- o botão Novo pedido abre a página de balcão e permite voltar ao painel;
- o lote completo é publicado em um único deploy de produção.
