(()=>{
  'use strict';
  const db=window.supabaseClient;
  if(!db)return;
  const byId=id=>document.getElementById(id);
  const digits=value=>String(value||'').replace(/\D/g,'');
  const feedback=byId('payment-settings-feedback');
  const statusCard=document.querySelector('.payment-status-card');
  const feeModeMap={estabelecimento:1,proporcional:2};
  const feeModeReverse={1:'estabelecimento',2:'proporcional'};
  let store=null;
  let integration=null;
  let busy=false;

  function showFeedback(message,type='success'){
    feedback.hidden=false;
    feedback.classList.toggle('error',type==='error');
    feedback.textContent=message;
    feedback.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function setBusy(value,label='Salvando...'){
    busy=value;
    byId('save-integration').disabled=value;
    byId('test-integration').disabled=value;
    byId('save-integration').textContent=value?label:'Salvar e validar';
    byId('test-integration').textContent=value?'Validando...':'Validar na Efí';
  }

  function validCpf(value){
    const cpf=digits(value);
    if(cpf.length!==11||/^(\d)\1{10}$/.test(cpf))return false;
    const calc=size=>{let sum=0;for(let i=0;i<size;i++)sum+=Number(cpf[i])*(size+1-i);const rest=(sum*10)%11;return rest===10?0:rest};
    return calc(9)===Number(cpf[9])&&calc(10)===Number(cpf[10]);
  }

  function validCnpj(value){
    const cnpj=digits(value);
    if(cnpj.length!==14||/^(\d)\1{13}$/.test(cnpj))return false;
    const calc=base=>{const weights=base.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const sum=base.split('').reduce((total,n,index)=>total+Number(n)*weights[index],0);const rest=sum%11;return rest<2?0:11-rest};
    const d1=calc(cnpj.slice(0,12));const d2=calc(cnpj.slice(0,12)+d1);
    return d1===Number(cnpj[12])&&d2===Number(cnpj[13]);
  }

  function updateStatus(){
    const status=integration?.status||'nao_configurado';
    const active=Boolean(integration?.conta_validada&&status==='ativo');
    const error=['erro','bloqueado'].includes(status);
    statusCard.classList.toggle('is-active',active);
    statusCard.classList.toggle('is-error',error);
    byId('payment-status-title').textContent=active?'Conta homologada':status==='em_analise'?'Validando conta Efí':integration?'Solicitação aguardando validação':'Conta Efí ainda não configurada';
    byId('payment-status-description').textContent=active
      ?`Recebedor validado. Cartão ${integration.cartao_online_ativo?'ativo':'inativo'}, split ${integration.split_ativo?'ativo':'inativo'}${integration.pix_online_solicitado&&!integration.pix_online_ativo?'. Pix on-line segue pendente de homologação específica.':''}`
      :integration?.erro_ultima_validacao||'Salve os dados para validar automaticamente a conta recebedora na Efí.';
    byId('payment-status-badge').textContent=status.replaceAll('_',' ');
  }

  function fillForm(){
    if(!integration){updateStatus();return}
    byId('account-type').value=integration.tipo_pessoa||'pj';
    byId('payee-code').value=integration.payee_code||'';
    byId('commission-percent').value=(Number(integration.percentual_comissao_bps||0)/100).toFixed(2);
    byId('fee-mode').value=feeModeReverse[Number(integration.modo_tarifa)]||'proporcional';
    byId('online-card').checked=Boolean(integration.cartao_online_solicitado);
    byId('online-pix').checked=Boolean(integration.pix_online_solicitado);
    byId('split-enabled').checked=Boolean(integration.split_solicitado);
    updateStatus();
  }

  function validateForm({requireDocument=true}={}){
    const type=byId('account-type').value;
    const documentValue=byId('document-number').value;
    const payeeCode=byId('payee-code').value.trim();
    const commission=Number(byId('commission-percent').value||0);
    if(requireDocument){
      const validDocument=type==='pf'?validCpf(documentValue):validCnpj(documentValue);
      if(!validDocument)throw new Error(`Informe um ${type==='pf'?'CPF':'CNPJ'} válido para conferência local.`);
      if(!byId('security-confirmation').checked)throw new Error('Confirme a origem segura do payee code.');
    }
    if(!/^[A-Za-z0-9_-]{8,160}$/.test(payeeCode))throw new Error('Informe um payee code em formato válido.');
    if(!Number.isFinite(commission)||commission<0||commission>30)throw new Error('A comissão deve ficar entre 0% e 30%.');
    if(!byId('split-enabled').checked)throw new Error('Ative a solicitação de Split automático para validar o recebedor.');
    return {payeeCode,commission};
  }

  async function reloadIntegration(){
    const {data,error}=await db.from('integracoes_pagamento_estabelecimento').select('*').eq('estabelecimento_id',store.id).maybeSingle();
    if(error)throw error;
    integration=data||null;
    fillForm();
    return integration;
  }

  async function load(){
    const {data:{session}}=await db.auth.getSession();
    if(!session){location.replace('auth');return}
    const {data:est,error:storeError}=await db.from('estabelecimentos').select('id,nome').eq('usuario_id',session.user.id).maybeSingle();
    if(storeError||!est)throw new Error('Não foi possível localizar o estabelecimento desta conta.');
    store=est;
    await reloadIntegration();
    byId('save-integration').textContent='Salvar e validar';
    byId('test-integration').textContent='Validar na Efí';
  }

  async function validateEfi({silentStart=false}={}){
    if(busy)return null;
    if(!store)throw new Error('Estabelecimento ainda não carregado.');
    validateForm({requireDocument:false});
    setBusy(true,'Validando na Efí...');
    if(!silentStart)showFeedback('Validando o recebedor na Efí em homologação. Uma cobrança sandbox de R$ 1,00 será criada e cancelada automaticamente.');
    try{
      const {data,error}=await db.functions.invoke('validar-payee-efi',{body:{estabelecimento_id:store.id}});
      if(error)throw error;
      if(!data?.sucesso)throw new Error(data?.erro||'A Efí não confirmou o recebedor.');
      await reloadIntegration();
      showFeedback(data.mensagem||'Conta Efí validada automaticamente em homologação.');
      return data;
    }catch(error){
      await reloadIntegration().catch(()=>null);
      const message=error?.context?.body?.erro||error?.message||'Não foi possível validar a conta na Efí.';
      showFeedback(message,'error');
      throw error;
    }finally{setBusy(false)}
  }

  async function save(event){
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    try{
      const {payeeCode,commission}=validateForm();
      const payload={
        estabelecimento_id:store.id,
        provedor:'efi',
        tipo_pessoa:byId('account-type').value,
        payee_code:payeeCode,
        cartao_online_solicitado:byId('online-card').checked,
        pix_online_solicitado:byId('online-pix').checked,
        split_solicitado:byId('split-enabled').checked,
        percentual_comissao_bps:Math.round(commission*100),
        modo_tarifa:feeModeMap[byId('fee-mode').value]||2,
        updated_at:new Date().toISOString()
      };
      const {data,error}=await db.from('integracoes_pagamento_estabelecimento').upsert(payload,{onConflict:'estabelecimento_id'}).select().single();
      if(error)throw error;
      integration=data;
      byId('document-number').value='';
      byId('security-confirmation').checked=false;
      fillForm();
      setBusy(false);
      showFeedback('Solicitação salva. Iniciando validação automática na Efí...');
      await validateEfi({silentStart:true});
    }catch(error){
      console.error(error);
      if(!feedback.textContent||feedback.hidden)showFeedback(error.message||'Não foi possível salvar ou validar a integração.','error');
    }finally{setBusy(false)}
  }

  async function retryValidation(){
    try{await validateEfi();}
    catch(error){console.error(error)}
  }

  byId('payment-integration-form').addEventListener('submit',save);
  byId('test-integration').addEventListener('click',retryValidation);
  load().catch(error=>{console.error(error);showFeedback(error.message||'Falha ao carregar a integração.','error');updateStatus()});
})();