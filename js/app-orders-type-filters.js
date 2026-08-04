(()=>{
  if(!/(^|\/)app\.html$/i.test(location.pathname))return;
  let active='todos';
  let selectedOrderId=null;
  const options=[['todos','Todos'],['local','Local / Mesa'],['retirada','Retirada'],['entrega','Entrega']];
  const typeOf=card=>{
    const text=[...card.querySelectorAll('.fs-order-meta span')].map(node=>node.textContent.trim().toLowerCase()).join(' ');
    if(text.includes('mesa')||text.includes('consumo local'))return'local';
    if(text.includes('retirada'))return'retirada';
    if(text.includes('entrega'))return'entrega';
    return'outro';
  };
  function ensure(){
    const status=document.getElementById('fs-order-filters');
    if(!status||document.getElementById('fs-order-type-filters'))return;
    const host=document.createElement('div');host.id='fs-order-type-filters';host.className='fs-order-type-filters';
    host.innerHTML=options.map(([value,label])=>`<button type="button" data-type-filter="${value}" class="${value===active?'active':''}">${label}</button>`).join('');
    status.insertAdjacentElement('afterend',host);
    host.querySelectorAll('[data-type-filter]').forEach(button=>button.onclick=()=>{active=button.dataset.typeFilter;host.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button));apply()});
  }
  function apply(){
    ensure();
    document.querySelectorAll('#fs-orders-list .fs-order-card').forEach(card=>{card.hidden=active!=='todos'&&typeOf(card)!==active});
    const list=document.getElementById('fs-orders-list');if(!list)return;
    let empty=document.getElementById('fs-order-type-empty');const visible=[...list.querySelectorAll('.fs-order-card')].some(card=>!card.hidden);
    if(!visible&&list.querySelector('.fs-order-card')){if(!empty){empty=document.createElement('div');empty.id='fs-order-type-empty';empty.className='empty-state';empty.textContent='Nenhum pedido nesta modalidade.';list.appendChild(empty)}empty.hidden=false}else if(empty)empty.hidden=true;
  }
  function syncRejectButton(){
    const modal=document.getElementById('fs-order-modal');
    const cancel=document.getElementById('fs-order-cancel');
    if(!modal||!cancel)return;
    const awaiting=/aguardando aprova/i.test(document.getElementById('fs-order-modal-detail')?.textContent||'');
    cancel.textContent=awaiting?'Rejeitar pedido':'Cancelar pedido';
    cancel.dataset.rejectMode=awaiting?'true':'false';
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('[data-fs-order],[data-fs-detail]');
    if(trigger)selectedOrderId=trigger.dataset.fsOrder||trigger.dataset.fsDetail||selectedOrderId;
  },true);
  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('#fs-order-cancel');
    if(!button||button.dataset.rejectMode!=='true')return;
    event.preventDefault();event.stopImmediatePropagation();
    const motivo=prompt('Informe o motivo da rejeição:');
    if(motivo===null)return;
    if(motivo.trim().length<3)return alert('Informe um motivo válido.');
    if(!selectedOrderId)return alert('Não foi possível identificar o pedido.');
    button.disabled=true;const label=button.textContent;button.textContent='Rejeitando...';
    try{
      const {error}=await window.supabaseClient.rpc('rejeitar_pedido_operacional',{p_pedido_id:Number(selectedOrderId),p_motivo:motivo.trim()});
      if(error)throw error;
      document.getElementById('fs-order-modal')?.classList.remove('open');
      document.body.style.overflow='';
      location.reload();
    }catch(error){alert(error.message||'Não foi possível rejeitar o pedido.');button.disabled=false;button.textContent=label}
  },true);
  const style=document.createElement('style');style.textContent='.fs-order-type-filters{display:flex;gap:8px;overflow:auto;margin:-6px 0 16px;padding-bottom:2px}.fs-order-type-filters button{white-space:nowrap;min-height:38px;padding:8px 13px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--muted);font-weight:750;cursor:pointer}.fs-order-type-filters button.active{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}';document.head.appendChild(style);
  new MutationObserver(()=>{apply();syncRejectButton()}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('DOMContentLoaded',()=>{apply();syncRejectButton()});setTimeout(()=>{apply();syncRejectButton()},500);
})();
