(()=>{
  'use strict';
  if(!/(^|\/)app\.html$/i.test(location.pathname))return;
  if(window.__fsOrderTypeFilters)return;
  window.__fsOrderTypeFilters=true;

  let active='todos';
  let selectedOrderId=null;
  let frame=0;
  let observedList=null;
  let listObserver=null;
  const options=[['todos','Todos'],['local','Local / Mesa'],['retirada','Retirada'],['entrega','Entrega']];

  const typeOf=card=>{
    const text=[...card.querySelectorAll('.fs-order-meta span')].map(node=>node.textContent.trim().toLowerCase()).join(' ');
    if(text.includes('mesa')||text.includes('consumo local'))return'local';
    if(text.includes('retirada'))return'retirada';
    if(text.includes('entrega'))return'entrega';
    return'outro';
  };

  function ensureFilters(){
    const status=document.getElementById('fs-order-filters');
    if(!status)return;
    let host=document.getElementById('fs-order-type-filters');
    if(host)return;
    host=document.createElement('div');
    host.id='fs-order-type-filters';
    host.className='fs-order-type-filters';
    host.innerHTML=options.map(([value,label])=>`<button type="button" data-type-filter="${value}" class="${value===active?'active':''}">${label}</button>`).join('');
    status.insertAdjacentElement('afterend',host);
    host.addEventListener('click',event=>{
      const button=event.target.closest('[data-type-filter]');
      if(!button)return;
      active=button.dataset.typeFilter;
      host.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));
      scheduleApply();
    });
  }

  function apply(){
    frame=0;
    ensureFilters();
    const list=document.getElementById('fs-orders-list');
    if(!list)return;
    const cards=[...list.querySelectorAll('.fs-order-card')];
    cards.forEach(card=>{
      const shouldHide=active!=='todos'&&typeOf(card)!==active;
      if(card.hidden!==shouldHide)card.hidden=shouldHide;
    });
    let empty=document.getElementById('fs-order-type-empty');
    const visible=cards.some(card=>!card.hidden);
    if(!visible&&cards.length){
      if(!empty){
        empty=document.createElement('div');
        empty.id='fs-order-type-empty';
        empty.className='empty-state';
        empty.textContent='Nenhum pedido nesta modalidade.';
        list.appendChild(empty);
      }
      empty.hidden=false;
    }else if(empty){
      empty.hidden=true;
    }
    observeList(list);
  }

  function scheduleApply(){
    if(frame)return;
    frame=requestAnimationFrame(apply);
  }

  function observeList(list){
    if(observedList===list)return;
    listObserver?.disconnect();
    observedList=list;
    listObserver=new MutationObserver(mutations=>{
      if(mutations.some(mutation=>[...mutation.addedNodes,...mutation.removedNodes].some(node=>node.nodeType===1&&(!node.id||node.id!=='fs-order-type-empty'))))scheduleApply();
    });
    listObserver.observe(list,{childList:true});
  }

  function syncRejectButton(){
    const cancel=document.getElementById('fs-order-cancel');
    if(!cancel)return;
    const awaiting=/aguardando aprova/i.test(document.getElementById('fs-order-modal-detail')?.textContent||'');
    const text=awaiting?'Rejeitar pedido':'Cancelar pedido';
    if(cancel.textContent!==text)cancel.textContent=text;
    cancel.dataset.rejectMode=awaiting?'true':'false';
  }

  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('[data-fs-order],[data-fs-detail]');
    if(!trigger)return;
    selectedOrderId=trigger.dataset.fsOrder||trigger.dataset.fsDetail||selectedOrderId;
    requestAnimationFrame(()=>requestAnimationFrame(syncRejectButton));
  },true);

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('#fs-order-cancel');
    if(!button||button.dataset.rejectMode!=='true')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const motivo=prompt('Informe o motivo da rejeição:');
    if(motivo===null)return;
    if(motivo.trim().length<3)return alert('Informe um motivo válido.');
    if(!selectedOrderId)return alert('Não foi possível identificar o pedido.');
    button.disabled=true;
    const label=button.textContent;
    button.textContent='Rejeitando...';
    try{
      const {error}=await window.supabaseClient.rpc('rejeitar_pedido_operacional',{p_pedido_id:Number(selectedOrderId),p_motivo:motivo.trim()});
      if(error)throw error;
      document.getElementById('fs-order-modal')?.classList.remove('open');
      document.body.style.overflow='';
      document.dispatchEvent(new CustomEvent('fs:orders:refresh'));
      location.reload();
    }catch(error){
      alert(error.message||'Não foi possível rejeitar o pedido.');
      button.disabled=false;
      button.textContent=label;
    }
  },true);

  document.addEventListener('fs:orders:rendered',scheduleApply);
  document.addEventListener('fs:orders:modal-opened',syncRejectButton);
  window.addEventListener('pagehide',()=>listObserver?.disconnect(),{once:true});

  const start=()=>{scheduleApply();syncRejectButton()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
