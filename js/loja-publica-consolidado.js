(()=>{
  'use strict';
  if(window.__fsLojaPublicaConsolidada)return;
  window.__fsLojaPublicaConsolidada=true;

  const db=window.supabaseClient;
  const byId=id=>document.getElementById(id);
  const digits=value=>String(value||'').replace(/\D/g,'');
  const params=new URLSearchParams(location.search);
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bii\b/g,'2').replace(/\biii\b/g,'3').replace(/\biv\b/g,'4').replace(/\b(residencial|bairro|jardim|jd|conjunto|cj|loteamento|lot)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

  function addressFields(){
    return {
      cep:byId('customer-cep'),
      street:byId('delivery-street')||byId('customer-street')||byId('address-street'),
      number:byId('delivery-number')||byId('customer-number')||byId('address-number'),
      neighborhood:byId('delivery-neighborhood')||byId('customer-neighborhood')||byId('address-neighborhood'),
      complement:byId('delivery-complement')||byId('customer-complement')||byId('address-complement'),
      city:byId('customer-city')||byId('address-city'),
      state:byId('customer-state')||byId('address-state'),
      legacy:byId('customer-address')
    };
  }

  function removeLegacyRegionField(){
    const field=byId('region-field');
    if(field)field.remove();
  }

  function resolveDeliveryRegion(){
    const bairro=String(addressFields().neighborhood?.value||'').trim();
    if(typeof regions==='undefined'||!Array.isArray(regions)||!regions.length){
      if(typeof selectedRegion!=='undefined')selectedRegion=null;
      return null;
    }
    const target=normalize(bairro);
    const match=regions.find(region=>{
      const candidate=normalize(region.nome);
      return candidate===target||candidate.includes(target)||target.includes(candidate);
    })||null;
    if(typeof selectedRegion!=='undefined')selectedRegion=match;
    return match;
  }

  function structuredAddress(){
    const f=addressFields();
    const data={
      cep:digits(f.cep?.value),
      logradouro:String(f.street?.value||'').trim(),
      numero:String(f.number?.value||'').trim(),
      bairro:String(f.neighborhood?.value||'').trim(),
      complemento:String(f.complement?.value||'').trim(),
      cidade:String(f.city?.value||f.street?.dataset.cidade||'').trim(),
      estado:String(f.state?.value||f.street?.dataset.uf||'').trim()
    };
    data.texto=[data.logradouro,data.numero,data.complemento,data.bairro,data.cidade,data.estado,data.cep?`CEP ${data.cep}`:''].filter(Boolean).join(', ');
    if(f.legacy)f.legacy.value=data.texto;
    return data;
  }

  function feedback(message,field){
    if(typeof setFeedback==='function')setFeedback(message,'error',0);
    else alert(message);
    field?.focus({preventScroll:true});
    field?.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function setStoreClosed(closed){
    ['submit-order-btn','checkout-btn','mobile-cart'].forEach(id=>{
      const button=byId(id);
      if(button){button.disabled=closed;button.setAttribute('aria-disabled',String(closed))}
    });
    const submit=byId('submit-order-btn');
    if(submit)submit.textContent=closed?'Loja fechada — pedidos indisponíveis':'Revisar e enviar pedido';
  }

  async function storeAvailable(){
    if(typeof settings==='undefined'||!settings?.id)return false;
    try{
      const {data,error}=await db.rpc('loja_disponivel',{p_estabelecimento:settings.id});
      if(error)throw error;
      settings.aberto=Boolean(settings.aberto&&data!==false);
    }catch(error){
      console.error('Falha ao verificar disponibilidade:',error);
      settings.aberto=false;
    }
    setStoreClosed(!settings.aberto);
    return settings.aberto;
  }

  function checkoutToken(){
    const key=`fsdelivery_checkout_${params.get('loja')||'public'}_${params.get('mesa')||'online'}`;
    let token=sessionStorage.getItem(key);
    if(!token){token=crypto.randomUUID();sessionStorage.setItem(key,token)}
    return {key,token};
  }

  async function submitOrder(event){
    event.preventDefault();
    if(typeof submitting!=='undefined'&&submitting)return;
    if(!await storeAvailable())return feedback('A loja está fechada e não está recebendo pedidos.',byId('submit-order-btn'));
    if(typeof cart==='undefined'||!cart.length)return feedback('Adicione ao menos um produto ao pedido.',byId('checkout-btn'));

    const form=event.currentTarget;
    const formData=new FormData(form);
    const orderType=typeof type==='function'?type():'delivery';
    const name=String(formData.get('name')||'').trim();
    const phone=digits(formData.get('phone'));
    const payment=String(formData.get('payment')||'').trim();
    const address=structuredAddress();
    const fields=addressFields();

    if(name.length<2)return feedback('Informe seu nome.',byId('customer-name'));
    if(phone.length<10||phone.length>13)return feedback('Informe um WhatsApp válido.',byId('customer-phone'));
    if(orderType!=='mesa'&&!payment)return feedback('Selecione a forma de pagamento.',byId('payment-method'));
    if(orderType==='delivery'){
      if(address.cep.length!==8)return feedback('Informe um CEP válido.',fields.cep);
      if(address.logradouro.length<3)return feedback('Informe a rua da entrega.',fields.street);
      if(!address.numero)return feedback('Informe o número do endereço.',fields.number);
      if(address.bairro.length<2)return feedback('Informe o bairro da entrega.',fields.neighborhood);
      if(typeof regions!=='undefined'&&regions.length&&!resolveDeliveryRegion())return feedback('Este bairro não está cadastrado na área de entrega da loja.',fields.neighborhood);
    }

    const checkout=checkoutToken();
    const payload={
      slug:typeof slug!=='undefined'?slug:params.get('loja'),
      nome:name,
      telefone:phone,
      tipo:orderType,
      endereco:orderType==='delivery'?address.texto:null,
      endereco_dados:orderType==='delivery'?address:null,
      cep:address.cep,
      pagamento:payment,
      troco_para:payment==='Dinheiro'?String(formData.get('change')||'').replace(',','.').trim()||null:null,
      observacoes:String(formData.get('notes')||'').trim(),
      mesa_token:typeof tableToken!=='undefined'?tableToken:null,
      cupom:typeof appliedCoupon!=='undefined'?appliedCoupon:'',
      checkout_token:checkout.token,
      itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))
    };

    const button=byId('submit-order-btn');
    if(typeof submitting!=='undefined')submitting=true;
    if(button){button.disabled=true;button.textContent='Validando e enviando...'}
    try{
      const {data:orderCode,error}=await db.rpc('criar_pedido_publico',{payload});
      if(error)throw error;
      sessionStorage.removeItem(checkout.key);
      if(typeof saveCustomer==='function')saveCustomer(formData);
      if(typeof close==='function')close();
      if(byId('success-message'))byId('success-message').textContent=`Pedido #${orderCode} enviado com sucesso. Aguarde a confirmação do estabelecimento.`;
      cart=[];
      if(typeof saveCart==='function')saveCart();
      if(typeof renderCart==='function')renderCart();
      if(typeof open==='function')open('success-modal');
    }catch(error){
      console.error('Falha ao enviar pedido público:',error);
      feedback(error?.message||'Não foi possível enviar o pedido.',button);
    }finally{
      if(typeof submitting!=='undefined')submitting=false;
      if(button){button.disabled=!settings?.aberto;button.textContent=settings?.aberto?'Revisar e enviar pedido':'Loja fechada — pedidos indisponíveis'}
    }
  }

  function install(){
    removeLegacyRegionField();
    const neighborhood=addressFields().neighborhood;
    neighborhood?.addEventListener('input',()=>{resolveDeliveryRegion();if(typeof updateTotal==='function')updateTotal()});
    neighborhood?.addEventListener('change',()=>{resolveDeliveryRegion();if(typeof updateTotal==='function')updateTotal()});
    const form=byId('checkout-form');
    if(form){form.onsubmit=submitOrder;form.dataset.fsConsolidated='true'}
    storeAvailable();
    window.addEventListener('pageshow',()=>{removeLegacyRegionField();storeAvailable()});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();