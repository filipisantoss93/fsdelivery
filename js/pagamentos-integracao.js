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
  let session=null;
  let store=null;
  let integration=null;

  function showFeedback(message,type='success'){
    feedback.hidden=false;
    feedback.classList.toggle('error',type==='error');
    feedback.textContent=message;
    feedback.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function setBusy(busy){
    byId('save-integration').disabled=busy;
    byId('test-integration').disabled=busy;
    byId('save-integration').textContent=busy?'Salvando...':'Salvar integração';
  }

  function updateStatus(){
    const status=integration?.status||'não configurado';
    const active=integration?.conta_validada&&status==='ativo';
    const erro=status==='erro'||status==='bloqueado';
    statusCard.classList.toggle('is-active',Boolean(active));
    statusCard.classList.toggle('is-error',Boolean(erro));
    byId('payment-status-title').textContent=active?'Conta pronta para homologação comercial':integration?'Configuração aguardando validação':'Conta Efí ainda não configurada';
    byId('payment-status-description').textContent=active
      ?'A conta recebedora foi validada. Cartão e split ainda dependem dos testes finais do checkout e webhook.'
      :integration?.erro_ultima_validacao||'Salve o payee code para iniciar a homologação da conta recebedora.';
    byId('payment-status-badge').textContent=status.replaceAll('_',' ');
  }

  function fillForm(){
    if(!integration){updateStatus();return}
    byId('account-type').value=integration.tipo_pessoa||'pj';
    byId('payee-code').value=integration.payee_code||'';
    byId('commission-percent').value=(Number(integration.percentual_comissao_bps||0)/100).toFixed(2);
    byId('fee-mode').value=feeModeReverse[Number(integration.modo_tarifa)]||'proporcional';
    byId('online-card').checked=Boolean(integration.cartao_online_ativo);
    byId('online-pix').checked=Boolean(integration.pix_online_ativo);
    byId('split-enabled').checked=Boolean(integration.split_ativo);
    updateStatus();
  }

  function validateDocument(){
    const type=byId('account-type').value;
    const value=digits(byId('document-number').value);
    return type==='pf'?value.length===11:value.length===14;
  }

  function validateForm(){
    const payeeCode=byId('payee-code').value.trim();
    const commission=Number(byId('commission-percent').value||0);
    if(!validateDocument())throw new Error('Informe um CPF ou CNPJ válido para conferência local.');
    if(payeeCode.length<8)throw new Error('Informe um payee code válido.');
    if(!Number.isFinite(commission)||commission<0||commission>30)throw new Error('A comissão deve ficar entre 0% e 30%.');
    if(byId('fee-mode').value==='plataforma')throw new Error('O modo em que a plataforma assume todas as tarifas ainda não está homologado.');
    if(!byId('security-confirmation').checked)throw new Error('Confirme a origem segura do payee code.');
    return {payeeCode,commission};
  }

  async function load(){
    const {data:{session:current}}=await db.auth.getSession();
    if(!current){location.replace('auth');return}
    session=current;
    const {data:est,error:storeError}=await db.from('estabelecimentos').select('id,nome').eq('usuario_id',session.user.id).maybeSingle();
    if(storeError||!est)throw new Error('Não foi possível localizar o estabelecimento desta conta.');
    store=est;
    const {data,error}=await db.from('integracoes_pagamento_estabelecimento').select('*').eq('estabelecimento_id',store.id).maybeSingle();
    if(error)throw error;
    integration=data||null;
    fillForm();
  }

  async function save(event){
    event.preventDefault();
    setBusy(true);
    try{
      const {payeeCode,commission}=validateForm();
      const wantsSplit=byId('split-enabled').checked;
      const payload={
        estabelecimento_id:store.id,
        provedor:'efi',
        tipo_pessoa:byId('account-type').value,
        payee_code:payeeCode,
        conta_validada:false,
        cartao_online_ativo:false,
        pix_online_ativo:false,
        split_ativo:false,
        percentual_comissao_bps:Math.round(commission*100),
        modo_tarifa:feeModeMap[byId('fee-mode').value]||2,
        ambiente:'homologacao',
        status:'pendente',
        erro_ultima_validacao:wantsSplit?'Split solicitado; aguardando validação do payee code e testes de homologação.':'Aguardando validação do payee code.',
        validado_em:null,
        updated_at:new Date().toISOString()
      };
      const {data,error}=await db.from('integracoes_pagamento_estabelecimento').upsert(payload,{onConflict:'estabelecimento_id'}).select().single();
      if(error)throw error;
      integration=data;
      byId('document-number').value='';
      byId('security-confirmation').checked=false;
      fillForm();
      showFeedback('Configuração salva em homologação. Cartão, Pix e split permaneceram bloqueados até a validação técnica.');
    }catch(error){
      console.error(error);
      showFeedback(error.message||'Não foi possível salvar a integração.','error');
    }finally{setBusy(false)}
  }

  function testConfiguration(){
    try{
      validateForm();
      showFeedback('A configuração local está consistente. A próxima etapa é validar o payee code pela infraestrutura de marketplace da Efí.');
    }catch(error){showFeedback(error.message,'error')}
  }

  byId('fee-mode').querySelector('option[value="plataforma"]')?.setAttribute('disabled','disabled');
  byId('payment-integration-form').addEventListener('submit',save);
  byId('test-integration').addEventListener('click',testConfiguration);
  load().catch(error=>{console.error(error);showFeedback(error.message||'Falha ao carregar a integração.','error');updateStatus()});
})();
