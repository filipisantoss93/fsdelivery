(()=>{
  if(!/(^|\/)app\.html$/i.test(location.pathname))return;
  let active='todos';
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
  const style=document.createElement('style');style.textContent='.fs-order-type-filters{display:flex;gap:8px;overflow:auto;margin:-6px 0 16px;padding-bottom:2px}.fs-order-type-filters button{white-space:nowrap;min-height:38px;padding:8px 13px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--muted);font-weight:750;cursor:pointer}.fs-order-type-filters button.active{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}';document.head.appendChild(style);
  new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',apply);setTimeout(apply,500);
})();
