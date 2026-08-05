(()=>{
  'use strict';
  if(!/(^|\/)loja\.html$/i.test(location.pathname))return;
  if(window.__fsLojaPosEnvio)return;
  window.__fsLojaPosEnvio=true;

  const byId=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  const db=window.supabaseClient;
  let lastPhone='';
  let processedCode='';

  const normalizePhone=value=>String(value||'').replace(/\D/g,'');
  const extractCode=text=>String(text||'').match(/Pedido\s+#([^\s.,]+)/i)?.[1]||'';
  const tokenKey=(phone)=>`fsdelivery_customer_token_${slug}_${normalizePhone(phone)}`;

  async function bindCustomerDevice(code,phone){
    if(!db||!slug||!code||normalizePhone(phone).length<10)return;
    try{
      const {data,error}=await db.rpc('vincular_dispositivo_cliente',{p_slug:slug,p_telefone:normalizePhone(phone),p_codigo_pedido:String(code)});
      if(error)throw error;
      if(data)localStorage.setItem(tokenKey(phone),String(data));
    }catch(error){
      console.warn('Não foi possível vincular o dispositivo do cliente:',error);
    }
  }

  function enhanceSuccess(){
    const modal=byId('success-modal');
    const message=byId('success-message');
    const link=byId('track-order-link');
    if(!modal?.classList.contains('open')||!message||!link)return;
    const code=extractCode(message.textContent);
    const phone=lastPhone||normalizePhone(byId('customer-phone')?.value);
    if(!message.dataset.fsStatusEnhanced){
      if(!/aguardando confirmação/i.test(message.textContent))message.textContent=`${message.textContent} Status: aguardando confirmação do restaurante.`;
      message.dataset.fsStatusEnhanced='true';
    }
    if(slug){
      const query=new URLSearchParams({loja:slug});
      if(phone)query.set('telefone',phone);
      if(code)query.set('pedido',code);
      link.href=`cliente.html?${query.toString()}`;
    }
    try{
      localStorage.setItem(`fsdelivery_last_order_${slug||'public'}`,JSON.stringify({codigo:code,telefone:phone,criado_em:new Date().toISOString()}));
    }catch{}
    if(code&&code!==processedCode){
      processedCode=code;
      bindCustomerDevice(code,phone);
      document.dispatchEvent(new CustomEvent('fs:public-order-created',{detail:{slug,codigo:code,telefone:phone}}));
    }
  }

  function install(){
    const form=byId('checkout-form');
    const modal=byId('success-modal');
    if(!form||!modal)return false;
    form.addEventListener('submit',()=>{
      lastPhone=normalizePhone(byId('customer-phone')?.value);
      requestAnimationFrame(()=>setTimeout(enhanceSuccess,0));
    },true);
    modal.addEventListener('transitionend',enhanceSuccess);
    document.addEventListener('click',event=>{
      if(event.target.closest?.('#checkout-form button[type="submit"],#checkout-form .btn-primary'))setTimeout(enhanceSuccess,150);
    });
    return true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
