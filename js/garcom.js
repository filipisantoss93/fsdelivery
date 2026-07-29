const db = window.supabaseClient;
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const el = id => document.getElementById(id);

let establishment = null;
let products = [];
let tables = [];
let orders = [];
let cart = [];
let current = null;
let qty = 1;
let orderScope = 'local';

const statusLabels = {
  novo: 'Novo', confirmado: 'Confirmado', preparo: 'Em preparo', pronto: 'Pronto',
  saiu_entrega: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado'
};

async function resolveEstablishment() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    const { data, error } = await db.from('estabelecimentos').select('*').eq('usuario_id', session.user.id).single();
    if (error) throw error;
    return data;
  }

  const teamSession = JSON.parse(sessionStorage.getItem('fsdelivery_team') || 'null');
  if (!teamSession?.estabelecimento_id) {
    location.replace('equipe-acesso.html');
    return null;
  }

  const { data, error } = await db.from('estabelecimentos').select('*').eq('id', teamSession.estabelecimento_id).single();
  if (error) throw error;
  return data;
}

async function init() {
  try {
    establishment = await resolveEstablishment();
    if (!establishment) return;

    el('waiter-store-status').textContent = establishment.aberto ? 'Loja aberta' : 'Loja fechada';
    el('waiter-store-status').className = `status ${establishment.aberto ? 'pronto' : 'cancelado'}`;

    bindTabs();
    bindActions();
    await loadData();
    renderCategories();
    renderProducts();
    renderTables();
    renderOrders();
    renderCart();
    updateDestination();

    db.channel(`cardapio-${establishment.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${establishment.id}` }, async () => {
        await loadOrders();
        renderOrders();
      })
      .subscribe();
  } catch (error) {
    console.error(error);
    el('waiter-store-status').textContent = 'Erro';
    el('waiter-store-status').className = 'status cancelado';
    el('waiter-products').innerHTML = `<div class="empty-state">Não foi possível carregar o cardápio: ${error.message}</div>`;
  }
}

async function loadData() {
  const [productResult, tableResult] = await Promise.all([
    db.from('produtos').select('id,nome,descricao,preco,ativo,categoria_id,categorias(nome)').eq('estabelecimento_id', establishment.id).eq('ativo', true).order('nome'),
    db.from('mesas').select('id,numero,nome,codigo_qr,ativo').eq('estabelecimento_id', establishment.id).eq('ativo', true).order('numero')
  ]);

  if (productResult.error) throw productResult.error;
  if (tableResult.error) throw tableResult.error;

  products = (productResult.data || []).map(product => ({
    id: product.id,
    name: product.nome,
    description: product.descricao || '',
    price: Number(product.preco),
    category: product.categorias?.nome || 'Sem categoria'
  }));
  tables = tableResult.data || [];
  await loadOrders();
}

async function loadOrders() {
  const { data, error } = await db.from('pedidos')
    .select('id,codigo,status,tipo,total,created_at,mesa_id,clientes(nome,telefone),mesas(numero,nome),itens_pedido(quantidade,nome_produto)')
    .eq('estabelecimento_id', establishment.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  orders = data || [];
}

function bindTabs() {
  document.querySelectorAll('[data-waiter-page]').forEach(button => {
    button.onclick = () => openPage(button.dataset.waiterPage);
  });
  document.querySelectorAll('[data-order-scope]').forEach(button => {
    button.onclick = () => {
      orderScope = button.dataset.orderScope;
      document.querySelectorAll('[data-order-scope]').forEach(item => {
        const active = item === button;
        item.classList.toggle('btn-primary', active);
        item.classList.toggle('btn-secondary', !active);
      });
      renderOrders();
    };
  });
}

function bindActions() {
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = closeModal);
  el('waiter-product-modal').onclick = event => { if (event.target === el('waiter-product-modal')) closeModal(); };
  el('waiter-search').oninput = renderProducts;
  el('waiter-category').onchange = renderProducts;
  el('waiter-type').onchange = updateDestination;
  el('waiter-minus').onclick = () => { qty = Math.max(1, qty - 1); el('waiter-qty').textContent = qty; updateAddButton(); };
  el('waiter-plus').onclick = () => { qty += 1; el('waiter-qty').textContent = qty; updateAddButton(); };
  el('waiter-add').onclick = addCurrentProduct;
  el('waiter-submit').onclick = submitOrder;
}

function openPage(page) {
  document.querySelectorAll('[id^="waiter-page-"]').forEach(section => section.classList.toggle('active', section.id === `waiter-page-${page}`));
  document.querySelectorAll('[data-waiter-page]').forEach(button => {
    const active = button.dataset.waiterPage === page;
    button.classList.toggle('active', active);
    if (button.classList.contains('btn')) {
      button.classList.toggle('btn-primary', active);
      button.classList.toggle('btn-secondary', !active);
    }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCategories() {
  const categories = [...new Set(products.map(product => product.category))];
  el('waiter-category').innerHTML = '<option value="">Todas as categorias</option>' + categories.map(category => `<option value="${category}">${category}</option>`).join('');
}

function renderProducts() {
  const term = el('waiter-search').value.trim().toLowerCase();
  const category = el('waiter-category').value;
  const list = products.filter(product => (!category || product.category === category) && (!term || `${product.name} ${product.description}`.toLowerCase().includes(term)));

  el('waiter-products').innerHTML = list.length
    ? list.map(product => `<article class="row-card" data-product="${product.id}"><div class="order-main"><b>${product.name}</b><small>${product.category}${product.description ? ` • ${product.description}` : ''}</small></div><strong>${money(product.price)}</strong></article>`).join('')
    : '<div class="empty-state">Nenhum produto ativo encontrado no cardápio.</div>';

  el('waiter-products').querySelectorAll('[data-product]').forEach(node => {
    node.onclick = () => showProduct(node.dataset.product);
  });
}

function renderTables() {
  el('waiter-table').innerHTML = tables.length
    ? '<option value="">Selecione uma mesa</option>' + tables.map(table => `<option value="${table.id}" data-token="${table.codigo_qr || ''}">${table.nome || `Mesa ${String(table.numero).padStart(2, '0')}`}</option>`).join('')
    : '<option value="">Nenhuma mesa ativa</option>';
}

function renderOrders() {
  const localTypes = ['mesa', 'local'];
  const list = orders.filter(order => orderScope === 'local' ? localTypes.includes(order.tipo) : !localTypes.includes(order.tipo));
  el('waiter-orders').innerHTML = list.length ? list.map(order => {
    const tableName = order.mesas?.nome || (order.mesas?.numero ? `Mesa ${String(order.mesas.numero).padStart(2, '0')}` : '');
    const reference = tableName || order.clientes?.nome || (order.tipo === 'entrega' ? 'Entrega' : 'Retirada');
    const items = (order.itens_pedido || []).map(item => `${item.quantidade}x ${item.nome_produto}`).join(' • ');
    return `<article class="order-card"><div class="order-main"><b>#${order.codigo || order.id} • ${reference}</b><small>${items || 'Sem itens'} • ${new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div><div><span class="status ${order.status}">${statusLabels[order.status] || order.status}</span><b>${money(order.total)}</b></div></article>`;
  }).join('') : `<div class="empty-state">Nenhum pedido ${orderScope === 'local' ? 'local' : 'on-line'} encontrado.</div>`;
}

function showProduct(id) {
  current = products.find(product => product.id === id);
  if (!current) return;
  qty = 1;
  el('waiter-product-title').textContent = current.name;
  el('waiter-product-description').textContent = current.description || 'Sem descrição.';
  el('waiter-qty').textContent = qty;
  el('waiter-item-note').value = '';
  updateAddButton();
  el('waiter-product-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  el('waiter-product-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function updateAddButton() {
  el('waiter-add').textContent = `Adicionar • ${money((current?.price || 0) * qty)}`;
}

function addCurrentProduct() {
  if (!current) return;
  cart.push({ cartId: crypto.randomUUID(), productId: current.id, name: current.name, price: current.price, qty, note: el('waiter-item-note').value.trim() });
  closeModal();
  renderCart();
}

function subtotal() { return cart.reduce((sum, item) => sum + item.price * item.qty, 0); }
function total() { return subtotal() + (el('waiter-type').value === 'entrega' ? Number(establishment?.taxa_entrega || 0) : 0); }

function renderCart() {
  el('waiter-cart').innerHTML = cart.length
    ? cart.map(item => `<div class="row-card"><div class="order-main"><b>${item.qty}x ${item.name}</b><small>${item.note || money(item.price)}</small></div><div><b>${money(item.price * item.qty)}</b><button class="link-button" data-remove="${item.cartId}">Remover</button></div></div>`).join('')
    : '<div class="empty-state">Nenhum item adicionado.</div>';
  el('waiter-total').textContent = money(total());
  el('waiter-cart').querySelectorAll('[data-remove]').forEach(button => {
    button.onclick = () => { cart = cart.filter(item => item.cartId !== button.dataset.remove); renderCart(); };
  });
}

function updateDestination() {
  const type = el('waiter-type').value;
  el('waiter-table-field').hidden = type !== 'mesa';
  el('waiter-address-field').hidden = type !== 'entrega';
  el('waiter-destination-label').textContent = { mesa: 'Pedido vinculado à mesa', entrega: 'Pedido para entrega', retirada: 'Retirada no balcão', local: 'Cliente vem comer' }[type];
  renderCart();
}

async function submitOrder() {
  if (!cart.length) return alert('Adicione ao menos um produto.');
  const type = el('waiter-type').value;
  const name = el('waiter-name').value.trim();
  const phone = el('waiter-phone').value.trim();
  const address = el('waiter-address').value.trim();
  if (type === 'mesa' && !el('waiter-table').value) return alert('Selecione uma mesa ativa.');
  if (type === 'entrega' && !address) return alert('Informe o endereço completo.');
  if ((type === 'entrega' || type === 'retirada') && (!name || !phone)) return alert('Informe nome e WhatsApp do cliente.');

  const selected = el('waiter-table').selectedOptions[0];
  const payload = {
    tipo: type,
    mesa_id: type === 'mesa' ? el('waiter-table').value : null,
    mesa_token: type === 'mesa' ? selected?.dataset.token : null,
    nome: name,
    telefone: phone,
    endereco: address,
    pagamento: el('waiter-payment').value,
    observacoes: el('waiter-notes').value.trim(),
    itens: cart.map(item => ({ produto_id: item.productId, quantidade: item.qty, observacoes: item.note }))
  };

  const button = el('waiter-submit');
  button.disabled = true;
  button.textContent = 'Enviando...';
  const { data, error } = await db.rpc('criar_pedido_garcom', { payload });
  button.disabled = false;
  button.textContent = 'Enviar pedido';
  if (error) return alert(error.message);

  alert(`Pedido #${data} enviado com sucesso.`);
  cart = [];
  ['waiter-name', 'waiter-phone', 'waiter-address', 'waiter-notes'].forEach(id => { el(id).value = ''; });
  renderCart();
  await loadOrders();
  orderScope = type === 'mesa' || type === 'local' ? 'local' : 'online';
  openPage('pedidos');
  renderOrders();
}

init();