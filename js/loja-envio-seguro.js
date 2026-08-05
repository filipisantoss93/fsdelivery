(()=>{
  'use strict';
  if(window.__fsLojaEnvioSeguro)return;
  window.__fsLojaEnvioSeguro=true;

  const byId=id=>document.getElementById(id);
  const digits=value=>String(value||'').replace(/\D/g,'');
  const params=new URLSearchParams(location.search);
  const fieldByLabel=text=>[...document.querySelectorAll('#address-field label')].find(label=>label.textContent.trim().toLowerCase()===text.toLowerCase())?.control||null;
  const fields=()=>({
    cep:byId('customer-cep'),
    street:byId('delivery-street')||byId('customer-street')||byId('address-street')||fieldByLabel('Rua'),
    number:byId('delivery-number')||byId('customer-number')||byId('address-number')||fieldByLabel('Número'),
    neighborhood:byId('delivery-neighborhood')||byId('customer-neighborhood')||byId('address-neighborhood')||fieldByLabel('Bairro'),
    complement:byId('delivery-complement')||byId('customer-complement')||byId('address-complement')||fieldByLabel('Complemento ou referência'),
    city:byId('customer-city')||byId('address-city'),
    state:byId('customer-state')||byId('address-state'),
    legacy:byId('customer-address')
  });

  function checkoutToken(){
    const key=`fsdelivery_checkout_${params.get('loja')||'public'}_${params.get('mesa')||'online'}`;
    let token=sessionStorage.getItem(key);
    if(!token){token=crypto.randomUUID();sessionStorage.setItem(key,token)}
    return {key,token};
  }

  function addressPayload(){
    const f=fields();
    const selected=byId('public-saved-addresses')?.querySelector('select')?.value||null;
    const structured={
      id:selected||null,
      cep:digits(f.cep?.value),
      logradouro:String(f.street?.value||'').trim(),
      numero:String(f.number?.value||'').trim(),
      bairro:String(f.neighborhood?.value||'').trim(),
      complemento:String(f.complement?.value||'').trim(),
      cidade:String(f.city?.value||f.street?.dataset.cidade||'').trim(),
      estado:String(f.state?.value||f.street?.dataset.uf||'').trim()
    };
    structured.texto=[structured.logradouro,structured.numero,structured.complemento,structured.bairro,structured.cidade,structured.estado,structured.cep?`CEP ${structured.cep}`:''].filter(Boolean).join(', ');
    if(f.legacy)f.legacy.value=structured.texto;
    return structured;
  }

  function setClosedState(closed){
    const submit=byId('submit-order-btn');
    const checkout=byId('checkout-btn');
    const cartCheckout=byId('cart-summary-checkout');
    const mobile=byId('mobile-cart');
    [submit,checkout,cartCheckout,mobile].filter(Boolean).forEach(button=>{
      button.disabled=closed;
      button.setAttribute('aria-disabled',String(closed));
    });
    if(submit){
      if(closed){submit.dataset.openLabel=submit.dataset.openLabel||submit.textContent;submit.textContent='Loja fechada — pedidos indisponíveis'}
      else if(submit.dataset.openLabel){submit.textContent=submit.dataset.openLabel;delete submit.dataset.openLabel}
    }
  }

  async function refreshStoreAvailability(){
    if(typeof settings==='undefined'||!settings)return false;
    try{
      const {data,error}=await window.supabaseClient.rpc('loja_disponivel',{p_estabelecimento:settings.id});
      if(error)throw error;
      settings.aberto=Boolean(settings.aberto&&data!==false);
    }catch(error){
      console.warn('Não foi possível confirmar disponibilidade da loja:',error);
      settings.aberto=false;
    }
    setClosedState(!settings.aberto);
    const status=byId('public-store-status');
    if(status){status.textContent=settings.aberto?'Aberto agora':'Fechado agora';status.classList.toggle('is-open',settings.aberto);status.classList.toggle('is-closed',!settings.aberto)}
    if(byId('closed-notice'))byId('closed-notice').hidden=settings.aberto;
    return settings.aberto;
  }

  function showValidationError(message,field){
    if(typeof setFeedback==='function')setFeedback(message,'error',0);
    else alert(message);
    field?.focus({preventScroll:true});
    field?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function validate(formData,orderType,address){
    const f=fields();
    const name=String(formData.get('name')||'').trim();
    const phone=digits(formData.get('phone'));
    const payment=String(formData.get('payment')||'').trim();
    if(name.length<2){showValidationError('Informe seu nome.',byId('customer-name'));return null}
    if(phone.length<10||phone.length>13){showValidationError('Informe um WhatsApp válido.',byId('customer-phone'));return null}
    if(orderType!=='mesa'&&!payment){showValidationError('Selecione a forma de pagamento.',byId('payment-method'));return null}
    if(orderType==='delivery'){
      if(address.cep.length!==8){showValidationError('Informe um CEP válido.',f.cep);return null}
      if(address.logradouro.length<3){showValidationError('Informe a rua da entrega.',f.street);return null}
      if(!address.numero){showValidationError('Informe o número do endereço.',f.number);return null}
      if(address.bairro.length<2){showValidationError('Informe o bairro da entrega.',f.neighborhood);return null}
      if(typeof regions!=='undefined'&&regions.length&&typeof selectedRegion!=='undefined'&&!selectedRegion){showValidationError('Selecione o bairro ou região de entrega.',byId('delivery-region'));return null}
    }
    return {name,phone,payment};
  }

  async function secureSubmit(event){
    event.preventDefault();
    if(typeof submitting!=='undefined'&&submitting)return;
    const available=await refreshStoreAvailability();
    if(!available){showValidationError('A loja está fechada e não está recebendo pedidos.',byId('submit-order-btn'));return}
    if(typeof cart==='undefined'||!cart.length){showValidationError('Adicione ao menos um produto ao pedido.',byId('checkout-btn'));return}

    const form=event.currentTarget;
    const formData=new FormData(form);
    const orderType=typeof type==='function'?type():'delivery';
    const address=addressPayload();
    const valid=validate(formData,orderType,address);
    if(!valid)return;

    const checkout=checkoutToken();
    const payload={
      slug:typeof slug!=='undefined'?slug:params.get('loja'),
      nome:valid.name,
      telefone:valid.phone,
      tipo:orderType,
      endereco:orderType==='delivery'?address.texto:null,
      endereco_dados:orderType==='delivery'?address:null,
      bairro:orderType==='delivery'?(typeof selectedRegion!=='undefined'&&selectedRegion?.nome?selectedRegion.nome:address.bairro):'',
      cep:address.cep,
      pagamento:valid.payment,
      troco_para:valid.payment==='Dinheiro'?String(formData.get('change')||'').replace(',','.').trim()||null:null,
      observacoes:String(formData.get('notes')||'').trim(),
      mesa_token:typeof tableToken!=='undefined'?tableToken:null,
      cupom:typeof appliedCoupon!=='undefined'?appliedCoupon:'',
      checkout_token:checkout.token,
      itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))
    };

    const button=byId('submit-order-btn');
    const original=button?.textContent||'Revisar e enviar pedido';
    if(typeof submitting!=='undefined')submitting=true;
    if(button){button.disabled=true;button.textContent='Validando e enviando...'}
    try{
      const {data:orderCode,error}=await window.supabaseClient.rpc('criar_pedido_publico',{payload});
      if(error)throw error;
      if(typeof saveCustomer==='function')saveCustomer(formData);
      sessionStorage.removeItem(checkout.key);
      if(typeof close==='function')close();
      const message=byId('success-message');
      if(message)message.textContent=`Pedido #${orderCode} enviado com sucesso. Aguarde a confirmação do estabelecimento.`;
      if(typeof cart!=='undefined')cart=[];
      if(typeof saveCart==='function')saveCart();
      if(typeof renderCart==='function')renderCart();
      if(typeof open==='function')open('success-modal');
      document.dispatchEvent(new CustomEvent('fs:public-order-created',{detail:{slug:payload.slug,codigo:String(orderCode),telefone:valid.phone}}));
    }catch(error){
      console.error('Falha no envio seguro do pedido:',error);
      showValidationError(error?.message||'Não foi possível enviar o pedido. Revise os dados e tente novamente.',button);
    }finally{
      if(typeof submitting!=='undefined')submitting=false;
      if(button){button.disabled=!settings?.aberto;button.textContent=settings?.aberto?original:'Loja fechada — pedidos indisponíveis'}
    }
  }

  function install(){
    const form=byId('checkout-form');
    if(!form||form.dataset.fsSecureSubmitBound==='true')return;
    form.dataset.fsSecureSubmitBound='true';
    form.onsubmit=secureSubmit;
    refreshStoreAvailability();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshStoreAvailability()});
    window.addEventListener('pageshow',refreshStoreAvailability);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();