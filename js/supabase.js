const SUPABASE_URL='https://kvjvhoziqcevkzyszdke.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_NgOVxQYh3jxQ7Go7y2HTLg_rVJuQ3mc';

(function bloquearZoomGlobal(){
  const viewport=document.querySelector('meta[name="viewport"]')||document.createElement('meta');
  viewport.name='viewport';
  viewport.content='width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
  if(!viewport.parentNode)document.head.appendChild(viewport);
  const style=document.createElement('style');style.id='fs-global-zoom-lock';style.textContent='html,body{touch-action:pan-x pan-y}';document.head.appendChild(style);
  const impedir=event=>event.preventDefault();
  ['gesturestart','gesturechange','gestureend'].forEach(type=>document.addEventListener(type,impedir,{passive:false}));
  let ultimoToque=0;document.addEventListener('touchend',event=>{const agora=Date.now();if(agora-ultimoToque<=300)event.preventDefault();ultimoToque=agora},{passive:false});
  document.addEventListener('wheel',event=>{if(event.ctrlKey)event.preventDefault()},{passive:false});
  document.addEventListener('keydown',event=>{const tecla=String(event.key||'').toLowerCase();if((event.ctrlKey||event.metaKey)&&['+','-','=','0'].includes(tecla))event.preventDefault()});
})();

(function direcionarNovoPedidoParaBalcao(){
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('a,button');if(!trigger)return;
    const label=String(trigger.textContent||'').trim().toLowerCase();
    const destination=`${trigger.getAttribute('href')||''} ${trigger.getAttribute('onclick')||''}`.toLowerCase();
    const isAdministrativeNewOrder=trigger.id==='new-order-btn'||trigger.id==='fs-new-order'||(label.includes('novo pedido')&&destination.includes('cardapio.html'));
    if(!isAdministrativeNewOrder)return;
    event.preventDefault();event.stopImmediatePropagation();location.href='balcao.html';
  },true);
})();

const authLock=async(_name,_acquireTimeout,fn)=>await fn();
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,lock:authLock}});

(async function resolvePublicStoreUrl(){
  const isPublicStore=/(^|\/)loja\.html$/i.test(location.pathname);if(!isPublicStore)return;
  const params=new URLSearchParams(location.search);const rawSlug=String(params.get('loja')||'').trim();const slug=['','undefined','null'].includes(rawSlug.toLowerCase())?'':rawSlug;if(slug)return;
  const storeId=String(params.get('estabelecimento')||'').trim();const conceal=document.createElement('style');conceal.id='fs-store-resolver-style';conceal.textContent='body{visibility:hidden!important}';document.head.appendChild(conceal);
  try{
    let store=null;
    if(storeId){const{data,error}=await window.supabaseClient.from('estabelecimentos').select('id,slug').eq('id',storeId).maybeSingle();if(error)throw error;store=data}
    if(!store){const{data:{session}}=await window.supabaseClient.auth.getSession();if(session){const{data,error}=await window.supabaseClient.from('estabelecimentos').select('id,slug').eq('usuario_id',session.user.id).maybeSingle();if(error)throw error;store=data}}
    if(store?.slug){params.set('loja',store.slug);params.delete('estabelecimento');location.replace(`${location.pathname}?${params.toString()}${location.hash}`);return}
  }catch(error){console.error('Falha ao resolver a loja pública:',error)}
  conceal.remove();
})();

[
  ['script','js/pull-to-refresh.js','fsPullRefresh'],
  ['script','js/admin-mobile-nav.js','fsAdminMobileNav'],
  ['script','js/config-modal-bootstrap.js','fsConfigModalBootstrap'],
  ['script','js/subscription-entry.js','fsSubscriptionEntry'],
  ['script','js/assinatura-complemento.js','fsSubscriptionGuards'],
  ['script','js/public-store-link-config.js','fsPublicStoreLinkConfig']
].forEach(([tag,src,key])=>{
  if(document.querySelector(`${tag}[data-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}]`))return;
  const element=document.createElement(tag);element.src=src;element.defer=true;element.dataset[key]='true';document.head.appendChild(element);
});

if(/(^|\/)balcao\.html$/i.test(location.pathname)&&!document.querySelector('script[src="js/balcao-fluxos.js"]')){
  window.addEventListener('DOMContentLoaded',()=>{const script=document.createElement('script');script.src='js/balcao-fluxos.js';script.dataset.fsBalcaoFluxos='true';document.body.appendChild(script)});
}
if(/(^|\/)loja\.html$/i.test(location.pathname)&&!document.querySelector('script[src="js/loja-fluxos-pedido.js"]')){
  const script=document.createElement('script');script.src='js/loja-fluxos-pedido.js';script.defer=true;script.dataset.fsLojaFluxos='true';document.head.appendChild(script);
}

[
  ['css/admin-mobile-nav.css','fsAdminMobileNav'],
  ['css/mobile-density.css','fsMobileDensity']
].forEach(([href,key])=>{
  const selector=`link[data-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}]`;if(document.querySelector(selector))return;
  const style=document.createElement('link');style.rel='stylesheet';style.href=href;style.dataset[key]='true';document.head.appendChild(style);
});

(function carregarPainelOperacionalPedidos(){
  if(!/(^|\/)app\.html$/i.test(location.pathname))return;
  if(!document.querySelector('link[href="css/app-orders-operational.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='css/app-orders-operational.css';document.head.appendChild(style)}
  if(!document.querySelector('script[src="js/app-orders-operational.js"]')){const script=document.createElement('script');script.src='js/app-orders-operational.js';script.defer=true;document.head.appendChild(script)}
  if(!document.querySelector('script[src="js/app-orders-type-filters.js"]')){const script=document.createElement('script');script.src='js/app-orders-type-filters.js';script.defer=true;document.head.appendChild(script)}
})();
