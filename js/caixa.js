const db=window.supabaseClient;
const{money,escapeHtml,byId:el}=window.FSRuntime;
const ONLINE_PAID=new Set(['autorizado','pago']);
let store=null,orders=[],tables=[],payments=[],selected=null,selectedOrders=[],Status=null,config={},cashSummary={aberto:false};

async function ensureNotifications(){
  if(window.FSOperationalNotifications)return window.FSOperationalNotifications;
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='js/operational-notifications.js';
    script.onload=resolve;
    script.onerror=reject;
    document.head.appendChild(script);
  });
  return window.FSOperationalNotifications;
}

async function init(){
  Status=await window.FSRuntime.ensureGlobal('FSOrderStatus','js/pedido-status.js');
  await ensureNotifications();
  const context=await window.FSRuntime.requireOwnedStore();
  if(!context)return;
  store=context.store;
  bind();
  await load();
  render();
  window.FSOperationalNotifications?.start({role:'caixa',storeId:store.id,owner:true});
  db.channel(`caixa-${store.id}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'pedidos',filter:`estabelecimento_id=eq.${store.id}`},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'pagamentos',filter:`estabelecimento_id=eq.${store.id}`},refresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'caixas',filter:`estabelecimento_id=eq.${store.id}`},refresh)
    .subscribe();
}

async function refresh(){
  await load();
  render();
}

async function load(){
  const[ordersResult,tablesResult,paymentsResult,configResult,cashResult]=await Promise.all([
    db.from('pedidos').select('*,clientes(nome,telefone),itens_pedido(*),mesas(id,numero,identificacao,nome)').eq('estabelecimento_id',store.id).order('created_at',{ascending:false}),
    db.from('mesas').select('*').eq('estabelecimento_id',store.id).eq('ativo',true).order('numero'),
    db.from('pagamentos').select('id,pedido_id,caixa_id,valor,forma_pagamento,created_at').eq('estabelecimento_id',store.id).order('created_at',{ascending:false}),
    db.from('configuracoes_operacionais').select('exige_abertura_caixa').eq('estabelecimento_id',store.id).maybeSingle(),
    db.rpc('obter_resumo_caixa',{p_estabelecimento:store.id})
  ]);
  const error=ordersResult.error||tablesResult.error||paymentsResult.error||configResult.error||cashResult.error;
  if(error){console.error(error);throw error}
  orders=(ordersResult.data||[]).map(order=>({...order,rawStatus:order.status,status:Status.normalize(order.status)}));
  tables=tablesResult.data||[];
  payments=paymentsResult.data||[];
  config=configResult.data||{};
  cashSummary=cashResult.data||{aberto:false};
}

function manualPaidForOrder(orderId){
  return payments.filter(payment=>String(payment.pedido_id)===String(orderId)).reduce((sum,payment)=>sum+Number(payment.valor||0),0);
}
function isOnlinePaid(order){return ONLINE_PAID.has(String(order?.pagamento_status||'').toLowerCase())}
function paidForOrder(order){return Math.max(manualPaidForOrder(order.id),isOnlinePaid(order)?Number(order.total||0):0)}
function balanceForOrder(order){return Math.max(Number(order.total||0)-paidForOrder(order),0)}
function isOpen(order){return Status.active.includes(Status.normalize(order.status))}
function tableLabel(table){return table?.nome||`Mesa ${table?.numero??table?.identificacao??''}`}
function typeLabel(type){return Status.typeLabel(type)}
function cashRequiredAndClosed(){return Boolean(config.exige_abertura_caixa&&!cashSummary.aberto)}
function canCharge(order){
  return isOpen(order)&&!['aguardando_aprovacao','novo'].includes(order.rawStatus)&&!isOnlinePaid(order)&&balanceForOrder(order)>0&&!cashRequiredAndClosed();
}
function canFinalize(order){
  if(!isOpen(order)||balanceForOrder(order)>0)return false;
  return(order.status==='servido'&&['mesa','local'].includes(order.tipo))||(order.status==='pronto'&&order.tipo==='retirada');
}
function paymentState(order){
  if(order.pagamento_status==='autorizado')return'Cartão on-line autorizado';
  if(order.pagamento_status==='pago')return'Pago on-line';
  const balance=balanceForOrder(order);
  return balance>0?`${money(balance)} pendente`:'Pago';
}
function ordersForTable(tableId){return orders.filter(order=>String(order.mesa_id)===String(tableId)&&isOpen(order))}

function bind(){
  window.FSRuntime.bindModalDismiss(closeModals);
  el('order-filter').onchange=renderOrders;
  el('charge-order').onclick=beginPayment;
  el('approve-order').onclick=approveSelected;
  el('finalize-order').onclick=()=>finalizeOrder(selected);
  el('payment-form').onsubmit=pay;
  el('cash-session-toggle').onclick=toggleCashSession;
}

function openModal(id){
  el(id).classList.add('open');
  document.body.style.overflow='hidden';
}
function closeModals(){
  document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));
  document.body.style.overflow='';
}

function render(){
  const active=orders.filter(isOpen);
  const occupied=new Set(active.filter(order=>order.mesa_id).map(order=>String(order.mesa_id)));
  const today=new Date().toDateString();
  const manualToday=payments.filter(payment=>new Date(payment.created_at).toDateString()===today).reduce((sum,payment)=>sum+Number(payment.valor||0),0);
  const onlineToday=orders.filter(order=>{
    if(!isOnlinePaid(order))return false;
    const timestamp=order.pagamento_confirmado_em||order.pagamento_autorizado_em;
    return timestamp&&new Date(timestamp).toDateString()===today;
  }).reduce((sum,order)=>sum+Number(order.total||0),0);
  el('m-open').textContent=active.length;
  el('m-tables').textContent=occupied.size;
  el('m-pending').textContent=money(active.reduce((sum,order)=>sum+balanceForOrder(order),0));
  el('m-paid').textContent=money(manualToday+onlineToday);
  renderSession();
  renderOrders();
  renderTables();
}

function renderSession(){
  const status=el('cash-session-status'),button=el('cash-session-toggle'),summary=el('cash-session-summary'),quickSale=el('quick-sale');
  status.textContent=cashSummary.aberto?'Caixa aberto':'Caixa fechado';
  status.className=`status ${cashSummary.aberto?'pronto':'cancelado'}`;
  button.textContent=cashSummary.aberto?'Fechar caixa':'Abrir caixa';
  button.className=`btn ${cashSummary.aberto?'btn-danger':'btn-primary'}`;
  quickSale.disabled=cashRequiredAndClosed();
  quickSale.title=cashRequiredAndClosed()?'Abra o caixa para realizar vendas':'';
  if(cashSummary.aberto){
    const opened=cashSummary.aberto_em?new Date(cashSummary.aberto_em).toLocaleString('pt-BR'):'agora';
    summary.hidden=false;
    summary.innerHTML=`<div class="row-card"><div class="order-main"><b>Sessão aberta em ${escapeHtml(opened)}</b><small>${Number(cashSummary.quantidade_pagamentos||0)} recebimento(s) nesta sessão</small></div><b>Dinheiro esperado: ${money(cashSummary.valor_esperado)}</b></div><div class="cash-session-breakdown"><span>Inicial ${money(cashSummary.valor_inicial)}</span><span>Dinheiro ${money(cashSummary.dinheiro)}</span><span>Pix ${money(cashSummary.pix)}</span><span>Crédito ${money(cashSummary.credito)}</span><span>Débito ${money(cashSummary.debito)}</span><span>Vale ${money(cashSummary.vale)}</span></div>`;
  }else{
    summary.hidden=!cashRequiredAndClosed();
    summary.innerHTML=cashRequiredAndClosed()?'<div class="cash-alert warning">Abra o caixa para liberar cobranças e vendas rápidas.</div>':'';
  }
}

function renderOrders(){
  const filter=el('order-filter').value;
  const list=orders.filter(order=>order.tipo!=='mesa'&&isOpen(order)&&(!filter||order.tipo===filter));
  el('online-orders').innerHTML=list.map(order=>{
    const status=Status.normalize(order.status);
    return `<article class="order-card" data-order="${escapeHtml(order.id)}"><div class="order-main"><b>#${escapeHtml(order.codigo||order.id)} • ${escapeHtml(order.clientes?.nome||typeLabel(order.tipo))}</b><small>${escapeHtml(typeLabel(order.tipo))} • ${new Date(order.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small></div><div><span class="status ${Status.css(status)}">${escapeHtml(Status.label(status,order.tipo))}</span><b>${escapeHtml(paymentState(order))}</b></div></article>`;
  }).join('')||'<div class="empty-state">Nenhum pedido em aberto.</div>';
  document.querySelectorAll('[data-order]').forEach(card=>card.onclick=()=>showOrder(card.dataset.order));
}

function renderTables(){
  el('tables-grid').innerHTML=tables.map(table=>{
    const tableOrders=ordersForTable(table.id),busy=tableOrders.length>0;
    const total=tableOrders.reduce((sum,order)=>sum+Number(order.total||0),0);
    const balance=tableOrders.reduce((sum,order)=>sum+balanceForOrder(order),0);
    const allServed=busy&&tableOrders.every(order=>order.status==='servido');
    const state=!busy?'Disponível':allServed?(balance>0?'Servida • pagamento pendente':'Servida • paga'):`${tableOrders.length} pedido${tableOrders.length===1?'':'s'} em andamento`;
    return `<article class="feature-card ${busy?'danger-zone':''}" data-table="${escapeHtml(table.id)}"><span class="status ${busy?'cancelado':'pronto'}">${escapeHtml(state)}</span><h3>${escapeHtml(tableLabel(table))}</h3><p>${busy?`${tableOrders.length} pedido${tableOrders.length===1?'':'s'} • ${balance>0?money(balance)+' pendente':money(total)+' pago'}`:'Sem pedido em andamento'}</p></article>`;
  }).join('')||'<div class="empty-state">Nenhuma mesa ativa cadastrada.</div>';
  document.querySelectorAll('[data-table]').forEach(card=>card.onclick=()=>showTable(card.dataset.table));
}

function orderItems(order){
  return(order.itens_pedido||[]).map(item=>`<div class="row-card"><div class="order-main"><b>${Number(item.quantidade)}x ${escapeHtml(item.nome_produto)}</b><small>${escapeHtml(item.observacoes||'Sem observações')}</small></div><b>${money(Number(item.total)||Number(item.valor_unitario)*Number(item.quantidade))}</b></div>`).join('');
}

function showOrder(id){
  selected=orders.find(order=>String(order.id)===String(id));
  if(!selected)return;
  selectedOrders=[selected];
  const table=selected.mesas?tableLabel(selected.mesas):null,paid=paidForOrder(selected),balance=balanceForOrder(selected),status=Status.normalize(selected.status);
  el('cash-order-title').textContent=`Pedido #${selected.codigo||selected.id}`;
  el('cash-order-detail').innerHTML=`<div class="row-card"><div class="order-main"><b>${escapeHtml(table||typeLabel(selected.tipo))}</b><small>${escapeHtml(selected.clientes?.nome||'Atendimento sem cliente')} • ${escapeHtml(selected.clientes?.telefone||'Sem telefone')}</small></div><span class="status ${Status.css(status)}">${escapeHtml(Status.label(status,selected.tipo))}</span></div><div class="product-list">${orderItems(selected)}</div><div class="row-card"><span>Total do pedido</span><b>${money(selected.total)}</b></div><div class="row-card"><span>Total recebido</span><b>${money(paid)}</b></div><div class="cart-total"><span>Saldo restante</span><strong>${money(balance)}</strong></div>${isOnlinePaid(selected)?`<div class="cash-alert success" role="status">${escapeHtml(paymentState(selected))}. Uma nova cobrança foi bloqueada.</div>`:''}${status==='servido'&&balance>0?'<div class="cash-alert warning">A mesa permanece ocupada até a quitação integral.</div>':''}`;
  el('approve-order').hidden=selected.rawStatus!=='aguardando_aprovacao';
  el('charge-order').hidden=!canCharge(selected);
  el('charge-order').textContent='Realizar cobrança';
  el('finalize-order').hidden=!canFinalize(selected);
  openModal('cash-order-modal');
}

function showTable(tableId){
  const table=tables.find(item=>String(item.id)===String(tableId)),tableOrders=ordersForTable(tableId);
  if(!table||!tableOrders.length)return;
  selected=null;
  selectedOrders=tableOrders.filter(canCharge);
  const total=tableOrders.reduce((sum,order)=>sum+Number(order.total||0),0),paid=tableOrders.reduce((sum,order)=>sum+paidForOrder(order),0),balance=tableOrders.reduce((sum,order)=>sum+balanceForOrder(order),0);
  el('cash-order-title').textContent=`Conta • ${tableLabel(table)}`;
  el('cash-order-detail').innerHTML=`<div class="row-card"><span>Pedidos em atendimento</span><b>${tableOrders.length}</b></div><div class="product-list">${tableOrders.map(order=>`<div class="row-card"><div class="order-main"><b>#${escapeHtml(order.codigo||order.id)} • ${escapeHtml(Status.label(order.status,order.tipo))}</b><small>${(order.itens_pedido||[]).reduce((sum,item)=>sum+Number(item.quantidade||0),0)} item(ns) • ${escapeHtml(paymentState(order))}</small></div><div><b>${money(order.total)}</b><button class="link-button" type="button" data-table-order="${escapeHtml(order.id)}">Detalhes</button>${canFinalize(order)?`<button class="link-button" type="button" data-finalize-table-order="${escapeHtml(order.id)}">Finalizar</button>`:''}</div></div>`).join('')}</div><div class="row-card"><span>Total da conta</span><b>${money(total)}</b></div><div class="row-card"><span>Total recebido</span><b>${money(paid)}</b></div><div class="cart-total"><span>Saldo da conta</span><strong>${money(balance)}</strong></div>`;
  el('approve-order').hidden=true;
  el('finalize-order').hidden=true;
  el('charge-order').hidden=selectedOrders.length===0;
  el('charge-order').textContent=selectedOrders.length>1?`Cobrar conta (${selectedOrders.length} pedidos)`:'Realizar cobrança';
  el('cash-order-detail').querySelectorAll('[data-table-order]').forEach(button=>button.onclick=()=>showOrder(button.dataset.tableOrder));
  el('cash-order-detail').querySelectorAll('[data-finalize-table-order]').forEach(button=>button.onclick=()=>{
    const order=tableOrders.find(item=>String(item.id)===button.dataset.finalizeTableOrder);
    finalizeOrder(order);
  });
  openModal('cash-order-modal');
}

function beginPayment(){
  const chargeable=selectedOrders.filter(canCharge);
  if(!chargeable.length)return alert(cashRequiredAndClosed()?'Abra o caixa antes de registrar recebimentos.':'Não há saldo disponível para cobrança.');
  selectedOrders=chargeable;
  const balance=selectedOrders.reduce((sum,order)=>sum+balanceForOrder(order),0);
  closeModals();
  el('payment-context').textContent=selectedOrders.length>1?`${selectedOrders.length} pedidos • conta agrupada`:`Pedido #${selectedOrders[0].codigo||selectedOrders[0].id}`;
  el('payment-total').value=money(balance);
  document.querySelector('#payment-form [name=amount]').value=balance.toFixed(2).replace('.',',');
  openModal('payment-modal');
}

async function approveSelected(){
  if(!selected||selected.rawStatus!=='aguardando_aprovacao')return;
  if(!confirm('Aprovar este pedido e enviar para a cozinha?'))return;
  const button=el('approve-order'),label=button.textContent;
  button.disabled=true;button.textContent='Aprovando...';
  const{error}=await db.rpc('aprovar_pedido_caixa',{p_pedido_id:Number(selected.id)});
  button.disabled=false;button.textContent=label;
  if(error)return alert(error.message||'Não foi possível aprovar o pedido.');
  closeModals();await refresh();
}

async function finalizeOrder(order){
  if(!canFinalize(order))return alert('Este atendimento ainda não pode ser finalizado.');
  if(!confirm(`Finalizar o atendimento #${order.codigo||order.id}?`))return;
  const{error}=await db.rpc('atualizar_status_pedido_operacional',{p_pedido_id:Number(order.id),p_novo_status:'finalizado',p_origem:'caixa'});
  if(error)return alert(error.message||'Não foi possível finalizar o atendimento.');
  closeModals();await refresh();
}

async function pay(event){
  event.preventDefault();
  if(!selectedOrders.length)return;
  const form=event.currentTarget,data=new FormData(form),amount=parseMoney(data.get('amount'));
  const balance=selectedOrders.reduce((sum,order)=>sum+balanceForOrder(order),0);
  if(!Number.isFinite(amount)||amount<=0)return alert('Informe um valor válido.');
  if(amount>balance)return alert(`O valor excede o saldo restante de ${money(balance)}.`);
  const submit=form.querySelector('button[type="submit"]'),previousText=submit.textContent;
  submit.disabled=true;submit.textContent='Registrando...';
  const payload={
    estabelecimento_id:store.id,
    pedido_id:selectedOrders[0].id,
    pedido_ids:selectedOrders.map(order=>order.id),
    valor:amount,
    forma_pagamento:data.get('method')==='voucher'?'vale':data.get('method'),
    referencia:String(data.get('reference')||'').trim()||null,
    observacoes:String(data.get('notes')||'').trim()||null
  };
  const{data:result,error}=await db.rpc('registrar_pagamento_caixa',{payload});
  submit.disabled=false;submit.textContent=previousText;
  if(error)return alert(error.message);
  closeModals();form.reset();selected=null;selectedOrders=[];await refresh();
  if(result?.finalizados>0)return alert(`Pagamento registrado. ${result.finalizados} atendimento(s) finalizado(s).`);
  if(result?.quitado)return alert('Pagamento integral registrado. O atendimento seguirá aberto até a conclusão operacional.');
  alert(`Pagamento registrado. Saldo restante: ${money(result?.saldo)}.`);
}

function parseMoney(value){
  const normalized=String(value??'').trim().replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');
  return Number(normalized);
}

async function toggleCashSession(){
  const button=el('cash-session-toggle'),label=button.textContent;
  if(cashSummary.aberto){
    const expected=Number(cashSummary.valor_esperado||0);
    if(!confirm(`Fechar o caixa?\n\nDinheiro esperado: ${money(expected)}\nOutros meios: ${money(Number(cashSummary.total_recebido||0)-Number(cashSummary.dinheiro||0))}`))return;
    const value=prompt('Valor em dinheiro contado na gaveta:',expected.toFixed(2).replace('.',','));
    if(value===null)return;
    const finalValue=parseMoney(value);
    if(!Number.isFinite(finalValue)||finalValue<0)return alert('Informe um valor final válido.');
    const notes=prompt('Observação do fechamento (opcional):','')||'';
    button.disabled=true;button.textContent='Fechando...';
    const{error}=await db.rpc('fechar_caixa',{p_estabelecimento:store.id,p_valor:finalValue,p_obs:notes});
    button.disabled=false;button.textContent=label;
    if(error)return alert(error.message);
    const difference=finalValue-expected;
    await refresh();
    return alert(`Caixa fechado. Diferença apurada: ${money(difference)}.`);
  }
  const value=prompt('Valor inicial em dinheiro:','0,00');
  if(value===null)return;
  const initialValue=parseMoney(value);
  if(!Number.isFinite(initialValue)||initialValue<0)return alert('Informe um valor inicial válido.');
  button.disabled=true;button.textContent='Abrindo...';
  const{error}=await db.rpc('abrir_caixa',{p_estabelecimento:store.id,p_valor:initialValue});
  button.disabled=false;button.textContent=label;
  if(error)return alert(error.message);
  await refresh();
}

init().catch(error=>{console.error(error);alert('Não foi possível carregar o caixa.')});
