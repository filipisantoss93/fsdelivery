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

// A loja pública ainda usa o slug como identificador principal. Links internos
// antigos podem chegar com ?estabelecimento=<uuid> ou sem identificador quando
// abertos pelo administrador. Resolve esses casos antes de continuar e troca a
// URL pelo link público canônico.
(async function resolvePublicStoreUrl(){
  const isPublicStore=/(^|\/)loja\.html$/i.test(location.pathname);
  if(!isPublicStore)return;

  const params=new URLSearchParams(location.search);
  const rawSlug=String(params.get('loja')||'').trim();
  const slug=['','undefined','null'].includes(rawSlug.toLowerCase())?'':rawSlug;
  if(slug)return;

  const storeId=String(params.get('estabelecimento')||'').trim();
  const conceal=document.createElement('style');
  conceal.id='fs-store-resolver-style';
  conceal.textContent='body{visibility:hidden!important}';
  document.head.appendChild(conceal);

  try{
    let store=null;

    if(storeId){
      const {data,error}=await window.supabaseClient
        .from('estabelecimentos')
        .select('id,slug')
        .eq('id',storeId)
        .maybeSingle();
      if(error)throw error;
      store=data;
    }

    if(!store){
      const {data:{session}}=await window.supabaseClient.auth.getSession();
      if(session){
        const {data,error}=await window.supabaseClient
          .from('estabelecimentos')
          .select('id,slug')
          .eq('usuario_id',session.user.id)
          .maybeSingle();
        if(error)throw error;
        store=data;
      }
    }

    if(store?.slug){
      params.set('loja',store.slug);
      params.delete('estabelecimento');
      location.replace(`${location.pathname}?${params.toString()}${location.hash}`);
      return;
    }
  }catch(error){
    console.error('Falha ao resolver a loja pública:',error);
  }

  conceal.remove();
})();

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
