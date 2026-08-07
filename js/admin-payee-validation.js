(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const db=window.supabaseClient;
  if(!db)return;

  function feedback(message,type='success'){
    const box=byId('admin-feedback');
    if(!box)return;
    box.textContent=message;
    box.classList.toggle('error',type==='error');
    box.hidden=false;
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function sync(){
    const validated=byId('integration-validated');
    const environment=byId('integration-environment');
    const footer=byId('admin-integration-form')?.querySelector('footer');
    if(!validated||!footer)return false;
    validated.disabled=true;
    validated.title='A validação é definida automaticamente pelo teste sandbox da Efí.';

    let button=byId('integration-validate-efi');
    if(!button){
      button=document.createElement('button');
      button.id='integration-validate-efi';
      button.className='btn btn-secondary';
      button.type='button';
      button.textContent='Validar na Efí';
      footer.insertBefore(button,footer.lastElementChild);
      button.addEventListener('click',validate);
    }
    button.disabled=environment?.value==='producao';
    button.title=button.disabled?'A validação automática está restrita à homologação.':'';
    return true;
  }

  async function validate(){
    const storeId=byId('integration-store-id')?.value;
    const payee=byId('integration-payee')?.value.trim();
    const split=byId('integration-split')?.checked;
    if(!storeId)return feedback('Estabelecimento não selecionado.','error');
    if(!payee)return feedback('Informe e salve o payee code antes da validação.','error');
    if(!split)return feedback('O Split precisa estar solicitado antes da validação.','error');

    const button=byId('integration-validate-efi');
    button.disabled=true;
    button.textContent='Validando...';
    feedback('Consultando a Efí em homologação. A cobrança sandbox de validação será cancelada automaticamente.');
    try{
      const {data,error}=await db.functions.invoke('validar-payee-efi',{body:{estabelecimento_id:storeId}});
      if(error)throw error;
      if(!data?.sucesso)throw new Error(data?.erro||'Recebedor não validado pela Efí.');
      feedback(data.mensagem||'Recebedor validado na Efí.');
      setTimeout(()=>location.reload(),700);
    }catch(error){
      const message=error?.context?.body?.erro||error?.message||'Falha ao validar o recebedor na Efí.';
      feedback(message,'error');
      button.disabled=false;
      button.textContent='Validar na Efí';
    }
  }

  document.addEventListener('change',event=>{if(event.target?.id==='integration-environment')sync()});
  let attempts=0;
  const timer=setInterval(()=>{attempts++;if(sync()||attempts>50)clearInterval(timer)},100);
})();