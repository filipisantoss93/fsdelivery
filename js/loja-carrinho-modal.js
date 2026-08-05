(() => {
  const byId = id => document.getElementById(id);

  function installPublicStoreLayoutFixes() {
    if (byId('public-store-layout-fixes')) return;

    const style = document.createElement('style');
    style.id = 'public-store-layout-fixes';
    style.textContent = `
      .store-summary-compact{
        display:grid;
        grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);
        align-items:stretch;
        gap:0;
      }
      .store-summary-item{
        display:flex;
        align-items:center;
        justify-content:flex-start;
        gap:12px;
        min-width:0;
        min-height:72px;
        padding:12px 16px;
        color:inherit;
        text-decoration:none;
      }
      .store-summary-item>div{min-width:0}
      .store-summary-item small,.store-summary-item b{display:block}
      .store-summary-item b{overflow-wrap:anywhere}
      .store-summary-divider{align-self:center;width:1px;height:42px;background:var(--border)}
      .store-summary-icon.whatsapp{display:grid!important;background:#e8f7ee;color:#128c4a}
      .store-whatsapp{border-radius:12px}
      .store-whatsapp:hover{background:var(--surface-2)}
      #checkout-modal .modal-card{max-height:min(90vh,760px);overflow-y:auto}
      #checkout-modal .form-grid{display:grid!important}
      #checkout-modal .field:not([hidden]){visibility:visible;opacity:1}
      #checkout-modal input,#checkout-modal select,#checkout-modal textarea{width:100%}
      @media(max-width:760px){
        .store-summary-compact{
          grid-template-columns:repeat(3,minmax(0,1fr));
          align-items:stretch;
        }
        .store-summary-divider{display:none}
        .store-summary-item{
          min-height:86px;
          padding:12px 10px;
          flex-direction:column;
          justify-content:center;
          gap:7px;
          text-align:center;
        }
        .store-summary-item .store-summary-icon{display:grid}
        .store-summary-item small{font-size:10px}
        .store-summary-item b{font-size:14px;line-height:1.2}
      }
      @media(max-width:420px){
        .store-summary-compact{gap:6px}
        .store-summary-item{padding:10px 6px}
        .store-summary-item .store-summary-icon{width:36px;height:36px;flex-basis:36px;border-radius:10px}
        .store-summary-item .store-summary-icon svg{width:20px;height:20px}
      }
    `;
    document.head.appendChild(style);
  }

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
      if (typeof checkout === 'function') checkout();
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

  function ensureCheckoutFields(orderType) {
    const isTable = orderType === 'mesa';
    const isDelivery = orderType === 'delivery';
    const nameField = byId('customer-name')?.closest('.field');
    const phoneField = byId('customer-phone')?.closest('.field');
    const address = byId('customer-address');

    setVisible(nameField, true);
    setVisible(phoneField, true);
    setVisible(byId('address-field'), isDelivery);
    setVisible(byId('region-field'), isDelivery);

    if (address) address.required = isDelivery;
    if (byId('customer-name')) byId('customer-name').required = true;
    if (byId('customer-phone')) byId('customer-phone').required = true;

    const form = byId('checkout-form');
    if (form) {
      form.dataset.checkoutReady = 'true';
      form.dataset.orderType = orderType;
      form.dataset.paymentIntegration = isTable ? 'not-required' : 'ready';
    }
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

    ensureCheckoutFields(orderType);
    setVisible(deliveryField, !isTable);
    setVisible(paymentField, !isTable);
    setVisible(notesField, !isTable);
    setVisible(byId('change-field'), !isTable && paymentMethod?.value === 'Dinheiro');

    setVisible(cartFeeRow, isDelivery, 'flex');
    setVisible(checkoutFeeRow, isDelivery, 'flex');
    setVisible(byId('cart-summary-fee-row'), isDelivery, 'flex');

    setVisible(cartSubtotalRow, !isTable, 'flex');
    setVisible(checkoutSubtotalRow, !isTable, 'flex');
    setVisible(byId('cart-summary-subtotal-row'), !isTable, 'flex');

    const title = byId('checkout-title');
    const feedback = byId('checkout-modal')?.querySelector('.feedback');
    if (isTable) {
      if (title) title.textContent = 'Identifique seu pedido';
      if (feedback) feedback.textContent = 'Informe seu nome e WhatsApp para enviar o pedido à mesa.';
    } else if (isPickup) {
      if (title) title.textContent = 'Finalizar pedido';
      if (feedback) feedback.textContent = 'Informe seus dados e escolha a forma de pagamento. O pedido ficará disponível para retirada no estabelecimento.';
    } else {
      if (title) title.textContent = 'Finalizar pedido';
      if (feedback) feedback.textContent = 'Preencha seus dados, endereço e forma de pagamento. O pedido ficará aguardando confirmação do estabelecimento.';
    }
  }

  function buildPaymentContext() {
    return {
      orderType: currentType(),
      method: byId('payment-method')?.value || '',
      customer: {
        name: byId('customer-name')?.value.trim() || '',
        phone: byId('customer-phone')?.value.replace(/\D/g, '') || ''
      },
      address: byId('customer-address')?.value.trim() || '',
      totals: {
        subtotal: typeof subtotal === 'function' ? subtotal() : 0,
        deliveryFee: typeof fee === 'function' ? fee() : 0,
        total: typeof total === 'function' ? total() : 0
      },
      items: Array.isArray(window.cart) ? window.cart : (typeof cart !== 'undefined' && Array.isArray(cart) ? cart : [])
    };
  }

  function installPaymentAdapter() {
    const form = byId('checkout-form');
    const submit = byId('submit-order-btn');
    if (!form || form.dataset.paymentAdapterBound) return;

    form.dataset.paymentAdapterBound = 'true';
    submit?.setAttribute('data-payment-status', 'pending-integration');
    submit?.setAttribute('data-payment-provider', 'none');

    window.FSDeliveryPayment = Object.freeze({
      version: 1,
      getContext: buildPaymentContext,
      markProcessing(provider = 'app') {
        if (!submit) return;
        submit.dataset.paymentProvider = provider;
        submit.dataset.paymentStatus = 'processing';
      },
      markReady(provider = 'app') {
        if (!submit) return;
        submit.dataset.paymentProvider = provider;
        submit.dataset.paymentStatus = 'ready';
      },
      markFailed(provider = 'app') {
        if (!submit) return;
        submit.dataset.paymentProvider = provider;
        submit.dataset.paymentStatus = 'failed';
      }
    });

    form.addEventListener('submit', () => {
      form.dispatchEvent(new CustomEvent('fsdelivery:checkout-submit', {
        bubbles: true,
        detail: buildPaymentContext()
      }));
    }, true);

    byId('payment-method')?.addEventListener('change', event => {
      form.dispatchEvent(new CustomEvent('fsdelivery:payment-method-change', {
        bubbles: true,
        detail: { method: event.target.value, context: buildPaymentContext() }
      }));
    });
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
    if (!items || typeof cart === 'undefined') return;

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

  const originalRenderCart = typeof window.renderCart === 'function' ? window.renderCart : null;
  if (originalRenderCart) {
    window.renderCart = function (...args) {
      const result = originalRenderCart.apply(this, args);
      renderCartModal();
      applyCheckoutContext();
      return result;
    };
  }

  function bindMobileCart() {
    installPublicStoreLayoutFixes();
    ensureCartModal();
    installPaymentAdapter();

    const button = byId('mobile-cart');
    if (button && !button.dataset.cartModalBound) {
      button.dataset.cartModalBound = 'true';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openCartModal();
      }, true);
    }

    byId('delivery-type')?.addEventListener('change', () => requestAnimationFrame(applyCheckoutContext));
    byId('payment-method')?.addEventListener('change', () => requestAnimationFrame(applyCheckoutContext));
    byId('checkout-btn')?.addEventListener('click', () => requestAnimationFrame(applyCheckoutContext));
    byId('cart-summary-checkout')?.addEventListener('click', () => requestAnimationFrame(applyCheckoutContext));

    const checkoutModal = byId('checkout-modal');
    if (checkoutModal && !checkoutModal.dataset.visibilityObserverBound) {
      checkoutModal.dataset.visibilityObserverBound = 'true';
      new MutationObserver(() => {
        if (checkoutModal.classList.contains('open')) requestAnimationFrame(applyCheckoutContext);
      }).observe(checkoutModal, { attributes: true, attributeFilter: ['class'] });
    }

    applyCheckoutContext();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMobileCart, { once: true });
  } else {
    bindMobileCart();
  }
})();
