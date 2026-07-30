const db = window.supabaseClient;
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const el = id => document.getElementById(id);
const TEAM_SESSION_KEY = 'fsdelivery_team';
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;

let establishment = null;
let products = [];
let tables = [];
let orders = [];
let cart = [];
let current = null;
let qty = 1;
let orderScope = 'local';
let ownerSession = null;
let teamSession = null;
let refreshTimer = null;
let loading = false;

const statusLabels = {
  novo: 'Novo', confirmado: 'Confirmado', preparo: 'Em preparo', pronto: 'Pronto',
  saiu_entrega: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function readTeamSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(TEAM_SESSION_KEY) || 'null');
    const authenticatedAt = Number(value?.authenticated_at || 0);
    if (!value || value.funcao !== 'garcom' || !value.phone || !value.pin || !value.estabelecimento_id) return null;
    if (!authenticatedAt || Date.now() - authenticatedAt > SESSION_MAX_AGE) return null;
    return value;
  } catch {
    return null;
  }
}

function redirectToAccess() {
  sessionStorage.removeItem(TEAM_SESSION_KEY);
  location.replace('garcom.html');
}

async function resolveAccess() {
  const { data: { session } } = await db.auth.getSession();
  ownerSession = session;
  teamSession = readTeamSession();
  if (!ownerSession && !teamSession) {
    redirectToAccess();
    return false;
  }
  return true;
}

async function loadOwnerData() {
  const { data: store, error: storeError } = await db.from('estabelecimentos').select('*').eq('usuario_id', ownerSession.user.id).single();
  if (storeError || !store) throw storeError || new Error('Estabelecimento não encontrado.');
  establishment = store;

  const [productResult, tableResult, orderResult] = await Promise.all([
    db.from('produtos').select('id,nome,descricao,preco,ativo,categoria_id,categorias(nome)').eq('estabelecimento_id', store.id).eq('ativo', true).order('nome'),
    db.from('mesas').select('id,numero,nome,codigo_qr,token_publico,identificacao,ativo').eq('estabelecimento_id', store.id).eq('ativo', true).order('numero'),
    db.from('pedidos').select('id,codigo,status,tipo,total,created_at,mesa_id,clientes(nome,telefone),mesas(numero,nome),itens_pedido(quantidade,nome_produto)').eq('estabelecimento_id', store.id).order('created_at', { ascending: false }).limit(100)
  ]);

  if (productResult.error) throw productResult.error;
  if (tableResult.error) throw tableResult.error;
  if (orderResult.error) throw orderResult.error;

  products = (productResult.data || []).map(product => ({
    id: product.id,
    name: product.nome,
    description: product.descricao || '',
    price: Number(product.preco),
    category: product.categorias?.nome || 'Sem categoria'
  }));
  tables = (tableResult.data || []).map(table => ({
    id: table.id,
    numero: table.numero || table.identificacao,
    nome: table.nome,
    token: table.codigo_qr || table.token_publico
  }));
  orders = orderResult.data || [];
}

async function loadTeamData() {
  teamSession = readTeamSession();
  if (!teamSession) return redirectToAccess();

  const { data, error } = await db.rpc('carregar_operacao_garcom', {
    p_telefone: teamSession.phone,
    p_pin: teamSession.pin
  });
  if (error) throw error;

  establishment = data.estabelecimento;
  products = (data.produtos || []).map(product => ({
    id: product.id,
    name: product.nome,
    description: product.descricao || '',
    price: Number(product.preco),
    category: product.categoria || 'Sem categoria'
  }));
  tables = (data.mesas || []).map(table => ({
    id: table.id,
    numero: table.numero,
    nome: table.nome,
    token: table.token
  }));
  orders = (data.pedidos || []).map(order => ({
    id: order.id,
    codigo: order.codigo,
    status: order.status,
    tipo: order.tipo,
    total: order.total,
    created_at: order.created_at,
    mesa_id: order.mesa_id,
    clientes: { nome: order.cliente_nome, telefone: order.cliente_telefone },
    mesas: { nome: order.mesa_nome, numero: order.mesa_numero },
    itens_pedido: order.itens || []
  }));
}

async function loadData() {
  if (loading) return;
  loading = true;
  try {
    if (ownerSession) await loadOwnerData();
    else await loadTeamData();
  } finally {
    loading = false;
  }
}

async function init() {
  try {
    if (!await resolveAccess()) return;
    bindTabs();
    bindActions();
    await loadData();
    renderAll();
    configureUpdates();
  } catch (error) {
    console.error(error);
    el('waiter-store-status').textContent = 'Erro';
    el('waiter-store-status').className = 'status cancelado';
    el('waiter-products').innerHTML = '<div class="empty-state">Não foi possível carregar a operação do garçom.</div>';
  }
}

function renderAll() {
  el('waiter-store-status').textContent = establishment?.aberto ? 'Loja aberta' : 'Loja fechada';
  el('waiter-store-status').className = `status ${establishment?.aberto ? 'pronto' : 'cancelado'}`;
  renderCategories();
  renderProducts();
  renderTables();
  renderOrders();
  renderCart();
  updateDestination();
}

function configureUpdates() {
  if (ownerSession) {
    db.channel(`cardapio-${establishment.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${establishment.id}` }, refreshOperation)
      .subscribe();
  } else {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshOperation();
    }, 20000);
  }
}

async function refreshOperation() {
  try {
    await loadData();
    renderOrders();
  } catch (error) {
    console.error('Falha ao atualizar operação:', error);
  }
}

function bindTabs() {
  document.querySelectorAll('[data-waiter-page]').forEach(button => button.onclick = () => openPage(button.dataset.waiterPage));
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
  el('waiter-category').innerHTML = '<option value="">Todas as categorias</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
}

function renderProducts() {
  const term = el('waiter-search').value.trim().toLowerCase();
  const category = el('waiter-category').value;
  const list = products.filter(product => (!category || product.category === category) && (!term || `${product.name} ${product.description}`.toLowerCase().includes(term)));
  el('waiter-products').innerHTML = list.length
    ? list.map(product => `<article class="row-card" data-product="${escapeHtml(product.id)}"><div class="order-main"><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.category)}${product.description ? ` • ${escapeHtml(product.description)}` : ''}</small></div><strong>${money(product.price)}</strong></article>`).join('')
    : '<div class="empty-state">Nenhum produto ativo encontrado no cardápio.</div>';
  el('waiter-products').querySelectorAll('[data-product]').forEach(node => node.onclick = () => showProduct(node.dataset.product));
}

function renderTables() {
  el('waiter-table').innerHTML = tables.length
    ? '<option value="">Selecione uma mesa</option>' + tables.map(table => `<option value="${escapeHtml(table.id)}" data-token="${escapeHtml(table.token || '')}">${escapeHtml(table.nome || `Mesa ${String(table.numero || '').padStart(2, '0')}`)}</option>`).join('')
    : '<option value="">Nenhuma mesa ativa</option>';
}

function renderOrders() {
  const localTypes = ['mesa', 'local'];
  const list = orders.filter(order => orderScope === 'local' ? localTypes.includes(order.tipo) : !localTypes.includes(order.tipo));
  el('waiter-orders').innerHTML = list.length ? list.map(order => {
    const tableName = order.mesas?.nome || (order.mesas?.numero ? `Mesa ${String(order.mesas.numero).padStart(2, '0')}` : '');
    const reference = tableName || order.clientes?.nome || (order.tipo === 'entrega' ? 'Entrega' : 'Retirada');
    const items = (order.itens_pedido || []).map(item => `${Number(item.quantidade)}x ${escapeHtml(item.nome_produto || item.nome)}`).join(' • ');
    return `<article class="order-card"><div class="order-main"><b>#${escapeHtml(order.codigo || order.id)} • ${escapeHtml(reference)}</b><small>${items || 'Sem itens'} • ${new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div><div><span class="status ${escapeHtml(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</span><b>${money(order.total)}</b></div></article>`;
  }).join('') : `<div class="empty-state">Nenhum pedido ${orderScope === 'local' ? 'local' : 'on-line'} encontrado.</div>`;
}

function showProduct(id) {
  current = products.find(product => String(product.id) === String(id));
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
    ? cart.map(item => `<div class="row-card"><div class="order-main"><b>${Number(item.qty)}x ${escapeHtml(item.name)}</b><small>${item.note ? escapeHtml(item.note) : money(item.price)}</small></div><div><b>${money(item.price * item.qty)}</b><button class="link-button" data-remove="${escapeHtml(item.cartId)}">Remover</button></div></div>`).join('')
    : '<div class="empty-state">Nenhum item adicionado.</div>';
  el('waiter-total').textContent = money(total());
  el('waiter-cart').querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { cart = cart.filter(item => item.cartId !== button.dataset.remove); renderCart(); });
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
  const phone = el('waiter-phone').value.replace(/\D/g, '');
  const address = el('waiter-address').value.trim();
  if (type === 'mesa' && !el('waiter-table').value) return alert('Selecione uma mesa ativa.');
  if (type === 'entrega' && address.length < 8) return alert('Informe o endereço completo.');
  if ((type === 'entrega' || type === 'retirada') && (name.length < 2 || phone.length < 10)) return alert('Informe nome e WhatsApp válidos do cliente.');

  const selectedTable = el('waiter-table').selectedOptions[0];
  const payload = {
    tipo: type,
    mesa_id: type === 'mesa' ? el('waiter-table').value : null,
    mesa_token: type === 'mesa' ? selectedTable?.dataset.token : null,
    nome: name || 'Atendimento local',
    telefone: phone || `mesa${Date.now()}`,
    endereco: address,
    pagamento: el('waiter-payment').value,
    observacoes: el('waiter-notes').value.trim(),
    itens: cart.map(item => ({ produto_id: item.productId, quantidade: item.qty, observacoes: item.note }))
  };

  const button = el('waiter-submit');
  button.disabled = true;
  button.textContent = 'Enviando...';

  try {
    let result;
    if (ownerSession) {
      result = await db.rpc('criar_pedido_garcom', { payload });
    } else {
      teamSession = readTeamSession();
      if (!teamSession) return redirectToAccess();
      result = await db.rpc('criar_pedido_equipe_garcom', {
        p_telefone: teamSession.phone,
        p_pin: teamSession.pin,
        payload
      });
    }
    if (result.error) throw result.error;

    alert(`Pedido #${result.data} enviado com sucesso.`);
    cart = [];
    ['waiter-name', 'waiter-phone', 'waiter-address', 'waiter-notes'].forEach(id => { el(id).value = ''; });
    renderCart();
    await refreshOperation();
    orderScope = type === 'mesa' || type === 'local' ? 'local' : 'online';
    openPage('pedidos');
    renderOrders();
  } catch (error) {
    console.error(error);
    alert(error.message || 'Não foi possível enviar o pedido.');
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar pedido';
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !ownerSession) refreshOperation();
});

init();