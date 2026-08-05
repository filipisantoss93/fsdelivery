(() => {
  const byId = id => document.getElementById(id);

  function installStyles() {
    if (byId('public-store-layout-fixes')) return;
    const style = document.createElement('style');
    style.id = 'public-store-layout-fixes';
    style.textContent = `
      .store-summary-compact{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);align-items:stretch;gap:0}
      .store-summary-item{display:flex;align-items:center;justify-content:flex-start;gap:12px;min-width:0;min-height:72px;padding:12px 16px;color:inherit;text-decoration:none}
      .store-summary-item>div{min-width:0}.store-summary-item small,.store-summary-item b{display:block}.store-summary-item b{overflow-wrap:anywhere}
      .store-summary-divider{align-self:center;width:1px;height:42px;background:var(--border)}
      .store-summary-icon.whatsapp{display:grid!important;background:#e8f7ee;color:#128c4a}.store-whatsapp{border-radius:12px}
      #checkout-modal .modal-card{max-height:90vh;overflow-y:auto}#checkout-modal .form-grid{display:grid!important}
      #checkout-modal input,#checkout-modal select,#checkout-modal textarea{width:100%}
      @media(max-width:760px){.store-summary-compact{grid-template-columns:repeat(3,minmax(0,1fr))}.store-summary-divider{display:none}.store-summary-item{min-height:86px;padding:12px 10px;flex-direction:column;justify-content:center;gap:7px;text-align:center}.store-summary-item .store-summary-icon{display:grid}.store-summary-item small{font-size:10px}.store-summary-item b{font-size:14px;line-height:1.2}}
      @media(max-width:420px){.store-summary-compact{gap:6px}.store-summary-item{padding:10px 6px}.store-summary-item .store-summary-icon{width:36px;height:36px;flex-basis:36px;border-radius:10px}.store-summary-item .store-summary-icon svg{width:20px;height:20px}}
    `;
    document.head.appendChild(style);
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
    } else element.style.setProperty('display', 'none', 'important');
  }

  function syncCheckout() {
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
    setVisible(byId('checkout-delivery-fee')?.closest('.row-card'), isDelivery, 'flex');
    setVisible(byId('cart-delivery-fee')?.closest('.row-card'), isDelivery, 'flex');
    setVisible(byId('cart-summary-fee-row'), isDelivery, 'flex');

    const address = byId('customer-address');
    if (address) address.required = isDelivery;

    const title = byId('checkout-title');
    const feedback = byId('checkout-modal')?.querySelector('.feedback');
    if (isTable) {
      if (title) title.textContent = 'Identifique seu pedido';
      if (feedback) feedback.textContent = 'Informe seu nome e WhatsApp para enviar o pedido à mesa.';
    } else if (orderType === 'pickup') {
      if (title) title.textContent = 'Finalizar pedido';
      if (feedback) feedback.textContent = 'Informe seus dados e escolha a forma de pagamento para retirada.';
    } else {
      if (title) title.textContent = 'Finalizar pedido';
      if (feedback) feedback.textContent = 'Selecione sua região, informe o endereço e escolha a forma de pagamento.';
    }
  }

  function openCheckoutForm(event) {
    event?.preventDefault();
    event?.stopImmediatePropagation();

    if (typeof settings === 'undefined' || !settings?.aberto) return typeof setFeedback === 'function' && setFeedback('A loja está fechada no momento.', 'error');
    if (typeof cart === 'undefined' || !cart.length) return typeof setFeedback === 'function' && setFeedback('Adicione ao menos um produto ao pedido.', 'error');
    if (typeof table !== 'undefined' && !table && typeof subtotal === 'function' && subtotal() < Number(settings.pedido_minimo)) {
      return typeof setFeedback === 'function' && setFeedback(`O pedido mínimo é ${money(settings.pedido_minimo)}.`, 'error');
    }

    if (typeof updateTotal === 'function') updateTotal();
    if (typeof open === 'function') open('checkout-modal');
    else byId('checkout-modal')?.classList.add('open');
    requestAnimationFrame(() => {
      syncCheckout();
      (currentType() === 'delivery' ? byId('delivery-region') : byId('customer-name'))?.focus({preventScroll:true});
    });
  }

  function closeCartModal() {
    byId('cart-summary-modal')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  function ensureCartModal() {
    if (byId('cart-summary-modal')) return;
    const modal = document.createElement('div');
    modal.className = 'modal store-modal';
    modal.id = 'cart-summary-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `<div class="modal-card cart-summary-modal-card"><div class="modal-head"><div><small id="cart-summary-context">Pedido on-line</small><h2>Seu pedido</h2></div><button class="icon-btn" data-cart-modal-close type="button" aria-label="Fechar">×</button></div><div id="cart-summary-items"></div><div class="row-card" id="cart-summary-subtotal-row"><span>Subtotal</span><b id="cart-summary-subtotal">R$ 0,00</b></div><div class="row-card" id="cart-summary-fee-row"><span>Taxa de entrega</span><b id="cart-summary-fee">R$ 0,00</b></div><div class="cart-total"><span>Total</span><span id="cart-summary-total">R$ 0,00</span></div><small id="cart-summary-minimum"></small><button class="btn btn-primary btn-block" id="cart-summary-checkout" type="button">Continuar pedido</button></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal || event.target.closest('[data-cart-modal-close]')) closeCartModal(); });
    byId('cart-summary-checkout').onclick = event => { closeCartModal(); openCheckoutForm(event); };
  }

  function bindModalActions() {
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
    if (typeof cart === 'undefined') return;
    const items = byId('cart-summary-items');
    items.innerHTML = cart.length ? cart.map(item => `<div class="cart-item"><div class="cart-item-line"><b>${item.qty}x ${escapeHtml(item.name)}</b><b>${money(item.qty * item.price)}</b></div>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}<div class="inline-actions"><button class="btn btn-secondary" data-modal-minus="${escapeHtml(item.cartId)}" type="button">−</button><button class="btn btn-secondary" data-modal-plus="${escapeHtml(item.cartId)}" type="button">+</button><button class="link-button" data-modal-remove="${escapeHtml(item.cartId)}" type="button">Remover</button></div></div>`).join('') : '<div class="cart-empty">Seu carrinho está vazio.</div>';
    byId('cart-summary-context').textContent = byId('order-context-label')?.textContent || 'Pedido on-line';
    byId('cart-summary-subtotal').textContent = money(subtotal());
    byId('cart-summary-fee').textContent = money(fee());
    byId('cart-summary-total').textContent = money(total());
    byId('cart-summary-minimum').textContent = byId('minimum-order-hint')?.textContent || '';
    byId('cart-summary-checkout').disabled = !cart.length;
    syncCheckout();
    bindModalActions();
  }

  function openCartModal() {
    renderCartModal();
    byId('cart-summary-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function installPaymentAdapter() {
    const form = byId('checkout-form');
    const submit = byId('submit-order-btn');
    if (!form || form.dataset.paymentAdapterBound) return;
    form.dataset.paymentAdapterBound = 'true';
    submit?.setAttribute('data-payment-status', 'pending-integration');
    window.FSDeliveryPayment = Object.freeze({
      version: 1,
      getContext: () => ({orderType:currentType(),method:byId('payment-method')?.value||'',customer:{name:byId('customer-name')?.value.trim()||'',phone:byId('customer-phone')?.value.replace(/\D/g,'')||''},address:byId('customer-address')?.value.trim()||'',totals:{subtotal:subtotal(),deliveryFee:fee(),total:total()}}),
      markProcessing: provider => { if (submit) { submit.dataset.paymentProvider = provider || 'app'; submit.dataset.paymentStatus = 'processing'; } },
      markReady: provider => { if (submit) { submit.dataset.paymentProvider = provider || 'app'; submit.dataset.paymentStatus = 'ready'; } },
      markFailed: provider => { if (submit) { submit.dataset.paymentProvider = provider || 'app'; submit.dataset.paymentStatus = 'failed'; } }
    });
  }

  function bind() {
    installStyles();
    ensureCartModal();
    installPaymentAdapter();

    const checkoutButton = byId('checkout-btn');
    if (checkoutButton) checkoutButton.onclick = openCheckoutForm;

    const mobile = byId('mobile-cart');
    if (mobile) {
      mobile.onclick = null;
      mobile.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); openCartModal(); }, true);
    }

    byId('delivery-type')?.addEventListener('change', () => requestAnimationFrame(syncCheckout));
    byId('payment-method')?.addEventListener('change', () => requestAnimationFrame(syncCheckout));

    const observer = new MutationObserver(() => {
      if (byId('checkout-modal')?.classList.contains('open')) requestAnimationFrame(syncCheckout);
    });
    if (byId('checkout-modal')) observer.observe(byId('checkout-modal'), {attributes:true,attributeFilter:['class']});
    syncCheckout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
})();
