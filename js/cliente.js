(()=>{
  'use strict';
  const db=window.supabaseClient;
  const Access=window.FSCustomerOrderAccess;
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  let requestedOrder=String(params.get('pedido')||'').trim();
  const container=document.getElementById('customer-orders');
  const form=document.getElementById('customer-lookup-form');
  const modal=document.getElementById('customer-order-modal');
  const phoneInput=document.getElementById('lookup-phone');
  const accessFeedback=document.getElementById('customer-access-feedback');
  const syncStatus=document.getElementById('customer-sync-status');
  const recoveryPanel=document.getElementById('customer-recovery-panel');
  const recoveryForm=document.getElementById('customer-recovery-form');
  const recoveryPhone=document.getElementById('recovery-phone');
  const recoveryOrder=document.getElementById('recovery-order');
  const recoveryCode=document.getElementById('recovery-code');
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const date=value=>{
    const parsed=new Date(value);
    return Number.isNaN(parsed.getTime())?'Horário indisponível':parsed.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  };
  const phoneKey=Access?.keys.phone(slug);
  const lastOrderKey=Access?.keys.lastOrder(slug);
  let orders=[];
  let activeOrderCode='';
  let loading=false;
  let refreshTimer=0;
  let refreshedAt=null;

  if(!db||!Access||!container||!form||!modal||!phoneInput){
    console.error('Não foi possível iniciar a consulta de pedidos.');
    return;
  }

  function setFeedback(message,tone='info',code=''){
    if(!accessFeedback)return;
    accessFeedback.replaceChildren();
    if(!message){accessFeedback.hidden=true;return}
    const copy=document.createElement('div');
    copy.className=`customer-access-message ${tone}`;
    const text=document.createElement('span');
    text.textContent=message;
    copy.appendChild(text);
    if(code){
      const strong=document.createElement('strong');
      strong.textContent=Access.formatRecoveryCode(code);
      copy.appendChild(strong);
      const button=document.createElement('button');
      button.type='button';
      button.className='btn btn-secondary';
      button.textContent='Copiar código';
      button.addEventListener('click',async()=>{
        try{await navigator.clipboard.writeText(strong.textContent);button.textContent='Código copiado'}catch{button.textContent='Não foi possível copiar'}
      });
      copy.appendChild(button);
    }
    accessFeedback.appendChild(copy);
    accessFeedback.hidden=false;
  }

  function state(title,message,{recovery=false,retry=false}={}){
    container.innerHTML=`<div class="customer-state-card"><span class="customer-state-icon" aria-hidden="true">${recovery?'↻':'⌕'}</span><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="customer-state-actions">${recovery?'<button class="btn btn-primary" type="button" data-customer-action="recover">Recuperar um pedido</button>':''}${retry?'<button class="btn btn-secondary" type="button" data-customer-action="retry">Tentar novamente</button>':''}</div></div>`;
  }

  function updateSyncStatus(message=''){
    if(!syncStatus)return;
    syncStatus.textContent=message;
    syncStatus.hidden=!message;
  }

  function stopAutoRefresh(){
    if(refreshTimer)clearTimeout(refreshTimer);
    refreshTimer=0;
  }

  function scheduleAutoRefresh(){
    stopAutoRefresh();
    if(document.visibilityState==='hidden'||!orders.some(order=>!Access.statusFor(order).terminal))return;
    refreshTimer=setTimeout(async()=>{
      await lookup(phoneInput.value,{silent:true,preserve:true,automatic:true});
    },15000);
  }

  function address(order){
    const value=order.endereco_entrega;
    if(order.tipo==='mesa')return'Atendimento na mesa';
    if(order.tipo==='retirada')return'Retirada no estabelecimento';
    if(order.tipo==='local')return'Consumo no local';
    if(!value)return'Endereço não informado';
    if(typeof value==='string')return value;
    return value.texto||value.endereco||[value.logradouro,value.numero,value.complemento,value.bairro,value.cidade,value.estado].filter(Boolean).join(', ')||'Endereço não informado';
  }

  function render(){
    if(!orders.length){
      state('Nenhum pedido vinculado','Faça um novo pedido neste aparelho ou recupere um pedido usando o código de acesso.',{recovery:true});
      return;
    }
    const updateLabel=refreshedAt?`Atualizado às ${new Date(refreshedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:'Atualizando';
    container.innerHTML=`<div class="customer-orders-head"><div><h2>Pedidos deste aparelho</h2><small>${orders.length} pedido(s) protegido(s) nos últimos 90 dias • ${esc(updateLabel)}</small></div><button class="btn btn-secondary" id="refresh-customer-orders" type="button">Atualizar agora</button></div><div class="customer-order-grid">${orders.map(order=>{
      const status=Access.statusFor(order);
      const payment=Access.paymentFor(order);
      return`<article class="customer-order-card" data-order="${esc(order.codigo||order.id)}" tabindex="0" role="button" aria-label="Abrir pedido ${esc(order.codigo||order.id)}"><div class="customer-order-card-top"><div><div class="customer-order-code">Pedido #${esc(order.codigo||order.id)} • ${date(order.created_at)}</div><h3>${esc(status.label)}</h3></div><span class="customer-order-badge ${esc(status.tone)}">${esc(status.label)}</span></div><div class="customer-order-items">${(order.itens||[]).map(item=>`${Number(item.quantidade)||1}x ${esc(item.nome)}`).join(' • ')||'Itens do pedido'}</div><div class="customer-order-payment ${esc(payment.tone)}">${esc(payment.label)}</div><div class="customer-order-footer"><span>Ver detalhes e andamento</span><strong>${money(order.total)}</strong></div></article>`;
    }).join('')}</div>`;
    document.getElementById('refresh-customer-orders')?.addEventListener('click',()=>lookup(phoneInput.value,{silent:true,preserve:true}));
    container.querySelectorAll('[data-order]').forEach(card=>{
      const open=()=>openOrder(card.dataset.order);
      card.addEventListener('click',open);
      card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}});
    });
  }

  function eventsMarkup(order){
    const events=Array.isArray(order.eventos)?order.eventos:[];
    if(!events.length)return'<p class="customer-event-empty">As próximas mudanças de status aparecerão aqui.</p>';
    return`<div class="customer-event-list">${events.map(event=>{
      const eventStatus=Access.statusFor({...order,status:event.status,status_entrega:''});
      return`<div class="customer-event"><span class="customer-event-dot"></span><div><b>${esc(eventStatus.label)}</b><small>${date(event.created_at)}</small></div></div>`;
    }).join('')}</div>`;
  }

  function openOrder(code){
    const order=orders.find(item=>String(item.codigo||item.id).toLowerCase()===String(code).toLowerCase());
    if(!order)return;
    activeOrderCode=String(order.codigo||order.id);
    const status=Access.statusFor(order);
    const payment=Access.paymentFor(order);
    const recovery=Access.readRecoveryCode(slug,activeOrderCode);
    document.getElementById('customer-order-title').textContent=`Pedido #${activeOrderCode}`;
    document.getElementById('customer-order-detail').innerHTML=`<div class="customer-order-state ${esc(status.tone)}">${esc(status.label)}</div>${status.step<0?'':`<div class="customer-order-timeline">${status.labels.map((label,index)=>`<div class="customer-order-step ${index<=status.step?'done':''} ${index===status.step?'current':''}">${esc(label)}</div>`).join('')}</div>`}<div class="customer-order-meta"><span><small>Modalidade</small><b>${esc(({mesa:'Mesa',local:'Consumo local',retirada:'Retirada',entrega:'Entrega'})[order.tipo]||order.tipo)}</b></span><span><small>Pagamento</small><b>${esc(payment.label)}</b></span><span><small>Última mudança</small><b>${date(order.atualizado_em||order.created_at)}</b></span></div><div class="receipt"><p><b>Destino:</b> ${esc(address(order))}</p>${order.observacoes?`<p><b>Observações:</b> ${esc(order.observacoes)}</p>`:''}${(order.itens||[]).map(item=>`<div class="receipt-line"><span>${Number(item.quantidade)||1}x ${esc(item.nome)}${item.observacoes?`<small>${esc(item.observacoes)}</small>`:''}</span><b>${money(item.total)}</b></div>`).join('')}<div class="receipt-line"><span>Subtotal</span><b>${money(order.subtotal)}</b></div>${Number(order.taxa_entrega)>0?`<div class="receipt-line"><span>Taxa de entrega</span><b>${money(order.taxa_entrega)}</b></div>`:'<div class="receipt-line"><span>Entrega</span><b>Grátis</b></div>'}<div class="receipt-total"><span>Total</span><b>${money(order.total)}</b></div></div><section class="customer-events"><h3>Atualizações do pedido</h3>${eventsMarkup(order)}</section>${recovery?`<div class="customer-modal-recovery"><small>Código de recuperação deste pedido</small><strong>${esc(Access.formatRecoveryCode(recovery))}</strong><span>Guarde-o para trocar de aparelho.</span></div>`:''}`;
    modal.classList.add('open');
    document.body.style.overflow='hidden';
  }

  async function lookup(phone,{silent=false,preserve=false,automatic=false}={}){
    if(loading)return false;
    const normalized=Access.normalizePhone(phone);
    if(!slug){state('Loja não informada','Abra “Meus pedidos” pelo cardápio da loja.');return false}
    if(!Access.validPhone(normalized)){state('WhatsApp inválido','Informe o mesmo WhatsApp utilizado no pedido.');return false}
    const token=Access.readText(Access.keys.token(slug,normalized));
    if(!token){
      stopAutoRefresh();
      state('Aparelho ainda não vinculado','Para sua segurança, o telefone sozinho não libera pedidos. Faça um pedido neste aparelho ou use um código de recuperação.',{recovery:true});
      return false;
    }

    loading=true;
    if(!silent)state('Consultando pedidos','Validando este aparelho e carregando o andamento.');
    if(automatic)updateSyncStatus('Atualizando andamento...');
    try{
      const{data,error}=await db.rpc('consultar_pedidos_cliente',{p_slug:slug,p_telefone:normalized,p_token:token});
      if(error)throw error;
      orders=Array.isArray(data)?data:[];
      refreshedAt=new Date().toISOString();
      Access.writeText(phoneKey,normalized);
      render();
      if(preserve&&activeOrderCode)openOrder(activeOrderCode);
      else if(requestedOrder){openOrder(requestedOrder);requestedOrder=''}
      updateSyncStatus(orders.some(order=>!Access.statusFor(order).terminal)?'Atualização automática ativa':'Todos os pedidos estão concluídos');
      scheduleAutoRefresh();
      return true;
    }catch(error){
      console.error('Falha protegida ao consultar pedidos:',error);
      orders=[];
      stopAutoRefresh();
      state('Não foi possível validar este aparelho','A autorização pode ter expirado. Recupere o pedido com seu código de acesso ou tente novamente.',{recovery:true,retry:true});
      updateSyncStatus('Atualização interrompida');
      return false;
    }finally{loading=false}
  }

  function openRecovery(prefill={}){
    recoveryPanel.hidden=false;
    recoveryPhone.value=Access.normalizePhone(prefill.phone||phoneInput.value||'');
    recoveryOrder.value=String(prefill.order||requestedOrder||'');
    recoveryCode.value=Access.formatRecoveryCode(prefill.code||'');
    recoveryPanel.scrollIntoView({behavior:'smooth',block:'start'});
    (recoveryOrder.value?recoveryCode:recoveryOrder).focus({preventScroll:true});
  }

  async function recoverOrder(event){
    event.preventDefault();
    const phone=Access.normalizePhone(recoveryPhone.value);
    const orderCode=String(recoveryOrder.value||'').trim().toUpperCase();
    const oldCode=Access.normalizeRecoveryCode(recoveryCode.value);
    if(!Access.validPhone(phone)){setFeedback('Informe o WhatsApp usado no pedido.','error');recoveryPhone.focus();return}
    if(orderCode.length<3){setFeedback('Informe o número do pedido.','error');recoveryOrder.focus();return}
    if(oldCode.length!==10){setFeedback('O código de recuperação deve ter 10 caracteres.','error');recoveryCode.focus();return}

    const button=recoveryForm.querySelector('button[type="submit"]');
    const token=Access.ensureDeviceToken(slug,phone);
    const newCode=Access.createRecoveryCode();
    button.disabled=true;
    button.textContent='Validando código...';
    try{
      const{data,error}=await db.rpc('recuperar_pedido_dispositivo',{
        p_slug:slug,
        p_telefone:phone,
        p_codigo_pedido:orderCode,
        p_codigo_recuperacao:oldCode,
        p_token:token,
        p_novo_codigo_recuperacao:newCode
      });
      if(error)throw error;
      if(!data?.recuperado)throw new Error('Recuperação não confirmada');
      Access.saveRecoveryCode(slug,orderCode,newCode);
      Access.writeText(phoneKey,phone);
      phoneInput.value=phone;
      recoveryPanel.hidden=true;
      setFeedback('Pedido recuperado. O código antigo foi invalidado; guarde o novo código:','success',newCode);
      requestedOrder=orderCode;
      await lookup(phone);
    }catch(error){
      console.warn('Recuperação de pedido não autorizada:',error);
      setFeedback('Não foi possível recuperar. Confira pedido, WhatsApp e código. Após muitas tentativas, aguarde 15 minutos.','error');
    }finally{
      button.disabled=false;
      button.textContent='Recuperar neste aparelho';
    }
  }

  async function restoreLegacyOrder(saved){
    const attemptKey=`fsdelivery_legacy_restore_${slug}_${String(saved.codigo||'').toUpperCase()}`;
    if(sessionStorage.getItem(attemptKey))return false;
    sessionStorage.setItem(attemptKey,'1');
    const phone=Access.normalizePhone(saved.telefone);
    if(!saved.codigo||!Access.validPhone(phone)||!saved.criado_em)return false;
    const age=Date.now()-new Date(saved.criado_em).getTime();
    if(!Number.isFinite(age)||age<0||age>24*60*60*1000)return false;

    state('Restaurando acompanhamento','Reconhecemos um pedido recente feito neste aparelho. Aguarde a validação segura.');
    const token=Access.ensureDeviceToken(slug,phone);
    const newCode=Access.createRecoveryCode();
    try{
      const{data,error}=await db.rpc('vincular_pedido_legado_dispositivo',{
        p_slug:slug,
        p_telefone:phone,
        p_codigo_pedido:saved.codigo,
        p_criado_em_aproximado:saved.criado_em,
        p_token:token,
        p_codigo_recuperacao:newCode
      });
      if(error)throw error;
      if(!data?.vinculado)throw new Error('Restauração não confirmada');
      Access.saveRecoveryCode(slug,saved.codigo,newCode);
      Access.write(lastOrderKey,{codigo:saved.codigo,telefone:phone,criado_em:saved.criado_em,recoveryCode:newCode,vinculado:true});
      Access.writeText(phoneKey,phone);
      phoneInput.value=phone;
      requestedOrder=String(saved.codigo);
      setFeedback('Acompanhamento restaurado. Guarde o código para recuperar este pedido em outro aparelho:','success',newCode);
      return lookup(phone);
    }catch(error){
      console.warn('Pedido anterior não pôde ser restaurado automaticamente:',error);
      return lookup(phone,{silent:true});
    }
  }

  form.addEventListener('submit',event=>{
    event.preventDefault();
    requestedOrder='';
    activeOrderCode='';
    setFeedback('');
    lookup(phoneInput.value);
  });
  recoveryForm?.addEventListener('submit',recoverOrder);
  recoveryCode?.addEventListener('input',()=>{recoveryCode.value=Access.formatRecoveryCode(recoveryCode.value)});
  document.getElementById('cancel-customer-recovery')?.addEventListener('click',()=>{recoveryPanel.hidden=true});
  container.addEventListener('click',event=>{
    const action=event.target.closest('[data-customer-action]')?.dataset.customerAction;
    if(action==='recover')openRecovery();
    if(action==='retry')lookup(phoneInput.value);
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{
    modal.classList.remove('open');
    document.body.style.overflow='';
    activeOrderCode='';
  }));
  modal.addEventListener('click',event=>{if(event.target===modal)event.target.querySelector('[data-close]')?.click()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))modal.querySelector('[data-close]')?.click()});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&phoneInput.value&&orders.some(order=>!Access.statusFor(order).terminal))lookup(phoneInput.value,{silent:true,preserve:Boolean(activeOrderCode),automatic:true});
    else if(document.visibilityState==='hidden')stopAutoRefresh();
  });
  window.addEventListener('online',()=>{updateSyncStatus('Conexão restabelecida');if(phoneInput.value)lookup(phoneInput.value,{silent:true,preserve:Boolean(activeOrderCode),automatic:true})});
  window.addEventListener('offline',()=>{stopAutoRefresh();updateSyncStatus('Sem conexão — o andamento será retomado quando a internet voltar')});
  window.addEventListener('pagehide',stopAutoRefresh,{once:true});

  if(!slug){
    state('Loja não informada','Abra “Meus pedidos” pelo cardápio do estabelecimento.');
    return;
  }
  document.querySelectorAll('a[href^="loja"]').forEach(link=>link.href=`loja?loja=${encodeURIComponent(slug)}`);
  const savedPhone=Access.readText(phoneKey);
  const lastOrder=Access.read(lastOrderKey,null);
  const initialPhone=Access.normalizePhone(savedPhone||lastOrder?.telefone||'');
  if(initialPhone)phoneInput.value=initialPhone;
  if(initialPhone&&Access.readText(Access.keys.token(slug,initialPhone))){
    lookup(initialPhone);
  }else if(lastOrder){
    restoreLegacyOrder(lastOrder);
  }else{
    state('Consulte seus pedidos','Informe o WhatsApp usado na compra. Somente pedidos protegidos neste aparelho serão exibidos.',{recovery:true});
  }
})();
