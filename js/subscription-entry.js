(()=>{
  const modal=document.getElementById('plano-config');
  if(!modal||!window.supabaseClient)return;
  const planName=document.getElementById('plan-name');
  const planStatus=document.getElementById('plan-status');
  const panel=modal.querySelector('.config-panel');
  if(panel&&!document.getElementById('manage-subscription-link')){
    const actions=document.createElement('div');
    actions.className='inline-actions settings-actions';
    actions.innerHTML='<a class="btn btn-primary" id="manage-subscription-link" href="assinatura.html">Gerenciar assinatura</a>';
    panel.appendChild(actions);
  }
  const labels={ativa:'Ativa',pendente:'Em processamento',vencida:'Vencida',cancelada:'Cancelada',falhou:'Falhou'};
  async function load(){
    const {data:{session}}=await window.supabaseClient.auth.getSession();
    if(!session)return;
    const {data,error}=await window.supabaseClient.from('assinaturas').select('status,meio_pagamento,acesso_valido_ate,renovacao_automatica,updated_at,planos_assinatura(nome)').eq('usuario_id',session.user.id).order('updated_at',{ascending:false}).limit(1).maybeSingle();
    if(error||!data)return;
    if(planName)planName.textContent=data.planos_assinatura?.nome||'FS Delivery';
    if(planStatus){
      const validity=data.acesso_valido_ate?new Date(data.acesso_valido_ate).toLocaleDateString('pt-BR'):'';
      planStatus.textContent=`${labels[data.status]||data.status}${validity?` • até ${validity}`:''}`;
    }
  }
  load();
})();
