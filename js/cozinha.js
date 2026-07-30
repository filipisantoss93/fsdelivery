const db = window.supabaseClient;
const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

let store = null;
let orders = [];
let scope = 'local';
let selected = null;
let updating = false;

const el = id => document.getElementById(id);
const activeStatuses = ['novo', 'confirmado', 'preparo'];
const labels = {
  novo: 'Novo',
  confirmado: 'Confirmado',
  preparo: 'Em preparo',
  pronto: 'Pronto'
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

function nextStep(order) {
  if (['novo', 'confirmado'].includes(order.status)) {
    return { status: 'preparo', label: 'Iniciar preparo', loading: 'Iniciando...' };
  }
  if (order.status === 'preparo') {
    return { status: 'pronto', label: 'Marcar pronto', loading: 'Finalizando...' };
  }
  return null;
}

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

  db.channel(`cozinha-${store.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'pedidos',
      filter: `estabelecimento_id=eq.${store.id}`
    }, async () => {
      await load();
      render();
    })
    .subscribe();
}

function bind() {
  document.querySelectorAll('[data-kitchen-scope]').forEach(button => {
    button.onclick = () => {
      scope = button.dataset.kitchenScope;
      document.querySelectorAll('[data-kitchen-scope]').forEach(item => {
        const active = item === button;
        item.classList.toggle('btn-primary', active);
        item.classList.toggle('btn-secondary', !active);
      });
      render();
    };
  });

  document.querySelectorAll('[data-close]').forEach(button => button.onclick = closeModal);
  el('kitchen-order-modal').onclick = event => {
    if (event.target === el('kitchen-order-modal')) closeModal();
  };
  el('kitchen-complete').onclick = completeSelected;
}

async function load() {
  el('kitchen-status').textContent = 'Atualizando';

  const { data, error } = await db
    .from('pedidos')
    .select('id,numero,codigo,status,tipo,total,observacoes,created_at,mesa_id,clientes(nome,telefone),mesas(numero,nome),itens_pedido(quantidade,nome_produto,observacoes,total)')
    .eq('estabelecimento_id', store.id)
    .order('numero', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    el('kitchen-orders').innerHTML = '<div class="empty-state">Não foi possível carregar os pedidos.</div>';
    orders = [];
    el('kitchen-status').textContent = 'Erro';
    return;
  }

  orders = data || [];
  el('kitchen-status').textContent = 'Ao vivo';
}

function filtered() {
  const localTypes = ['mesa', 'local'];
  return orders.filter(order =>
    activeStatuses.includes(order.status) &&
    (scope === 'local' ? localTypes.includes(order.tipo) : !localTypes.includes(order.tipo))
  );
}

function orderNumber(order) {
  return order.numero
    ? `#${String(order.numero).padStart(4, '0')}`
    : `#${order.codigo || order.id}`;
}

function reference(order) {
  if (order.tipo === 'mesa') return order.mesas?.nome || `Mesa ${order.mesas?.numero || ''}`;
  return order.clientes?.nome || ({ entrega: 'Entrega', retirada: 'Retirada' })[order.tipo] || 'Pedido';
}

function render() {
  const list = filtered();
  el('kitchen-list-title').textContent = scope === 'local' ? 'Pedidos locais' : 'Pedidos on-line';
  el('kitchen-queued').textContent = orders.filter(order => ['novo', 'confirmado'].includes(order.status)).length;
  el('kitchen-preparing').textContent = orders.filter(order => order.status === 'preparo').length;

  const today = new Date().toDateString();
  el('kitchen-ready').textContent = orders.filter(order =>
    order.status === 'pronto' && new Date(order.created_at).toDateString() === today
  ).length;

  el('kitchen-orders').innerHTML = list.length
    ? list.map(order => {
        const step = nextStep(order);
        return `<article class="kitchen-card" data-kitchen-order="${escapeHtml(order.id)}">
          <div class="kitchen-card-head">
            <span class="status ${escapeHtml(order.status)}">${escapeHtml(labels[order.status] || order.status)}</span>
            <b>${escapeHtml(orderNumber(order))}</b>
          </div>
          <h3>${escapeHtml(reference(order))}</h3>
          <div class="kitchen-items">
            ${(order.itens_pedido || []).map(item => `<p><b>${Number(item.quantidade)}x</b> ${escapeHtml(item.nome_produto)}${item.observacoes ? `<small>${escapeHtml(item.observacoes)}</small>` : ''}</p>`).join('') || '<p>Sem itens</p>'}
          </div>
          ${order.observacoes ? `<div class="kitchen-note">${escapeHtml(order.observacoes)}</div>` : ''}
          <div class="kitchen-card-foot">
            <small>${new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small>
            <strong>${money(order.total)}</strong>
          </div>
          ${step ? `<button class="btn btn-primary btn-block" data-complete-order="${escapeHtml(order.id)}">${step.label}</button>` : ''}
        </article>`;
      }).join('')
    : `<div class="empty-state">Nenhum pedido ${scope === 'local' ? 'local' : 'on-line'} aguardando a cozinha.</div>`;

  document.querySelectorAll('[data-kitchen-order]').forEach(card => {
    card.onclick = event => {
      if (event.target.closest('[data-complete-order]')) return;
      openOrder(card.dataset.kitchenOrder);
    };
  });

  document.querySelectorAll('[data-complete-order]').forEach(button => {
    button.onclick = () => advanceOrder(button.dataset.completeOrder, button);
  });
}

function openOrder(id) {
  selected = orders.find(order => String(order.id) === String(id));
  if (!selected) return;

  const step = nextStep(selected);
  el('kitchen-order-title').textContent = `Pedido ${orderNumber(selected)}`;
  el('kitchen-order-detail').innerHTML = `<div class="row-card">
    <div><b>${escapeHtml(reference(selected))}</b><small>${escapeHtml(selected.tipo === 'entrega' ? 'Entrega' : selected.tipo === 'retirada' ? 'Retirada' : selected.tipo === 'mesa' ? 'Mesa' : 'Local')}</small></div>
    <span class="status ${escapeHtml(selected.status)}">${escapeHtml(labels[selected.status] || selected.status)}</span>
  </div>
  <div class="product-list">
    ${(selected.itens_pedido || []).map(item => `<div class="row-card"><div><b>${Number(item.quantidade)}x ${escapeHtml(item.nome_produto)}</b><small>${escapeHtml(item.observacoes || 'Sem observações')}</small></div><b>${money(item.total)}</b></div>`).join('')}
  </div>
  ${selected.observacoes ? `<div class="kitchen-note">${escapeHtml(selected.observacoes)}</div>` : ''}`;

  el('kitchen-complete').textContent = step?.label || 'Sem ação disponível';
  el('kitchen-complete').disabled = !step;
  el('kitchen-order-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  el('kitchen-order-modal').classList.remove('open');
  document.body.style.overflow = '';
  selected = null;
}

async function completeSelected() {
  if (selected) await advanceOrder(selected.id, el('kitchen-complete'));
}

async function advanceOrder(id, button) {
  if (updating) return;
  const order = orders.find(item => String(item.id) === String(id));
  const step = order && nextStep(order);
  if (!step) return alert('Este pedido não está em uma etapa válida da cozinha.');

  const message = step.status === 'preparo'
    ? 'Iniciar o preparo deste pedido?'
    : 'Confirmar que este pedido está pronto?';
  if (!confirm(message)) return;

  updating = true;
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = step.loading;

  const { error } = await db.rpc('atualizar_status_pedido_operacional', {
    p_pedido_id: Number(id),
    p_novo_status: step.status
  });

  updating = false;
  button.disabled = false;
  button.textContent = previous;

  if (error) return alert(error.message || 'Não foi possível atualizar o pedido.');

  closeModal();
  await load();
  render();
}

init();
