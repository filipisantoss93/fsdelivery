(() => {
  const byId = id => document.getElementById(id);

  function currentType() {
    if (new URLSearchParams(location.search).get('mesa')) return 'mesa';
    return byId('delivery-type')?.value || 'delivery';
  }

  function setVisible(element, visible, display = 'grid') {
    if (!element) return;
    element.hidden = !visible;
    element.setAttribute('aria-hidden', String(!visible));
    if (visible) {
      element.style.removeProperty('display');
      element.style.removeProperty('visibility');
      element.style.removeProperty('opacity');
      if (display !== 'grid') element.style.display = display;
    } else {
      element.style.setProperty('display', 'none', 'important');
    }
  }

  function syncCheckoutFields() {
    const orderType = currentType();
    const isTable = orderType === 'mesa';
    const isDelivery = orderType === 'delivery';
    const payment = byId('payment-method');

    setVisible(byId('customer-name')?.closest('.field'), true);
    setVisible(byId('customer-phone')?.closest('.field'), true);
    setVisible(byId('delivery-type')?.closest('.field'), !isTable);
    setVisible(byId('region-field'), isDelivery);
    setVisible(byId('address-field'), isDelivery);
    setVisible(payment?.closest('.field'), !isTable);
    setVisible(byId('order-notes')?.closest('.field'), !isTable);
    setVisible(byId('change-field'), !isTable && payment?.value === 'Dinheiro');

    const address = byId('customer-address');
    if (address) address.required = isDelivery;

    const checkoutFeeRow = byId('checkout-delivery-fee')?.closest('.row-card');
    setVisible(checkoutFeeRow, isDelivery, 'flex');

    const modal = byId('checkout-modal');
    if (modal) {
      modal.querySelector('.modal-card')?.style.setProperty('overflow-y', 'auto');
      modal.querySelector('.modal-card')?.style.setProperty('max-height', '90vh');
    }
  }

  function openCheckoutForm(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();

    if (typeof settings === 'undefined' || !settings?.aberto) {
      if (typeof setFeedback === 'function') setFeedback('A loja está fechada no momento.', 'error');
      return;
    }
    if (typeof cart === 'undefined' || !cart.length) {
      if (typeof setFeedback === 'function') setFeedback('Adicione ao menos um produto ao pedido.', 'error');
      return;
    }
    if (typeof table !== 'undefined' && !table && typeof subtotal === 'function' && subtotal() < Number(settings.pedido_minimo)) {
      if (typeof setFeedback === 'function') setFeedback(`O pedido mínimo é ${money(settings.pedido_minimo)}.`, 'error');
      return;
    }

    if (typeof updateTotal === 'function') updateTotal();
    if (typeof open === 'function') open('checkout-modal');
    else byId('checkout-modal')?.classList.add('open');

    requestAnimationFrame(() => {
      syncCheckoutFields();
      const firstField = currentType() === 'delivery' && byId('delivery-region')
        ? byId('delivery-region')
        : byId('customer-name');
      firstField?.focus({ preventScroll: true });
    });
  }

  function bind() {
    const checkoutButton = byId('checkout-btn');
    if (checkoutButton) checkoutButton.onclick = openCheckoutForm;

    const summaryButton = byId('cart-summary-checkout');
    if (summaryButton) {
      summaryButton.onclick = event => {
        byId('cart-summary-modal')?.classList.remove('open');
        document.body.style.overflow = '';
        openCheckoutForm(event);
      };
    }

    byId('delivery-type')?.addEventListener('change', () => requestAnimationFrame(syncCheckoutFields));
    byId('payment-method')?.addEventListener('change', () => requestAnimationFrame(syncCheckoutFields));

    const cartObserver = new MutationObserver(() => {
      const button = byId('cart-summary-checkout');
      if (button && !button.dataset.checkoutFlowFixed) {
        button.dataset.checkoutFlowFixed = 'true';
        button.onclick = event => {
          byId('cart-summary-modal')?.classList.remove('open');
          document.body.style.overflow = '';
          openCheckoutForm(event);
        };
      }
    });
    cartObserver.observe(document.body, { childList: true, subtree: true });

    syncCheckoutFields();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
