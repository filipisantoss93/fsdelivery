(()=>{
  'use strict';
  if(window.__fsLojaPublicaConsolidada)return;
  window.__fsLojaPublicaConsolidada=true;

  const db=window.supabaseClient;
  const byId=id=>document.getElementById(id);
  const digits=value=>String(value||'').replace(/\D/g,'');
  const params=new URLSearchParams(location.search);
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bii\b/g,'2').replace(/\biii\b/g,'3').replace(/\biv\b/g,'4').replace(/\b(residencial|bairro|jardim|jd|conjunto|cj|loteamento|lot)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  let sending=false;

  function fields(){
    const labelField=text=>[...document.querySelectorAll('#address-field label')].find(label=>label.textContent.trim().toLowerCase()===text.toLowerCase())?.control||null;
    return {
      cep:byId('customer-cep'),
      street:byId('delivery-street')||byId('customer-street')||byId('address-street')||labelField('Rua'),
      number:byId('delivery-number')||byId('customer-number')||byId('address-number')||labelField('Número'),
      neighborhood:byId('delivery-neighborhood')||byId('customer-neighborhood')||byId('address-neighborhood')||labelField('Bairro'),
      complement:byId('delivery-complement')||byId('customer-complement')||byId('address-complement')||labelField('Complemento ou referência'),
      city:byId('customer-city')||byId('address-city'),
      state:byId('customer-state')||byId('address-state'),
      legacy:byId('customer-address')
    };
  }

  function removeLegacyRegion(){
    byId('region-field')?.remove();
    byId('delivery-region')?.remove();
  }

  function inlineFeedback(message,type='error'){
    const form=byId('checkout-form');
    if(!form){alert(message);return}
    let node=byId('checkout-inline-feedback');
    if(!node){
      node=document.createElement('div');
      node.id='checkout-inline-feedback';
      node.setAttribute('role','alert');
      node.setAttribute('aria-live','assertive');
      form.prepend(node);
    }
    node.hidden=false;
    node.className=`feedback${type==='error'?' error':''}`;
    node.textContent=message;
    node.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function fail(message,field){
    inlineFeedback(message);
    field?.focus({preventScroll:true});
    field?.scrollIntoView({behavior:'smooth',block:'center'});
    return null;
  }

  function resolveRegion(){
    const bairro=String(fields().neighborhood?.value||'').trim();
    if(typeof regions==='undefined'||!Array.isArray(regions)||!regions.length){
      if(typeof selectedRegion!=='undefined')selectedRegion=null;
      return null;
    }
    const target=normalize(bairro);
    const match=target?regions.find(region=>{
      const candidate=normalize(region.nome);
      return candidate===target||candidate.includes(target)||target.includes(candidate);
    })||null:null;
    if(typeof selectedRegion!=='undefined')selectedRegion=match;
    return match;
  }

  function addressData(){
    const f=fields();
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

  function setClosed(closed){
    ['submit-order-btn','checkout-btn','mobile-cart'].forEach(id=>{
      const button=byId(id);
      if(button){button.disabled=closed;button.setAttribute('aria-disabled',String(closed))}
    });
    const submit=byId('submit-order-btn');
    if(submit&&!sending)submit.textContent=closed?'Loja fechada — pedidos indisponíveis':'Revisar e enviar pedido';
  }

  async function available(){
    if(typeof settings==='undefined'||!settings?.id)return false;
    try{
      const {data,error}=await db.rpc('loja_disponivel',{p_estabelecimento:settings.id});
      if(error)throw error;
      settings.aberto=data===true;
    }catch(error){
      console.error('Falha ao verificar disponibilidade:',error);
      inlineFeedback('Não foi possível confirmar se a loja está aberta. Tente novamente.');
      return false;
    }
    setClosed(!settings.aberto);
    return settings.aberto;
  }

  function checkoutToken(){
    const key=`fsdelivery_checkout_${params.get('loja')||'public'}_${params.get('mesa')||'online'}`;
    let token=sessionStorage.getItem(key);
    if(!token){token=crypto.randomUUID();sessionStorage.setItem(key,token)}
    return {key,token};
  }

  async function submit(event){
    event?.preventDefault();
    event?.stopImmediatePropagation();
    if(sending)return;
    removeLegacyRegion();

    const form=byId('checkout-form');
    if(!form)return;
    const button=byId('submit-order-btn');
    sending=true;
    if(typeof submitting!=='undefined')submitting=true;
    if(button){button.disabled=true;button.textContent='Validando e enviando...'}

    try{
      if(!await available())throw new Error('A loja está fechada e não está recebendo pedidos.');
      if(typeof cart==='undefined'||!Array.isArray(cart)||!cart.length)throw new Error('Adicione ao menos um produto ao pedido.');

      const formData=new FormData(form);
      const orderType=typeof type==='function'?type():'delivery';
      const name=String(formData.get('name')||'').trim();
      const phone=digits(formData.get('phone'));
      const payment=String(formData.get('payment')||'').trim();
      const address=addressData();
      const f=fields();

      if(name.length<2)return fail('Informe seu nome.',byId('customer-name'));
      if(phone.length<10||phone.length>13)return fail('Informe um WhatsApp válido.',byId('customer-phone'));
      if(orderType!=='mesa'&&!payment)return fail('Selecione a forma de pagamento.',byId('payment-method'));
      if(orderType==='delivery'){
        if(address.cep.length!==8)return fail('Informe um CEP válido.',f.cep);
        if(address.logradouro.length<3)return fail('Informe a rua da entrega.',f.street);
        if(!address.numero)return fail('Informe o número do endereço.',f.number);
        if(address.bairro.length<2)return fail('Informe o bairro da entrega.',f.neighborhood);
        if(typeof regions!=='undefined'&&regions.length&&!resolveRegion())return fail('Este bairro não está cadastrado na área de entrega da loja.',f.neighborhood);
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
      inlineFeedback(error?.message||'Não foi possível enviar o pedido.');
    }finally{
      sending=false;
      if(typeof submitting!=='undefined')submitting=false;
      if(button){button.disabled=!settings?.aberto;button.textContent=settings?.aberto?'Revisar e enviar pedido':'Loja fechada — pedidos indisponíveis'}
    }
  }

  function bind(){
    removeLegacyRegion();
    const form=byId('checkout-form');
    const button=byId('submit-order-btn');
    if(!form||!button)return false;
    form.noValidate=true;
    form.onsubmit=null;
    form.addEventListener('submit',submit,true);
    button.type='button';
    button.onclick=null;
    button.addEventListener('click',submit,true);
    form.dataset.fsConsolidated='true';
    fields().neighborhood?.addEventListener('change',resolveRegion);
    fields().neighborhood?.addEventListener('input',resolveRegion);
    available();
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(bind()||attempts>50)clearInterval(timer);
  },100);
  window.addEventListener('pageshow',()=>{removeLegacyRegion();available()});
})();