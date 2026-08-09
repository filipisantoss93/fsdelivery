(()=>{
  'use strict';
  if(!(window.FSDeliveryRoute?.matchesPage?.('loja')||/(^|\/)loja(?:\.html)?$/i.test(location.pathname)))return;
  if(window.__fsLojaPosEnvio)return;
  window.__fsLojaPosEnvio=true;

  const db=window.supabaseClient;
  const Access=window.FSCustomerOrderAccess;
  if(!db||!Access){console.error('Rastreamento de pedidos indisponível: dependência não carregada.');return}

  const byId=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const extractCode=text=>String(text||'').match(/Pedido\s+#([^\s.,]+)/i)?.[1]||'';
  const lastOrderKey=Access.keys.lastOrder(slug);
  const phoneKey=Access.keys.phone(slug);
  const claimTasks=new Map();
  let lastPhone='';
  let cartSnapshot=[];
  let checkoutSnapshot={};
  let currentOrder=null;
  let checkoutProof=null;
  let trackingTimer=0;
  let trackingStartedAt=0;
  let trackerState={claim:'idle',message:'',recoveryCode:'',updatedAt:null};

  function snapshotCheckout(){
    lastPhone=Access.normalizePhone(byId('customer-phone')?.value);
    try{cartSnapshot=Array.isArray(window.cart)?window.cart.map(item=>({...item})):[]}catch{cartSnapshot=[]}
    const form=byId('checkout-form');
    if(!form)return;
    const data=new FormData(form);
    checkoutSnapshot={
      nome:String(data.get('name')||'').trim(),
      pagamento:String(data.get('payment')||'').trim(),
      tipo:typeof window.type==='function'?window.type():'delivery',
      endereco:String(byId('customer-address')?.value||'').trim()
    };
  }

  function orderItems(order){
    if(Array.isArray(order?.itens)&&order.itens.length){
      return order.itens.map(item=>({
        quantidade:item.quantidade||item.qty||1,
        nome:item.nome||item.nome_produto||item.name||'Item',
        observacoes:item.observacoes||item.note||'',
        total:item.total??((item.preco||item.price||0)*(item.quantidade||item.qty||1))
      }));
    }
    return cartSnapshot.map(item=>({
      quantidade:item.qty||1,
      nome:item.name||item.nome||'Item',
      observacoes:item.note||'',
      total:(item.price||item.preco||0)*(item.qty||1)
    }));
  }

  function addressLabel(order){
    const value=order?.endereco_entrega;
    if(typeof value==='string')return value;
    if(value?.texto)return value.texto;
    return checkoutSnapshot.endereco||'';
  }

  function trackingAccessMarkup(){
    if(trackerState.claim==='active'){
      return '<div class="fs-tracking-access success"><b>Acompanhamento ativado</b><span>Este pedido está protegido e vinculado a este aparelho.</span></div>';
    }
    if(trackerState.claim==='error'){
      return `<div class="fs-tracking-access error" role="alert"><div><b>Acompanhamento ainda não ativado</b><span>${esc(trackerState.message||'Tente novamente para proteger o acesso ao pedido.')}</span></div><button type="button" id="fs-retry-order-claim">Tentar novamente</button></div>`;
    }
    return '<div class="fs-tracking-access pending" role="status"><span class="fs-tracking-spinner" aria-hidden="true"></span><div><b>Protegendo seu pedido</b><span>Vinculando o acompanhamento a este aparelho...</span></div></div>';
  }

  function renderTracker(order,code){
    currentOrder=order||currentOrder||{codigo:code,status:'aguardando_aprovacao',tipo:checkoutSnapshot.tipo,itens:orderItems(null)};
    const modal=byId('success-modal');
    const host=modal?.querySelector('.modal-card')||modal;
    if(!host)return;
    let tracker=byId('fs-order-tracker');
    if(!tracker){
      tracker=document.createElement('section');
      tracker.id='fs-order-tracker';
      tracker.className='fs-order-tracker';
      host.appendChild(tracker);
    }

    const status=Access.statusFor(currentOrder);
    const payment=Access.paymentFor(currentOrder);
    const items=orderItems(currentOrder);
    const total=currentOrder.total??items.reduce((sum,item)=>sum+Number(item.total||0),0);
    const address=addressLabel(currentOrder);
    const updated=trackerState.updatedAt?new Date(trackerState.updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'aguardando primeira atualização';
    const recovery=trackerState.claim==='active'&&trackerState.recoveryCode
      ?`<div class="fs-order-recovery"><div><small>Código para recuperar este pedido em outro aparelho</small><strong>${esc(Access.formatRecoveryCode(trackerState.recoveryCode))}</strong><span>Guarde este código. Cada recuperação gera um novo.</span></div><button type="button" id="fs-copy-recovery-code">Copiar código</button></div>`
      :'';
    const timeline=status.terminal&&status.step<0
      ?''
      :`<div class="fs-public-order-timeline">${status.labels.map((label,index)=>`<div class="fs-public-order-step ${index<=status.step?'done':''} ${index===status.step?'current':''}">${esc(label)}</div>`).join('')}</div>`;

    tracker.innerHTML=`<div class="fs-order-tracker-head"><small>Pedido #${esc(currentOrder.codigo||code)}</small><h3>Acompanhe seu pedido</h3><p>O andamento atualiza automaticamente enquanto você mantém esta tela aberta.</p></div>${trackingAccessMarkup()}<div class="fs-public-order-current${status.tone==='error'?' is-error':''}">${esc(status.label)}</div>${timeline}<div class="fs-order-summary"><h4>Resumo do pedido</h4>${items.map(item=>`<div class="fs-order-item"><span>${Number(item.quantidade)||1}x ${esc(item.nome)}${item.observacoes?`<small>${esc(item.observacoes)}</small>`:''}</span><b>${money(item.total)}</b></div>`).join('')}<div class="fs-order-summary-row"><span>Pagamento</span><b>${esc(payment.label)}</b></div>${address?`<div class="fs-order-summary-row"><span>Entrega</span><b>${esc(address)}</b></div>`:''}<div class="fs-order-summary-row fs-order-total"><span>Total</span><b>${money(total)}</b></div></div>${recovery}<div class="fs-order-refresh"><span>Atualizado: ${esc(updated)}</span><button type="button" id="fs-refresh-order" ${trackerState.claim==='active'?'':'disabled'}>Atualizar agora</button></div>`;

    byId('fs-refresh-order')?.addEventListener('click',()=>refreshOrder(code,true));
    byId('fs-retry-order-claim')?.addEventListener('click',()=>checkoutProof&&claimCompletedOrder(checkoutProof));
    byId('fs-copy-recovery-code')?.addEventListener('click',async event=>{
      try{
        await navigator.clipboard.writeText(Access.formatRecoveryCode(trackerState.recoveryCode));
        event.currentTarget.textContent='Código copiado';
      }catch{event.currentTarget.textContent='Não foi possível copiar'}
    });
  }

  async function refreshOrder(code,manual=false){
    if(!db||!slug||!lastPhone||!code||trackerState.claim!=='active')return null;
    const token=Access.readText(Access.keys.token(slug,lastPhone));
    if(!token)return null;
    try{
      const{data,error}=await db.rpc('consultar_pedidos_cliente',{p_slug:slug,p_telefone:lastPhone,p_token:token});
      if(error)throw error;
      const order=(Array.isArray(data)?data:[]).find(item=>String(item.codigo||item.id).toLowerCase()===String(code).toLowerCase());
      if(order){
        currentOrder=order;
        trackerState.updatedAt=new Date().toISOString();
        renderTracker(order,code);
        return order;
      }
      if(manual)trackerState.message='O pedido ainda não está disponível para atualização.';
    }catch(error){
      console.warn('Falha ao atualizar acompanhamento:',error);
      if(manual){trackerState.message='Não foi possível atualizar agora. Verifique sua conexão e tente novamente.';renderTracker(currentOrder,code)}
    }
    return null;
  }

  function stopTracking(){
    if(trackingTimer)clearTimeout(trackingTimer);
    trackingTimer=0;
  }

  function scheduleTracking(code,delay=12000){
    stopTracking();
    if(document.visibilityState==='hidden'||Access.statusFor(currentOrder).terminal)return;
    trackingTimer=setTimeout(async()=>{
      const order=await refreshOrder(code);
      if(order&&!Access.statusFor(order).terminal){
        const elapsed=Date.now()-trackingStartedAt;
        scheduleTracking(code,elapsed<60000?12000:20000);
      }
    },delay);
  }

  async function performClaim(proof){
    const code=String(proof?.codigo||extractCode(byId('success-message')?.textContent));
    const phone=Access.normalizePhone(proof?.telefone||lastPhone||byId('customer-phone')?.value);
    if(!slug||!code||!Access.validPhone(phone)||!proof?.checkoutToken){
      throw new Error('Comprovante do pedido incompleto. Atualize a página e tente novamente.');
    }

    lastPhone=phone;
    checkoutProof={...proof,codigo:code,telefone:phone};
    const token=Access.ensureDeviceToken(slug,phone);
    const recoveryCode=Access.readRecoveryCode(slug,code)||Access.createRecoveryCode();
    const createdAt=proof.criado_em||new Date().toISOString();
    Access.write(lastOrderKey,{codigo:code,telefone:phone,criado_em:createdAt,checkoutToken:proof.checkoutToken,recoveryCode,vinculado:false});
    Access.writeText(phoneKey,phone);
    trackerState={claim:'pending',message:'',recoveryCode,updatedAt:null};

    const message=byId('success-message');
    if(message)message.textContent=`Pedido #${code} enviado com sucesso.`;
    const link=byId('track-order-link');
    if(link){
      link.href=`cliente?${new URLSearchParams({loja:slug,pedido:code}).toString()}`;
      link.textContent='Abrir meus pedidos';
    }
    renderTracker(null,code);

    const{data,error}=await db.rpc('vincular_pedido_dispositivo',{
      p_slug:slug,
      p_telefone:phone,
      p_checkout_token:proof.checkoutToken,
      p_token:token,
      p_codigo_recuperacao:recoveryCode
    });
    if(error)throw error;
    if(!data?.vinculado)throw new Error('O pedido não recebeu autorização de acompanhamento.');

    Access.saveRecoveryCode(slug,code,recoveryCode);
    Access.write(lastOrderKey,{codigo:code,telefone:phone,criado_em:createdAt,recoveryCode,vinculado:true});
    trackerState={claim:'active',message:'',recoveryCode,updatedAt:null};
    renderTracker(null,code);
    trackingStartedAt=Date.now();
    await refreshOrder(code);
    scheduleTracking(code);
    document.dispatchEvent(new CustomEvent('fs:public-order-created',{detail:{slug,codigo:code,telefone:phone}}));
    return data;
  }

  function claimCompletedOrder(proof){
    const key=String(proof?.checkoutToken||proof?.codigo||'');
    if(!key)return Promise.resolve(null);
    if(claimTasks.has(key))return claimTasks.get(key);
    const task=performClaim(proof).catch(error=>{
      console.warn('Não foi possível vincular o acompanhamento do pedido:',error);
      trackerState={...trackerState,claim:'error',message:error?.message||'Falha ao ativar o acompanhamento.'};
      const code=String(proof?.codigo||extractCode(byId('success-message')?.textContent));
      renderTracker(currentOrder,code);
      return null;
    }).finally(()=>claimTasks.delete(key));
    claimTasks.set(key,task);
    return task;
  }

  function restoreLastOrder(){
    const saved=Access.read(lastOrderKey,null);
    if(!saved?.codigo||!saved?.telefone)return;
    const age=Date.now()-new Date(saved.criado_em).getTime();
    if(!Number.isFinite(age)||age<0||age>24*60*60*1000)return;
    lastPhone=Access.normalizePhone(saved.telefone);
    if(saved.checkoutToken&&!saved.vinculado){
      checkoutProof={...saved,checkoutToken:saved.checkoutToken};
      const modal=byId('success-modal');
      const message=byId('success-message');
      if(message)message.textContent=`Pedido #${saved.codigo} já foi criado. Retomando o acompanhamento...`;
      modal?.classList.add('open');
      document.body.style.overflow='hidden';
      claimCompletedOrder(checkoutProof);
    }
  }

  function install(){
    const form=byId('checkout-form');
    if(!form||!byId('success-modal'))return false;
    form.addEventListener('submit',snapshotCheckout,true);
    document.addEventListener('fs:public-order-completed',event=>{
      checkoutProof=event.detail||null;
      claimCompletedOrder(checkoutProof);
    });
    document.addEventListener('click',event=>{
      if(event.target.closest?.('#submit-order-btn,#checkout-form .btn-primary'))snapshotCheckout();
    },true);
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible'&&currentOrder&&trackerState.claim==='active'){
        refreshOrder(currentOrder.codigo).then(()=>scheduleTracking(currentOrder.codigo));
      }else if(document.visibilityState==='hidden')stopTracking();
    });
    window.addEventListener('pagehide',stopTracking,{once:true});
    restoreLastOrder();
    return true;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();
