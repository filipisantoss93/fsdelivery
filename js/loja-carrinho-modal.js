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
        <div class="row-card"><span>Subtotal</span><b id="cart-summary-subtotal">R$ 0,00</b></div>
        <div class="row-card"><span>Taxa de entrega</span><b id="cart-summary-fee">R$ 0,00</b></div>
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
    };
  }

  function closeCartModal() {
    byId('cart-summary-modal')?.classList.remove('open');
    document.body.style.overflow = '';
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMobileCart, { once: true });
  } else {
    bindMobileCart();
  }
})();