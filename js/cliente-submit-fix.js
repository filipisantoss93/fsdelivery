(()=>{
  'use strict';
  if(!/(^|\/)cliente\.html$/i.test(location.pathname))return;
  const form=document.getElementById('customer-lookup-form');
  const input=document.getElementById('lookup-phone');
  if(!form||!input)return;
  form.addEventListener('submit',event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    const phone=String(input.value||'').replace(/\D/g,'');
    if(phone.length<10||phone.length>13){input.focus();return}
    const params=new URLSearchParams(location.search);
    params.set('telefone',phone);
    params.delete('pedido');
    location.replace(`cliente?${params.toString()}`);
  },true);
})();