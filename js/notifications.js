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