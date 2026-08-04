(()=>{
  if(!/(^|\/)loja\.html$/i.test(location.pathname))return;
  const byId=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  let lastSubmitting=false;

  function normalizePhone(value){return String(value||'').replace(/\D/g,'')}
  function extractCode(text){return String(text||'').match(/Pedido\s+#([^\s.,]+)/i)?.[1]||''}

  function enhanceSuccess(){
    const modal=byId('success-modal');
    const message=byId('success-message');
    const link=byId('track-order-link');
    if(!modal?.classList.contains('open')||!message||!link)return;
    const code=extractCode(message.textContent);
    const phone=normalizePhone(byId('customer-phone')?.value);
    if(!message.dataset.fsStatusEnhanced){
      message.textContent=`${message.textContent} Status: aguardando confirmação do restaurante.`;
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
  }

  function install(){
    const form=byId('checkout-form');
    const modal=byId('success-modal');
    if(!form||!modal)return false;
    form.addEventListener('submit',()=>{lastSubmitting=true;setTimeout(()=>lastSubmitting=false,15000)},true);
    const observer=new MutationObserver(()=>{if(lastSubmitting||modal.classList.contains('open'))enhanceSuccess()});
    observer.observe(modal,{attributes:true,attributeFilter:['class'],subtree:true,childList:true,characterData:true});
    enhanceSuccess();
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{attempts++;if(install()||attempts>40)clearInterval(timer)},150);
})();