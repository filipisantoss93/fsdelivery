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
let statusFilter = 'ativos';
let ownerSession = null;
let teamSession = null;
let refreshTimer = null;
let loading = false;

const statusLabels = {
  novo: 'Novo', confirmado: 'Confirmado', preparo: 'Em preparo', pronto: 'Pronto',
  saiu_entrega: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado'
};
const activeStatuses = ['novo', 'confirmado', 'preparo', 'pronto', 'saiu_entrega'];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function normalizeProduct(product, category) {
  return {
    id: product.id,
    name: product.nome,
    description: product.descricao || '',
    price: Number(product.preco),
    category: category || product.categoria || product.categorias?.nome || 'Sem categoria',
    imageUrl: product.imagem_url || product.imagem || product.foto_url || '',
    featured: Boolean(product.destaque)
  };
}

function readTeamSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(TEAM_SESSION_KEY) || 'null');
    const authenticatedAt = Number(value?.authenticated_at || 0);
    if (!value || value.funcao !== 'garcom' || !value.phone || !value.pin || !value.estabelecimento_id) return null;
    if (!authenticatedAt || Date.now() - authenticatedAt > SESSION_MAX_AGE) return null;
    return value;
  } catch { return null; }
}

function redirectToAccess() {
  sessionStorage.removeItem(TEAM_SESSION_KEY);
  location.replace('garcom.html');
}

async function resolveAccess() {
  const { data: { session } } = await db.auth.getSession();
  ownerSession = session;
  teamSession = readTeamSession();
  if (!ownerSession && !teamSession) { redirectToAccess(); return false; }
  return true;
}

async function enrichProductImages(storeId) {
  try {
    const { data, error } = await db.from('produtos').select('id,imagem_url,destaque').eq('estabelecimento_id', storeId);
    if (error) return;
    const visualById = new Map((data || []).map(item => [String(item.id), item]));
    products = products.map(product => {
      const visual = visualById.get(String(product.id));
      return visual ? { ...product, imageUrl: visual.imagem_url || '', featured: Boolean(visual.destaque) } : product;
    });
  } catch (error) {
    console.info('Fotos de produtos ainda não configuradas.', error);
  }
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
  products = (productResult.data || []).map(product => normalizeProduct(product));
  await enrichProductImages(store.id);
  tables = (tableResult.data || []).map(table => ({ id: table.id, numero: table.numero || table.identificacao, nome: table.nome, token: table.codigo_qr || table.token_publico }));
  orders = orderResult.data || [];
}

async function loadTeamData() {
  teamSession = readTeamSession();
  if (!teamSession) return redirectToAccess();
  const { data, error } = await db.rpc('carregar_operacao_garcom', { p_telefone: teamSession.phone, p_pin: teamSession.pin });
  if (error) throw error;
  establishment = data.estabelecimento;
  products = (data.produtos || []).map(product => normalizeProduct(product, product.categoria));
  tables = (data.mesas || []).map(table => ({ id: table.id, numero: table.numero, nome: table.nome, token: table.token }));
  orders = (data.pedidos || []).map(order => ({ id: order.id, codigo: order.codigo, status: order.status, tipo: order.tipo, total: order.total, created_at: order.created_at, mesa_id: order.mesa_id, clientes: { nome: order.cliente_nome, telefone: order.cliente_telefone }, mesas: { nome: order.mesa_nome, numero: order.mesa_numero }, itens_pedido: order.itens || [] }));
}

async function loadData() {
  if (loading) return;
  loading = true;
  try { ownerSession ? await loadOwnerData() : await loadTeamData(); }
  finally { loading = false; }
}

async function init() {
  try {
    if (!await resolveAccess()) return;
    buildMobileNavigation();
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

function buildMobileNavigation() {
  const mobile = el('waiter-mobile-nav');
  const desktop = document.querySelector('.sidebar .nav');
  if (!mobile || !desktop || mobile.children.length) return;
  desktop.querySelectorAll('[data-waiter-page]').forEach(button => mobile.appendChild(button.cloneNode(true)));
  const ordersButton = mobile.querySelector('[data-waiter-page="pedidos"]');
  if (!ordersButton) return;
  const badge = document.createElement('b');
  badge.className = 'waiter-nav-badge';
  badge.id = 'waiter-ready-nav-count';
  badge.hidden = true;
  badge.textContent = '0';
  ordersButton.appendChild(badge);
}

function renderAll() {
  el('waiter-store-status').textContent = establishment?.aberto ? 'Loja aberta' : 'Loja fechada';
  el('waiter-store-status').className = `status ${establishment?.aberto ? 'pronto' : 'cancelado'}`;
  renderCategories(); renderProducts(); renderTables(); renderTableCards(); renderMetrics(); renderOrders(); renderCart(); updateDestination();
}

function configureUpdates() {
  if (ownerSession) {
    db.channel(`cardapio-${establishment.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${establishment.id}` }, refreshOperation).subscribe();
  } else {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshOperation(); }, 20000);
  }
}

async function refreshOperation() {
  try { await loadData(); renderTableCards(); renderMetrics(); renderOrders(); }
  catch (error) { console.error('Falha ao atualizar operação:', error); }
}

function bindTabs() {
  document.querySelectorAll('[data-waiter-page]').forEach(button => button.onclick = () => openPage(button.dataset.waiterPage));
  document.querySelectorAll('[data-order-scope]').forEach(button => button.onclick = () => {
    orderScope = button.dataset.orderScope;
    document.querySelectorAll('[data-order-scope]').forEach(item => { const active = item === button; item.classList.toggle('btn-primary', active); item.classList.toggle('btn-secondary', !active); });
    renderOrders();
  });
  document.querySelectorAll('[data-status-filter]').forEach(button => button.onclick = () => {
    statusFilter = button.dataset.statusFilter;
    document.querySelectorAll('[data-status-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderOrders();
  });
}

function bindActions() {
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = closeModal);
  el('waiter-product-modal').onclick = event => { if (event.target === el('waiter-product-modal')) closeModal(); };
  el('waiter-search').oninput = renderProducts;
  el('waiter-category').onchange = () => { renderCategoryTabs(); renderProducts(); };
  el('waiter-type').onchange = updateDestination;
  el('waiter-table').onchange = updateMenuContext;
  el('waiter-minus').onclick = () => { qty = Math.max(1, qty - 1); el('waiter-qty').textContent = qty; updateAddButton(); };
  el('waiter-plus').onclick = () => { qty += 1; el('waiter-qty').textContent = qty; updateAddButton(); };
  el('waiter-add').onclick = addCurrentProduct;
  el('waiter-submit').onclick = submitOrder;
  el('waiter-refresh').onclick = refreshOperation;
  el('waiter-back-tables').onclick = () => openPage('mesas');
  el('waiter-cart-summary').onclick = () => el('waiter-order-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openPage(page) {
  document.querySelectorAll('[id^="waiter-page-"]').forEach(section => section.classList.toggle('active', section.id === `waiter-page-${page}`));
  document.querySelectorAll('[data-waiter-page]').forEach(button => button.classList.toggle('active', button.dataset.waiterPage === page));
  el('waiter-page-title').textContent = ({ mesas: 'Mesas', cardapio: 'Cardápio', pedidos: 'Pedidos' })[page] || 'Atendimento';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderMetrics() {
  const busyTableIds = new Set(orders.filter(order => order.mesa_id && activeStatuses.includes(order.status)).map(order => String(order.mesa_id)));
  el('waiter-free-count').textContent = Math.max(0, tables.length - busyTableIds.size);
  el('waiter-busy-count').textContent = busyTableIds.size;
  el('waiter-preparing-count').textContent = orders.filter(order => order.status === 'preparo').length;
  el('waiter-ready-count').textContent = orders.filter(order => order.status === 'pronto').length;
  const readyNav = el('waiter-ready-nav-count');
  if (readyNav) {
    const ready = orders.filter(order => order.status === 'pronto').length;
    readyNav.textContent = ready > 9 ? '9+' : String(ready);
    readyNav.hidden = ready === 0;
  }
}

function tableLabel(table) { return table.nome || `Mesa ${String(table.numero || '').padStart(2, '0')}`; }
function activeOrderForTable(tableId) { return orders.find(order => String(order.mesa_id) === String(tableId) && activeStatuses.includes(order.status)); }

function renderTableCards() {
  el('waiter-tables-grid').innerHTML = tables.length ? tables.map(table => {
    const order = activeOrderForTable(table.id);
    const elapsed = order ? Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)) : 0;
    return `<button class="operational-table-card ${order ? 'busy' : 'free'}" type="button" data-table-card="${escapeHtml(table.id)}"><span class="table-state-dot"></span><small>${order ? statusLabels[order.status] || order.status : 'Livre'}</small><strong>${escapeHtml(tableLabel(table))}</strong>${order ? `<span>Pedido #${escapeHtml(order.codigo || order.id)}</span><b>${money(order.total)} • ${elapsed} min</b>` : '<span>Toque para iniciar pedido</span>'}</button>`;
  }).join('') : '<div class="empty-state">Nenhuma mesa ativa cadastrada.</div>';
  el('waiter-tables-grid').querySelectorAll('[data-table-card]').forEach(button => button.onclick = () => selectTable(button.dataset.tableCard));
}

function selectTable(tableId) {
  el('waiter-type').value = 'mesa';
  el('waiter-table').value = tableId;
  updateDestination(); updateMenuContext(); openPage('cardapio');
}

function updateMenuContext() {
  const table = tables.find(item => String(item.id) === String(el('waiter-table').value));
  el('waiter-menu-title').textContent = table ? `Pedido • ${tableLabel(table)}` : 'Novo pedido';
  el('waiter-menu-subtitle').textContent = table ? 'Adicione itens usando o cardápio oficial da loja.' : 'Selecione uma mesa ou outro tipo de atendimento.';
}

function renderCategories() {
  const categories = [...new Set(products.map(product => product.category))];
  el('waiter-category').innerHTML = '<option value="">Todas as categorias</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  renderCategoryTabs();
}

function renderCategoryTabs() {
  const container = el('waiter-category-tabs');
  if (!container) return;
  const categories = [...new Set(products.map(product => product.category))];
  const active = el('waiter-category').value;
  container.innerHTML = [{ value: '', label: 'Todos' }, ...categories.map(category => ({ value: category, label: category }))]
    .map(item => `<button type="button" class="${item.value === active ? 'active' : ''}" data-waiter-category="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`).join('');
  container.querySelectorAll('[data-waiter-category]').forEach(button => button.onclick = () => {
    el('waiter-category').value = button.dataset.waiterCategory;
    renderCategoryTabs();
    renderProducts();
  });
}

function productImage(product) {
  if (!product.imageUrl) return '';
  return `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.remove()">`;
}

function renderProducts() {
  const term = el('waiter-search').value.trim().toLowerCase();
  const category = el('waiter-category').value;
  const list = products.filter(product => (!category || product.category === category) && (!term || `${product.name} ${product.description}`.toLowerCase().includes(term)));
  el('waiter-products').innerHTML = list.length ? list.map(product => `<article class="menu-product" data-product="${escapeHtml(product.id)}"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || product.category)}</p><strong>${money(product.price)}</strong>${product.featured ? '<span class="status novo">Destaque</span>' : ''}</div>${productImage(product)}</article>`).join('') : '<div class="empty-state">Nenhum produto ativo encontrado no cardápio.</div>';
  el('waiter-products').querySelectorAll('[data-product]').forEach(node => node.onclick = () => showProduct(node.dataset.product));
}

function renderTables() {
  el('waiter-table').innerHTML = tables.length ? '<option value="">Selecione uma mesa</option>' + tables.map(table => `<option value="${escapeHtml(table.id)}" data-token="${escapeHtml(table.token || '')}">${escapeHtml(tableLabel(table))}</option>`).join('') : '<option value="">Nenhuma mesa ativa</option>';
}

function filteredOrders() {
  const localTypes = ['mesa', 'local'];
  return orders.filter(order => orderScope === 'local' ? localTypes.includes(order.tipo) : !localTypes.includes(order.tipo)).filter(order => {
    if (statusFilter === 'ativos') return activeStatuses.includes(order.status);
    if (statusFilter === 'preparo') return order.status === 'preparo';
    if (statusFilter === 'pronto') return order.status === 'pronto';
    return ['entregue', 'cancelado'].includes(order.status);
  });
}

function renderOrders() {
  const scopeOrders = orders.filter(order => orderScope === 'local' ? ['mesa', 'local'].includes(order.tipo) : !['mesa', 'local'].includes(order.tipo));
  el('waiter-active-count').textContent = scopeOrders.filter(order => activeStatuses.includes(order.status)).length;
  el('waiter-prep-count').textContent = scopeOrders.filter(order => order.status === 'preparo').length;
  el('waiter-done-count').textContent = scopeOrders.filter(order => order.status === 'pronto').length;
  const list = filteredOrders();
  el('waiter-orders').innerHTML = list.length ? list.map(order => {
    const tableName = order.mesas?.nome || (order.mesas?.numero ? `Mesa ${String(order.mesas.numero).padStart(2, '0')}` : '');
    const reference = tableName || order.clientes?.nome || (order.tipo === 'entrega' ? 'Entrega' : 'Retirada');
    const items = (order.itens_pedido || []).map(item => `${Number(item.quantidade)}x ${escapeHtml(item.nome_produto || item.nome)}`).join(' • ');
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
    return `<article class="operational-order-card status-${escapeHtml(order.status)}"><div class="operational-order-top"><div><div class="operational-order-number">#${escapeHtml(order.codigo || order.id)} <span class="status ${escapeHtml(order.status)}">${escapeHtml(statusLabels[order.status] || order.status)}</span></div><b>${escapeHtml(reference)}</b><small>${escapeHtml(order.tipo || '')}</small></div><div class="operational-order-time"><b>${elapsed} min</b><small>${new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div></div><div class="operational-order-body"><div><b>Itens do pedido</b><small>${items || 'Sem itens'}</small></div><div class="operational-order-total"><small>Total</small><b>${money(order.total)}</b></div></div></article>`;
  }).join('') : '<div class="empty-state orders-empty">Nenhum pedido nesta etapa.</div>';
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

function closeModal() { el('waiter-product-modal').classList.remove('open'); document.body.style.overflow = ''; }
function updateAddButton() { el('waiter-add').textContent = `Adicionar • ${money((current?.price || 0) * qty)}`; }
function addCurrentProduct() { if (!current) return; cart.push({ cartId: crypto.randomUUID(), productId: current.id, name: current.name, price: current.price, qty, note: el('waiter-item-note').value.trim() }); closeModal(); renderCart(); }
function subtotal() { return cart.reduce((sum, item) => sum + item.price * item.qty, 0); }
function total() { return subtotal() + (el('waiter-type').value === 'entrega' ? Number(establishment?.taxa_entrega || 0) : 0); }

function renderCart() {
  el('waiter-cart').innerHTML = cart.length ? cart.map(item => `<div class="row-card"><div class="order-main"><b>${Number(item.qty)}x ${escapeHtml(item.name)}</b><small>${item.note ? escapeHtml(item.note) : money(item.price)}</small></div><div><b>${money(item.price * item.qty)}</b><button class="link-button" data-remove="${escapeHtml(item.cartId)}">Remover</button></div></div>`).join('') : '<div class="empty-state">Nenhum item adicionado.</div>';
  const itemCount = cart.reduce((sum, item) => sum + Number(item.qty), 0);
  const orderTotal = total();
  el('waiter-total').textContent = money(orderTotal);
  el('waiter-cart-count').textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`;
  el('waiter-cart-summary-total').textContent = money(orderTotal);
  el('waiter-cart-summary').hidden = itemCount === 0;
  el('waiter-cart').querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { cart = cart.filter(item => item.cartId !== button.dataset.remove); renderCart(); });
}

function updateDestination() {
  const type = el('waiter-type').value;
  el('waiter-table-field').hidden = type !== 'mesa';
  el('waiter-address-field').hidden = type !== 'entrega';
  el('waiter-destination-label').textContent = { mesa: 'Pedido vinculado à mesa', entrega: 'Pedido para entrega', retirada: 'Retirada no balcão', local: 'Cliente no salão sem mesa' }[type];
  el('waiter-submit').textContent = type === 'mesa' || type === 'local' ? 'Enviar para cozinha' : 'Enviar pedido';
  updateMenuContext(); renderCart();
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
  const payload = { tipo: type, mesa_id: type === 'mesa' ? el('waiter-table').value : null, mesa_token: type === 'mesa' ? selectedTable?.dataset.token : null, nome: name || 'Atendimento local', telefone: phone || `mesa${Date.now()}`, endereco: address, pagamento: el('waiter-payment').value, observacoes: el('waiter-notes').value.trim(), itens: cart.map(item => ({ produto_id: item.productId, quantidade: item.qty, observacoes: item.note })) };
  const button = el('waiter-submit');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando...';
  try {
    let result;
    if (ownerSession) result = await db.rpc('criar_pedido_garcom', { payload });
    else { teamSession = readTeamSession(); if (!teamSession) return redirectToAccess(); result = await db.rpc('criar_pedido_equipe_garcom', { p_telefone: teamSession.phone, p_pin: teamSession.pin, payload }); }
    if (result.error) throw result.error;
    alert(`Pedido #${result.data} enviado com sucesso.`);
    cart = [];
    ['waiter-name', 'waiter-phone', 'waiter-address', 'waiter-notes'].forEach(id => { el(id).value = ''; });
    renderCart();
    await refreshOperation();
    orderScope = type === 'mesa' || type === 'local' ? 'local' : 'online';
    statusFilter = 'ativos';
    openPage('pedidos');
    renderOrders();
  } catch (error) {
    console.error(error);
    alert(error.message || 'Não foi possível enviar o pedido.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !ownerSession) refreshOperation(); });
init();
