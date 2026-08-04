(()=>{
 const Status=window.FSOrderStatus;
 const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
 let routeOrders=[];

 function actionFor(order){
  if(order.status==='pronto')return{status:'saiu_entrega',label:'Aceitar e retirar',confirm:'Confirmar que você aceitou a entrega e retirou o pedido no restaurante?'};
  if(order.status==='saiu_entrega')return{status:'entregue',label:'Confirmar entrega',confirm:'Confirmar que o pedido foi entregue ao cliente?'};
  return null;
 }

 function card(order,index){
  const phone=normalizePhone(order.cliente_telefone),address=addressOf(order),action=actionFor(order);
  return `<article class="order-card status-${esc(order.status)}">
   <span class="delivery-route-index">${index+1}</span>
   <div class="order-main">
    <b>#${esc(order.codigo||order.id)} • ${esc(order.cliente_nome||'Cliente')}</b>
    <small class="delivery-address">${esc(address)}</small>
    <div class="delivery-meta">
     <span>${esc(order.cliente_telefone||'Sem telefone')}</span>
     <span>${money(order.total)}</span>
     <span>${esc(Status.label(order.status,'entrega'))}</span>
    </div>
    <div class="delivery-actions">
     ${phone?`<a class="btn btn-secondary" href="tel:+55${phone}">Ligar</a><a class="btn btn-secondary" href="https://wa.me/55${phone}" target="_blank" rel="noopener">WhatsApp</a>`:''}
     ${['pronto','saiu_entrega'].includes(order.status)?`<button class="btn btn-secondary" data-map="${esc(order.id)}">Abrir rota</button>`:''}
     ${address!=='Endereço não informado'?`<button class="btn btn-secondary" data-copy-address="${esc(order.id)}">Copiar endereço</button>`:''}
     ${action?`<button class="btn btn-primary" data-delivery="${esc(order.id)}" data-status="${action.status}" data-confirm="${esc(action.confirm)}">${action.label}</button>`:''}
    </div>
   </div>
  </article>`;
 }

 function group(title,subtitle,list){
  return `<section class="delivery-group"><h3>${title}</h3><small>${subtitle}</small>${list.length?list.map(card).join(''):'<div class="empty-state">Nenhum pedido nesta etapa.</div>'}</section>`;
 }

 renderOrders=function(data){
  data.forEach(order=>order.status=Status.normalize(order.status));
  const preparing=data.filter(order=>order.status==='preparo');
  const ready=data.filter(order=>order.status==='pronto');
  const active=data.filter(order=>order.status==='saiu_entrega');
  const done=data.filter(order=>['finalizado','entregue'].includes(order.status));
  routeOrders=optimize([...active,...ready],currentPosition);
  currentOrders=data;
  pendingCount.textContent=String(ready.length);
  activeCount.textContent=String(active.length);
  routeButton.disabled=!routeOrders.length;
  orderList.innerHTML=
   group('Em preparo','Visualização antecipada. Aguarde a liberação da cozinha.',preparing)+
   group('Aguardando retirada','Aceite somente quando estiver pronto para retirar no restaurante.',ready)+
   group('Em rota','Pedidos retirados e em deslocamento até o cliente.',active)+
   group('Concluídas hoje','Entregas confirmadas e encerradas.',done);

  orderList.querySelectorAll('[data-map]').forEach(button=>button.onclick=()=>openSingleRoute(data.find(order=>String(order.id)===button.dataset.map)));
  orderList.querySelectorAll('[data-copy-address]').forEach(button=>button.onclick=async()=>{
   const order=data.find(item=>String(item.id)===button.dataset.copyAddress);if(!order)return;
   try{await navigator.clipboard.writeText(addressOf(order));const old=button.textContent;button.textContent='Copiado';setTimeout(()=>button.textContent=old,1300)}catch{alert(addressOf(order))}
  });
  orderList.querySelectorAll('[data-delivery]').forEach(button=>button.onclick=async()=>{
   if(!confirm(button.dataset.confirm||'Confirmar atualização?'))return;
   button.disabled=true;const label=button.textContent;button.textContent='Atualizando...';
   const{error}=await db.rpc('atualizar_entrega_equipe',{p_slug:session.slug,p_telefone:session.phone,p_pin:session.pin,p_pedido:Number(button.dataset.delivery),p_status:button.dataset.status});
   if(error){button.disabled=false;button.textContent=label;alert(friendlyError(error));return}
   await loadDeliveries();
  });
 };

 openFullRoute=function(){
  if(!routeOrders.length)return alert('Nenhuma entrega pronta ou em rota.');
  const ordered=optimize(routeOrders,currentPosition),points=ordered.map(mapsDestination).filter(Boolean),destination=points.pop();
  const origin=currentPosition?`${currentPosition.lat},${currentPosition.lng}`:'';
  const params=new URLSearchParams({api:'1',destination,travelmode:'driving'});
  if(origin)params.set('origin',origin);
  if(points.length)params.set('waypoints',points.slice(0,8).join('|'));
  window.open(`https://www.google.com/maps/dir/?${params}`,'_blank','noopener');
 };

 routeButton.onclick=openFullRoute;
 const head=document.querySelector('.panel-head p');if(head)head.textContent='Aceite pedidos prontos, navegue até o cliente e confirme a entrega.';
 loadDeliveries();
})();
