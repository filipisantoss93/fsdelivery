const db=window.supabaseClient;
const{money,escapeHtml,byId}=window.FSRuntime;
let store,tables=[],orders=[],payments=[],selectedOrder=null,Status=null,channel=null;

async function init(){
  Status=await window.FSRuntime.ensureGlobal('FSOrderStatus','js/pedido-status.js');
  const context=await window.FSRuntime.requireOwnedStore();if(!context)return;
  store=context.store;
  bindActions();
  await loadData();
  channel=db.channel(`mesas-operacao-${store.id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'pedidos',filter:`estabelecimento_id=eq.${store.id}`},loadData)
    .on('postgres_changes',{event:'*',schema:'public',table:'pagamentos',filter:`estabelecimento_id=eq.${store.id}`},loadData)
    .subscribe();
}

async function loadData(){
  const[tablesResult,ordersResult,paymentsResult]=await Promise.all([
    db.from('mesas').select('*').eq('estabelecimento_id',store.id).eq('ativo',true).order('numero'),
    db.from('pedidos').select('id,codigo,mesa_id,status,total,pagamento_status,created_at,clientes(nome,telefone),itens_pedido(*)').eq('estabelecimento_id',store.id).eq('tipo','mesa').in('status',['aguardando_aprovacao','novo','confirmado','preparo','pronto','servido','saiu_entrega']).order('created_at',{ascending:false}),
    db.from('pagamentos').select('pedido_id,valor').eq('estabelecimento_id',store.id)
  ]);
  const error=tablesResult.error||ordersResult.error||paymentsResult.error;
  if(error){console.error(error);return alert('Não foi possível atualizar as mesas.')}
  tables=tablesResult.data||[];
  orders=(ordersResult.data||[]).map(order=>({...order,status:Status.normalize(order.status)}));
  payments=paymentsResult.data||[];
  render();
}

function paid(order){const manual=payments.filter(item=>String(item.pedido_id)===String(order.id)).reduce((sum,item)=>sum+Number(item.valor||0),0);return Math.max(manual,['autorizado','pago'].includes(order.pagamento_status)?Number(order.total||0):0)}
function balance(order){return Math.max(Number(order.total||0)-paid(order),0)}

function render(){
  const activeByTable=new Map();
  orders.forEach(order=>{if(order.mesa_id&&!activeByTable.has(String(order.mesa_id)))activeByTable.set(String(order.mesa_id),order)});
  const busy=tables.filter(table=>activeByTable.has(String(table.id))).length;
  byId('tables-total').textContent=tables.length;
  byId('tables-free').textContent=tables.length-busy;
  byId('tables-busy').textContent=busy;
  byId('tables-orders').textContent=orders.length;
  byId('operational-tables-grid').innerHTML=tables.length?tables.map(table=>{
    const order=activeByTable.get(String(table.id)),label=table.nome||`Mesa ${String(table.numero??table.identificacao??'').padStart(2,'0')}`;
    const status=order?Status.normalize(order.status):null,saldo=order?balance(order):0;
    const state=!order?'Disponível':status==='servido'?(saldo>0?'Servida • pagamento pendente':'Servida • paga'):Status.label(status,'mesa');
    return `<button class="operational-table-card ${order?'busy':'free'}" type="button" ${order?`data-order-id="${escapeHtml(order.id)}"`:''}><span class="table-state-dot"></span><small>${escapeHtml(state)}</small><strong>${escapeHtml(label)}</strong>${order?`<span>Pedido #${escapeHtml(order.codigo||order.id)}</span><b>${saldo>0?money(saldo)+' pendente':money(order.total)}</b>`:'<span>Aguardando pedido</span>'}</button>`;
  }).join(''):'<div class="empty-state">Nenhuma mesa ativa cadastrada.</div>';
  document.querySelectorAll('[data-order-id]').forEach(card=>card.onclick=()=>openOrder(Number(card.dataset.orderId)));
}

function openOrder(id){
  selectedOrder=orders.find(order=>Number(order.id)===id);
  if(!selectedOrder)return;
  const table=tables.find(item=>String(item.id)===String(selectedOrder.mesa_id)),saldo=balance(selectedOrder),status=Status.normalize(selectedOrder.status);
  byId('table-order-title').textContent=`${table?.nome||`Mesa ${table?.numero||table?.identificacao||''}`} • Pedido #${selectedOrder.codigo||selectedOrder.id}`;
  byId('table-order-detail').innerHTML=`<div class="row-card"><span>Status</span><b>${escapeHtml(Status.label(status,'mesa'))}</b></div><div class="row-card"><span>Cliente</span><b>${escapeHtml(selectedOrder.clientes?.nome||'Cliente')}</b></div>${(selectedOrder.itens_pedido||[]).map(item=>`<div class="row-card"><span>${item.quantidade}x ${escapeHtml(item.nome_produto)}</span><b>${money(Number(item.total)||Number(item.valor_unitario)*item.quantidade)}</b></div>`).join('')}<div class="cart-total"><span>Total</span><span>${money(selectedOrder.total)}</span></div><div class="cart-total"><span>Pagamento pendente</span><span>${money(saldo)}</span></div>${status==='servido'&&saldo>0?'<div class="counter-warning">A mesa continua ocupada até o pagamento integral.</div>':''}`;
  byId('table-order-modal').classList.add('open');document.body.style.overflow='hidden';
}

function closeModal(){byId('table-order-modal').classList.remove('open');document.body.style.overflow=''}
function bindActions(){
  byId('refresh-tables').onclick=loadData;
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModal);
  byId('table-order-modal').onclick=event=>{if(event.target===byId('table-order-modal'))closeModal()};
  byId('open-order-panel').onclick=()=>{if(selectedOrder)location.href=`app.html#pedidos?pedido=${selectedOrder.id}`};
}
init().catch(error=>{console.error(error);alert('Não foi possível carregar a operação de mesas.')});
