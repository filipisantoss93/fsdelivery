(()=>{
  'use strict';
  if(!(window.FSDeliveryRoute?.matchesPage?.('loja')||/(^|\/)loja(?:\.html)?$/i.test(location.pathname)))return;
  if(window.__fsLojaPosEnvio)return;
  window.__fsLojaPosEnvio=true;

  const db=window.supabaseClient;
  const byId=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char]));
  const normalizePhone=value=>String(value||'').replace(/\D/g,'');
  const extractCode=text=>String(text||'').match(/Pedido\s+#([^\s.,]+)/i)?.[1]||'';
  const tokenKey=phone=>`fsdelivery_customer_token_${slug}_${normalizePhone(phone)}`;
  const phoneKey=`fsdelivery_customer_phone_${slug}`;
  const lastOrderKey=`fsdelivery_last_order_${slug||'public'}`;
  let lastPhone='',processedCode='',cartSnapshot=[],checkoutSnapshot={},currentOrder=null,checkoutProof=null;

  const stages=[{key:'approval',label:'Aguardando aprovação'},{key:'progress',label:'Em andamento'},{key:'driver',label:'Aguardando entregador'},{key:'route',label:'Saiu para entrega'},{key:'delivered',label:'Pedido entregue'}];

  function snapshotCheckout(){lastPhone=normalizePhone(byId('customer-phone')?.value);try{cartSnapshot=Array.isArray(window.cart)?window.cart.map(item=>({...item})):[]}catch{cartSnapshot=[]}const form=byId('checkout-form');if(form){const data=new FormData(form);checkoutSnapshot={nome:String(data.get('name')||'').trim(),pagamento:String(data.get('payment')||'').trim(),tipo:typeof window.type==='function'?window.type():'delivery',endereco:String(byId('customer-address')?.value||'').trim()}}}

  async function bindCustomerDevice(proof){
    const phone=normalizePhone(proof?.telefone||lastPhone);
    if(!db||!slug||!proof?.checkoutToken||phone.length<10)throw new Error('Comprovante do pedido indisponível para vincular este dispositivo.');
    const{data,error}=await db.rpc('vincular_dispositivo_cliente',{p_slug:slug,p_telefone:phone,p_checkout_token:proof.checkoutToken});
    if(error)throw error;
    if(!data)throw new Error('O dispositivo não recebeu autorização para consultar o histórico.');
    localStorage.setItem(tokenKey(phone),String(data));
    localStorage.setItem(phoneKey,phone);
    return String(data);
  }

  function normalizedStage(order){const status=String(order?.status||'novo').toLowerCase();if(['cancelado','rejeitado'].includes(status))return{index:-1,label:status==='rejeitado'?'Pedido não aprovado':'Pedido cancelado',error:true};if(['entregue','finalizado'].includes(status))return{index:4,label:'Pedido entregue'};if(['saiu_entrega','em_entrega'].includes(status))return{index:3,label:'Saiu para entrega'};if(['pronto','aguardando_entregador','aguardando_retirada'].includes(status))return{index:2,label:order?.tipo==='entrega'?'Aguardando entregador':'Pronto para retirada'};if(['confirmado','aceito','preparo','em_preparo','andamento'].includes(status))return{index:1,label:'Em andamento'};return{index:0,label:'Aguardando aprovação do restaurante'}}
  function orderItems(order){if(Array.isArray(order?.itens)&&order.itens.length)return order.itens.map(item=>({quantidade:item.quantidade||item.qty||1,nome:item.nome||item.nome_produto||item.name||'Item',observacoes:item.observacoes||item.note||'',total:item.total??((item.preco||item.price||0)*(item.quantidade||item.qty||1))}));return cartSnapshot.map(item=>({quantidade:item.qty||1,nome:item.name||item.nome||'Item',observacoes:item.note||'',total:(item.price||item.preco||0)*(item.qty||1)}))}
  function addressLabel(order){const value=order?.endereco_entrega;if(typeof value==='string')return value;if(value?.texto)return value.texto;return checkoutSnapshot.endereco||''}

  function renderTracker(order,code){
    currentOrder=order||currentOrder||{codigo:code,status:'novo',tipo:checkoutSnapshot.tipo,itens:orderItems(null)};
    const modal=byId('success-modal'),host=modal?.querySelector('.modal-card')||modal;if(!host)return;
    let tracker=byId('fs-order-tracker');if(!tracker){tracker=document.createElement('section');tracker.id='fs-order-tracker';tracker.className='fs-order-tracker';host.appendChild(tracker)}
    const stage=normalizedStage(currentOrder),items=orderItems(currentOrder),total=currentOrder.total??items.reduce((sum,item)=>sum+Number(item.total||0),0),payment=currentOrder.forma_pagamento||checkoutSnapshot.pagamento||'Não informado',address=addressLabel(currentOrder);
    tracker.innerHTML=`<div class="fs-order-tracker-head"><small>Pedido #${esc(currentOrder.codigo||code)}</small><h3>Acompanhe seu pedido</h3><p>O histórico fica disponível somente neste dispositivo autorizado após a compra.</p></div><div class="fs-public-order-current${stage.error?' is-error':''}">${esc(stage.label)}</div>${stage.error?'':`<div class="fs-public-order-timeline">${stages.map((item,index)=>`<div class="fs-public-order-step ${index<=stage.index?'done':''} ${index===stage.index?'current':''}">${esc(index===2&&currentOrder.tipo!=='entrega'?'Pronto para retirada':item.label)}</div>`).join('')}</div>`}<div class="fs-order-summary"><h4>Resumo do pedido</h4>${items.map(item=>`<div class="fs-order-item"><span>${Number(item.quantidade)||1}x ${esc(item.nome)}${item.observacoes?`<small>${esc(item.observacoes)}</small>`:''}</span><b>${money(item.total)}</b></div>`).join('')}<div class="fs-order-summary-row"><span>Pagamento</span><b>${esc(payment)}</b></div>${address?`<div class="fs-order-summary-row"><span>Entrega</span><b>${esc(address)}</b></div>`:''}<div class="fs-order-summary-row fs-order-total"><span>Total</span><b>${money(total)}</b></div></div><div class="fs-order-refresh"><span>Consulta protegida por dispositivo</span><button type="button" id="fs-refresh-order">Atualizar agora</button></div>`;
    byId('fs-refresh-order').onclick=()=>refreshOrder(code,true);
  }

  async function refreshOrder(code,manual=false){
    if(!db||!slug||!lastPhone||!code)return;
    const token=localStorage.getItem(tokenKey(lastPhone));
    if(!token){if(manual)console.warn('Este dispositivo ainda não foi autorizado para consultar o pedido.');return}
    try{const{data,error}=await db.rpc('consultar_pedidos_cliente',{p_slug:slug,p_telefone:lastPhone,p_token:token});if(error)throw error;const order=(data||[]).find(item=>String(item.codigo||item.id).toLowerCase()===String(code).toLowerCase());if(order)renderTracker(order,code);else if(manual)console.warn('Pedido ainda não disponível para consulta.')}catch(error){console.warn('Falha ao atualizar acompanhamento:',error)}
  }
  function startTracking(code){refreshOrder(code);setTimeout(()=>refreshOrder(code),1500);setTimeout(()=>refreshOrder(code),5000)}

  async function enhanceSuccess(){
    const modal=byId('success-modal'),message=byId('success-message'),link=byId('track-order-link');if(!modal?.classList.contains('open')||!message)return;
    const proof=checkoutProof||window.__fsLastPublicCheckout||null,code=String(proof?.codigo||extractCode(message.textContent)),phone=normalizePhone(proof?.telefone||lastPhone||byId('customer-phone')?.value);if(!code)return;
    lastPhone=phone;message.textContent=`Pedido #${code} enviado com sucesso.`;
    if(link){const query=new URLSearchParams({loja:slug,pedido:code});link.href=`cliente?${query.toString()}`;link.textContent='Abrir histórico de pedidos'}
    try{localStorage.setItem(lastOrderKey,JSON.stringify({codigo:code,telefone:phone,criado_em:new Date().toISOString()}));localStorage.setItem(phoneKey,phone)}catch{}
    renderTracker(null,code);
    if(code!==processedCode){
      processedCode=code;
      try{await bindCustomerDevice(proof)}catch(error){console.warn('Não foi possível vincular o dispositivo do cliente:',error);return}
      startTracking(code);
      document.dispatchEvent(new CustomEvent('fs:public-order-created',{detail:{slug,codigo:code,telefone:phone}}));
    }
  }

  function restoreLastOrder(){try{const saved=JSON.parse(localStorage.getItem(lastOrderKey)||'null');if(!saved?.codigo||!saved?.telefone)return;const age=Date.now()-new Date(saved.criado_em).getTime();if(age>24*60*60*1000)return;lastPhone=normalizePhone(saved.telefone)}catch{}}
  function install(){const form=byId('checkout-form'),modal=byId('success-modal');if(!form||!modal)return false;restoreLastOrder();form.addEventListener('submit',snapshotCheckout,true);document.addEventListener('fs:public-order-completed',event=>{checkoutProof=event.detail||null});document.addEventListener('click',event=>{if(event.target.closest?.('#submit-order-btn,#checkout-form .btn-primary')){snapshotCheckout();setTimeout(enhanceSuccess,180)}},true);modal.addEventListener('transitionend',enhanceSuccess);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&processedCode)refreshOrder(processedCode)});return true}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
