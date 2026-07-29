(() => {
  const button = document.getElementById('notification-button');
  const panel = document.getElementById('notification-panel');
  const list = document.getElementById('notification-list');
  const badge = document.getElementById('notification-badge');
  const markAll = document.getElementById('notification-mark-all');
  if (!button || !panel || !list || !badge) return;

  const storageKey = 'fsdelivery_notifications_read';
  const readIds = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
  const saveRead = () => localStorage.setItem(storageKey, JSON.stringify([...readIds].slice(-200)));

  function getNotifications() {
    try {
      return (orders || [])
        .filter(order => order.status !== 'cancelado')
        .slice(0, 20)
        .map(order => ({
          id: String(order.id),
          orderId: order.id,
          title: order.status === 'novo' ? `Novo pedido #${order.id}` : `Pedido #${order.id} — ${labels[order.status] || order.status}`,
          detail: `${order.customer} • ${order.time} • ${money(order.total)}`
        }));
    } catch (_) {
      return [];
    }
  }

  function renderNotifications() {
    const notifications = getNotifications();
    const unread = notifications.filter(item => !readIds.has(item.id));
    badge.textContent = unread.length > 9 ? '9+' : String(unread.length);
    badge.classList.toggle('show', unread.length > 0);

    list.innerHTML = notifications.length
      ? notifications.map(item => `
          <button class="notification-item ${readIds.has(item.id) ? '' : 'unread'}" type="button" data-notification-id="${item.id}" data-order-id="${item.orderId}">
            <span class="notification-dot"></span>
            <span class="notification-copy"><b>${item.title}</b><small>${item.detail}</small></span>
          </button>`).join('')
      : '<div class="notification-empty">Nenhuma notificação no momento.</div>';

    list.querySelectorAll('[data-notification-id]').forEach(item => {
      item.addEventListener('click', () => {
        readIds.add(item.dataset.notificationId);
        saveRead();
        renderNotifications();
        panel.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
        if (typeof openPage === 'function') openPage('pedidos');
        if (typeof openOrder === 'function') openOrder(Number(item.dataset.orderId));
      });
    });
  }

  button.addEventListener('click', event => {
    event.stopPropagation();
    const isOpen = panel.classList.toggle('open');
    button.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) renderNotifications();
  });

  panel.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', () => {
    panel.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
  });

  markAll?.addEventListener('click', () => {
    getNotifications().forEach(item => readIds.add(item.id));
    saveRead();
    renderNotifications();
  });

  const homeHead = document.querySelector('#inicio .page-head');
  const ordersButton = homeHead?.querySelector('[data-go="pedidos"]');
  if (homeHead && ordersButton && !document.getElementById('waiter-shortcut')) {
    const actionGroup = document.createElement('div');
    actionGroup.className = 'actions';
    ordersButton.replaceWith(actionGroup);
    actionGroup.appendChild(ordersButton);

    const waiterShortcut = document.createElement('button');
    waiterShortcut.id = 'waiter-shortcut';
    waiterShortcut.type = 'button';
    waiterShortcut.className = 'btn btn-secondary';
    waiterShortcut.textContent = 'Abrir garçom';
    waiterShortcut.addEventListener('click', () => location.href = 'garcom.html');
    actionGroup.appendChild(waiterShortcut);
  }

  const sidebarNav = document.querySelector('.sidebar .nav');
  const settingsButton = sidebarNav?.querySelector('[data-page="configuracoes"]');
  if (sidebarNav && settingsButton && !document.getElementById('tables-nav-button')) {
    const tablesButton = document.createElement('button');
    tablesButton.id = 'tables-nav-button';
    tablesButton.type = 'button';
    tablesButton.textContent = 'Mesas e QR Codes';
    tablesButton.addEventListener('click', () => location.href = 'mesas.html');
    sidebarNav.insertBefore(tablesButton, settingsButton);
  }

  renderNotifications();
  setInterval(renderNotifications, 15000);
})();

(() => {
  const mobileNav = document.querySelector('.mobile-nav');
  if (!mobileNav) return;

  mobileNav.innerHTML = `
    <button class="active" data-page="inicio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg><span>Início</span></button>
    <button data-page="pedidos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg><span>Pedidos</span></button>
    <button data-page="cardapio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16v18H4z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg><span>Cardápio</span></button>
    <button type="button" data-direct="mesas"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 19v2M17 19v2M7 9h10"/></svg><span>Mesas</span></button>
    <button type="button" id="more-menu-button" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg><span>Mais</span></button>`;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="more-menu-backdrop" id="more-menu-backdrop" hidden></div>
    <section class="more-menu-sheet" id="more-menu-sheet" aria-label="Mais opções" aria-hidden="true">
      <div class="more-menu-handle"></div>
      <div class="more-menu-head"><div><strong>Mais</strong><small>Acesse as demais áreas do FS Delivery</small></div><button class="icon-btn" id="more-menu-close" type="button" aria-label="Fechar">×</button></div>
      <div class="more-menu-grid">
        <button type="button" data-more-page="clientes"><span class="more-menu-icon">CL</span><b>Clientes</b><small>Histórico e frequência</small></button>
        <button type="button" data-more-page="financeiro"><span class="more-menu-icon">R$</span><b>Financeiro</b><small>Vendas e recebimentos</small></button>
        <button type="button" data-more-link="garcom.html"><span class="more-menu-icon">G</span><b>Garçom</b><small>Pedidos do atendimento</small></button>
        <button type="button" data-more-link="caixa.html"><span class="more-menu-icon">C</span><b>Caixa</b><small>Operação e fechamento</small></button>
        <button type="button" data-more-link="mesas.html"><span class="more-menu-icon">QR</span><b>Mesas e QR Codes</b><small>Gerar, baixar e imprimir</small></button>
        <button type="button" data-more-page="configuracoes"><span class="more-menu-icon">⚙</span><b>Estabelecimento</b><small>Dados e funcionamento</small></button>
      </div>
    </section>`);

  const moreButton = document.getElementById('more-menu-button');
  const sheet = document.getElementById('more-menu-sheet');
  const backdrop = document.getElementById('more-menu-backdrop');
  const closeButton = document.getElementById('more-menu-close');
  const closeMore = () => {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    moreButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('more-menu-open');
  };
  const openMore = () => {
    backdrop.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    sheet.setAttribute('aria-hidden', 'false');
    moreButton.setAttribute('aria-expanded', 'true');
    document.body.classList.add('more-menu-open');
  };

  moreButton.onclick = openMore;
  closeButton.onclick = closeMore;
  backdrop.onclick = closeMore;
  mobileNav.querySelector('[data-direct="mesas"]').onclick = () => location.href = 'mesas.html';
  mobileNav.querySelectorAll('[data-page]').forEach(button => button.onclick = () => {
    closeMore();
    if (typeof openPage === 'function') openPage(button.dataset.page);
  });
  sheet.querySelectorAll('[data-more-page]').forEach(button => button.onclick = () => {
    closeMore();
    if (typeof openPage === 'function') openPage(button.dataset.morePage);
  });
  sheet.querySelectorAll('[data-more-link]').forEach(button => button.onclick = () => location.href = button.dataset.moreLink);

  const requestedPage = location.hash.replace('#', '');
  if (requestedPage && document.getElementById(requestedPage) && typeof openPage === 'function') openPage(requestedPage);
})();