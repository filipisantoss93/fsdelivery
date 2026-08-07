(()=>{
  const ADMIN_EMAIL='filipi.01@live.com';
  const $=id=>document.getElementById(id);
  let db=null;
  let opening=false;

  function setMessage(message,type='info'){
    const box=$('admin-login-feedback');
    if(!box)return;
    box.textContent=message||'';
    box.className=`admin-login-feedback ${type}`;
    box.hidden=!message;
  }

  async function openCentralWithoutReload(){
    if(opening)return;
    opening=true;
    setMessage('Acesso autorizado. Abrindo Central Gerencial…','success');
    const {data:{session},error}=await db.auth.getSession();
    if(error||!session)throw error||new Error('A sessão administrativa não ficou disponível após o login.');
    if(String(session.user?.email||'').toLowerCase()!==ADMIN_EMAIL)throw new Error('Acesso administrativo negado.');

    // O JS principal já executou antes do login e encerrou ao não encontrar sessão.
    // Reexecutá-lo na mesma página permite usar a sessão recém-criada sem depender
    // de persistência/reload do navegador, que era a causa do login ficar preso.
    const previous=document.querySelector('script[data-admin-runtime-restart]');
    if(previous)previous.remove();
    const script=document.createElement('script');
    script.src=`js/zxq-91m7-k4v2.js?session=${Date.now()}`;
    script.dataset.adminRuntimeRestart='true';
    script.onload=()=>{opening=false};
    script.onerror=()=>{
      opening=false;
      setMessage('A sessão foi criada, mas a Central Gerencial não conseguiu iniciar. Atualize a página e tente novamente.','error');
    };
    document.body.appendChild(script);
  }

  async function submitLogin(event){
    event.preventDefault();
    if(!db)return;
    const email=$('admin-login-email').value.trim().toLowerCase();
    const password=$('admin-login-password').value;
    const button=$('admin-login-submit');

    if(email!==ADMIN_EMAIL){
      setMessage('Este usuário não possui acesso à Central Gerencial.','error');
      return;
    }

    button.disabled=true;
    button.textContent='Entrando…';
    setMessage('Validando credenciais…','info');
    try{
      const {data,error}=await db.auth.signInWithPassword({email,password});
      if(error)throw error;
      const authenticatedEmail=String(data.user?.email||'').toLowerCase();
      if(authenticatedEmail!==ADMIN_EMAIL){
        await db.auth.signOut({scope:'local'});
        throw new Error('Acesso administrativo negado.');
      }
      const {data:allowed,error:rpcError}=await db.rpc('fs_admin_autorizado');
      if(rpcError||!allowed){
        await db.auth.signOut({scope:'local'});
        throw new Error('Acesso administrativo negado pelo servidor.');
      }
      await openCentralWithoutReload();
    }catch(error){
      opening=false;
      const text=/invalid login credentials/i.test(error?.message||'')?'E-mail ou senha inválidos.':(error?.message||'Não foi possível autenticar.');
      setMessage(text,'error');
      $('admin-login-password').value='';
      $('admin-login-password').focus();
    }finally{
      button.disabled=false;
      button.textContent='Entrar na Central';
    }
  }

  async function internalLogout(event){
    const trigger=event.target.closest?.('#admin-signout');
    if(!trigger||!db)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    trigger.disabled=true;
    try{await db.auth.signOut({scope:'local'});}catch(error){console.error(error)}
    location.replace(location.pathname);
  }

  async function start(){
    db=window.supabaseClient;
    const form=$('admin-login-form');
    if(form)form.addEventListener('submit',submitLogin);
    document.addEventListener('click',internalLogout,true);
    const email=$('admin-login-email');
    if(email&&!email.value)email.value=ADMIN_EMAIL;

    // Se já houver sessão válida, não exige novo login e evita depender do reload.
    if(db){
      const {data:{session}}=await db.auth.getSession();
      if(session&&String(session.user?.email||'').toLowerCase()===ADMIN_EMAIL){
        try{
          const {data:allowed}=await db.rpc('fs_admin_autorizado');
          if(allowed&&$('admin-app')?.hidden)await openCentralWithoutReload();
        }catch(error){console.error('Falha ao restaurar sessão administrativa:',error)}
      }
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>start().catch(console.error),{once:true});
  else start().catch(console.error);
})();
