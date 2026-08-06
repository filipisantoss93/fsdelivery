(()=>{
  'use strict';
  if(!/(^|\/)loja\.html$/i.test(location.pathname))return;
  if(window.__fsLojaPosEnvio)return;
  window.__fsLojaPosEnvio=true;

  const db=window.supabaseClient;
  const byId=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalizePhone=value=>String(value||'').replace(/\D/g,'');
  const extractCode=text=>String(text||'').match(/Pedido\s+#([^\s.,]+)/i)?.[1]||'';
  const tokenKey=phone=>`fsdelivery_customer_token_${slug}_${normalizePhone(phone)}`;
  const lastOrderKey=`fsdelivery_last_order_${slug||'public'}`;

  let lastPhone='';
  let processedCode='';
  let cartSnapshot=[];
  let checkoutSnapshot={};
  let pollingTimer=null;
  let currentOrder=null;

  const stages=[
    {key:'approval',label:'Aguardando aprovação'},
    {key:'progress',label:'Em andamento'},
    {key:'driver',label:'Aguardando entregador'},
    {key:'route',label:'Saiu para entrega'},
    {key:'delivered',label:'Pedido entregue'}
  ];

  function injectStyles(){
    if(byId('fs-order-tracker-style'))return;
    const style=document.createElement('style');
    style.id='fs-order-tracker-style';
    style.textContent=`
      .fs-order-tracker{margin-top:18px;text-align:left;border:1px solid rgba(95,62,39,.18);border-radius:16px;background:#fffaf5;overflow:hidden}
      .fs-order-tracker-head{padding:18px;border-bottom:1px solid rgba(95,62,39,.14)}
      .fs-order-tracker-head small{display:block;color:#806b5b;margin-bottom:5px}.fs-order-tracker-head h3{margin:0;font-size:22px}.fs-order-tracker-head p{margin:7px 0 0;color:#6f5b4c;line-height:1.45}
      .fs-order-current{margin:14px 18px 0;padding:14px 16px;border-radius:12px;background:#eef8ef;color:#26743a;font-weight:800}
      .fs-order-current.is-error{background:#fff0f0;color:#b43c3c}
      .fs-order-timeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;padding:20px 14px 16px}
      .fs-order-step{position:relative;text-align:center;color:#9b8c80;font-size:11px;font-weight:700;line-height:1.25;padding:0 3px}
      .fs-order-step:before{content:'';display:block;width:14px;height:14px;margin:0 auto 8px;border-radius:50%;background:#ddd3ca;border:3px solid #fff;box-shadow:0 0 0 1px #d4c5b9;position:relative;z-index:2}
      .fs-order-step:after{content:'';position:absolute;top:7px;left:-50%;width:100%;height:2px;background:#ddd3ca;z-index:1}.fs-order-step:first-child:after{display:none}
      .fs-order-step.done{color:#2d6e3d}.fs-order-step.done:before,.fs-order-step.done:after{background:#3c914f}.fs-order-step.current:before{box-shadow:0 0 0 4px rgba(60,145,79,.18)}
      .fs-order-summary{padding:0 18px 18px}.fs-order-summary h4{margin:8px 0 12px;font-size:16px}.fs-order-item,.fs-order-summary-row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(95,62,39,.1)}
      .fs-order-item span,.fs-order-summary-row span{min-width:0}.fs-order-item small{display:block;color:#806b5b;margin-top:3px}.fs-order-total{font-size:18px;font-weight:800;border-bottom:0;padding-top:14px}
      .fs-order-refresh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;background:#f7eee6;color:#6f5b4c;font-size:12px}.fs-order-refresh button{border:0;background:none;color:#c45b19;font-weight:800;padding:6px}
      @media(max-width:560px){.fs-order-timeline{grid-template-columns:1fr;padding:14px 18px}.fs-order-step{text-align:left;padding:8px 0 8px 30px;font-size:13px}.fs-order-step:before{position:absolute;left:2px;top:7px;margin:0}.fs-order-step:after{left:8px;top:-12px;width:2px;height:28px}.fs-order-step:first-child:after{display:none}}
    `;
    document.head.appendChild(style);
  }

  function snapshotCheckout(){
    lastPhone=normalizePhone(byId('customer-phone')?.value);
    try{
      cartSnapshot=Array.isArray(window.cart)?window.cart.map(item=>({...item})):[];
    }catch{cartSnapshot=[]}
    const form=byId('checkout-form');
    if(form){
      const data=new FormData(form);
      checkoutSnapshot={
        nome:String(data.get('name')||'').trim(),
        pagamento:String(data.get('payment')||'').trim(),
        tipo:typeof window.type==='function'?window.type():'delivery',
        endereco:String(byId('customer-address')?.value||'').trim()
      };
    }
  }

  async function bindCustomerDevice(code,phone){
    if(!db||!slug||!code||normalizePhone(phone).length<10)return;
    try{
      const {data,error}=await db.rpc('vincular_dispositivo_cliente',{p_slug:slug,p_telefone:normalizePhone(phone),p_codigo_pedido:String(code)});
      if(error)throw error;
      if(data)localStorage.setItem(tokenKey(phone),String(data));
    }catch(error){console.warn('Não foi possível vincular o dispositivo do cliente:',error)}
  }

  function normalizedStage(order){
    const status=String(order?.status||'novo').toLowerCase();
    if(['cancelado','rejeitado'].includes(status))return {index:-1,label:status==='rejeitado'?'Pedido não aprovado':'Pedido cancelado',error:true};
    if(['entregue','finalizado'].includes(status))return {index:4,label:'Pedido entregue'};
    if(['saiu_entrega','em_entrega'].includes(status))return {index:3,label:'Saiu para entrega'};
    if(['pronto','aguardando_entregador','aguardando_retirada'].includes(status))return {index:2,label:order?.tipo==='entrega'?'Aguardando entregador':'Pronto para retirada'};
    if(['confirmado','aceito','preparo','em_preparo','andamento'].includes(status))return {index:1,label:'Em andamento'};
    return {index:0,label:'Aguardando aprovação do restaurante'};
  }

  function orderItems(order){
    if(Array.isArray(order?.itens)&&order.itens.length)return order.itens.map(item=>({
      quantidade:item.quantidade||item.qty||1,
      nome:item.nome||item.nome_produto||item.name||'Item',
      observacoes:item.observacoes||item.note||'',
      total:item.total??((item.preco||item.price||0)*(item.quantidade||item.qty||1))
    }));
    return cartSnapshot.map(item=>({quantidade:item.qty||1,nome:item.name||item.nome||'Item',observacoes:item.note||'',total:(item.price||item.preco||0)*(item.qty||1)}));
  }

  function addressLabel(order){
    const value=order?.endereco_entrega;
    if(typeof value==='string')return value;
    if(value?.texto)return value.texto;
    return checkoutSnapshot.endereco||'';
  }

  function renderTracker(order,code){
    injectStyles();
    currentOrder=order||currentOrder||{codigo:code,status:'novo',tipo:checkoutSnapshot.tipo,itens:orderItems(null)};
    const modal=byId('success-modal');
    const host=modal?.querySelector('.modal-card')||modal;
    if(!host)return;
    let tracker=byId('fs-order-tracker');
    if(!tracker){tracker=document.createElement('section');tracker.id='fs-order-tracker';tracker.className='fs-order-tracker';host.appendChild(tracker)}
    const stage=normalizedStage(currentOrder);
    const items=orderItems(currentOrder);
    const total=currentOrder.total??items.reduce((sum,item)=>sum+Number(item.total||0),0);
    const payment=currentOrder.forma_pagamento||checkoutSnapshot.pagamento||'Não informado';
    const address=addressLabel(currentOrder);
    tracker.innerHTML=`
      <div class="fs-order-tracker-head"><small>Pedido #${esc(currentOrder.codigo||code)}</small><h3>Acompanhe seu pedido</h3><p>Esta tela será atualizada automaticamente conforme o restaurante e o entregador avançarem o pedido.</p></div>
      <div class="fs-order-current${stage.error?' is-error':''}">${esc(stage.label)}</div>
      ${stage.error?'':`<div class="fs-order-timeline">${stages.map((item,index)=>`<div class="fs-order-step ${index<=stage.index?'done':''} ${index===stage.index?'current':''}">${esc(index===2&&currentOrder.tipo!=='entrega'?'Pronto para retirada':item.label)}</div>`).join('')}</div>`}
      <div class="fs-order-summary"><h4>Resumo do pedido</h4>${items.map(item=>`<div class="fs-order-item"><span>${Number(item.quantidade)||1}x ${esc(item.nome)}${item.observacoes?`<small>${esc(item.observacoes)}</small>`:''}</span><b>${money(item.total)}</b></div>`).join('')}<div class="fs-order-summary-row"><span>Pagamento</span><b>${esc(payment)}</b></div>${address?`<div class="fs-order-summary-row"><span>Entrega</span><b>${esc(address)}</b></div>`:''}<div class="fs-order-summary-row fs-order-total"><span>Total</span><b>${money(total)}</b></div></div>
      <div class="fs-order-refresh"><span>Atualização automática ativa</span><button type="button" id="fs-refresh-order">Atualizar agora</button></div>`;
    byId('fs-refresh-order').onclick=()=>refreshOrder(code,true);
  }

  async function refreshOrder(code,manual=false){
    if(!db||!slug||!lastPhone||!code)return;
    try{
      const {data,error}=await db.rpc('consultar_pedidos_cliente',{p_slug:slug,p_telefone:lastPhone});
      if(error)throw error;
      const order=(data||[]).find(item=>String(item.codigo||item.id).toLowerCase()===String(code).toLowerCase());
      if(order)renderTracker(order,code);
      else if(manual)console.warn('Pedido ainda não disponível para consulta.');
    }catch(error){console.warn('Falha ao atualizar acompanhamento:',error)}
  }

  function startPolling(code){
    clearInterval(pollingTimer);
    refreshOrder(code);
    pollingTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshOrder(code)},7000);
  }

  function enhanceSuccess(){
    const modal=byId('success-modal');
    const message=byId('success-message');
    const link=byId('track-order-link');
    if(!modal?.classList.contains('open')||!message)return;
    const code=extractCode(message.textContent);
    const phone=lastPhone||normalizePhone(byId('customer-phone')?.value);
    if(!code)return;
    lastPhone=phone;
    message.textContent=`Pedido #${code} enviado com sucesso.`;
    if(link){
      const query=new URLSearchParams({loja:slug,telefone:phone,pedido:code});
      link.href=`cliente.html?${query.toString()}`;
      link.textContent='Abrir histórico de pedidos';
    }
    try{localStorage.setItem(lastOrderKey,JSON.stringify({codigo:code,telefone:phone,criado_em:new Date().toISOString()}))}catch{}
    renderTracker(null,code);
    startPolling(code);
    if(code!==processedCode){
      processedCode=code;
      bindCustomerDevice(code,phone);
      document.dispatchEvent(new CustomEvent('fs:public-order-created',{detail:{slug,codigo:code,telefone:phone}}));
    }
  }

  function restoreLastOrder(){
    try{
      const saved=JSON.parse(localStorage.getItem(lastOrderKey)||'null');
      if(!saved?.codigo||!saved?.telefone)return;
      const age=Date.now()-new Date(saved.criado_em).getTime();
      if(age>24*60*60*1000)return;
      lastPhone=normalizePhone(saved.telefone);
    }catch{}
  }

  function install(){
    const form=byId('checkout-form');
    const modal=byId('success-modal');
    if(!form||!modal)return false;
    restoreLastOrder();
    form.addEventListener('submit',snapshotCheckout,true);
    document.addEventListener('click',event=>{
      if(event.target.closest?.('#submit-order-btn,#checkout-form .btn-primary')){
        snapshotCheckout();
        setTimeout(enhanceSuccess,180);
      }
    },true);
    modal.addEventListener('transitionend',enhanceSuccess);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&processedCode)refreshOrder(processedCode)});
    return true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();