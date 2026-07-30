const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const db=window.supabaseClient;
let session,user,store,products=[],orders=[],selectedOrder=null,activeOrderFilter='novo',ordersChannel=null;

const labels={novo:'Novo',preparo:'Em preparo',pronto:'Saiu para entrega',entregue:'Entregue',cancelado:'Cancelado'};
const byId=id=>document.getElementById(id);
const normalizeStatus=value=>{
  const status=String(value||'novo').toLowerCase().trim().replace(/[\s-]+/g,'_');
  if(['novo','pendente','recebido','aguardando'].includes(status))return'novo';
  if(['preparo','em_preparo','preparando','producao'].includes(status))return'preparo';
  if(['pronto','saiu','saiu_para_entrega','em_entrega','despachado'].includes(status))return'pronto';
  if(['entregue','finalizado','concluido','concluído'].includes(status))return'entregue';
  if(['cancelado','cancelada'].includes(status))return'cancelado';
  return status;
};
const isToday=date=>{
  const value=date instanceof Date?date:new Date(date);
  const now=new Date();
  return value.getFullYear()===now.getFullYear()&&value.getMonth()===now.getMonth()&&value.getDate()===now.getDate();
};

async function init(){
  const {data:{session:currentSession}}=await db.auth.getSession();
  if(!currentSession){location.replace('auth.html');return}
  session=currentSession;
  user=currentSession.user;

  const {data:establishment,error}=await db.from('estabelecimentos').select('*').eq('usuario_id',user.id).single();
  if(error||!establishment){alert('Não foi possível carregar o estabelecimento.');return}
  store=establishment;

  setupOrdersUI();
  await loadData();
  bindNavigation();
  bindModals();
  bindActions();
  setupLabels();
  render();
  subscribeOrders();
}

async function loadData(){
  const [productResult,orderResult]=await Promise.all([
    db.from('produtos').select('id,ativo').eq('estabelecimento_id',store.id),
    db.from('pedidos').select('*,clientes(nome,telefone),itens_pedido(*)').eq('estabelecimento_id',store.id).order('created_at',{ascending:false})
  ]);
  products=(productResult.data||[]).map(item=>({id:item.id,active:item.ativo}));
  orders=(orderResult.data||[]).map(mapOrder);
}

function mapOrder(item){
  const createdAt=new Date(item.created_at);
  return{
    id:item.id,
    customer:item.clientes?.nome||item.cliente_nome||'Cliente',
    phone:item.clientes?.telefone||item.cliente_telefone||'',
    type:item.tipo||'entrega',
    address:item.tipo==='retirada'?'Retirada no local':formatAddress(item.endereco_entrega),
    items:(item.itens_pedido||[]).map(orderItem=>({name:orderItem.nome_produto,qty:orderItem.quantidade,price:Number(orderItem.valor_unitario)})),
    total:Number(item.total),
    payment:item.forma_pagamento||'A definir',
    status:normalizeStatus(item.status),
    time:createdAt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
    date:createdAt.toLocaleDateString('pt-BR'),
    createdAt
  };
}

const formatAddress=address=>!address?'Não informado':typeof address==='string'?address:[address.logradouro,address.numero,address.bairro].filter(Boolean).join(', ');

function setupOrdersUI(){
  const page=byId('pedidos');
  if(!page)return;
  page.innerHTML=`<div class="page-head orders-page-head"><div><h1>Pedidos</h1><p>Organize a fila do recebimento até a entrega.</p></div><button class="btn btn-primary" id="new-order-btn">+ Novo pedido</button></div><div class="order-status-tabs" id="order-status-tabs"><button class="active" data-order-filter="novo">Novos <b id="count-novo">0</b></button><button data-order-filter="preparo">Em preparo <b id="count-preparo">0</b></button><button data-order-filter="pronto">Saiu para entrega <b id="count-pronto">0</b></button><button data-order-filter="entregue">Entregues <b id="count-entregue">0</b></button></div><div class="orders-active-list" id="orders-active-list"></div>`;
}

function bindNavigation(){
  document.querySelectorAll('[data-page]').forEach(button=>button.onclick=()=>openPage(button.dataset.page));
  document.querySelectorAll('[data-go]').forEach(button=>button.onclick=()=>openPage(button.dataset.go));
}

function openPage(id){
  if(!['inicio','pedidos'].includes(id))return;
  document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active',page.id===id));
  document.querySelectorAll('[data-page],[data-page-main]').forEach(button=>{
    const target=button.dataset.page||button.dataset.pageMain;
    button.classList.toggle('active',target===id);
  });
  const title=byId('page-title');
  if(title)title.textContent=id==='inicio'?'Início':'Pedidos';
  history.replaceState(null,'',id==='inicio'?location.pathname:`#${id}`);
  window.scrollTo(0,0);
}

function openModal(id){
  const modal=byId(id);
  if(!modal)return;
  modal.classList.add('open');
  document.body.style.overflow='hidden';
}
function closeModals(){document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));document.body.style.overflow=''}
function bindModals(){
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModals);
  document.querySelectorAll('.modal').forEach(modal=>modal.onclick=event=>{if(event.target===modal)closeModals()});
}

function elapsed(createdAt){
  const minutes=Math.max(0,Math.floor((Date.now()-createdAt.getTime())/60000));
  return minutes<1?'Agora':`${minutes} min`;
}

function orderCard(order,compact=false){
  const itemCount=order.items.reduce((sum,item)=>sum+Number(item.qty||0),0);
  const action=order.status==='novo'?`<button class="btn btn-primary" data-advance-order="${order.id}">Iniciar preparo</button>`:order.status==='preparo'?`<button class="btn btn-primary" data-advance-order="${order.id}">Marcar pronto</button>`:order.status==='pronto'?`<button class="btn btn-primary" data-advance-order="${order.id}">Confirmar entrega</button>`:'';
  const service=order.type==='retirada'?'Retirada no local':order.type==='mesa'?'Atendimento na mesa':'Entrega';
  return `<article class="order-card operational-order-card status-${order.status}" data-order="${order.id}"><div class="operational-order-top"><div><div class="operational-order-number">#${order.id} <span class="status ${order.status}">${labels[order.status]||order.status}</span></div><b>${order.customer}</b><small>${order.phone||'Telefone não informado'}</small></div><div class="operational-order-time"><b>${order.time}</b><small>${elapsed(order.createdAt)}</small></div></div><div class="operational-order-body"><div><b>${service}</b><small>${order.address}</small></div><div class="operational-order-total"><b>${money(order.total)}</b><small>${order.payment}</small></div></div><div class="operational-order-footer"><span>${itemCount} ${itemCount===1?'item':'itens'}</span>${compact?'':`<div class="inline-actions"><button class="btn btn-secondary" data-open-order="${order.id}">Ver detalhes</button>${action}</div>`}</div></article>`;
}

function bindOrderCards(){
  document.querySelectorAll('[data-order]').forEach(element=>element.onclick=event=>{if(event.target.closest('button'))return;openOrder(Number(element.dataset.order))});
  document.querySelectorAll('[data-open-order]').forEach(button=>button.onclick=()=>openOrder(Number(button.dataset.openOrder)));
  document.querySelectorAll('[data-advance-order]').forEach(button=>button.onclick=()=>advanceOrder(Number(button.dataset.advanceOrder)));
}

function renderOrders(){
  ['novo','preparo','pronto','entregue'].forEach(status=>{
    const target=byId(`count-${status}`);
    if(target)target.textContent=orders.filter(order=>order.status===status).length;
  });
  document.querySelectorAll('[data-order-filter]').forEach(button=>button.classList.toggle('active',button.dataset.orderFilter===activeOrderFilter));
  const list=byId('orders-active-list');
  if(!list)return;
  const filtered=orders.filter(order=>order.status===activeOrderFilter);
  list.innerHTML=filtered.map(order=>orderCard(order)).join('')||`<div class="empty-state orders-empty">Nenhum pedido em ${(labels[activeOrderFilter]||activeOrderFilter).toLowerCase()}.</div>`;
  bindOrderCards();
}

function renderDashboard(){
  const todayOrders=orders.filter(order=>order.status!=='cancelado'&&isToday(order.createdAt));
  const revenue=todayOrders.reduce((total,order)=>total+Number(order.total||0),0);
  const preparing=todayOrders.filter(order=>order.status==='preparo').length;

  byId('metric-orders').textContent=todayOrders.length;
  byId('summary-preparing').textContent=preparing;
  byId('metric-revenue').textContent=money(revenue);
  byId('metric-ticket').textContent=money(todayOrders.length?revenue/todayOrders.length:0);

  const recent=byId('recent-orders');
  recent.innerHTML=todayOrders.slice(0,4).map(order=>orderCard(order,true)).join('')||'<div class="empty-state"><b>Nenhum pedido recebido hoje.</b><br><a class="btn btn-primary" href="garcom.html">Criar pedido</a></div>';

  const productAlert=byId('dashboard-product-alert');
  if(productAlert){
    productAlert.innerHTML=products.some(product=>product.active)?'':'<div class="empty-state"><b>Nenhum produto ativo no cardápio.</b><br><a class="btn btn-secondary" href="garcom.html">Revisar cardápio</a></div>';
  }
  bindOrderCards();
}

function render(){renderDashboard();renderOrders()}

async function updateStoreStatus(open,{confirmChange=false}={}){
  if(confirmChange){
    const action=open?'abrir':'fechar';
    if(!confirm(`Deseja ${action} a loja agora?`))return false;
  }
  const statusButton=byId('store-status-button');
  if(statusButton)statusButton.disabled=true;
  const {data,error}=await db.from('estabelecimentos').update({aberto:open}).eq('id',store.id).select().single();
  if(statusButton)statusButton.disabled=false;
  if(error){alert(error.message);setupLabels();return false}
  store=data;
  setupLabels();
  return true;
}

async function advanceOrder(id){
  const order=orders.find(item=>item.id===id);
  if(!order)return;
  const flow=['novo','preparo','pronto','entregue'];
  const status=flow[Math.min(flow.indexOf(order.status)+1,3)];
  const {error}=await db.from('pedidos').update({status,atualizado_em:new Date().toISOString()}).eq('id',id);
  if(error)return alert(error.message);
  order.status=status;
  render();
}

function bindActions(){
  document.querySelectorAll('[data-order-filter]').forEach(button=>button.onclick=()=>{activeOrderFilter=button.dataset.orderFilter;renderOrders()});
  const advanceButton=byId('advance-order');
  if(advanceButton)advanceButton.onclick=()=>selectedOrder&&advanceOrder(selectedOrder.id).then(closeModals);
  const printButton=byId('print-order');
  if(printButton)printButton.onclick=()=>window.print();
  const newOrderButton=byId('new-order-btn');
  if(newOrderButton)newOrderButton.onclick=()=>location.href='garcom.html';
  const statusButton=byId('store-status-button');
  if(statusButton)statusButton.onclick=()=>updateStoreStatus(!store.aberto,{confirmChange:true});
}

function openOrder(id){
  selectedOrder=orders.find(order=>order.id===id);
  if(!selectedOrder)return;
  byId('order-modal-title').textContent=`Pedido #${id}`;
  byId('order-detail').innerHTML=`<div style="text-align:center"><h2>${String(store.nome||'FS Delivery').toUpperCase()}</h2><small>Pedido #${id} • ${selectedOrder.time}</small></div><hr><p><b>Cliente:</b> ${selectedOrder.customer}<br><b>Telefone:</b> ${selectedOrder.phone||'-'}<br><b>Atendimento:</b> ${selectedOrder.address}</p><hr>${selectedOrder.items.map(item=>`<p>${item.qty}x ${item.name}<b style="float:right">${money(item.qty*item.price)}</b></p>`).join('')}<hr><h3>Total <span style="float:right">${money(selectedOrder.total)}</span></h3><p><b>Pagamento:</b> ${selectedOrder.payment}<br><b>Status:</b> ${labels[selectedOrder.status]||selectedOrder.status}</p><div class="inline-actions"><button class="btn btn-danger" id="cancel-order">Cancelar pedido</button><button class="btn btn-danger" id="delete-order">Excluir registro</button></div>`;
  byId('advance-order').style.display=['entregue','cancelado'].includes(selectedOrder.status)?'none':'inline-flex';
  openModal('order-modal');
  byId('cancel-order').onclick=async()=>{
    if(!confirm('Cancelar este pedido?'))return;
    const {error}=await db.from('pedidos').update({status:'cancelado'}).eq('id',id);
    if(error)return alert(error.message);
    selectedOrder.status='cancelado';
    closeModals();
    render();
  };
  byId('delete-order').onclick=async()=>{
    if(!confirm('Excluir permanentemente este pedido?'))return;
    const {error}=await db.from('pedidos').delete().eq('id',id);
    if(error)return alert(error.message);
    orders=orders.filter(order=>order.id!==id);
    closeModals();
    render();
  };
}

function setupLabels(){
  const ownerName=user.user_metadata?.owner_name||user.email.split('@')[0];
  const greeting=document.querySelector('#inicio h1');
  if(greeting)greeting.textContent=`Olá, ${ownerName}`;
  const statusButton=byId('store-status-button');
  const statusLabel=byId('store-status-label');
  if(statusButton){
    statusButton.textContent='';
    statusButton.className=`status store-status-control ${store.aberto?'pronto':'cancelado'}`;
    statusButton.setAttribute('aria-label',store.aberto?'Loja aberta. Toque para fechar':'Loja fechada. Toque para abrir');
    statusButton.title=store.aberto?'Fechar loja':'Abrir loja';
  }
  if(statusLabel)statusLabel.textContent=store.aberto?'Loja aberta':'Loja fechada';
}

function subscribeOrders(){
  if(ordersChannel)db.removeChannel(ordersChannel);
  ordersChannel=db.channel(`orders-${store.id}`).on('postgres_changes',{event:'*',schema:'public',table:'pedidos',filter:`estabelecimento_id=eq.${store.id}`},async payload=>{
    const isNew=payload.eventType==='INSERT';
    await loadData();
    render();
    if(isNew){
      activeOrderFilter='novo';
      renderOrders();
      if('Notification' in window&&Notification.permission==='granted')new Notification('Novo pedido recebido',{body:`Pedido #${payload.new.id}`});
      const audio=new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      audio.play().catch(()=>{});
    }
  }).subscribe();
}

const requested=location.hash.slice(1);
init().then(()=>{if(['inicio','pedidos'].includes(requested))openPage(requested)});
