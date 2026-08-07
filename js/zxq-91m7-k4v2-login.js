(()=>{
  const ADMIN_EMAIL='filipi.01@live.com';
  const $=id=>document.getElementById(id);
  let db=null;

  function setMessage(message,type='info'){
    const box=$('admin-login-feedback');
    if(!box)return;
    box.textContent=message||'';
    box.className=`admin-login-feedback ${type}`;
    box.hidden=!message;
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
        await db.auth.signOut();
        throw new Error('Acesso administrativo negado.');
      }
      const {data:allowed,error:rpcError}=await db.rpc('fs_admin_autorizado');
      if(rpcError||!allowed){
        await db.auth.signOut();
        throw new Error('Acesso administrativo negado pelo servidor.');
      }
      setMessage('Acesso autorizado. Abrindo Central Gerencial…','success');
      location.reload();
    }catch(error){
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

  function start(){
    db=window.supabaseClient;
    const form=$('admin-login-form');
    if(form)form.addEventListener('submit',submitLogin);
    document.addEventListener('click',internalLogout,true);
    const email=$('admin-login-email');
    if(email&&!email.value)email.value=ADMIN_EMAIL;
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
