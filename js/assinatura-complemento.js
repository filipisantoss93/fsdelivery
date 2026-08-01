(()=>{
  async function start(){
    const checkout=document.getElementById('pix-checkout');
    const db=window.supabaseClient;
    if(!checkout||!db)return;

    const feedback=(message,type='success')=>{
      const box=document.getElementById('subscription-feedback');
      if(!box)return;
      box.textContent=message;
      box.classList.toggle('error',type==='error');
      box.hidden=false;
      box.scrollIntoView({behavior:'smooth',block:'nearest'});
    };

    const actions=document.getElementById('verify-pix-button')?.parentElement;
    if(actions&&!document.getElementById('cancel-pix-button')){
      const button=document.createElement('button');
      button.className='btn btn-danger';
      button.id='cancel-pix-button';
      button.type='button';
      button.textContent='Cancelar este PIX';
      actions.appendChild(button);
      button.addEventListener('click',async()=>{
        if(!confirm('Cancelar esta cobrança PIX?'))return;
        button.disabled=true;
        try{
          const {data:{session}}=await db.auth.getSession();
          if(!session)throw new Error('Sessão expirada. Entre novamente.');
          const {data:charge,error:chargeError}=await db.from('cobrancas_pix').select('id').eq('usuario_id',session.user.id).eq('status','pendente').order('created_at',{ascending:false}).limit(1).maybeSingle();
          if(chargeError)throw chargeError;
          if(!charge)throw new Error('Não existe uma cobrança PIX pendente para cancelar.');
          const {data,error}=await db.functions.invoke('cancelar-pix-fsdelivery',{body:{id:charge.id}});
          if(error||data?.erro)throw new Error(data?.erro||error?.message||'Não foi possível cancelar o PIX.');
          feedback('Cobrança PIX cancelada.');
          window.setTimeout(()=>location.reload(),1200);
        }catch(error){
          feedback(error?.message||'Não foi possível cancelar o PIX.','error');
          button.disabled=false;
        }
      });
    }

    const {data:{session}}=await db.auth.getSession();
    if(!session)return;
    const [{data:recurring},{data:pixPlans}]=await Promise.all([
      db.from('assinaturas').select('id').eq('usuario_id',session.user.id).eq('meio_pagamento','cartao').eq('renovacao_automatica',true).in('status',['pendente','ativa']).limit(1).maybeSingle(),
      db.from('planos_assinatura').select('id').eq('ativo',true).eq('meio_pagamento','pix')
    ]);
    if(!recurring)return;
    const pixIds=new Set((pixPlans||[]).map(plan=>plan.id));
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-plan]');
      if(!button||!pixIds.has(button.dataset.plan))return;
      event.preventDefault();
      event.stopImmediatePropagation();
      feedback('Cancele primeiro a renovação automática do cartão para contratar um período por PIX.','error');
    },true);
    const markButtons=()=>document.querySelectorAll('[data-plan]').forEach(button=>{
      if(pixIds.has(button.dataset.plan)){
        button.title='Cancele a renovação automática do cartão antes de usar PIX';
        button.setAttribute('aria-disabled','true');
      }
    });
    markButtons();
    const plans=document.getElementById('subscription-plans');
    if(plans)new MutationObserver(markButtons).observe(plans,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
