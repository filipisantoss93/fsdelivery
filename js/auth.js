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
    if(message.includes('password'))return 'A senha deve ter pelo menos 6 caracteres.';
    if(message.includes('rate limit'))return 'Muitas tentativas. Aguarde alguns minutos.';
    return error?.message||'Não foi possível concluir a operação.';
  };

  document.querySelectorAll('[data-auth-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.authView)));

  const params=new URLSearchParams(location.search);
  if(params.get('reset')==='1'||location.hash.includes('type=recovery'))setView('reset');

  db.auth.getSession().then(({data})=>{if(data.session&&!location.hash.includes('type=recovery')&&params.get('reset')!=='1')location.replace('app.html')});

  $('#login-form').onsubmit=async e=>{
    e.preventDefault();loading(e.currentTarget,true);
    const f=new FormData(e.currentTarget);
    const {error}=await db.auth.signInWithPassword({email:String(f.get('email')).trim(),password:String(f.get('password'))});
    loading(e.currentTarget,false);
    if(error)return show(authMessage(error),'error');
    location.replace('app.html');
  };

  $('#register-form').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget,f=new FormData(form);
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
    if(data.session){location.replace('app.html');return;}
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