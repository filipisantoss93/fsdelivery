(() => {
  const byId = id => document.getElementById(id);

  function ensureCartModal() {
    if (byId('cart-summary-modal')) return;

    const modal = document.createElement('div');
    modal.className = 'modal store-modal';
    modal.id = 'cart-summary-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'cart-summary-title');
    modal.innerHTML = `
      <div class="modal-card cart-summary-modal-card">
        <div class="modal-head">
          <div>
            <small id="cart-summary-context">Pedido on-line</small>
            <h2 id="cart-summary-title">Seu pedido</h2>
          </div>
          <button class="icon-btn" data-cart-modal-close type="button" aria-label="Fechar">×</button>
        </div>
        <div id="cart-summary-items"></div>
        <div class="row-card" id="cart-summary-subtotal-row"><span>Subtotal</span><b id="cart-summary-subtotal">R$ 0,00</b></div>
        <div class="row-card" id="cart-summary-fee-row"><span>Taxa de entrega</span><b id="cart-summary-fee">R$ 0,00</b></div>
        <div class="cart-total"><span>Total</span><span id="cart-summary-total">R$ 0,00</span></div>
        <small id="cart-summary-minimum"></small>
        <button class="btn btn-primary btn-block" id="cart-summary-checkout" type="button">Continuar pedido</button>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-cart-modal-close]')) closeCartModal();
    });
    byId('cart-summary-checkout').onclick = () => {
      closeCartModal();
      checkout();
      requestAnimationFrame(applyCheckoutContext);
    };
  }

  function closeCartModal() {
    byId('cart-summary-modal')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  function currentType() {
    if (new URLSearchParams(location.search).get('mesa')) return 'mesa';
    return byId('delivery-type')?.value || 'delivery';
  }

  function setVisible(element, visible, display = 'grid') {
    if (!element) return;
    element.hidden = !visible;
    if (visible) element.style.removeProperty('display');
    else element.style.setProperty('display', 'none', 'important');
    if (visible && display !== 'grid') element.style.display = display;
  }

  function applyCheckoutContext() {
    const orderType = currentType();
    const isTable = orderType === 'mesa';
    const isDelivery = orderType === 'delivery';
    const isPickup = orderType === 'pickup';
    const paymentMethod = byId('payment-method');

    const deliveryField = byId('delivery-type')?.closest('.field');
    const paymentField = paymentMethod?.closest('.field');
    const notesField = byId('order-notes')?.closest('.field');
    const checkoutSubtotalRow = byId('checkout-subtotal')?.closest('.row-card');
    const checkoutFeeRow = byId('checkout-delivery-fee')?.closest('.row-card');
    const cartSubtotalRow = byId('cart-subtotal')?.closest('.row-card');
    const cartFeeRow = byId('cart-delivery-fee')?.closest('.row-card');

    setVisible(deliveryField, !isTable);
    setVisible(byId('address-field'), isDelivery);
    setVisible(byId('region-field'), isDelivery);
    setVisible(paymentField, !isTable);
    setVisible(notesField, !isTable);
    setVisible(byId('change-field'), !isTable && paymentMethod?.value === 'Dinheiro');

    setVisible(cartFeeRow, isDelivery, 'flex');
    setVisible(checkoutFeeRow, isDelivery, 'flex');
    setVisible(byId('cart-summary-fee-row'), isDelivery, 'flex');

    // Em pedidos na mesa, subtotal e total são iguais. Exibe somente o total.
    setVisible(cartSubtotalRow, !isTable, 'flex');
    setVisible(checkoutSubtotalRow, !isTable, 'flex');
    setVisible(byId('cart-summary-subtotal-row'), !isTable, 'flex');

    const title = byId('checkout-title');
    const feedback = byId('checkout-modal')?.querySelector('.feedback');
    if (isTable) {
      if (title) title.textContent = 'Identifique seu pedido';
      if (feedback) feedback.textContent = 'Informe somente seu nome e WhatsApp para enviar o pedido à mesa.';
    } else if (isPickup) {
      if (title) title.textContent = 'Finalizar pedido';
      if (feedback) feedback.textContent = 'Informe seus dados e escolha a forma de pagamento. O pedido ficará disponível para retirada no estabelecimento.';
    } else {
      if (title) title.textContent = 'Finalizar pedido';
      if (feedback) feedback.textContent = 'Confira os dados antes de enviar. O pedido ficará aguardando confirmação do estabelecimento.';
    }
  }

  function bindModalCartActions() {
    const root = byId('cart-summary-items');
    if (!root) return;
    root.querySelectorAll('[data-modal-minus]').forEach(button => button.onclick = () => change(button.dataset.modalMinus, -1));
    root.querySelectorAll('[data-modal-plus]').forEach(button => button.onclick = () => change(button.dataset.modalPlus, 1));
    root.querySelectorAll('[data-modal-remove]').forEach(button => button.onclick = () => {
      cart = cart.filter(item => item.cartId !== button.dataset.modalRemove);
      saveCart();
      renderCart();
    });
  }

  function renderCartModal() {
    ensureCartModal();
    const items = byId('cart-summary-items');
    if (!items) return;

    items.innerHTML = cart.length
      ? cart.map(item => `
        <div class="cart-item">
          <div class="cart-item-line"><b>${item.qty}x ${escapeHtml(item.name)}</b><b>${money(item.qty * item.price)}</b></div>
          ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}
          <div class="inline-actions">
            <button class="btn btn-secondary" data-modal-minus="${escapeHtml(item.cartId)}" type="button">−</button>
            <button class="btn btn-secondary" data-modal-plus="${escapeHtml(item.cartId)}" type="button">+</button>
            <button class="link-button" data-modal-remove="${escapeHtml(item.cartId)}" type="button">Remover</button>
          </div>
        </div>`).join('')
      : '<div class="cart-empty">Seu carrinho está vazio.</div>';

    byId('cart-summary-context').textContent = byId('order-context-label')?.textContent || 'Pedido on-line';
    byId('cart-summary-subtotal').textContent = money(subtotal());
    byId('cart-summary-fee').textContent = money(fee());
    byId('cart-summary-total').textContent = money(total());
    byId('cart-summary-minimum').textContent = byId('minimum-order-hint')?.textContent || '';
    byId('cart-summary-minimum').style.color = byId('minimum-order-hint')?.style.color || '';
    byId('cart-summary-checkout').disabled = !cart.length;
    applyCheckoutContext();
    bindModalCartActions();
  }

  function openCartModal() {
    ensureCartModal();
    renderCartModal();
    byId('cart-summary-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  const originalRenderCart = window.renderCart;
  window.renderCart = function (...args) {
    const result = originalRenderCart.apply(this, args);
    renderCartModal();
    applyCheckoutContext();
    return result;
  };

  function bindMobileCart() {
    ensureCartModal();
    const button = byId('mobile-cart');
    if (!button || button.dataset.cartModalBound) return;
    button.dataset.cartModalBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openCartModal();
    }, true);

    byId('delivery-type')?.addEventListener('change', () => requestAnimationFrame(applyCheckoutContext));
    byId('payment-method')?.addEventListener('change', () => requestAnimationFrame(applyCheckoutContext));
    byId('checkout-btn')?.addEventListener('click', () => requestAnimationFrame(applyCheckoutContext));
    byId('cart-summary-checkout')?.addEventListener('click', () => requestAnimationFrame(applyCheckoutContext));
    applyCheckoutContext();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMobileCart, { once: true });
  } else {
    bindMobileCart();
  }
})();