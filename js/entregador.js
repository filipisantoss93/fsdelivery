const db = window.supabaseClient;
const TEAM_SESSION_KEY = 'fsdelivery_team';
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;
const LOGIN_PAGE = 'entrega.html';
const REFRESH_INTERVAL = 20000;

const money = value => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
}).format(Number(value) || 0);

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(TEAM_SESSION_KEY) || 'null');
  } catch (error) {
    console.error('Sessão da equipe inválida:', error);
    return null;
  }
}

function isValidDeliverySession(value) {
  if (!value || value.funcao !== 'entregador') return false;
  if (!value.estabelecimento_id || !value.slug || !value.phone || !value.pin) return false;

  const authenticatedAt = Number(value.authenticated_at || 0);
  return authenticatedAt > 0 && Date.now() - authenticatedAt <= SESSION_MAX_AGE;
}

function clearSessionAndRedirect() {
  sessionStorage.removeItem(TEAM_SESSION_KEY);
  location.replace(LOGIN_PAGE);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function getAddress(order) {
  const address = order?.endereco_entrega;
  if (!address) return 'Endereço não informado';
  if (typeof address === 'string') return address;

  return [
    address.endereco,
    address.numero,
    address.complemento,
    address.bairro,
    address.cidade,
    address.referencia
  ].filter(Boolean).join(', ') || 'Endereço não informado';
}

function friendlyError(error) {
  console.error(error);
  return 'Não foi possível atualizar as entregas. Verifique sua conexão e tente novamente.';
}

const session = readSession();
if (!isValidDeliverySession(session)) {
  clearSessionAndRedirect();
  throw new Error('Sessão de entregador ausente, inválida ou expirada.');
}

const userLabel = document.getElementById('delivery-user');
const logoutButton = document.getElementById('delivery-logout');
const orderList = document.getElementById('delivery-orders');

userLabel.textContent = `${session.nome || 'Entregador'} • Entregador`;
logoutButton.onclick = clearSessionAndRedirect;

let loading = false;
let refreshTimer = null;

function renderOrders(orders) {
  if (!orders.length) {
    orderList.innerHTML = '<div class="empty-state">Nenhuma entrega disponível.</div>';
    return;
  }

  orderList.innerHTML = orders.map(order => {
    const phone = normalizePhone(order.cliente_telefone);
    const address = getAddress(order);
    const nextStatus = order.status === 'pronto' ? 'saiu_entrega' : 'entregue';
    const actionLabel = order.status === 'pronto' ? 'Iniciar entrega' : 'Marcar entregue';
    const statusLabel = order.status === 'pronto' ? 'Pronto para sair' : 'Em entrega';
    const phoneLink = phone
      ? `<a class="link-button" href="tel:+55${phone}">Ligar</a>`
      : '';
    const routeLink = address !== 'Endereço não informado'
      ? `<a class="link-button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer">Abrir rota</a>`
      : '';

    return `<article class="order-card">
      <div class="order-main">
        <b>#${escapeHtml(order.id)} • ${escapeHtml(order.cliente_nome || 'Cliente')}</b>
        <small>${escapeHtml(order.cliente_telefone || 'Telefone não informado')} • ${escapeHtml(address)}</small>
        <div class="inline-actions">${phoneLink}${routeLink}</div>
      </div>
      <div>
        <span class="status ${escapeHtml(order.status)}">${statusLabel}</span>
        <b style="display:block;margin-top:7px">${money(order.total)}</b>
      </div>
      <button class="btn btn-primary" data-delivery="${escapeHtml(order.id)}" data-status="${nextStatus}">${actionLabel}</button>
    </article>`;
  }).join('');

  orderList.querySelectorAll('[data-delivery]').forEach(button => {
    button.onclick = () => updateDelivery(button);
  });
}

async function updateDelivery(button) {
  const nextStatus = button.dataset.status;
  const confirmationMessage = nextStatus === 'entregue'
    ? 'Confirmar que este pedido foi entregue ao cliente?'
    : 'Confirmar o início desta entrega?';

  if (!window.confirm(confirmationMessage)) return;

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Atualizando...';

  const { error } = await db.rpc('atualizar_entrega_equipe', {
    p_slug: session.slug,
    p_telefone: session.phone,
    p_pin: session.pin,
    p_pedido: Number(button.dataset.delivery),
    p_status: nextStatus
  });

  if (error) {
    alert(friendlyError(error));
    button.disabled = false;
    button.textContent = originalText;
    return;
  }

  await loadDeliveries();
}

async function loadDeliveries() {
  if (loading) return;
  if (!isValidDeliverySession(readSession())) {
    clearSessionAndRedirect();
    return;
  }

  loading = true;
  try {
    const { data, error } = await db.rpc('listar_entregas_equipe', {
      p_slug: session.slug,
      p_telefone: session.phone,
      p_pin: session.pin
    });

    if (error) throw error;
    renderOrders(data || []);
  } catch (error) {
    orderList.innerHTML = `<div class="empty-state">${friendlyError(error)}</div>`;
  } finally {
    loading = false;
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadDeliveries();
  }, REFRESH_INTERVAL);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadDeliveries();
});

window.addEventListener('pageshow', () => {
  if (!isValidDeliverySession(readSession())) clearSessionAndRedirect();
});

loadDeliveries();
scheduleRefresh();
