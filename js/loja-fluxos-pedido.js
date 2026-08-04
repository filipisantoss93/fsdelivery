(()=>{
  if(!/(^|\/)loja\.html$/i.test(location.pathname))return;
  const byId=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const tableMode=params.has('mesa');
  let confirmedSubmission=false;

  function installStyles(){
    if(byId('fs-public-order-audit-style'))return;
    const style=document.createElement('style');
    style.id='fs-public-order-audit-style';
    style.textContent=`
      .fs-order-mode-hint{margin:0 0 12px;padding:11px 13px;border:1px solid var(--store-line);border-radius:11px;background:var(--surface-2);color:var(--store-muted);font-size:13px}
      .fs-fee-row[hidden]{display:none!important}
      @media(max-width:760px){
        .store-modal{align-items:end;padding:0}
        .store-modal .modal-card{width:100%;max-height:calc(100dvh - 88px);padding:18px 18px calc(18px + env(safe-area-inset-bottom));border-radius:22px 22px 0 0;overscroll-behavior:contain}
        .store-modal .modal-head{margin-bottom:12px}
        .store-modal .modal-head h2{font-size:27px}
        .store-modal .row-card{min-height:54px;padding:11px 13px}
        .store-modal .cart-total{padding:14px 0;margin-top:8px}
        .store-modal .btn-block{min-height:52px}
        .cart-item{padding:10px 0}
      }
    `;
    document.head.appendChild(style);
  }

  function markFeeRows(){
    ['cart-delivery-fee','checkout-delivery-fee'].forEach(id=>{
      const value=byId(id);if(!value)return;
      value.closest('.row-card')?.classList.add('fs-fee-row');
    });
  }

  function moneyText(id){return byId(id)?.textContent?.trim()||'R$ 0,00'}

  function install(){
    const type=byId('delivery-type'),form=byId('checkout-form'),addressField=byId('address-field');
    if(!type||!form||!addressField)return false;
    if(form.dataset.fsPublicOrderAudit==='true')return true;
    form.dataset.fsPublicOrderAudit='true';
    installStyles();markFeeRows();

    const submit=byId('submit-order-btn');
    if(submit)submit.textContent='Revisar e enviar pedido';

    if(tableMode){
      type.innerHTML='<option value="mesa">Pedido nesta mesa</option>';
      addressField.hidden=true;addressField.style.display='none';
      byId('region-field')?.setAttribute('hidden','');
      document.querySelectorAll('.fs-fee-row').forEach(row=>row.hidden=true);
    }else{
      type.innerHTML='<option value="" selected disabled>Selecione entrega ou retirada</option><option value="delivery">Entrega</option><option value="pickup">Retirada no balcão</option>';
      type.value='';

      if(!byId('order-mode-hint')){
        const hint=document.createElement('p');hint.id='order-mode-hint';hint.className='fs-order-mode-hint';hint.textContent='Escolha como deseja receber para calcular o total corretamente.';
        type.closest('.field')?.insertAdjacentElement('afterend',hint);
      }

      if(!byId('online-address-fields')){
        const host=document.createElement('div');host.id='online-address-fields';host.className='form-grid';
        host.innerHTML='<div class="field full"><label for="delivery-street">Rua</label><input id="delivery-street" autocomplete="street-address"></div><div class="field"><label for="delivery-number">Número</label><input id="delivery-number" inputmode="numeric"></div><div class="field"><label for="delivery-neighborhood">Bairro</label><input id="delivery-neighborhood"></div><div class="field full"><label for="delivery-complement">Complemento ou referência</label><input id="delivery-complement"></div>';
        const textarea=addressField.querySelector('textarea,[name="address"]');
        if(textarea){textarea.hidden=true;textarea.required=false;addressField.appendChild(host)}
      }

      const sync=()=>{
        const selected=type.value;
        const delivery=selected==='delivery';
        const pickup=selected==='pickup';
        addressField.hidden=!delivery;addressField.style.display=delivery?'grid':'none';
        const region=byId('region-field');if(region){region.hidden=!delivery;region.style.display=delivery?'grid':'none'}
        ['delivery-street','delivery-number','delivery-neighborhood'].forEach(id=>{const input=byId(id);if(input)input.required=delivery});
        document.querySelectorAll('.fs-fee-row').forEach(row=>row.hidden=!delivery);
        const context=byId('order-context-label');if(context)context.textContent=delivery?'Pedido on-line • Entrega':pickup?'Pedido on-line • Retirada':'Pedido on-line';
        const hint=byId('order-mode-hint');if(hint)hint.hidden=Boolean(selected);
        confirmedSubmission=false;
        if(typeof window.updateTotal==='function')window.updateTotal();
      };

      type.addEventListener('change',sync);
      sync();

      const requireMode=event=>{
        if(type.value)return;
        event.preventDefault();event.stopImmediatePropagation();
        alert('Escolha Entrega ou Retirada antes de continuar.');
        type.focus();
      };
      byId('checkout-btn')?.addEventListener('click',requireMode,true);
      byId('mobile-cart')?.addEventListener('click',requireMode,true);
    }

    form.addEventListener('submit',event=>{
      if(!tableMode&&!type.value){event.preventDefault();event.stopImmediatePropagation();alert('Escolha Entrega ou Retirada.');return}

      if(type.value==='delivery'){
        const street=byId('delivery-street')?.value.trim()||'',number=byId('delivery-number')?.value.trim()||'',neighborhood=byId('delivery-neighborhood')?.value.trim()||'',complement=byId('delivery-complement')?.value.trim()||'';
        if(!street||!number||!neighborhood){event.preventDefault();event.stopImmediatePropagation();alert('Informe rua, número e bairro para entrega.');return}
        const textarea=addressField.querySelector('textarea,[name="address"]');if(textarea)textarea.value=[street,number,neighborhood,complement].filter(Boolean).join(', ');
      }

      if(confirmedSubmission)return;
      const mode=tableMode?'Pedido na mesa':type.value==='delivery'?'Entrega':'Retirada no balcão';
      const payment=byId('payment-method')?.value||'Não informado';
      const message=`Confirmar pedido?\n\nModalidade: ${mode}\nPagamento: ${payment}\nTotal: ${moneyText('checkout-total')}\n\nApós o envio, o pedido on-line ficará aguardando confirmação do restaurante.`;
      if(!confirm(message)){event.preventDefault();event.stopImmediatePropagation();return}
      confirmedSubmission=true;
      if(submit){submit.disabled=true;submit.textContent='Enviando pedido...'}
      setTimeout(()=>{if(submit&&confirmedSubmission){submit.disabled=false;submit.textContent='Revisar e enviar pedido';confirmedSubmission=false}},12000);
    },true);
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{attempts++;if(install()||attempts>40)clearInterval(timer)},150);
})();