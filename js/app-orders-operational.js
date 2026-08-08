(()=>{
  if(!(window.FSDeliveryRoute?.matchesPage?.('app')||/(^|\/)app(?:\.html)?$/i.test(location.pathname)))return;
  const db=window.supabaseClient;
  const state={store:null,orders:[],payments:[],events:[],filter:'ativos',selected:null,channel:null,loading:false,mounted:false};
  const{money,escapeHtml:esc,byId:el}=window.FSRuntime;
  const filters=[
    ['ativos','Todos ativos'],['aguardando_aprovacao','Aguardando aprovação'],['confirmado','Fila da cozinha'],['preparo','Em preparo'],['pronto','Prontos'],['servido','Servidos'],['saiu_entrega','Em rota'],['finalizado','Finalizados'],['cancelado','Cancelados']
  ];

  function overrideLegacy(){
    try{window.setupOrdersUI=()=>{};window.renderOrders=()=>{};window.advanceOrder=id=>openOrder(id)}catch{}
  }

  function markup(){
    return `<div class="fs-orders-shell"><div class="fs-orders-head"><div><h1>Pedidos</h1><p>Acompanhe cada atendimento da aprovação ao pagamento e conclusão.</p></div><button class="btn btn-primary" id="fs-new-order" type="button">Novo pedido</button></div><div class="fs-order-filters" id="fs-order-filters" role="tablist"></div><div id="fs-orders-error"></div><div class="fs-orders-list" id="fs-orders-list"><div class="empty-state">Carregando pedidos...</div></div><div class="fs-orders-compat" aria-hidden="true"><div id="order-status-tabs"></div><div id="orders-active-list"></div><b id="count-novo"></b><b id="count-preparo"></b><b id="count-pronto"></b><b id="count-entregue"></b></div></div>`;
  }

  function ensureModal(){
    if(el('fs-order-modal'))return;
    const modal=document.createElement('div');
    modal.className='modal';modal.id='fs-order-modal';
    modal.innerHTML=`<div class="modal-card"><div class="modal-head"><h2 id="fs-order-modal-title">Pedido</h2><button class="icon-btn" data-fs-close type="button">×</button></div><div id="fs-order-modal-detail"></div><div class="fs-order-modal-actions"><button class="btn btn-secondary" id="fs-order-print" type="button">Imprimir</button><button class="btn btn-danger" id="fs-order-cancel" type="button">Cancelar pedido</button><button class="btn btn-secondary" id="fs-order-cash" type="button">Abrir caixa</button><button class="btn btn-primary" id="fs-order-action" type="button">Avançar</button></div></div>`;
    document.body.appendChild(modal);
    modal.onclick=event=>{if(event.target===modal||event.target.closest('[data-fs-close]'))closeModal()};
    el('fs-order-print').onclick=()=>window.print();
    el('fs-order-cash').onclick=()=>location.href='caixa';
    el('fs-order-action').onclick=()=>{const action=nextAction(state.selected);if(action)runAction(state.selected,action)};
    el('fs-order-cancel').onclick=()=>{if(state.selected)runAction(state.selected,{status:'cancelado',label:'Cancelar pedido'})};
  }

  function mount(){
    const page=el('pedidos');if(!page)return false;
    if(page.dataset.fsOperationalOrders==='true')return true;
    page.dataset.fsOperationalOrders='true';page.innerHTML=markup();state.mounted=true;
    el('fs-new-order').onclick=()=>location.href='balcao';
    ensureModal();renderFilters();render();return true;
  }

  function count(filter){
    if(filter==='ativos')return state.orders.filter(order=>FSOrderStatus.active.includes(order.status)).length;
    return state.orders.filter(order=>order.status===filter).length;
  }

  function renderFilters(){
    const host=el('fs-order-filters');if(!host)return;
    host.innerHTML=filters.map(([value,label])=>`<button class="fs-order-filter ${state.filter===value?'active':''}" type="button" data-fs-filter="${value}">${esc(label)} <b>${count(value)}</b></button>`).join('');
    host.querySelectorAll('[data-fs-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.fsFilter;renderFilters();render()});
  }

  function paid(orderId){return state.payments.filter(item=>String(item.pedido_id)===String(orderId)).reduce((sum,item)=>sum+Number(item.valor||0),0)}
  function balance(order){return Math.max(Number(order.total||0)-paid(order.id),0)}
  function tableName(order){return order.mesas?.nome||order.mesas?.identificacao||order.mesas?.numero?order.mesas?.nome||`Mesa ${order.mesas?.numero??order.mesas?.identificacao??''}`:null}
  function address(order){
    if(order.tipo!=='entrega')return '';
    const data=order.endereco_entrega;if(!data)return 'Endereço não informado';
    if(typeof data==='string')return data;
    return [data.logradouro||data.rua,data.numero,data.bairro,data.cidade,data.complemento].filter(Boolean).join(', ')||'Endereço não informado';
  }
  function reference(order){
    if(order.tipo==='mesa')return tableName(order)||'Mesa';
    if(order.tipo==='local')return order.clientes?.nome||'Consumo local';
    return order.clientes?.nome||FSOrderStatus.typeLabel(order.tipo);
  }
  function subtitle(order){
    if(order.tipo==='mesa')return 'Atendimento na mesa';
    if(order.tipo==='local')return 'Consumo no local';
    if(order.tipo==='retirada')return [order.clientes?.telefone,'Retirada no balcão'].filter(Boolean).join(' • ');
    return address(order);
  }
  function elapsed(value){const minutes=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));return minutes<1?'Agora':minutes<60?`${minutes} min`:minutes<1440?`${Math.floor(minutes/60)}h ${minutes%60}min`:new Date(value).toLocaleDateString('pt-BR')}

  function nextAction(order){
    if(!order)return null;
    const status=order.status,type=order.tipo;
    if(status==='aguardando_aprovacao')return{status:'confirmado',label:'Aprovar pedido'};
    if(status==='confirmado')return{status:'preparo',label:'Iniciar preparo'};
    if(status==='preparo')return{status:'pronto',label:'Marcar pronto'};
    if(status==='pronto'&&['mesa','local'].includes(type))return{status:'servido',label:'Marcar servido'};
    if(status==='pronto'&&type==='retirada')return{status:'finalizado',label:'Confirmar retirada'};
    if(status==='pronto'&&type==='entrega')return{status:'saiu_entrega',label:'Iniciar entrega'};
    if(status==='saiu_entrega'&&type==='entrega')return{status:'finalizado',label:'Confirmar entrega'};
    return null;
  }

  function filtered(){
    const list=state.filter==='ativos'?state.orders.filter(order=>FSOrderStatus.active.includes(order.status)):state.orders.filter(order=>order.status===state.filter);
    return [...list].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  }

  function card(order){
    const action=nextAction(order),saldo=balance(order),itemCount=(order.itens_pedido||[]).reduce((sum,item)=>sum+Number(item.quantidade||0),0);
    const payment=saldo>0?`<small class="is-pending">${money(saldo)} pendente</small>`:'<small class="is-paid">Pago</small>';
    return `<article class="fs-order-card status-${esc(order.status)}" data-fs-order="${esc(order.id)}"><div class="fs-order-card-top"><div><div class="fs-order-number"><strong>#${esc(order.codigo||order.numero||order.id)}</strong><span class="status ${FSOrderStatus.css(order.status)}">${esc(FSOrderStatus.label(order.status,order.tipo))}</span></div><span class="fs-order-reference">${esc(reference(order))}</span><small>${esc(subtitle(order))}</small></div><div class="fs-order-total"><b>${money(order.total)}</b>${payment}</div></div><div class="fs-order-card-middle"><div class="fs-order-meta"><span>${esc(FSOrderStatus.typeLabel(order.tipo))}</span><span>${new Date(order.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span><span>${elapsed(order.created_at)}</span><span>${itemCount} ${itemCount===1?'item':'itens'}</span></div></div><div class="fs-order-items">${(order.itens_pedido||[]).slice(0,4).map(item=>`<span class="fs-order-item-chip">${Number(item.quantidade)}x ${esc(item.nome_produto)}</span>`).join('')}${(order.itens_pedido||[]).length>4?`<span class="fs-order-item-chip">+${order.itens_pedido.length-4}</span>`:''}</div>${order.status==='servido'&&saldo>0?`<div class="fs-order-payment-warning">Mesa servida e ainda ocupada. Saldo pendente: ${money(saldo)}.</div>`:''}<div class="fs-order-card-foot"><button class="btn btn-secondary" type="button" data-fs-detail="${esc(order.id)}">Ver detalhes</button><div class="fs-order-actions">${order.status==='servido'&&saldo>0?'<button class="btn btn-secondary" type="button" data-fs-cash>Abrir caixa</button>':''}${action?`<button class="btn btn-primary" type="button" data-fs-action="${esc(order.id)}">${esc(action.label)}</button>`:''}</div></div></article>`;
  }

  function render(){
    const host=el('fs-orders-list');if(!host)return;
    const list=filtered();host.innerHTML=list.length?list.map(card).join(''):'<div class="empty-state">Nenhum pedido nesta etapa.</div>';
    host.querySelectorAll('[data-fs-detail]').forEach(button=>button.onclick=event=>{event.stopPropagation();openOrder(button.dataset.fsDetail)});
    host.querySelectorAll('[data-fs-order]').forEach(node=>node.onclick=event=>{if(!event.target.closest('button'))openOrder(node.dataset.fsOrder)});
    host.querySelectorAll('[data-fs-action]').forEach(button=>button.onclick=event=>{event.stopPropagation();const order=state.orders.find(item=>String(item.id)===button.dataset.fsAction),action=nextAction(order);if(action)runAction(order,action)});
    host.querySelectorAll('[data-fs-cash]').forEach(button=>button.onclick=event=>{event.stopPropagation();location.href='caixa'});
    updateDashboard();
    document.dispatchEvent(new CustomEvent('fs:orders:rendered'));
  }

  function updateDashboard(){
    const today=new Date().toDateString(),todayOrders=state.orders.filter(order=>new Date(order.created_at).toDateString()===today),revenue=todayOrders.filter(order=>order.status!=='cancelado').reduce((sum,order)=>sum+Number(order.total||0),0);
    const set=(id,value)=>{const node=el(id);if(node)node.textContent=value};
    set('metric-orders',todayOrders.length);set('summary-preparing',state.orders.filter(order=>['confirmado','preparo'].includes(order.status)).length);set('home-preparing',state.orders.filter(order=>['confirmado','preparo'].includes(order.status)).length);set('metric-revenue',money(revenue));set('metric-ticket',money(todayOrders.length?revenue/todayOrders.length:0));
  }

  function timeline(order){
    const events=state.events.filter(event=>String(event.pedido_id)===String(order.id)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    return events.length?events.map(event=>`<div class="fs-order-event"><span class="fs-order-event-dot"></span><div><b>${esc(FSOrderStatus.label(event.status_novo,order.tipo))}</b><small>${new Date(event.created_at).toLocaleString('pt-BR')} • ${esc(event.origem||'sistema')}</small></div></div>`).join(''):'<div class="empty-state">Histórico ainda não disponível.</div>';
  }

  function openOrder(id){
    const order=state.orders.find(item=>String(item.id)===String(id));if(!order)return;state.selected=order;
    const saldo=balance(order),action=nextAction(order),modal=el('fs-order-modal');
    el('fs-order-modal-title').textContent=`Pedido #${order.codigo||order.numero||order.id}`;
    el('fs-order-modal-detail').innerHTML=`<div class="fs-order-detail-grid"><div class="row-card"><div><small>Atendimento</small><b>${esc(FSOrderStatus.typeLabel(order.tipo))}</b></div></div><div class="row-card"><div><small>Status</small><b>${esc(FSOrderStatus.label(order.status,order.tipo))}</b></div></div><div class="row-card"><div><small>Cliente ou mesa</small><b>${esc(reference(order))}</b></div></div><div class="row-card"><div><small>Pagamento</small><b>${saldo>0?money(saldo)+' pendente':'Pago'}</b></div></div></div>${order.tipo==='entrega'?`<div class="row-card"><div><small>Endereço</small><b>${esc(address(order))}</b></div></div>`:''}<div class="product-list">${(order.itens_pedido||[]).map(item=>`<div class="row-card"><div><b>${Number(item.quantidade)}x ${esc(item.nome_produto)}</b><small>${esc(item.observacoes||'Sem observações')}</small></div><b>${money(Number(item.total)||Number(item.valor_unitario)*Number(item.quantidade))}</b></div>`).join('')}</div><div class="cart-total"><span>Total</span><strong>${money(order.total)}</strong></div>${order.status==='servido'&&saldo>0?`<div class="fs-order-payment-warning">A mesa permanece ocupada até o pagamento integral de ${money(saldo)}.</div>`:''}<h3>Linha do tempo</h3><div class="fs-order-timeline">${timeline(order)}</div>`;
    const actionButton=el('fs-order-action');actionButton.hidden=!action;if(action)actionButton.textContent=action.label;
    el('fs-order-cash').hidden=!(order.status==='servido'&&saldo>0);
    el('fs-order-cancel').hidden=FSOrderStatus.isFinal(order.status)||order.status==='servido';
    modal.classList.add('open');document.body.style.overflow='hidden';
    document.dispatchEvent(new CustomEvent('fs:orders:modal-opened'));
  }

  function closeModal(){el('fs-order-modal')?.classList.remove('open');document.body.style.overflow='';state.selected=null}

  async function runAction(order,action){
    if(!order||!action)return;
    const messages={confirmado:'Aprovar este pedido?',preparo:'Iniciar o preparo?',pronto:'Confirmar que o pedido está pronto?',servido:'Confirmar que foi servido? A mesa seguirá ocupada até o pagamento.',saiu_entrega:'Iniciar esta entrega?',finalizado:'Confirmar a conclusão?',cancelado:'Cancelar este pedido?'};
    if(!confirm(messages[action.status]||'Confirmar alteração?'))return;
    try{
      const result=await db.rpc('atualizar_status_pedido_operacional',{p_pedido_id:Number(order.id),p_novo_status:action.status,p_origem:action.status==='servido'?'garcom':'admin'});
      if(result.error)throw result.error;
      closeModal();await load();renderFilters();render();
    }catch(error){alert(error.message||'Não foi possível atualizar o pedido.')}
  }

  async function load(){
    if(state.loading||!state.store)return;state.loading=true;
    try{
      const[ordersResult,paymentsResult,eventsResult]=await Promise.all([
        db.from('pedidos').select('id,numero,codigo,status,tipo,total,forma_pagamento,endereco_entrega,observacoes,created_at,mesa_id,clientes(nome,telefone),mesas(numero,identificacao,nome),itens_pedido(quantidade,nome_produto,observacoes,total,valor_unitario)').eq('estabelecimento_id',state.store.id).order('created_at',{ascending:false}).limit(300),
        db.from('pagamentos').select('pedido_id,valor,forma_pagamento,created_at').eq('estabelecimento_id',state.store.id),
        db.from('pedido_eventos').select('pedido_id,status_anterior,status_novo,origem,created_at').eq('estabelecimento_id',state.store.id).order('created_at',{ascending:true}).limit(1500)
      ]);
      const error=ordersResult.error||paymentsResult.error||eventsResult.error;if(error)throw error;
      state.orders=(ordersResult.data||[]).map(order=>({...order,status:FSOrderStatus.normalize(order.status)}));state.payments=paymentsResult.data||[];state.events=eventsResult.data||[];
      el('fs-orders-error').innerHTML='';
    }catch(error){console.error(error);if(el('fs-orders-error'))el('fs-orders-error').innerHTML=`<div class="fs-order-error">Erro ao carregar pedidos: ${esc(error.message)}</div>`}
    finally{state.loading=false}
  }

  function subscribe(){
    state.channel=db.channel(`admin-orders-operational-${state.store.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'pedidos',filter:`estabelecimento_id=eq.${state.store.id}`},async()=>{await load();renderFilters();render()})
      .on('postgres_changes',{event:'*',schema:'public',table:'pagamentos',filter:`estabelecimento_id=eq.${state.store.id}`},async()=>{await load();renderFilters();render()})
      .on('postgres_changes',{event:'*',schema:'public',table:'pedido_eventos',filter:`estabelecimento_id=eq.${state.store.id}`},async()=>{await load();render()})
      .subscribe();
  }

  async function boot(){
    await window.FSRuntime.ensureGlobal('FSOrderStatus','js/pedido-status.js');overrideLegacy();
    const context=await window.FSRuntime.requireOwnedStore();if(!context)return;
    state.store=context.store;
    mount();await load();renderFilters();render();subscribe();
    const observer=new MutationObserver(()=>{const page=el('pedidos');if(page&&!page.querySelector('.fs-orders-shell')){page.dataset.fsOperationalOrders='';mount();renderFilters();render()}});
    observer.observe(document.body,{subtree:true,childList:true});
    setTimeout(()=>{mount();renderFilters();render()},1200);
    const requested=new URLSearchParams(location.hash.split('?')[1]||'').get('pedido');if(requested)setTimeout(()=>openOrder(requested),800);
    document.addEventListener('fs:orders:refresh',async()=>{await load();renderFilters();render()});
  }

  window.FSAdminOrders={openOrder,refresh:async()=>{await load();renderFilters();render()}};
  boot().catch(error=>console.error('Falha no painel operacional de pedidos:',error));
})();
