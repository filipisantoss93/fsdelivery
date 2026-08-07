(()=>{
  const ADMIN_EMAIL='filipi.01@live.com';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((Number(value)||0)/100);
  const dateTime=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
  const dateOnly=value=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
  const statusClass=status=>['ativa','ativo','paga','paid','pago','processado'].includes(String(status))?'ok':['pendente','em_analise','aguardando','waiting'].includes(String(status))?'warn':['erro','falhou','recusado','vencida','cancelada','bloqueado','chargeback','estornado'].includes(String(status))?'danger':'info';
  const statusLabel=value=>({ativa:'Ativa',ativo:'Ativo',pendente:'Pendente',em_analise:'Em análise',vencida:'Vencida',cancelada:'Cancelada',falhou:'Falhou',paga:'Paga',paid:'Paga',pago:'Pago',aguardando:'Aguardando',waiting:'Aguardando',recusado:'Recusado',bloqueado:'Bloqueado',erro:'Erro',chargeback:'Chargeback',estornado:'Estornado',nao_iniciado:'Não iniciado'}[value]||String(value||'—').replaceAll('_',' '));
  let db=null;
  let session=null;
  let data={resumo:{},planos:[],clientes:[],cobrancas_pix:[],cobrancas_cartao:[],cobrancas_pedidos:[],eventos_pagamento:[],auditoria:[]};

  function feedback(message,type='success'){
    const box=$('admin-feedback');
    box.textContent=message;
    box.classList.toggle('error',type==='error');
    box.hidden=false;
    clearTimeout(feedback.timer);
    feedback.timer=setTimeout(()=>box.hidden=true,7000);
  }

  async function rpc(name,args={}){
    const {data:result,error}=await db.rpc(name,args);
    if(error)throw error;
    return result;
  }

  function lock(message,showLogin=false){
    $('admin-app').hidden=true;
    $('admin-lock').hidden=false;
    $('admin-lock-message').textContent=message;
    $('admin-login-link').hidden=!showLogin;
  }

  function unlock(){
    $('admin-lock').hidden=true;
    $('admin-app').hidden=false;
    $('admin-session-label').textContent=session?.user?.email||'Sessão administrativa';
  }

  function summaryCard(label,value,detail=''){
    return `<article class="admin-summary-card"><span>${esc(label)}</span><strong>${esc(value)}</strong>${detail?`<small class="admin-muted">${esc(detail)}</small>`:''}</article>`;
  }

  function renderOverview(){
    const r=data.resumo||{};
    const totalReceived=(Number(r.pix_recebido_centavos)||0)+(Number(r.cartao_recebido_centavos)||0);
    $('admin-summary').innerHTML=[
      summaryCard('Empresas',r.estabelecimentos||0,'cadastradas'),
      summaryCard('Assinaturas ativas',r.assinaturas_ativas||0,`${r.assinaturas_pendentes||0} pendentes`),
      summaryCard('Receita recebida',money(totalReceived),'assinaturas PIX + cartão'),
      summaryCard('Integrações Efí ativas',r.integracoes_ativas||0,`${r.integracoes_pendentes||0} aguardando análise`)
    ].join('');

    $('admin-revenue-breakdown').innerHTML=`
      <div class="admin-list-item"><div class="admin-list-row"><span>PIX de assinatura</span><strong>${money(r.pix_recebido_centavos)}</strong></div></div>
      <div class="admin-list-item"><div class="admin-list-row"><span>Cartão de assinatura</span><strong>${money(r.cartao_recebido_centavos)}</strong></div></div>
      <div class="admin-list-item"><div class="admin-list-row"><span>Total confirmado</span><strong>${money(totalReceived)}</strong></div></div>`;

    const clients=data.clientes||[];
    const alerts=[];
    const pendingIntegrations=clients.filter(c=>['pendente','em_analise'].includes(c.integracao_pagamento?.status));
    const errorIntegrations=clients.filter(c=>['erro','bloqueado'].includes(c.integracao_pagamento?.status));
    const expired=clients.filter(c=>['vencida','falhou'].includes(c.assinatura?.status));
    const production=clients.filter(c=>c.integracao_pagamento?.ambiente==='producao');
    if(pendingIntegrations.length)alerts.push(`${pendingIntegrations.length} integração(ões) Efí aguardando análise.`);
    if(errorIntegrations.length)alerts.push(`${errorIntegrations.length} integração(ões) com erro ou bloqueio.`);
    if(expired.length)alerts.push(`${expired.length} assinatura(s) vencida(s) ou com falha.`);
    if(production.length)alerts.push(`${production.length} estabelecimento(s) configurado(s) em produção.`);
    if(!alerts.length)alerts.push('Nenhum alerta crítico encontrado nos dados atuais.');
    $('admin-alerts').innerHTML=alerts.map((text,index)=>`<div class="admin-list-item"><div class="admin-list-row"><span>${esc(text)}</span><span class="admin-pill ${index?'info':'warn'}">${index?'Info':'Atenção'}</span></div></div>`).join('');
  }

  function currentPlanName(client){return client.plano_assinatura?.nome||client.estabelecimento?.plano||'—'}
  function clientSearchText(client){return `${client.estabelecimento?.nome||''} ${client.email||''} ${currentPlanName(client)} ${client.assinatura?.status||''}`.toLowerCase()}

  function renderClients(){
    const term=$('admin-client-search').value.trim().toLowerCase();
    const items=(data.clientes||[]).filter(client=>!term||clientSearchText(client).includes(term));
    $('admin-client-list').innerHTML=items.length?items.map(client=>{
      const e=client.estabelecimento||{};
      const a=client.assinatura||{};
      const i=client.integracao_pagamento||{};
      return `<article class="admin-list-item">
        <div class="admin-list-row">
          <div class="admin-list-main"><strong>${esc(e.nome||'Estabelecimento sem nome')}</strong><small>${esc(client.email||'Sem e-mail')} • usuário ${esc(client.usuario_id||'—')}</small></div>
          <div class="admin-list-actions"><span class="admin-pill ${statusClass(a.status)}">${esc(statusLabel(a.status||e.assinatura_status))}</span><button class="btn btn-secondary" type="button" data-plan-user="${esc(client.usuario_id)}">Alterar plano</button></div>
        </div>
        <div class="admin-kv">
          <div><small>Plano</small><strong>${esc(currentPlanName(client))}</strong></div>
          <div><small>Acesso até</small><strong>${esc(dateOnly(a.acesso_valido_ate))}</strong></div>
          <div><small>Efí</small><strong>${esc(statusLabel(i.status||'não configurada'))}</strong></div>
          <div><small>Payee code</small><strong class="admin-code">${esc(i.payee_code||'—')}</strong></div>
        </div>
      </article>`;
    }).join(''):'<div class="admin-empty">Nenhum cliente encontrado.</div>';
    document.querySelectorAll('[data-plan-user]').forEach(button=>button.onclick=()=>openPlan(button.dataset.planUser));
  }

  function paymentDate(item){return item?.dados?.created_at||item?.dados?.pago_em||item?.pedido?.created_at||null}
  function paymentSearchText(item){const d=item.dados||{};return `${item.tipo||''} ${item.email||''} ${item.estabelecimento||''} ${item.plano||''} ${d.status||''} ${d.id||''} ${d.efi_charge_id||''}`.toLowerCase()}
  function renderPayments(){
    const type=$('admin-payment-type').value;
    const term=$('admin-payment-search').value.trim().toLowerCase();
    let items=[...(data.cobrancas_pix||[]),...(data.cobrancas_cartao||[]),...(data.cobrancas_pedidos||[])];
    items=items.filter(item=>(type==='all'||item.tipo===type)&&(!term||paymentSearchText(item).includes(term))).sort((a,b)=>new Date(paymentDate(b)||0)-new Date(paymentDate(a)||0));
    $('admin-payment-list').innerHTML=items.length?items.map(item=>{
      const d=item.dados||{};
      const status=d.status||item.pedido?.pagamento_status||'—';
      const value=d.valor_centavos??item.pedido?.total_centavos??item.pedido?.total??0;
      const label=item.tipo==='assinatura_pix'?'PIX assinatura':item.tipo==='assinatura_cartao'?'Cartão assinatura':'Cartão pedido';
      return `<article class="admin-list-item">
        <div class="admin-list-row"><div class="admin-list-main"><strong>${esc(item.estabelecimento||item.email||label)}</strong><small>${esc(label)} • ${esc(item.plano||'')} • ${esc(dateTime(paymentDate(item)))}</small></div><div class="admin-list-actions"><strong>${money(value)}</strong><span class="admin-pill ${statusClass(status)}">${esc(statusLabel(status))}</span></div></div>
        <div class="admin-kv"><div><small>ID</small><strong class="admin-code">${esc(d.id||'—')}</strong></div><div><small>Charge Efí</small><strong class="admin-code">${esc(d.efi_charge_id||item.pedido?.efi_charge_id||'—')}</strong></div><div><small>Pedido</small><strong>${esc(d.pedido_id||item.pedido?.id||'—')}</strong></div><div><small>Pago em</small><strong>${esc(dateTime(d.pago_em||item.pedido?.pagamento_confirmado_em))}</strong></div></div>
      </article>`;
    }).join(''):'<div class="admin-empty">Nenhuma cobrança encontrada.</div>';
  }

  function integrationSearchText(client){const i=client.integracao_pagamento||{};return `${client.estabelecimento?.nome||''} ${client.email||''} ${i.payee_code||''} ${i.status||''} ${i.ambiente||''}`.toLowerCase()}
  function renderIntegrations(){
    const term=$('admin-integration-search').value.trim().toLowerCase();
    const items=(data.clientes||[]).filter(client=>!term||integrationSearchText(client).includes(term));
    $('admin-integration-list').innerHTML=items.length?items.map(client=>{
      const e=client.estabelecimento||{};
      const i=client.integracao_pagamento||{};
      const active=[i.cartao_online_ativo&&'Cartão',i.pix_online_ativo&&'PIX',i.split_ativo&&'Split'].filter(Boolean).join(' + ')||'Nenhum meio ativo';
      return `<article class="admin-list-item">
        <div class="admin-list-row"><div class="admin-list-main"><strong>${esc(e.nome||'Estabelecimento')}</strong><small>${esc(client.email||'—')} • ${esc(active)}</small></div><div class="admin-list-actions"><span class="admin-pill ${statusClass(i.status)}">${esc(statusLabel(i.status||'não configurada'))}</span><button class="btn btn-secondary" type="button" data-integration-store="${esc(e.id)}">Configurar</button></div></div>
        <div class="admin-kv"><div><small>Payee code</small><strong class="admin-code">${esc(i.payee_code||'—')}</strong></div><div><small>Conta validada</small><strong>${i.conta_validada?'Sim':'Não'}</strong></div><div><small>Ambiente</small><strong>${esc(i.ambiente||'homologacao')}</strong></div><div><small>Comissão</small><strong>${((Number(i.percentual_comissao_bps)||0)/100).toFixed(2)}%</strong></div></div>
        ${i.erro_ultima_validacao?`<div class="admin-danger-note">${esc(i.erro_ultima_validacao)}</div>`:''}
      </article>`;
    }).join(''):'<div class="admin-empty">Nenhuma integração encontrada.</div>';
    document.querySelectorAll('[data-integration-store]').forEach(button=>button.onclick=()=>openIntegration(button.dataset.integrationStore));
  }

  function renderAudit(){
    const items=data.auditoria||[];
    $('admin-audit-list').innerHTML=items.length?items.map(item=>`<article class="admin-list-item"><div class="admin-list-row"><div class="admin-list-main"><strong>${esc(item.acao)}</strong><small>${esc(item.entidade)} ${item.entidade_id?`• ${esc(item.entidade_id)}`:''} • ${esc(dateTime(item.created_at))}</small></div><span class="admin-pill info">${esc(item.admin_email||'admin')}</span></div><pre class="admin-json">${esc(JSON.stringify(item.detalhes||{},null,2))}</pre></article>`).join(''):'<div class="admin-empty">Nenhuma ação administrativa registrada.</div>';
  }

  function renderAll(){renderOverview();renderClients();renderPayments();renderIntegrations();renderAudit();}

  async function load(){
    $('admin-refresh').disabled=true;
    try{
      data=await rpc('fs_admin_dashboard')||data;
      renderAll();
      $('admin-last-update').textContent=`Atualizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
    }catch(error){feedback(error.message||'Não foi possível carregar a central.','error');throw error}
    finally{$('admin-refresh').disabled=false}
  }

  function openPlan(userId){
    const client=(data.clientes||[]).find(item=>item.usuario_id===userId);
    if(!client)return;
    $('plan-user-id').value=userId;
    $('plan-client-name').value=`${client.estabelecimento?.nome||'Estabelecimento'} — ${client.email||''}`;
    $('plan-id').innerHTML=(data.planos||[]).map(plan=>`<option value="${esc(plan.id)}">${esc(plan.nome)} • ${money(plan.valor_centavos)} • ${esc(plan.meio_pagamento||'')}</option>`).join('');
    if(client.assinatura?.plano_id)$('plan-id').value=client.assinatura.plano_id;
    $('plan-status').value=client.assinatura?.status||'ativa';
    $('plan-valid-until').value=client.assinatura?.acesso_valido_ate?new Date(new Date(client.assinatura.acesso_valido_ate).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):'';
    $('admin-plan-dialog').showModal();
  }

  async function savePlan(event){
    event.preventDefault();
    const button=$('plan-save');button.disabled=true;
    try{
      const valid=$('plan-valid-until').value?new Date($('plan-valid-until').value).toISOString():null;
      await rpc('fs_admin_alterar_plano',{p_usuario_id:$('plan-user-id').value,p_plano_id:$('plan-id').value,p_status:$('plan-status').value,p_acesso_valido_ate:valid});
      $('admin-plan-dialog').close();
      feedback('Plano atualizado e ação registrada na auditoria.');
      await load();
    }catch(error){feedback(error.message||'Falha ao alterar o plano.','error')}
    finally{button.disabled=false}
  }

  function openIntegration(storeId){
    const client=(data.clientes||[]).find(item=>item.estabelecimento?.id===storeId);
    if(!client)return;
    const i=client.integracao_pagamento||{};
    $('integration-store-id').value=storeId;
    $('integration-store-name').value=`${client.estabelecimento?.nome||'Estabelecimento'} — ${client.email||''}`;
    $('integration-person-type').value=i.tipo_pessoa||'pj';
    $('integration-payee').value=i.payee_code||'';
    $('integration-status').value=i.status||'pendente';
    $('integration-environment').value=i.ambiente||'homologacao';
    $('integration-commission').value=((Number(i.percentual_comissao_bps)||0)/100).toFixed(2);
    $('integration-fee-mode').value=String(i.modo_tarifa||2);
    $('integration-validated').checked=Boolean(i.conta_validada);
    $('integration-card').checked=Boolean(i.cartao_online_ativo);
    $('integration-pix').checked=Boolean(i.pix_online_ativo);
    $('integration-split').checked=Boolean(i.split_ativo);
    $('integration-error').value=i.erro_ultima_validacao||'';
    syncProductionWarning();
    $('admin-integration-dialog').showModal();
  }

  function syncProductionWarning(){$('integration-production-warning').hidden=$('integration-environment').value!=='producao'}

  async function saveIntegration(event){
    event.preventDefault();
    const production=$('integration-environment').value==='producao';
    const active=$('integration-status').value==='ativo';
    if(production&&!confirm('Você está prestes a salvar esta integração em PRODUÇÃO. Confirma que credenciais, webhook, payee code e split já foram homologados?'))return;
    if(active&&!$('integration-validated').checked){feedback('Uma integração ativa exige Conta validada.','error');return}
    const button=$('integration-save');button.disabled=true;
    try{
      await rpc('fs_admin_configurar_integracao',{
        p_estabelecimento_id:$('integration-store-id').value,
        p_tipo_pessoa:$('integration-person-type').value,
        p_payee_code:$('integration-payee').value.trim(),
        p_conta_validada:$('integration-validated').checked,
        p_status:$('integration-status').value,
        p_cartao_online_ativo:$('integration-card').checked,
        p_pix_online_ativo:$('integration-pix').checked,
        p_split_ativo:$('integration-split').checked,
        p_ambiente:$('integration-environment').value,
        p_percentual_comissao_bps:Math.round((Number($('integration-commission').value)||0)*100),
        p_modo_tarifa:Number($('integration-fee-mode').value),
        p_erro_ultima_validacao:$('integration-error').value.trim()||null
      });
      $('admin-integration-dialog').close();
      feedback('Integração atualizada e ação registrada na auditoria.');
      await load();
    }catch(error){feedback(error.message||'Falha ao salvar a integração.','error')}
    finally{button.disabled=false}
  }

  function setView(name){
    document.querySelectorAll('.admin-view').forEach(view=>view.classList.toggle('is-active',view.dataset.view===name));
    document.querySelectorAll('[data-admin-view]').forEach(button=>button.classList.toggle('is-active',button.dataset.adminView===name));
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function bind(){
    document.querySelectorAll('[data-admin-view]').forEach(button=>button.onclick=()=>setView(button.dataset.adminView));
    $('admin-refresh').onclick=()=>load();
    $('admin-signout').onclick=async()=>{await db.auth.signOut();location.replace('auth')};
    $('admin-client-search').oninput=renderClients;
    $('admin-payment-type').onchange=renderPayments;
    $('admin-payment-search').oninput=renderPayments;
    $('admin-integration-search').oninput=renderIntegrations;
    $('admin-plan-form').addEventListener('submit',savePlan);
    $('admin-integration-form').addEventListener('submit',saveIntegration);
    $('integration-environment').onchange=syncProductionWarning;
  }

  async function init(){
    db=window.supabaseClient;
    if(!db){lock('Falha ao iniciar a conexão segura.');return}
    const {data:{session:s}}=await db.auth.getSession();
    if(!s){lock('Esta área exige autenticação.',true);return}
    session=s;
    if(String(session.user?.email||'').toLowerCase()!==ADMIN_EMAIL){
      lock('A sessão atual não possui acesso à Central Gerencial.');
      return;
    }
    try{
      const allowed=await rpc('fs_admin_autorizado');
      if(!allowed){lock('Acesso administrativo negado pelo servidor.');return}
    }catch(error){lock('O backend da Central Gerencial ainda não está disponível. Aplique a migration administrativa antes de usar esta página.');return}
    unlock();bind();await load();
  }

  const start=()=>init().catch(error=>{console.error(error);lock('Não foi possível iniciar a Central Gerencial com segurança.')});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
