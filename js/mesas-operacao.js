const db=window.supabaseClient;
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
let store,tables=[],orders=[],selectedOrder=null;
const byId=id=>document.getElementById(id);

async function init(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){location.replace('auth.html');return}
  const {data:est,error}=await db.from('estabelecimentos').select('*').eq('usuario_id',session.user.id).single();
  if(error||!est){alert('Não foi possível carregar o estabelecimento.');return}
  store=est;
  bindActions();
  await loadData();
}

async function loadData(){
  const [tablesResult,ordersResult]=await Promise.all([
    db.from('mesas').select('*').eq('estabelecimento_id',store.id).eq('ativo',true).order('numero'),
    db.from('pedidos').select('id,mesa_id,status,total,created_at,clientes(nome,telefone),itens_pedido(*)').eq('estabelecimento_id',store.id).eq('tipo','mesa').not('status','in','("entregue","cancelado")').order('created_at',{ascending:false})
  ]);
  tables=tablesResult.data||[];
  orders=ordersResult.data||[];
  render();
}

function render(){
  const activeByTable=new Map();
  orders.forEach(order=>{if(order.mesa_id&&!activeByTable.has(order.mesa_id))activeByTable.set(order.mesa_id,order)});
  const busy=tables.filter(table=>activeByTable.has(table.id)).length;
  byId('tables-total').textContent=tables.length;
  byId('tables-free').textContent=tables.length-busy;
  byId('tables-busy').textContent=busy;
  byId('tables-orders').textContent=orders.length;
  byId('operational-tables-grid').innerHTML=tables.length?tables.map(table=>{
    const order=activeByTable.get(table.id);
    const label=table.nome||`Mesa ${String(table.numero).padStart(2,'0')}`;
    return `<button class="operational-table-card ${order?'busy':'free'}" type="button" ${order?`data-order-id="${order.id}"`:''}>
      <span class="table-state-dot"></span>
      <small>${order?'Ocupada':'Disponível'}</small>
      <strong>${label}</strong>
      ${order?`<span>Pedido #${order.id}</span><b>${money(order.total)}</b>`:'<span>Aguardando pedido</span>'}
    </button>`;
  }).join(''):'<div class="empty-state">Nenhuma mesa ativa cadastrada.</div>';
  document.querySelectorAll('[data-order-id]').forEach(card=>card.onclick=()=>openOrder(Number(card.dataset.orderId)));
}

function openOrder(id){
  selectedOrder=orders.find(order=>Number(order.id)===id);
  if(!selectedOrder)return;
  const table=tables.find(item=>item.id===selectedOrder.mesa_id);
  byId('table-order-title').textContent=`${table?.nome||`Mesa ${table?.numero||''}`} • Pedido #${selectedOrder.id}`;
  byId('table-order-detail').innerHTML=`<div class="row-card"><span>Status</span><b>${selectedOrder.status}</b></div><div class="row-card"><span>Cliente</span><b>${selectedOrder.clientes?.nome||'Cliente'}</b></div>${(selectedOrder.itens_pedido||[]).map(item=>`<div class="row-card"><span>${item.quantidade}x ${item.nome_produto}</span><b>${money(Number(item.total)||Number(item.valor_unitario)*item.quantidade)}</b></div>`).join('')}<div class="cart-total"><span>Total</span><span>${money(selectedOrder.total)}</span></div>`;
  byId('table-order-modal').classList.add('open');document.body.style.overflow='hidden';
}

function closeModal(){byId('table-order-modal').classList.remove('open');document.body.style.overflow=''}
function bindActions(){
  byId('refresh-tables').onclick=loadData;
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModal);
  byId('table-order-modal').onclick=event=>{if(event.target===byId('table-order-modal'))closeModal()};
  byId('open-order-panel').onclick=()=>{if(selectedOrder)location.href=`app.html#pedidos&pedido=${selectedOrder.id}`};
}
init();