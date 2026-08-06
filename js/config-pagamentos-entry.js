(()=>{
  'use strict';
  const groups=[...document.querySelectorAll('.config-group')];
  const operationGroup=groups.find(group=>group.querySelector('.config-group-head h2')?.textContent.trim()==='Operação');
  const shortcuts=operationGroup?.querySelector('.config-shortcuts');
  if(!shortcuts||shortcuts.querySelector('[data-payment-integration-link]'))return;
  const link=document.createElement('a');
  link.className='config-shortcut';
  link.href='pagamentos';
  link.dataset.paymentIntegrationLink='true';
  link.innerHTML='<span>Pagamentos on-line</span><small>Conta Efí, cartão, Pix e split</small>';
  shortcuts.insertBefore(link,shortcuts.children[1]||null);
})();
