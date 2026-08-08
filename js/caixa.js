const db=window.supabaseClient;
const{money,escapeHtml,byId:el}=window.FSRuntime;
let store,orders=[],tables=[],payments=[],selected=null,Status=null;

async function ensureNotifications(){
  if(!document.querySelector('link[href="css/operational.css"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='css/operational.css';document.head.appendChild(link)}
  if(window.FSOperationalNotifications)return window.FSOperationalNotifications;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='js/operational-notifications.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});
  return window.FSOperationalNotifications;
}

async function init(){
  Status=await window.FSRuntime.ensureGlobal('FSOrderStatus','js/pedido-status.js');
  await ensureNotifications();
  const context=await window.FSRuntime.requireOwnedStore();if(!context)return;
  store=context.store;
  bind();
  await load();
  render();
  window.FSOperationalNotifications?.start({role:'caixa',storeId:store.id,owner:true});
  db.channel(`caixa-${store.id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'pedidos',filter:`estabelecimento_id=eq.${store.id}`},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'pagamentos',filter:`estabelecimento_id=eq.${store.id}`},refresh)
    .subscribe();
}

async function refresh(){await load();render()}

async function load(){
  const[ordersResult,tablesResult,paymentsResult]=await Promise.all([
    db.from('pedidos').select('*,clientes(nome,telefone),itens_pedido(*),mesas(id,numero,identificacao,nome)').eq('estabelecimento_id',store.id).order('created_at',{ascending:false}),
    db.from('mesas').select('*').eq('estabelecimento_id',store.id).eq('ativo',true).order('numero'),
    db.from('pagamentos').select('id,pedido_id,valor,forma_pagamento,created_at').eq('estabelecimento_id',store.id).order('created_at',{ascending:false})
  ]);
  const error=ordersResult.error||tablesResult.error||paymentsResult.error;
  if(error){console.error(error);throw error}
  orders=(ordersResult.data||[]).map(order=>({...order,status:Status.normalize(order.status)}));
  tables=tablesResult.data||[];
  payments=paymentsResult.data||[];
}

function paidForOrder(orderId){return payments.filter(payment=>String(payment.pedido_id)===String(orderId)).reduce((sum,payment)=>sum+Number(payment.valor||0),0)}
function balanceForOrder(order){return Math.max(Number(order.total||0)-paidForOrder(order.id),0)}
function isOpen(order){return Status.active.includes(Status.normalize(order.status))}
function tableLabel(table){return table?.nome||`Mesa ${table?.numero??table?.identificacao??''}`}
function typeLabel(type){return Status.typeLabel(type)}

function bind(){
  window.FSRuntime.bindModalDismiss(close);
  el('order-filter').onchange=renderOrders;
  el('charge-order').onclick=()=>{
    if(!selected)return;
    const balance=balanceForOrder(selected);
    if(balance<=0)return alert('Este pedido já está integralmente pago.');
    close();
    el('payment-total').value=money(balance);
    document.querySelector('#payment-form [name=amount]').value=balance.toFixed(2).replace('.',',');
    open('payment-modal');
  };
  el('payment-form').onsubmit=pay;
}

function open(id){el(id).classList.add('open');document.body.style.overflow='hidden'}
function close(){document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));document.body.style.overflow=''}

function render(){
  const active=orders.filter(isOpen);
  const occupied=new Set(active.filter(order=>order.mesa_id).map(order=>String(order.mesa_id)));
  const today=new Date().toDateString();
  const paidToday=payments.filter(payment=>new Date(payment.created_at).toDateString()===today).reduce((sum,payment)=>sum+Number(payment.valor||0),0);
  el('m-open').textContent=active.length;
  el('m-tables').textContent=occupied.size;
  el('m-pending').textContent=money(active.reduce((sum,order)=>sum+balanceForOrder(order),0));
  el('m-paid').textContent=money(paidToday);
  renderOrders();
  renderTables(occupied);
}

function renderOrders(){
  const filter=el('order-filter').value;
  const list=orders.filter(order=>order.tipo!=='mesa'&&isOpen(order)&&(!filter||order.tipo===filter));
  el('online-orders').innerHTML=list.map(order=>{
    const balance=balanceForOrder(order),status=Status.normalize(order.status);
    return `<article class="order-card" data-order="${escapeHtml(order.id)}"><div class="order-main"><b>#${escapeHtml(order.codigo||order.id)} • ${escapeHtml(order.clientes?.nome||'Cliente')}</b><small>${escapeHtml(typeLabel(order.tipo))} • ${new Date(order.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small></div><div><span class="status ${Status.css(status)}">${escapeHtml(Status.label(status,order.tipo))}</span><b>${balance>0?`${money(balance)} pendente`:'Pago'}</b></div></article>`;
  }).join('')||'<div class="empty-state">Nenhum pedido em aberto.</div>';
  document.querySelectorAll('[data-order]').forEach(card=>card.onclick=()=>showOrder(card.dataset.order));
}

function renderTables(occupied){
  el('tables-grid').innerHTML=tables.map(table=>{
    const order=orders.find(item=>String(item.mesa_id)===String(table.id)&&isOpen(item));
    const busy=occupied.has(String(table.id)),balance=order?balanceForOrder(order):0,status=order?Status.normalize(order.status):null;
    const state=order&&status==='servido'?(balance>0?'Servida • pagamento pendente':'Servida • paga'):busy?'Ocupada':'Disponível';
    return `<article class="feature-card ${busy?'danger-zone':''}" data-table="${escapeHtml(table.id)}"><span class="status ${busy?'cancelado':'pronto'}">${escapeHtml(state)}</span><h3>${escapeHtml(tableLabel(table))}</h3><p>${order?`Pedido #${escapeHtml(order.codigo||order.id)} • ${balance>0?money(balance)+' pendente':'Pagamento concluído'}`:'Sem pedido em andamento'}</p></article>`;
  }).join('')||'<div class="empty-state">Nenhuma mesa ativa cadastrada.</div>';
  document.querySelectorAll('[data-table]').forEach(card=>card.onclick=()=>{const order=orders.find(item=>String(item.mesa_id)===card.dataset.table&&isOpen(item));if(order)showOrder(order.id)});
}

function showOrder(id){
  selected=orders.find(order=>String(order.id)===String(id));
  if(!selected)return;
  const table=selected.mesas?tableLabel(selected.mesas):null,paid=paidForOrder(selected.id),balance=balanceForOrder(selected),status=Status.normalize(selected.status);
  el('cash-order-title').textContent=`Pedido #${selected.codigo||selected.id}`;
  el('cash-order-detail').innerHTML=`<div class="row-card"><div class="order-main"><b>${escapeHtml(table||typeLabel(selected.tipo))}</b><small>${escapeHtml(selected.clientes?.nome||'Cliente')} • ${escapeHtml(selected.clientes?.telefone||'Sem telefone')}</small></div><span class="status ${Status.css(status)}">${escapeHtml(Status.label(status,selected.tipo))}</span></div><div class="product-list">${(selected.itens_pedido||[]).map(item=>`<div class="row-card"><div class="order-main"><b>${item.quantidade}x ${escapeHtml(item.nome_produto)}</b><small>${escapeHtml(item.observacoes||'Sem observações')}</small></div><b>${money(Number(item.total)||Number(item.valor_unitario)*item.quantidade)}</b></div>`).join('')}</div><div class="row-card"><span>Total do pedido</span><b>${money(selected.total)}</b></div><div class="row-card"><span>Total recebido</span><b>${money(paid)}</b></div><div class="cart-total"><span>Saldo restante</span><strong>${money(balance)}</strong></div>${status==='servido'&&balance>0?'<div class="counter-warning">A mesa permanece ocupada até a quitação integral.</div>':''}`;
  el('charge-order').style.display=isOpen(selected)&&balance>0?'inline-flex':'none';
  open('cash-order-modal');
}

async function pay(event){
  event.preventDefault();
  if(!selected)return;
  const form=event.currentTarget,data=new FormData(form),amount=Number(String(data.get('amount')||'').replace(',','.')),balance=balanceForOrder(selected);
  if(!Number.isFinite(amount)||amount<=0)return alert('Informe um valor válido.');
  if(amount>balance)return alert(`O valor excede o saldo restante de ${money(balance)}.`);
  const submit=form.querySelector('button[type="submit"]'),previousText=submit.textContent;
  submit.disabled=true;submit.textContent='Registrando...';
  const payload={estabelecimento_id:store.id,pedido_id:selected.id,valor:amount,forma_pagamento:data.get('method')==='voucher'?'vale':data.get('method'),referencia:String(data.get('reference')||'').trim()||null,observacoes:String(data.get('notes')||'').trim()||null};
  const{data:result,error}=await db.rpc('registrar_pagamento_caixa',{payload});
  submit.disabled=false;submit.textContent=previousText;
  if(error)return alert(error.message);
  close();form.reset();await refresh();
  if(result?.finalizado)return alert('Pagamento registrado. Conta encerrada e mesa liberada.');
  if(result?.quitado)return alert('Pagamento integral registrado. A mesa será liberada quando o pedido for marcado como servido.');
  alert(`Pagamento registrado. Saldo restante: ${money(result?.saldo)}.`);
}

init().catch(error=>{console.error(error);alert('Não foi possível carregar o caixa.')});
