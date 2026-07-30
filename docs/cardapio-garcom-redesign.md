# Redesign da `cardapio.html` — Cardápio visual do garçom

## Objetivo

Atualizar a página operacional `cardapio.html` para exibir um cardápio visual, rápido e interativo, com fotos dos produtos, fundo claro em tom areia e foco no lançamento de pedidos pelo garçom.

A alteração deve preservar a operação existente:

- seleção de mesa ou tipo de atendimento;
- busca de produtos;
- filtro por categoria;
- inclusão de itens no pedido;
- definição de quantidade e observações;
- carrinho e total do pedido;
- envio do pedido para a cozinha;
- acompanhamento de pedidos ativos.

O redesign deve reutilizar a mesma fonte de dados do cardápio administrativo e da página pública do estabelecimento.

---

## Escopo principal

### 1. Estrutura da página

A `cardapio.html` deve manter as áreas operacionais existentes, porém com a seguinte organização:

1. cabeçalho do garçom;
2. navegação entre `Pedidos` e `Cardápio`;
3. título e contexto do novo pedido;
4. busca e filtro de categorias;
5. atalhos visuais de categorias;
6. grade de produtos com foto;
7. configuração do atendimento;
8. carrinho do pedido;
9. ação principal para iniciar ou enviar o pedido.

### 2. Ordem recomendada no mobile

1. cabeçalho;
2. abas `Pedidos` e `Cardápio`;
3. busca;
4. categorias;
5. produtos;
6. resumo flutuante do carrinho;
7. formulário de atendimento;
8. confirmação do pedido.

O carrinho deve permanecer acessível durante a navegação, preferencialmente por uma barra fixa inferior exibindo:

- quantidade de itens;
- total;
- botão `Ver pedido` ou `Continuar`.

---

## Paleta visual

Aplicar uma paleta clara e quente, próxima à referência aprovada.

```css
--waiter-bg: #f8f3eb;
--waiter-bg-soft: #fcf8f1;
--waiter-surface: #ffffff;
--waiter-surface-soft: #fffaf4;
--waiter-line: #e5ded5;
--waiter-line-strong: #d7cabd;
--waiter-text: #171717;
--waiter-muted: #6d665f;
--waiter-primary: #ff7900;
--waiter-primary-hover: #e96f00;
--waiter-primary-soft: #fff0df;
--waiter-danger: #d94141;
--waiter-success: #2f9e59;
--waiter-shadow: 0 8px 24px rgba(60, 39, 20, 0.10);
```

### Regra de consolidação

As alterações devem ser feitas no CSS global já existente, preferencialmente em `css/style.css`, sem criar folhas de estilo paralelas ou arquivos de override.

Não alterar as variáveis globais do tema escuro usado em outras áreas. Criar um escopo específico para a página do garçom.

Exemplo:

```html
<body class="app-body waiter-menu-body">
```

```css
.waiter-menu-body {
  --bg: var(--waiter-bg);
  --bg-soft: var(--waiter-bg-soft);
  --surface: var(--waiter-surface);
  --surface-2: var(--waiter-surface-soft);
  --line: var(--waiter-line);
  --line-strong: var(--waiter-line-strong);
  --text: var(--waiter-text);
  --muted: var(--waiter-muted);
}
```

---

## Alterações no banco de dados

### 1. Imagem do produto

Confirmar a existência de uma coluna de imagem na tabela `produtos`.

Nome recomendado:

```sql
imagem_url text
```

Caso a coluna ainda não exista:

```sql
alter table public.produtos
add column if not exists imagem_url text;
```

### 2. Campos opcionais recomendados

Para suportar uma apresentação mais completa:

```sql
alter table public.produtos
add column if not exists destaque boolean not null default false,
add column if not exists ordem_exibicao integer not null default 0;
```

Uso esperado:

- `imagem_url`: URL pública da foto;
- `destaque`: exibir selo como `Mais pedido` ou `Destaque`;
- `ordem_exibicao`: controlar a ordem dos produtos no cardápio.

### 3. Supabase Storage

Criar ou confirmar um bucket específico para imagens dos produtos.

Nome recomendado:

```text
produtos
```

Estrutura sugerida:

```text
produtos/{estabelecimento_id}/{produto_id}/principal.webp
```

Requisitos:

- leitura pública das imagens usadas no cardápio;
- escrita restrita ao proprietário do estabelecimento;
- remoção ou substituição da imagem ao atualizar o produto;
- validação de tipo e tamanho do arquivo;
- preferência por WebP ou JPEG otimizado.

---

## Alterações em `cardapio.html`

### 1. Body da página

Adicionar classe específica:

```html
<body class="app-body waiter-menu-body">
```

### 2. Área de produtos

Substituir a lista visual simples por uma grade:

```html
<div id="waiter-products" class="waiter-product-grid">
  <div class="empty-state">Carregando cardápio...</div>
</div>
```

### 3. Categorias rápidas

Adicionar uma faixa horizontal de categorias abaixo da busca:

```html
<div id="waiter-category-tabs" class="waiter-category-tabs"></div>
```

O `<select id="waiter-category">` pode ser mantido como fallback e para desktop, ou substituído pelas abas desde que a lógica continue acessível.

### 4. Carrinho mobile

Adicionar resumo fixo:

```html
<button id="waiter-cart-summary" class="waiter-cart-summary" type="button" hidden>
  <span><b id="waiter-cart-count">0 itens</b><small id="waiter-cart-summary-total">R$ 0,00</small></span>
  <strong>Ver pedido</strong>
</button>
```

O resumo deve aparecer somente quando houver itens no carrinho.

---

## Alterações em `js/garcom.js`

### 1. Consulta de produtos do proprietário

Alterar o `select` atual para incluir a imagem e os campos visuais.

Exemplo:

```js
.select(`
  id,
  nome,
  descricao,
  preco,
  ativo,
  categoria_id,
  imagem_url,
  destaque,
  ordem_exibicao,
  categorias(nome)
`)
```

Ordenação recomendada:

```js
.order('ordem_exibicao', { ascending: true })
.order('nome', { ascending: true })
```

### 2. Mapeamento do produto

Atualizar o objeto interno:

```js
products = (productResult.data || []).map(product => ({
  id: product.id,
  name: product.nome,
  description: product.descricao || '',
  price: Number(product.preco),
  category: product.categorias?.nome || 'Sem categoria',
  imageUrl: product.imagem_url || '',
  featured: Boolean(product.destaque),
  order: Number(product.ordem_exibicao || 0)
}));
```

### 3. RPC do acesso do garçom

A função `carregar_operacao_garcom` também deve retornar:

- `imagem_url`;
- `destaque`;
- `ordem_exibicao`.

Atualizar o mapeamento de `loadTeamData()` com os mesmos campos usados em `loadOwnerData()`.

A versão do proprietário e a versão do garçom devem produzir o mesmo formato de objeto em `products`.

### 4. Renderização dos produtos

Substituir a renderização baseada em `.row-card` por cards visuais.

Estrutura recomendada:

```js
function renderProducts() {
  const term = el('waiter-search').value.trim().toLowerCase();
  const category = el('waiter-category').value;

  const list = products.filter(product =>
    (!category || product.category === category) &&
    (!term || `${product.name} ${product.description}`.toLowerCase().includes(term))
  );

  el('waiter-products').innerHTML = list.length
    ? list.map(product => `
      <article class="waiter-product-card" data-product="${escapeHtml(product.id)}">
        <div class="waiter-product-image-wrap">
          ${product.imageUrl
            ? `<img class="waiter-product-image" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy">`
            : `<div class="waiter-product-placeholder" aria-hidden="true"></div>`}
          ${product.featured ? '<span class="waiter-product-badge">Destaque</span>' : ''}
        </div>

        <div class="waiter-product-content">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description || product.category)}</p>

          <div class="waiter-product-footer">
            <strong>${money(product.price)}</strong>
            <button class="waiter-product-add" type="button" aria-label="Adicionar ${escapeHtml(product.name)}">+</button>
          </div>
        </div>
      </article>
    `).join('')
    : '<div class="empty-state">Nenhum produto ativo encontrado no cardápio.</div>';

  el('waiter-products').querySelectorAll('[data-product]').forEach(card => {
    card.onclick = () => showProduct(card.dataset.product);
  });
}
```

### 5. Evitar clique duplicado

O botão `+` deve abrir o mesmo modal de quantidade e observação já existente.

Usar `stopPropagation()` caso o card inteiro também seja clicável.

### 6. Imagem com falha

Implementar fallback quando a URL estiver quebrada:

```js
image.onerror = () => {
  image.closest('.waiter-product-image-wrap')?.classList.add('image-error');
  image.remove();
};
```

### 7. Categorias visuais

Criar função dedicada:

```js
function renderCategoryTabs() {
  const categories = [...new Set(products.map(product => product.category))];
  const active = el('waiter-category').value;

  el('waiter-category-tabs').innerHTML = [
    { value: '', label: 'Todos' },
    ...categories.map(category => ({ value: category, label: category }))
  ].map(item => `
    <button
      type="button"
      class="${item.value === active ? 'active' : ''}"
      data-waiter-category="${escapeHtml(item.value)}">
      ${escapeHtml(item.label)}
    </button>
  `).join('');

  el('waiter-category-tabs').querySelectorAll('[data-waiter-category]').forEach(button => {
    button.onclick = () => {
      el('waiter-category').value = button.dataset.waiterCategory;
      renderCategoryTabs();
      renderProducts();
    };
  });
}
```

### 8. Resumo do carrinho

Atualizar `renderCart()` para também atualizar:

- quantidade total de itens;
- total resumido;
- visibilidade da barra mobile.

Exemplo:

```js
const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

el('waiter-cart-count').textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`;
el('waiter-cart-summary-total').textContent = money(total);
el('waiter-cart-summary').hidden = itemCount === 0;
```

---

## CSS necessário

Adicionar ao final da seção consolidada referente ao aplicativo/garçom em `css/style.css`.

### Grade de produtos

```css
.waiter-menu-body {
  background: var(--waiter-bg);
  color: var(--waiter-text);
}

.waiter-menu-body .main,
.waiter-menu-body .content {
  background: var(--waiter-bg);
}

.waiter-product-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.waiter-product-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--waiter-line);
  border-radius: 14px;
  background: var(--waiter-surface);
  box-shadow: var(--waiter-shadow);
  cursor: pointer;
}

.waiter-product-image-wrap {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--waiter-surface-soft);
}

.waiter-product-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.waiter-product-placeholder {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(135deg, rgba(255, 121, 0, 0.08), transparent),
    var(--waiter-surface-soft);
}

.waiter-product-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--waiter-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}

.waiter-product-content {
  display: grid;
  gap: 8px;
  padding: 13px;
}

.waiter-product-content h3 {
  margin: 0;
  color: var(--waiter-text);
  font-size: 15px;
  line-height: 1.3;
}

.waiter-product-content p {
  display: -webkit-box;
  min-height: 38px;
  margin: 0;
  overflow: hidden;
  color: var(--waiter-muted);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.waiter-product-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}

.waiter-product-footer strong {
  color: var(--waiter-primary);
  font-size: 15px;
}

.waiter-product-add {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--waiter-primary);
  border-radius: 10px;
  background: #fff;
  color: var(--waiter-primary);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
```

### Categorias

```css
.waiter-category-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 14px;
  scrollbar-width: none;
}

.waiter-category-tabs::-webkit-scrollbar {
  display: none;
}

.waiter-category-tabs button {
  flex: 0 0 auto;
  min-height: 42px;
  padding: 9px 14px;
  border: 1px solid var(--waiter-line);
  border-radius: 11px;
  background: var(--waiter-surface);
  color: var(--waiter-text);
  font-weight: 700;
  cursor: pointer;
}

.waiter-category-tabs button.active {
  border-color: var(--waiter-primary);
  background: var(--waiter-primary-soft);
  color: var(--waiter-primary);
}
```

### Carrinho mobile

```css
.waiter-cart-summary {
  display: none;
}

@media (max-width: 760px) {
  .waiter-product-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .waiter-product-content {
    padding: 11px;
  }

  .waiter-product-content h3 {
    font-size: 13px;
  }

  .waiter-product-content p {
    min-height: 34px;
    font-size: 11px;
  }

  .waiter-product-footer strong {
    font-size: 13px;
  }

  .waiter-product-add {
    width: 34px;
    height: 34px;
  }

  .waiter-cart-summary:not([hidden]) {
    position: fixed;
    right: 14px;
    bottom: calc(74px + env(safe-area-inset-bottom));
    left: 14px;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 58px;
    padding: 10px 16px;
    border: 0;
    border-radius: 14px;
    background: var(--waiter-primary);
    color: #fff;
    box-shadow: 0 14px 34px rgba(80, 38, 0, 0.24);
  }

  .waiter-cart-summary span {
    display: grid;
    text-align: left;
  }

  .waiter-cart-summary small {
    color: rgba(255, 255, 255, 0.82);
  }
}

@media (max-width: 390px) {
  .waiter-product-grid {
    gap: 8px;
  }
}
```

---

## Responsividade

### Mobile

- duas colunas de produtos;
- cards compactos;
- descrições limitadas a duas linhas;
- categorias com rolagem horizontal;
- carrinho fixo na parte inferior;
- áreas clicáveis com pelo menos 44 px;
- respeitar `safe-area-inset-bottom` no iPhone.

### Tablet

- três colunas;
- painel do pedido pode ficar abaixo da grade ou lateral;
- categorias continuam horizontais.

### Desktop

- três ou quatro colunas conforme largura disponível;
- carrinho/pedido deve permanecer em painel lateral;
- painel lateral pode usar `position: sticky`.

---

## Regras de UX

1. O garçom deve conseguir adicionar um item com no máximo dois toques.
2. O botão de adicionar deve ser visualmente evidente.
3. Produtos sem foto não podem quebrar o layout.
4. O preço deve permanecer visível mesmo em cards compactos.
5. A busca deve filtrar por nome e descrição.
6. A categoria ativa deve ficar claramente destacada.
7. O carrinho deve indicar quantidade e total em tempo real.
8. O formulário de atendimento não deve impedir a exploração do cardápio.
9. O pedido não pode ser enviado sem mesa quando o tipo selecionado for `mesa`.
10. A interface deve continuar utilizável com a loja fechada, mas o envio deve respeitar a regra operacional já definida pelo sistema.

---

## Desempenho das imagens

Requisitos mínimos:

- usar `loading="lazy"`;
- salvar versões otimizadas;
- evitar imagens maiores que 1600 px;
- recomendar proporção 4:3;
- limitar upload, preferencialmente, a 2 MB antes da otimização;
- usar `object-fit: cover`;
- não carregar imagens ocultas em modais antes de necessário;
- utilizar cache público do Supabase Storage.

Tamanho visual recomendado:

```text
800 × 600 px
```

Formato preferencial:

```text
WebP
```

---

## Fonte única de dados

A imagem do produto deve ser cadastrada uma única vez e reutilizada em:

- cadastro administrativo;
- página pública do estabelecimento;
- `cardapio.html` do garçom;
- QR Code da mesa;
- futuras telas de caixa ou cozinha, quando necessário.

Não criar campos de imagem específicos para cada página.

A tabela `produtos` deve permanecer como fonte oficial do cardápio.

---

## Etapas de implantação

### Etapa 1 — Banco e cadastro

- [ ] confirmar/criar `produtos.imagem_url`;
- [ ] criar bucket de imagens no Supabase Storage;
- [ ] configurar políticas de acesso;
- [ ] incluir upload de imagem no cadastro e edição do produto;
- [ ] incluir preview e remoção da foto;
- [ ] garantir imagem padrão para produtos sem foto.

### Etapa 2 — Dados do garçom

- [ ] incluir imagem na consulta de `loadOwnerData()`;
- [ ] atualizar RPC `carregar_operacao_garcom`;
- [ ] padronizar o objeto `products`;
- [ ] incluir ordenação por `ordem_exibicao`;
- [ ] validar acesso do garçom às URLs públicas.

### Etapa 3 — Interface

- [ ] adicionar classe de tema claro à `cardapio.html`;
- [ ] criar grade de produtos;
- [ ] criar cards com foto;
- [ ] criar categorias horizontais;
- [ ] adaptar modal do item;
- [ ] implementar carrinho fixo mobile;
- [ ] manter painel lateral no desktop.

### Etapa 4 — CSS consolidado

- [ ] adicionar variáveis do tema do garçom em `css/style.css`;
- [ ] evitar alteração do tema escuro das demais páginas;
- [ ] manter raios de borda moderados;
- [ ] revisar contraste e estados de foco;
- [ ] revisar iPhone com safe area;
- [ ] eliminar regras duplicadas de `app-polish.css`, se houver conflito.

### Etapa 5 — Testes

- [ ] produto com foto;
- [ ] produto sem foto;
- [ ] URL de foto inválida;
- [ ] busca por nome;
- [ ] busca por descrição;
- [ ] filtro por categoria;
- [ ] carrinho com múltiplos itens;
- [ ] alteração de quantidade;
- [ ] observação por item;
- [ ] pedido em mesa;
- [ ] pedido para retirada;
- [ ] pedido para entrega;
- [ ] pedido para consumo local;
- [ ] sessão do proprietário;
- [ ] sessão do garçom por PIN;
- [ ] loja aberta e fechada;
- [ ] telas de 320 px, 375 px, 390 px e 430 px;
- [ ] tablet e desktop.

---

## Critérios de aceite

A implementação será considerada concluída quando:

1. a `cardapio.html` exibir produtos em cards com foto;
2. produtos sem foto tiverem fallback visual adequado;
3. o tema claro ficar restrito à operação do garçom;
4. as demais páginas do FS Delivery não sofrerem alteração visual indevida;
5. busca e categorias continuarem funcionando;
6. o modal existente continuar controlando quantidade e observação;
7. o carrinho atualizar quantidade e total imediatamente;
8. o pedido continuar sendo enviado corretamente para a cozinha;
9. as imagens vierem da mesma tabela e do mesmo cadastro usado no cardápio público;
10. a página funcionar adequadamente em iPhone e Android.

---

## Risco principal conhecido

A tela atual apresenta a mensagem:

```text
Não foi possível carregar a operação do garçom.
```

O redesign visual não deve ocultar esse problema. Antes ou durante a implantação, é necessário validar:

- existência e assinatura da RPC `carregar_operacao_garcom`;
- retorno do estabelecimento;
- permissões da função e das tabelas;
- validade da sessão armazenada em `fsdelivery_team`;
- campos retornados em `data.produtos`, `data.mesas` e `data.pedidos`;
- tratamento de erros no carregamento.

A correção funcional do carregamento deve ser tratada como pré-requisito para validar o novo cardápio.

---

## Arquivos previstos para alteração

```text
cardapio.html
js/garcom.js
css/style.css
js de cadastro/edição de produtos
página administrativa de produtos
migration SQL do Supabase
função RPC carregar_operacao_garcom
```

Não criar uma segunda implementação de cardápio nem duplicar a lógica de produtos.
