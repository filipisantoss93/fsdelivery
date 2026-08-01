const db=window.supabaseClient;
const byId=id=>document.getElementById(id);
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(value)||0)/100);
const dateTime=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const dateOnly=value=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
const digits=value=>String(value||'').replace(/\D/g,'');
const statusLabels={ativa:'Ativa',pendente:'Em processamento',vencida:'Vencida',cancelada:'Cancelada',falhou:'Falhou',paga:'Paga',expirada:'Expirada',waiting:'Aguardando',paid:'Paga',unpaid:'Não paga',canceled:'Cancelada'};
let session,user,store,plans=[],subscriptions=[],pixCharges=[],cardCharges=[],currentSubscription=null,currentPix=null,pixTimer=null;

function feedback(message,type='success'){
  const box=byId('subscription-feedback');
  box.textContent=message;
  box.classList.toggle('error',type==='error');
  box.hidden=false;
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function clearFeedback(){byId('subscription-feedback').hidden=true}
function functionError(error,data){return data?.erro||error?.context?.body?.erro||error?.message||'Não foi possível concluir a operação.'}
async function invoke(name,body={}){
  const {data,error}=await db.functions.invoke(name,{body});
  if(error||data?.erro)throw new Error(functionError(error,data));
  return data;
}
function currentFrom(items){
  return [...items].sort((a,b)=>{
    const activeA=['ativa','pendente'].includes(a.status)?0:1;
    const activeB=['ativa','pendente'].includes(b.status)?0:1;
    return activeA-activeB||new Date(b.updated_at)-new Date(a.updated_at);
  })[0]||null;
}
async function init(){
  const {data:{session:s}}=await db.auth.getSession();
  if(!s){location.replace('auth.html');return}
  session=s;user=s.user;
  const [storeResult,plansResult,subscriptionsResult,pixResult,cardResult]=await Promise.all([
    db.from('estabelecimentos').select('id,nome,plano,assinatura_status').eq('usuario_id',user.id).maybeSingle(),
    db.from('planos_assinatura').select('*').eq('ativo',true).order('meio_pagamento').order('intervalo_meses'),
    db.from('assinaturas').select('*,planos_assinatura(nome,codigo,valor_centavos,intervalo_meses)').eq('usuario_id',user.id).order('updated_at',{ascending:false}),
    db.from('cobrancas_pix').select('id,plano_id,status,valor_centavos,vence_em,pago_em,created_at,planos_assinatura(nome)').eq('usuario_id',user.id).order('created_at',{ascending:false}).limit(10),
    db.from('cobrancas_cartao').select('id,assinatura_id,status,valor_centavos,pago_em,created_at,planos_assinatura(nome)').eq('usuario_id',user.id).order('created_at',{ascending:false}).limit(10)
  ]);
  if(storeResult.error)throw storeResult.error;
  if(plansResult.error)throw plansResult.error;
  if(subscriptionsResult.error)throw subscriptionsResult.error;
  store=storeResult.data;plans=plansResult.data||[];subscriptions=subscriptionsResult.data||[];
  pixCharges=pixResult.data||[];cardCharges=cardResult.data||[];
  currentSubscription=currentFrom(subscriptions);
  prefillUser();renderCurrent();renderPlans();renderHistory();bind();
}
function prefillUser(){
  byId('customer-email').value=user.email||'';
  const name=user.user_metadata?.nome||user.user_metadata?.name||'';
  byId('customer-name').value=name;
  byId('card-holder-name').value=name;
}
function renderCurrent(){
  const s=currentSubscription;
  const status=byId('subscription-current-status');
  if(!s){
    byId('subscription-current-description').textContent='Nenhuma assinatura contratada. Escolha um plano abaixo.';
    byId('subscription-current-plan').textContent=store?.plano==='premium'?'Premium':'Período de teste';
    byId('subscription-current-method').textContent='—';
    byId('subscription-current-validity').textContent='—';
    byId('subscription-current-renewal').textContent='Desativada';
    status.textContent=store?.assinatura_status==='trial'?'Teste':'Sem assinatura';
    status.className='status';
    return;
  }
  const validity=s.acesso_valido_ate?dateOnly(s.acesso_valido_ate):'Aguardando confirmação';
  const validUntil=s.acesso_valido_ate&&new Date(s.acesso_valido_ate)>new Date();
  byId('subscription-current-description').textContent=s.status==='cancelada'&&validUntil?'Renovação cancelada; o acesso permanece até o fim do período pago.':'Situação sincronizada com as confirmações da Efí.';
  byId('subscription-current-plan').textContent=s.planos_assinatura?.nome||'FS Delivery';
  byId('subscription-current-method').textContent=s.meio_pagamento==='cartao'?`Cartão ${s.cartao_mascara||''}`.trim():'PIX';
  byId('subscription-current-validity').textContent=validity;
  byId('subscription-current-renewal').textContent=s.renovacao_automatica?'Automática':'Manual';
  status.textContent=statusLabels[s.status]||s.status;
  status.className=`status ${s.status==='ativa'?'pronto':s.status==='pendente'?'preparo':s.status==='cancelada'?'entregue':'cancelado'}`;
  const recurring=s.meio_pagamento==='cartao'&&s.renovacao_automatica&&['ativa','pendente'].includes(s.status);
  byId('update-card-button').hidden=!recurring;
  byId('cancel-subscription-button').hidden=!recurring;
}
function renderPlans(){
  const activeRecurring=currentSubscription?.meio_pagamento==='cartao'&&currentSubscription.renovacao_automatica&&['ativa','pendente'].includes(currentSubscription.status);
  byId('subscription-plans').innerHTML=plans.map(plan=>{
    const months=Number(plan.intervalo_meses)||1;
    const label=months===1?'Mensal':months===3?'Trimestral':months===6?'Semestral':months===12?'Anual':`${months} meses`;
    const featured=plan.codigo==='fsdelivery_anual_pix';
    const disabled=plan.meio_pagamento==='cartao'&&activeRecurring;
    return `<article class="subscription-plan-card ${featured?'is-featured':''}"><span class="subscription-method">${plan.meio_pagamento==='cartao'?'Cartão recorrente':'PIX'}</span><div><h3>${label}</h3><div class="subscription-plan-price">${money(plan.valor_centavos)}</div></div><p>${plan.meio_pagamento==='cartao'?'Renovação automática a cada mês.':`Acesso liberado por ${months} ${months===1?'mês':'meses'} após a confirmação.`}</p><button class="btn ${featured?'btn-primary':'btn-secondary'}" type="button" data-plan="${plan.id}" ${disabled?'disabled':''}>${disabled?'Recorrência já ativa':plan.meio_pagamento==='cartao'?'Assinar com cartão':'Gerar PIX'}</button></article>`;
  }).join('')||'<div class="empty-state">Nenhum plano disponível.</div>';
  document.querySelectorAll('[data-plan]').forEach(button=>button.onclick=()=>selectPlan(button.dataset.plan));
}
function renderHistory(){
  const items=[...pixCharges.map(item=>({...item,method:'PIX'})),...cardCharges.map(item=>({...item,method:'Cartão'}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,12);
  byId('subscription-history').innerHTML=items.length?items.map(item=>`<article class="row-card subscription-history-item"><div><b>${item.planos_assinatura?.nome||`Cobrança por ${item.method}`}</b><small>${item.method} • ${dateTime(item.created_at)}</small></div><div class="subscription-history-meta"><b>${money(item.valor_centavos)}</b><small>${statusLabels[item.status]||item.status}</small></div></article>`).join(''):'<div class="empty-state">Nenhuma cobrança registrada.</div>';
}
function selectPlan(id){
  clearFeedback();
  const plan=plans.find(item=>item.id===id);
  if(!plan)return;
  if(plan.meio_pagamento==='pix')createPix(plan);else openCardForm(plan,'create');
}
async function createPix(plan){
  const button=document.querySelector(`[data-plan="${plan.id}"]`);
  button.disabled=true;button.textContent='Gerando...';
  try{
    const data=await invoke('criar-pix-fsdelivery',{plano_id:plan.id});
    currentPix=data.cobranca;
    byId('pix-plan-name').textContent=plan.nome;
    byId('pix-plan-value').textContent=money(currentPix.valor_centavos);
    byId('pix-expiration').textContent=dateTime(currentPix.vence_em);
    byId('pix-copy-code').value=currentPix.pix_copia_cola||'';
    const image=byId('pix-qr-image');
    if(currentPix.qr_code_url){image.src=currentPix.qr_code_url;image.hidden=false;byId('pix-qr-placeholder').hidden=true}
    else{image.hidden=true;byId('pix-qr-placeholder').hidden=false;byId('pix-qr-placeholder').textContent='Use o código PIX Copia e Cola.'}
    byId('pix-status-text').textContent='Aguardando a confirmação do pagamento...';
    byId('pix-checkout').hidden=false;
    byId('pix-checkout').scrollIntoView({behavior:'smooth',block:'start'});
    startPixPolling();
  }catch(error){feedback(error.message,'error')}
  finally{button.disabled=false;button.textContent='Gerar PIX'}
}
function startPixPolling(){clearInterval(pixTimer);pixTimer=setInterval(()=>verifyPix(false),5000)}
async function verifyPix(showMessage=true){
  if(!currentPix)return;
  const button=byId('verify-pix-button');button.disabled=true;
  try{
    const data=await invoke('verificar-pix-fsdelivery',{id:currentPix.id});
    const charge=data.cobranca;
    if(!charge)throw new Error('Cobrança não encontrada.');
    byId('pix-status-text').textContent=`Status: ${statusLabels[charge.status]||charge.status}`;
    if(charge.status==='paga'){
      clearInterval(pixTimer);feedback('Pagamento confirmado. A assinatura foi ativada com sucesso.');setTimeout(()=>location.reload(),1800);
    }else if(['expirada','cancelada','falhou'].includes(charge.status)){
      clearInterval(pixTimer);feedback(`A cobrança foi ${statusLabels[charge.status]?.toLowerCase()||charge.status}. Gere um novo PIX.`,'error');
    }else if(showMessage)feedback('Pagamento ainda não identificado. A verificação automática continua ativa.');
  }catch(error){if(showMessage)feedback(error.message,'error')}
  finally{button.disabled=false}
}
function openCardForm(plan,mode){
  byId('card-plan-id').value=plan?.id||currentSubscription?.plano_id||'';
  byId('card-update-mode').value=mode;
  byId('card-checkout-title').textContent=mode==='update'?'Atualizar cartão':'Assinar com cartão';
  byId('submit-card-subscription').textContent=mode==='update'?'Salvar novo cartão':'Confirmar assinatura';
  byId('card-customer-section').hidden=mode==='update';
  byId('card-consent').required=mode==='create';
  byId('card-checkout').hidden=false;
  byId('card-checkout').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeCardForm(){byId('card-checkout').hidden=true;byId('card-subscription-form').reset();prefillUser()}
async function tokenizeCard(){
  if(!window.EfiPay?.CreditCard)throw new Error('A biblioteca segura de cartão não foi carregada. Desative bloqueadores e tente novamente.');
  const config=await invoke('config-assinatura-cartao-fsdelivery',{});
  if(await EfiPay.CreditCard.isScriptBlocked())throw new Error('O recurso antifraude da Efí foi bloqueado pelo navegador. Desative o bloqueador para concluir.');
  const number=digits(byId('card-number').value);
  const brand=await EfiPay.CreditCard.setCardNumber(number).verifyCardBrand();
  if(!brand||['undefined','unsupported'].includes(brand))throw new Error('Bandeira do cartão não aceita.');
  return EfiPay.CreditCard.setAccount(config.payee_code).setEnvironment(config.environment).setCreditCardData({brand,number,cvv:digits(byId('card-cvv').value),expirationMonth:digits(byId('card-expiration-month').value).padStart(2,'0'),expirationYear:digits(byId('card-expiration-year').value),holderName:byId('card-holder-name').value.trim(),holderDocument:digits(byId('card-holder-document').value),reuse:true}).getPaymentToken();
}
async function submitCard(event){
  event.preventDefault();clearFeedback();
  const button=byId('submit-card-subscription');button.disabled=true;button.textContent='Processando com segurança...';
  try{
    const token=await tokenizeCard();
    const mode=byId('card-update-mode').value;
    if(mode==='update'){
      await invoke('atualizar-assinatura-cartao-fsdelivery',{assinatura_id:currentSubscription.id,payment_token:token.payment_token,cartao_mascara:token.card_mask});
      feedback('Cartão atualizado com sucesso.');
    }else{
      await invoke('criar-assinatura-cartao-fsdelivery',{plano_id:byId('card-plan-id').value,payment_token:token.payment_token,cartao_mascara:token.card_mask,customer:{name:byId('customer-name').value.trim(),cpf:digits(byId('card-holder-document').value),email:byId('customer-email').value.trim(),birth:byId('customer-birth').value,phone_number:digits(byId('customer-phone').value)},billing_address:{street:byId('billing-street').value.trim(),number:byId('billing-number').value.trim(),neighborhood:byId('billing-neighborhood').value.trim(),zipcode:digits(byId('billing-zipcode').value),city:byId('billing-city').value.trim(),complement:byId('billing-complement').value.trim(),state:byId('billing-state').value.trim().toUpperCase()}});
      feedback('Assinatura enviada. A confirmação da cobrança será atualizada automaticamente.');
    }
    ['card-number','card-cvv','card-expiration-month','card-expiration-year'].forEach(id=>byId(id).value='');
    setTimeout(()=>location.reload(),1800);
  }catch(error){
    const message=error?.error_description||error?.message||'Não foi possível processar o cartão.';
    feedback(message,'error');button.disabled=false;button.textContent=byId('card-update-mode').value==='update'?'Salvar novo cartão':'Confirmar assinatura';
  }
}
async function cancelSubscription(){
  if(!currentSubscription||!confirm('Cancelar a renovação automática? O acesso permanece até o fim do período já pago.'))return;
  const button=byId('cancel-subscription-button');button.disabled=true;
  try{
    const data=await invoke('cancelar-assinatura-cartao-fsdelivery',{assinatura_id:currentSubscription.id,remover_cartao:false});
    feedback(data.mensagem||'Renovação automática cancelada.');setTimeout(()=>location.reload(),1800);
  }catch(error){feedback(error.message,'error');button.disabled=false}
}
async function copyPix(){
  const value=byId('pix-copy-code').value;if(!value)return;
  try{await navigator.clipboard.writeText(value);feedback('Código PIX copiado.')}
  catch{byId('pix-copy-code').select();document.execCommand('copy');feedback('Código PIX copiado.')}
}
function bind(){
  byId('close-pix-checkout').onclick=()=>{byId('pix-checkout').hidden=true;clearInterval(pixTimer)};
  byId('copy-pix-button').onclick=copyPix;
  byId('verify-pix-button').onclick=()=>verifyPix(true);
  byId('close-card-checkout').onclick=closeCardForm;
  byId('cancel-card-form').onclick=closeCardForm;
  byId('card-subscription-form').onsubmit=submitCard;
  byId('update-card-button').onclick=()=>openCardForm(null,'update');
  byId('cancel-subscription-button').onclick=cancelSubscription;
  byId('card-number').oninput=e=>e.target.value=digits(e.target.value).replace(/(.{4})/g,'$1 ').trim();
  byId('card-holder-document').oninput=e=>e.target.value=digits(e.target.value).slice(0,11);
  byId('customer-phone').oninput=e=>e.target.value=digits(e.target.value).slice(0,11);
  byId('billing-zipcode').oninput=e=>e.target.value=digits(e.target.value).slice(0,8);
  byId('billing-state').oninput=e=>e.target.value=e.target.value.replace(/[^a-z]/gi,'').slice(0,2).toUpperCase();
  window.addEventListener('beforeunload',()=>clearInterval(pixTimer));
}
init().catch(error=>feedback(error.message||'Não foi possível carregar a assinatura.','error'));
