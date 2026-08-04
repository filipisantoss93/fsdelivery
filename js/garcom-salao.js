(()=>{
  const byId=id=>document.getElementById(id);
  function enforce(){
    const type=byId('waiter-type');
    if(type){
      type.innerHTML='<option value="mesa">Mesa</option>';
      type.value='mesa';
      const field=type.closest('.field');
      if(field)field.hidden=true;
      type.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const tableField=byId('waiter-table-field');
    if(tableField)tableField.hidden=false;
    const addressField=byId('waiter-address-field');
    if(addressField)addressField.hidden=true;
    const title=byId('waiter-menu-title');
    if(title&&!byId('waiter-table')?.value)title.textContent='Novo pedido na mesa';
    const subtitle=byId('waiter-menu-subtitle');
    if(subtitle&&!byId('waiter-table')?.value)subtitle.textContent='Selecione uma mesa para iniciar o atendimento.';
    document.querySelectorAll('[data-order-scope="online"]').forEach(button=>button.remove());
    const localScope=document.querySelector('[data-order-scope="local"]');
    if(localScope){localScope.textContent='Pedidos das mesas';localScope.click()}
    const scopeBar=document.querySelector('.waiter-order-tabs');
    if(scopeBar&&scopeBar.children.length<=1)scopeBar.hidden=true;
  }
  document.addEventListener('click',event=>{
    const submit=event.target.closest('#waiter-submit');
    if(!submit)return;
    const table=byId('waiter-table');
    if(!table?.value){event.preventDefault();event.stopImmediatePropagation();alert('Selecione uma mesa antes de enviar o pedido.');table?.focus()}
  },true);
  const observer=new MutationObserver(enforce);
  document.addEventListener('DOMContentLoaded',()=>{enforce();observer.observe(document.body,{childList:true,subtree:true})});
  setTimeout(enforce,500);
})();
