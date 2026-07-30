const db = window.supabaseClient;
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let store;
let orders = [];
let tables = [];
let payments = [];
let selected = null;

const openStatuses = ['novo', 'confirmado', 'preparo', 'pronto', 'saiu_entrega'];
const labels = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  preparo: 'Em preparo',
  pronto: 'Pronto',
  saiu_entrega: 'Em entrega',
  entregue: 'Finalizado',
  cancelado: 'Cancelado'
};

const el = id => document.getElementById(id);

async function init() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return location.replace('auth.html');

  const { data: establishment, error } = await db
    .from('estabelecimentos')
    .select('*')
    .eq('usuario_id', session.user.id)
    .single();

  if (error || !establishment) {
    alert('Não foi possível carregar o estabelecimento.');
    return;
  }

  store = establishment;
  bind();
  await load();
  render();

  db.channel(`caixa-${store.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `estabelecimento_id=eq.${store.id}` }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pagamentos', filter: `estabelecimento_id=eq.${store.id}` }, refresh)
    .subscribe();
}

async function refresh() {
  await load();
  render();
}

async function load() {
  const [ordersResult, tablesResult, paymentsResult] = await Promise.all([
    db.from('pedidos')
      .select('*,clientes(nome,telefone),itens_pedido(*),mesas(id,identificacao,nome)')
      .eq('estabelecimento_id', store.id)
      .order('created_at', { ascending: false }),
    db.from('mesas')
      .select('*')
      .eq('estabelecimento_id', store.id)
      .eq('ativo', true)
      .order('identificacao'),
    db.from('pagamentos')
      .select('id,pedido_id,valor,forma_pagamento,created_at')
      .eq('estabelecimento_id', store.id)
      .order('created_at', { ascending: false })
  ]);

  const error = ordersResult.error || tablesResult.error || paymentsResult.error;
  if (error) {
    console.error(error);
    alert('Não foi possível atualizar o caixa.');
  }

  orders = ordersResult.data || [];
  tables = tablesResult.data || [];
  payments = paymentsResult.data || [];
}

function paidForOrder(orderId) {
  return payments
    .filter(payment => String(payment.pedido_id) === String(orderId))
    .reduce((sum, payment) => sum + Number(payment.valor || 0), 0);
}

function balanceForOrder(order) {
  return Math.max(Number(order.total || 0) - paidForOrder(order.id), 0);
}

function bind() {
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = close);
  document.querySelectorAll('.modal').forEach(modal => modal.onclick = event => {
    if (event.target === modal) close();
  });

  el('order-filter').onchange = renderOrders;
  el('charge-order').onclick = () => {
    if (!selected) return;
    const balance = balanceForOrder(selected);
    if (balance <= 0) return alert('Este pedido já está integralmente pago.');

    close();
    el('payment-total').value = money(balance);
    document.querySelector('#payment-form [name=amount]').value = balance.toFixed(2).replace('.', ',');
    open('payment-modal');
  };
  el('payment-form').onsubmit = pay;
}

function open(id) {
  el(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function close() {
  document.querySelectorAll('.modal').forEach(modal => modal.classList.remove('open'));
  document.body.style.overflow = '';
}

function render() {
  const active = orders.filter(order => openStatuses.includes(order.status));
  const occupied = new Set(active.filter(order => order.mesa_id).map(order => order.mesa_id));
  const today = new Date().toDateString();
  const paidToday = payments
    .filter(payment => new Date(payment.created_at).toDateString() === today)
    .reduce((sum, payment) => sum + Number(payment.valor || 0), 0);

  el('m-open').textContent = active.length;
  el('m-tables').textContent = occupied.size;
  el('m-pending').textContent = money(active.reduce((sum, order) => sum + balanceForOrder(order), 0));
  el('m-paid').textContent = money(paidToday);

  renderOrders();
  renderTables(occupied);
}

function renderOrders() {
  const filter = el('order-filter').value;
  const list = orders.filter(order =>
    order.tipo !== 'mesa' &&
    openStatuses.includes(order.status) &&
    (!filter || order.tipo === filter)
  );

  el('online-orders').innerHTML = list.map(order => {
    const balance = balanceForOrder(order);
    return `<article class="order-card" data-order="${escapeHtml(order.id)}">
      <div class="order-main">
        <b>#${escapeHtml(order.codigo || order.id)} • ${escapeHtml(order.clientes?.nome || 'Cliente')}</b>
        <small>${escapeHtml(typeLabel(order.tipo))} • ${new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
      <div>
        <span class="status ${escapeHtml(order.status)}">${escapeHtml(labels[order.status] || order.status)}</span>
        <b>${balance > 0 ? `${money(balance)} pendente` : 'Pago'}</b>
      </div>
    </article>`;
  }).join('') || '<div class="empty-state">Nenhum pedido on-line em aberto.</div>';

  document.querySelectorAll('[data-order]').forEach(card => card.onclick = () => showOrder(card.dataset.order));
}

function renderTables(occupied) {
  el('tables-grid').innerHTML = tables.map(table => {
    const order = orders.find(item => item.mesa_id === table.id && openStatuses.includes(item.status));
    const busy = occupied.has(table.id);
    const balance = order ? balanceForOrder(order) : 0;

    return `<article class="feature-card ${busy ? 'danger-zone' : ''}" data-table="${escapeHtml(table.id)}">
      <span class="status ${busy ? 'cancelado' : 'pronto'}">${busy ? 'Ocupada' : 'Disponível'}</span>
      <h3>${escapeHtml(table.nome || `Mesa ${table.identificacao}`)}</h3>
      <p>${order ? `Pedido #${escapeHtml(order.codigo || order.id)} • ${balance > 0 ? money(balance) + ' pendente' : 'Pago'}` : 'Sem pedido em andamento'}</p>
    </article>`;
  }).join('') || '<div class="empty-state">Nenhuma mesa ativa cadastrada.</div>';

  document.querySelectorAll('[data-table]').forEach(card => card.onclick = () => {
    const order = orders.find(item => String(item.mesa_id) === card.dataset.table && openStatuses.includes(item.status));
    if (order) showOrder(order.id);
  });
}

function typeLabel(type) {
  return ({ entrega: 'Entrega', retirada: 'Retirada', local: 'Comer no local', mesa: 'Mesa' })[type] || type;
}

function showOrder(id) {
  selected = orders.find(order => String(order.id) === String(id));
  if (!selected) return;

  const table = selected.mesas ? selected.mesas.nome || `Mesa ${selected.mesas.identificacao}` : null;
  const paid = paidForOrder(selected.id);
  const balance = balanceForOrder(selected);

  el('cash-order-title').textContent = `Pedido #${selected.codigo || selected.id}`;
  el('cash-order-detail').innerHTML = `<div class="row-card">
    <div class="order-main">
      <b>${escapeHtml(table || typeLabel(selected.tipo))}</b>
      <small>${escapeHtml(selected.clientes?.nome || 'Cliente')} • ${escapeHtml(selected.clientes?.telefone || 'Sem telefone')}</small>
    </div>
    <span class="status ${escapeHtml(selected.status)}">${escapeHtml(labels[selected.status] || selected.status)}</span>
  </div>
  <div class="product-list">${(selected.itens_pedido || []).map(item => `<div class="row-card">
    <div class="order-main"><b>${item.quantidade}x ${escapeHtml(item.nome_produto)}</b><small>${escapeHtml(item.observacoes || 'Sem observações')}</small></div>
    <b>${money(Number(item.total) || Number(item.valor_unitario) * item.quantidade)}</b>
  </div>`).join('')}</div>
  <div class="row-card"><span>Total do pedido</span><b>${money(selected.total)}</b></div>
  <div class="row-card"><span>Total recebido</span><b>${money(paid)}</b></div>
  <div class="cart-total"><span>Saldo restante</span><strong>${money(balance)}</strong></div>`;

  el('charge-order').style.display = openStatuses.includes(selected.status) && balance > 0 ? 'inline-flex' : 'none';
  open('cash-order-modal');
}

async function pay(event) {
  event.preventDefault();
  if (!selected) return;

  const form = event.currentTarget;
  const data = new FormData(form);
  const amount = Number(String(data.get('amount') || '').replace(',', '.'));
  const balance = balanceForOrder(selected);

  if (!Number.isFinite(amount) || amount <= 0) return alert('Informe um valor válido.');
  if (amount > balance) return alert(`O valor excede o saldo restante de ${money(balance)}.`);

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  const previousText = submit.textContent;
  submit.textContent = 'Registrando...';

  const payload = {
    estabelecimento_id: store.id,
    pedido_id: selected.id,
    valor: amount,
    forma_pagamento: data.get('method'),
    referencia: String(data.get('reference') || '').trim() || null,
    observacoes: String(data.get('notes') || '').trim() || null
  };

  const { data: result, error } = await db.rpc('registrar_pagamento_caixa', { payload });

  submit.disabled = false;
  submit.textContent = previousText;

  if (error) return alert(error.message);

  close();
  form.reset();
  await refresh();
  alert(result?.quitado ? 'Pagamento registrado. Pedido integralmente pago.' : `Pagamento registrado. Saldo restante: ${money(result?.saldo)}.`);
}

init();
