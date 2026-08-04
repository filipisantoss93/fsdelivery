(()=>{
  const byId=id=>document.getElementById(id);
  let applying=false;
  let scheduled=false;

  function enforce(){
    if(applying)return;
    applying=true;
    try{
      const type=byId('waiter-type');
      if(type){
        const valid=type.options.length===1&&type.options[0]?.value==='mesa';
        if(!valid)type.innerHTML='<option value="mesa">Mesa</option>';
        const changed=type.value!=='mesa';
        if(changed)type.value='mesa';
        const field=type.closest('.field');
        if(field&&!field.hidden)field.hidden=true;
        if(changed)type.dispatchEvent(new Event('change',{bubbles:true}));
      }

      const tableField=byId('waiter-table-field');
      if(tableField&&tableField.hidden)tableField.hidden=false;
      const addressField=byId('waiter-address-field');
      if(addressField&&!addressField.hidden)addressField.hidden=true;

      const noTable=!byId('waiter-table')?.value;
      const title=byId('waiter-menu-title');
      if(title&&noTable&&title.textContent!=='Novo pedido na mesa')title.textContent='Novo pedido na mesa';
      const subtitle=byId('waiter-menu-subtitle');
      const subtitleText='Selecione uma mesa para iniciar o atendimento.';
      if(subtitle&&noTable&&subtitle.textContent!==subtitleText)subtitle.textContent=subtitleText;

      document.querySelectorAll('[data-order-scope="online"]').forEach(button=>button.remove());
      const localScope=document.querySelector('[data-order-scope="local"]');
      if(localScope){
        if(localScope.textContent!=='Pedidos das mesas')localScope.textContent='Pedidos das mesas';
        if(!localScope.classList.contains('active')&&localScope.dataset.fsSalaoActivated!=='true'){
          localScope.dataset.fsSalaoActivated='true';
          localScope.click();
        }
      }
      const scopeBar=document.querySelector('.waiter-order-tabs');
      if(scopeBar&&scopeBar.children.length<=1&&!scopeBar.hidden)scopeBar.hidden=true;
    }finally{
      applying=false;
    }
  }

  function scheduleEnforce(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{
      scheduled=false;
      enforce();
    });
  }

  document.addEventListener('click',event=>{
    const submit=event.target.closest('#waiter-submit');
    if(!submit)return;
    const table=byId('waiter-table');
    if(!table?.value){
      event.preventDefault();
      event.stopImmediatePropagation();
      alert('Selecione uma mesa antes de enviar o pedido.');
      table?.focus();
    }
  },true);

  document.addEventListener('DOMContentLoaded',()=>{
    enforce();
    const host=byId('waiter-content')||document.querySelector('.waiter-menu-body main')||document.body;
    new MutationObserver(scheduleEnforce).observe(host,{childList:true,subtree:true});
  });
  setTimeout(enforce,500);
})();
