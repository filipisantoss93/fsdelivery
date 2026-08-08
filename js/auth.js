(()=>{
  const $=s=>document.querySelector(s);
  const db=window.supabaseClient;
  const feedback=$('#auth-feedback');
  const show=(message,type='success')=>{feedback.hidden=false;feedback.className=`feedback ${type}`;feedback.textContent=message};
  const loading=(form,on)=>{const button=form.querySelector('button[type="submit"],button:not([type])');if(!button)return;button.disabled=on;button.dataset.label??=button.textContent;button.textContent=on?'Aguarde...':button.dataset.label};
  const setView=view=>{document.querySelectorAll('.auth-form').forEach(f=>f.classList.toggle('active',f.id===`${view}-form`));document.querySelectorAll('[data-auth-view]').forEach(b=>b.classList.toggle('active',b.dataset.authView===view));feedback.hidden=true};
  const authMessage=error=>{
    const message=(error?.message||'').toLowerCase();
    if(message.includes('invalid login'))return 'E-mail ou senha inválidos.';
    if(message.includes('email not confirmed'))return 'Confirme seu e-mail antes de entrar.';
    if(message.includes('already registered')||message.includes('already been registered'))return 'Já existe uma conta com este e-mail.';
    if(message.includes('password'))return 'A senha deve ter pelo menos 8 caracteres e não pode constar em vazamentos conhecidos.';
    if(message.includes('rate limit'))return 'Muitas tentativas. Aguarde alguns minutos.';
    return error?.message||'Não foi possível concluir a operação.';
  };

  const params=new URLSearchParams(location.search);
  const isRecovery=()=>params.get('reset')==='1'||location.hash.includes('type=recovery');
  let redirecting=false;
  const goToApp=()=>{
    if(redirecting||isRecovery())return;
    redirecting=true;
    location.replace('app.html');
  };

  document.querySelectorAll('[data-auth-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.authView)));

  if(isRecovery())setView('reset');

  db.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_IN'&&session)goToApp();
  });

  db.auth.getSession()
    .then(({data})=>{if(data.session)goToApp()})
    .catch(()=>{});

  $('#login-form').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    loading(form,true);
    const f=new FormData(form);
    try{
      const {data,error}=await db.auth.signInWithPassword({
        email:String(f.get('email')).trim(),
        password:String(f.get('password'))
      });
      if(error){loading(form,false);return show(authMessage(error),'error')}
      if(data.session)goToApp();
    }catch(error){
      loading(form,false);
      show(authMessage(error),'error');
    }
  };

  $('#register-form').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget,f=new FormData(form);
    if(String(f.get('password')).length<8)return show('A senha deve ter pelo menos 8 caracteres.','error');
    if(f.get('password')!==f.get('confirmPassword'))return show('As senhas não coincidem.','error');
    loading(form,true);
    const redirectTo=new URL('auth.html',location.href).href;
    const {data,error}=await db.auth.signUp({
      email:String(f.get('email')).trim(),
      password:String(f.get('password')),
      options:{emailRedirectTo:redirectTo,data:{owner_name:String(f.get('ownerName')).trim(),store_name:String(f.get('storeName')).trim(),phone:String(f.get('phone')).trim(),category:String(f.get('category')).trim()}}
    });
    loading(form,false);
    if(error)return show(authMessage(error),'error');
    form.reset();
    if(data.session){goToApp();return;}
    show('Conta criada. Confirme o cadastro pelo e-mail enviado.');
    setTimeout(()=>setView('login'),1200);
  };

  $('#forgot-form').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget,f=new FormData(form);loading(form,true);
    const redirectTo=new URL('auth.html?reset=1',location.href).href;
    const {error}=await db.auth.resetPasswordForEmail(String(f.get('email')).trim(),{redirectTo});
    loading(form,false);
    if(error)return show(authMessage(error),'error');
    show('Enviamos as instruções de redefinição para o e-mail informado.');
  };

  $('#reset-form').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget,f=new FormData(form);
    if(String(f.get('password')).length<8)return show('A senha deve ter pelo menos 8 caracteres.','error');
    if(f.get('password')!==f.get('confirmPassword'))return show('As senhas não coincidem.','error');
    loading(form,true);
    const {error}=await db.auth.updateUser({password:String(f.get('password'))});
    loading(form,false);
    if(error)return show(authMessage(error),'error');
    await db.auth.signOut();
    show('Senha alterada com sucesso. Entre novamente.');
    history.replaceState({},'',location.pathname);
    setTimeout(()=>setView('login'),900);
  };
})();
