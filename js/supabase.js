const SUPABASE_URL='https://kvjvhoziqcevkzyszdke.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_NgOVxQYh3jxQ7Go7y2HTLg_rVJuQ3mc';

// Evita travamentos do LockManager observados no Safari/iOS durante a
// persistência da sessão. O Supabase continua armazenando e renovando a sessão
// normalmente, sem deixar signInWithPassword preso após autenticar.
const authLock=async(_name,_acquireTimeout,fn)=>await fn();

window.supabaseClient=window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true,
      lock:authLock
    }
  }
);

// Recursos globais compartilhados pelas páginas da plataforma.
[
  ['script','js/pull-to-refresh.js','fsPullRefresh'],
  ['script','js/admin-mobile-nav.js','fsAdminMobileNav'],
  ['script','js/config-modal-bootstrap.js','fsConfigModalBootstrap'],
  ['script','js/subscription-entry.js','fsSubscriptionEntry'],
  ['script','js/assinatura-complemento.js','fsSubscriptionGuards']
].forEach(([tag,src,key])=>{
  if(document.querySelector(`${tag}[data-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}]`))return;
  const element=document.createElement(tag);
  element.src=src;
  element.defer=true;
  element.dataset[key]='true';
  document.head.appendChild(element);
});

[
  ['css/admin-mobile-nav.css','fsAdminMobileNav'],
  ['css/mobile-density.css','fsMobileDensity']
].forEach(([href,key])=>{
  const selector=`link[data-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}]`;
  if(document.querySelector(selector))return;
  const style=document.createElement('link');
  style.rel='stylesheet';
  style.href=href;
  style.dataset[key]='true';
  document.head.appendChild(style);
});
