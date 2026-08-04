(()=>{
 const Status=window.FSOrderStatus;
 if(!document.getElementById('waiter-served-style')){const style=document.createElement('style');style.id='waiter-served-style';style.textContent='.waiter-payment-note{margin-top:10px;padding:10px 12px;border:1px solid #e2bf72;border-radius:9px;background:#fff8e7;color:#6c4b00;font-size:13px;font-weight:700}';document.head.appendChild(style)}
 const normalize=status=>Status.normalize(status);
 if(typeof activeStatuses!=='undefined'){
   ['aguardando_aprovacao','servido'].forEach(status=>{if(!activeStatuses.includes(status))activeStatuses.push(status)});
 }
 if(typeof statusLabels!=='undefined')Object.assign(statusLabels,Status.labels);
 const localTypes=['mesa','local'];
 filteredOrders=function(){
   return orders
     .filter(order=>orderScope==='local'?localTypes.includes(order.tipo):!localTypes.includes(order.tipo))
     .filter(order=>{
       const status=normalize(order.status);
       if(statusFilter==='ativos')return Status.active.includes(status);
       if(statusFilter==='preparo')return status==='preparo';
       if(statusFilter==='pronto')return status==='pronto';
       return ['finalizado','cancelado'].includes(status);
     });
 };
 async function serve(id,button){
   if(!confirm('Confirmar que o pedido foi servido? A mesa permanecerá ocupada até o pagamento.'))return;
   const original=button.textContent;
   button.disabled=true;
   button.textContent='Registrando...';
   try{
     const result=ownerSession
       ?await db.rpc('atualizar_status_pedido_operacional',{p_pedido_id:Number(id),p_novo_status:'servido',p_origem:'garcom'})
       :await db.rpc('marcar_pedido_servido_equipe_garcom',{p_telefone:teamSession.phone,p_pin:teamSession.pin,p_pedido_id:Number(id)});
     if(result.error)throw result.error;
     await refreshOperation();
   }catch(error){
     alert(error.message||'Não foi possível registrar o pedido como servido.');
   }finally{
     button.disabled=false;
     button.textContent=original;
   }
 }
 const originalRender=renderOrders;
 renderOrders=function(){
   originalRender();
   const visible=filteredOrders(),cards=[...document.querySelectorAll('#waiter-orders .operational-order-card')];
   cards.forEach((card,index)=>{
     const order=visible[index];
     if(!order)return;
     const status=normalize(order.status),badge=card.querySelector('.status');
     if(badge)badge.textContent=Status.label(status,order.tipo);
     if(status==='pronto'&&localTypes.includes(order.tipo)){
       const button=document.createElement('button');
       button.className='btn btn-primary waiter-serve-action';
       button.textContent='Marcar como servido';
       button.onclick=()=>serve(order.id,button);
       card.appendChild(button);
     }
     if(status==='servido'){
       const note=document.createElement('div');
       note.className='waiter-payment-note';
       note.textContent='Mesa ocupada • pagamento pendente no caixa';
       card.appendChild(note);
     }
   });
 };
 const originalRefresh=refreshOperation;
 refreshOperation=async function(){
   await originalRefresh();
   orders.forEach(order=>order.status=normalize(order.status));
 };
 function addBack(){
   if(ownerSession&&!document.getElementById('waiter-back-admin')){
     const button=document.createElement('button');
     button.id='waiter-back-admin';
     button.className='btn btn-secondary';
     button.textContent='Painel';
     button.onclick=()=>location.href='app.html#pedidos';
     document.querySelector('.topbar-actions')?.prepend(button);
   }
 }
 const wait=()=>{
   if(typeof establishment==='undefined'||!establishment)return setTimeout(wait,200);
   addBack();
   orders.forEach(order=>order.status=normalize(order.status));
   renderMetrics();
   renderOrders();
 };
 wait();
})();
