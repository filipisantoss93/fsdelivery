(()=>{
'use strict';
const db=window.supabaseClient;
const params=new URLSearchParams(location.search);
const slug=String(params.get('loja')||'').trim();
const requestedPhone=String(params.get('telefone')||'');
const requestedOrder=String(params.get('pedido')||'');
const container=document.getElementById('customer-orders');
const form=document.getElementById('customer-lookup-form');
const modal=document.getElementById('customer-order-modal');
const phoneInput=document.getElementById('lookup-phone');
let orders=[];
let activeOrderCode='';
let pollTimer=null;
let loading=false;

const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const normalize=value=>String(value||'').replace(/\D/g,'');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatDate=value=>new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});

function stageFor(order){
  const status=String(order.status||'novo').toLowerCase();
  const delivery=String(order.status_entrega||'').toLowerCase();
  if(['rejeitado'].includes(status))return{index:-1,label:'Pedido não aprovado',error:true};
  if(['cancelado'].includes(status))return{index:-1,label:'Pedido cancelado',error:true};
  if(['entregue'].includes(delivery)||['entregue','finalizado'].includes(status))return{index:4,label:'Pedido entregue'};
  if(['saiu_entrega','em_entrega'].includes(status)||['em_rota','saiu_entrega','em_entrega'].includes(delivery))return{index:3,label:'Saiu para entrega'};
  if(['pronto','aguardando_entregador','aguardando_retirada'].includes(status)||['aguardando_entregador','pronto'].includes(delivery))return{index:2,label:order.tipo==='entrega'?'Aguardando entregador':'Pronto para retirada'};
  if(['confirmado','aceito','preparo','em_preparo','andamento'].includes(status))return{index:1,label:'Em andamento'};
  return{index:0,label:'Aguardando aprovação'};
}

const stageLabels=['Aguardando aprovação','Em andamento','Aguardando entregador','Saiu para entrega','Pedido entregue'];

function addressLabel(order){
  const address=order.endereco_entrega;
  if(order.tipo==='mesa')return'Pedido na mesa';
  if(order.tipo==='retirada')return'Retirada no estabelecimento';
  if(order.tipo==='local')return'Consumo no local';
  if(!address)return'Endereço não informado';
  if(typeof address==='string')return address;
  return address.texto||address.endereco||[address.logradouro,address.numero,address.complemento,address.bairro,address.cidade,address.estado].filter(Boolean).join(', ')||'Endereço não informado';
}

function injectStyles(){
  if(document.getElementById('customer-order-modern-style'))return;
  const style=document.createElement('style');
  style.id='customer-order-modern-style';
  style.textContent=`
    .customer-order-card{cursor:pointer;transition:.18s ease}.customer-order-card:active{transform:scale(.99)}
    .customer-order-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.customer-order-card-status{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eef8ef;color:#2d743e;font-size:12px;font-weight:800}.customer-order-card-status.error{background:#fff0f0;color:#b43c3c}
    .customer-order-meta{color:var(--muted);font-size:13px}.customer-order-items{margin:10px 0;color:var(--muted)}
    .customer-order-refresh{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:14px 0}.customer-order-refresh small{color:var(--muted)}
    .customer-order-timeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:18px 4px}.customer-order-step{position:relative;text-align:center;color:#9b8c80;font-size:11px;font-weight:700;padding:0 3px}.customer-order-step:before{content:'';display:block;width:14px;height:14px;border-radius:50%;background:#ded4cb;margin:0 auto 8px;position:relative;z-index:2}.customer-order-step:after{content:'';position:absolute;top:6px;left:-50%;width:100%;height:2px;background:#ded4cb}.customer-order-step:first-child:after{display:none}.customer-order-step.done{color:#2d743e}.customer-order-step.done:before,.customer-order-step.done:after{background:#3d9250}.customer-order-step.current:before{box-shadow:0 0 0 4px rgba(61,146,80,.18)}
    .customer-order-state{padding:14px 16px;border-radius:12px;background:#eef8ef;color:#2d743e;font-weight:800;margin-bottom:12px}.customer-order-state.error{background:#fff0f0;color:#b43c3c}
    .customer-order-empty{padding:28px;text-align:center}.customer-order-error-detail{margin-top:8px;color:#a34a4a;font-size:13px}
    @media(max-width:560px){.customer-order-timeline{grid-template-columns:1fr}.customer-order-step{text-align:left;padding:8px 0 8px 30px;font-size:13px}.customer-order-step:before{position:absolute;left:2px;top:7px;margin:0}.customer-order-step:after{left:8px;top:-12px;width:2px;height:28px}}
  `;
  document.head.appendChild(style);
}

function render(){
  injectStyles();
  if(!orders.length){
    container.innerHTML=`<div class="empty-state customer-order-empty"><h3>Nenhum pedido encontrado</h3><p>Confira o WhatsApp informado ou faça um novo pedido.</p><a class="btn btn-primary" href="loja?loja=${encodeURIComponent(slug)}">Abrir cardápio</a></div>`;
    return;
  }
  container.innerHTML=`<div class="customer-order-refresh"><div><h2>Seus pedidos</h2><small>${orders.length} pedido(s) encontrado(s) nos últimos 90 dias.</small></div><button class="btn btn-secondary" id="refresh-customer-orders" type="button">Atualizar</button></div><div class="customer-order-grid">${orders.map(order=>{
    const stage=stageFor(order);
    return `<article class="customer-order-card" data-id="${esc(order.codigo||order.id)}"><div class="customer-order-card-head"><div><small class="customer-order-meta">Pedido #${esc(order.codigo||order.id)} • ${formatDate(order.created_at)}</small><h3>${esc(stage.label)}</h3></div><span class="customer-order-card-status${stage.error?' error':''}">${esc(stage.label)}</span></div><p class="customer-order-items">${(order.itens||[]).map(item=>`${Number(item.quantidade)||1}x ${esc(item.nome)}`).join(' • ')}</p><strong>${money(order.total)}</strong></article>`;
  }).join('')}</div>`;
  document.getElementById('refresh-customer-orders').onclick=()=>lookup(phoneInput.value,{silent:true,preserveModal:true});
  container.querySelectorAll('[data-id]').forEach(card=>card.onclick=()=>openOrder(card.dataset.id));
}

function openOrder(code){
  const order=orders.find(item=>String(item.codigo||item.id).toLowerCase()===String(code).toLowerCase());
  if(!order)return;
  activeOrderCode=String(order.codigo||order.id);
  const stage=stageFor(order);
  document.getElementById('customer-order-title').textContent=`Pedido #${activeOrderCode}`;
  const timeline=stage.error?'':`<div class="customer-order-timeline">${stageLabels.map((label,index)=>`<div class="customer-order-step ${index<=stage.index?'done':''} ${index===stage.index?'current':''}">${esc(order.tipo!=='entrega'&&index===2?'Pronto para retirada':label)}</div>`).join('')}</div>`;
  document.getElementById('customer-order-detail').innerHTML=`<div class="customer-order-state${stage.error?' error':''}">${esc(stage.label)}</div>${timeline}<div class="receipt"><p><b>Modalidade:</b> ${esc(({mesa:'Mesa',local:'Consumo local',retirada:'Retirada',entrega:'Entrega'})[order.tipo]||order.tipo)}</p><p><b>Destino:</b> ${esc(addressLabel(order))}</p><p><b>Pagamento:</b> ${esc(order.forma_pagamento||'Não informado')}</p>${(order.itens||[]).map(item=>`<div class="receipt-line"><span>${Number(item.quantidade)||1}x ${esc(item.nome)}${item.observacoes?`<small>${esc(item.observacoes)}</small>`:''}</span><b>${money(item.total)}</b></div>`).join('')}<div class="receipt-line"><span>Subtotal</span><b>${money(order.subtotal)}</b></div>${Number(order.taxa_entrega)>0?`<div class="receipt-line"><span>Taxa de entrega</span><b>${money(order.taxa_entrega)}</b></div>`:`<div class="receipt-line"><span>Entrega</span><b>Grátis</b></div>`}<div class="receipt-total"><span>Total</span><b>${money(order.total)}</b></div></div><button class="btn btn-secondary" id="refresh-current-order" type="button">Atualizar status</button>`;
  document.getElementById('refresh-current-order').onclick=()=>lookup(phoneInput.value,{silent:true,preserveModal:true});
  modal.classList.add('open');
  document.body.style.overflow='hidden';
  startPolling();
}

async function lookup(phone,{silent=false,preserveModal=false}={}){
  if(loading)return;
  if(!slug){
    container.innerHTML='<div class="empty-state"><h3>Loja não informada</h3><p>Abra esta página pelo link do cardápio.</p></div>';
    return;
  }
  const normalized=normalize(phone);
  if(normalized.length<10||normalized.length>13){
    container.innerHTML='<div class="empty-state">Informe um WhatsApp válido.</div>';
    phoneInput.focus();
    return;
  }
  loading=true;
  localStorage.setItem(`fsdelivery_customer_phone_${slug}`,normalized);
  if(!silent)container.innerHTML='<div class="empty-state">Consultando pedidos...</div>';
  try{
    const {data,error}=await db.rpc('consultar_pedidos_cliente',{p_slug:slug,p_telefone:normalized});
    if(error)throw error;
    orders=Array.isArray(data)?data:[];
    render();
    if(preserveModal&&activeOrderCode)openOrder(activeOrderCode);
    else if(requestedOrder)openOrder(requestedOrder);
    else if(orders.length===1)openOrder(orders[0].codigo||orders[0].id);
  }catch(error){
    console.error('Falha ao consultar pedidos:',error);
    container.innerHTML=`<div class="empty-state customer-order-empty"><h3>Não foi possível consultar os pedidos</h3><p>Tente novamente em alguns segundos.</p><div class="customer-order-error-detail">${esc(error?.message||'Falha inesperada')}</div><button class="btn btn-primary" id="retry-customer-orders" type="button">Tentar novamente</button></div>`;
    document.getElementById('retry-customer-orders').onclick=()=>lookup(normalized);
  }finally{loading=false}
}

function startPolling(){
  clearInterval(pollTimer);
  pollTimer=setInterval(()=>{
    if(document.visibilityState==='visible'&&activeOrderCode)lookup(phoneInput.value,{silent:true,preserveModal:true});
  },7000);
}

form.onsubmit=event=>{event.preventDefault();requestedOrder='';lookup(phoneInput.value)};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{modal.classList.remove('open');document.body.style.overflow='';activeOrderCode='';clearInterval(pollTimer)});

if(slug){
  document.querySelectorAll('a[href="loja.html"]').forEach(link=>link.href=`loja?loja=${encodeURIComponent(slug)}`);
  const saved=requestedPhone||localStorage.getItem(`fsdelivery_customer_phone_${slug}`)||'';
  if(saved){phoneInput.value=saved;lookup(saved)}
}
})();