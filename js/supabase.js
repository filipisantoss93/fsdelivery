const SUPABASE_URL='https://kvjvhoziqcevkzyszdke.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_NgOVxQYh3jxQ7Go7y2HTLg_rVJuQ3mc';
const currentPath=location.pathname.toLowerCase();
const currentPage=(currentPath.split('/').filter(Boolean).pop()||'index').replace(/\.html$/i,'');
const pageKey=name=>String(name||'').toLowerCase().replace(/\.html$/i,'');
const matchesPage=name=>currentPage===pageKey(name);
window.FSDeliveryRoute=Object.freeze({currentPath,currentPage,matchesPage});

(function normalizarViewport(){
  const viewport=document.querySelector('meta[name="viewport"]')||document.createElement('meta');
  viewport.name='viewport';
  viewport.content='width=device-width,initial-scale=1,viewport-fit=cover';
  if(!viewport.parentNode)document.head.appendChild(viewport);
})();

(function direcionarNovoPedidoParaBalcao(){
  if(!matchesPage('app'))return;
  document.addEventListener('click',event=>{
    const trigger=event.target.closest?.('a,button');
    if(!trigger)return;
    const label=String(trigger.textContent||'').trim().toLowerCase();
    const destination=`${trigger.getAttribute('href')||''} ${trigger.getAttribute('onclick')||''}`.toLowerCase();
    const isAdministrativeNewOrder=trigger.id==='new-order-btn'||trigger.id==='fs-new-order'||(label.includes('novo pedido')&&destination.includes('cardapio'));
    if(!isAdministrativeNewOrder)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    location.href='balcao';
  },true);
})();

const authLock=async(_name,_acquireTimeout,fn)=>await fn();
window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,lock:authLock}});

function appendScript(src,key,{defer=true,target=document.head}={}){
  const selector=`script[data-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}]`;
  if(document.querySelector(selector)||document.querySelector(`script[src="${src}"]`))return;
  const script=document.createElement('script');
  script.src=src;
  script.defer=defer;
  script.dataset[key]='true';
  target.appendChild(script);
}

function appendStyle(href,key){
  const selector=`link[data-${key.replace(/[A-Z]/g,m=>`-${m.toLowerCase()}`)}]`;
  if(document.querySelector(selector)||document.querySelector(`link[href="${href}"]`))return;
  const style=document.createElement('link');
  style.rel='stylesheet';
  style.href=href;
  style.dataset[key]='true';
  document.head.appendChild(style);
}

(async function resolvePublicStoreUrl(){
  if(!matchesPage('loja'))return;
  const params=new URLSearchParams(location.search);
  const rawSlug=String(params.get('loja')||'').trim();
  const slug=['','undefined','null'].includes(rawSlug.toLowerCase())?'':rawSlug;
  if(slug)return;
  const storeId=String(params.get('estabelecimento')||'').trim();
  document.documentElement.classList.add('fs-store-resolving');
  try{
    let store=null;
    if(storeId){
      const{data,error}=await window.supabaseClient.from('estabelecimentos').select('id,slug').eq('id',storeId).maybeSingle();
      if(error)throw error;
      store=data;
    }
    if(!store){
      const{data:{session}}=await window.supabaseClient.auth.getSession();
      if(session){
        const{data,error}=await window.supabaseClient.from('estabelecimentos').select('id,slug').eq('usuario_id',session.user.id).maybeSingle();
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
  document.documentElement.classList.remove('fs-store-resolving');
})();

appendScript('js/pull-to-refresh.js','fsPullRefresh');

if(matchesPage('app')||matchesPage('configuracoes')){
  appendScript('js/admin-mobile-nav.js','fsAdminMobileNav');
  appendStyle('css/admin-mobile-nav.css','fsAdminMobileNav');
}

if(matchesPage('configuracoes')){
  appendStyle('css/config-bairros-cidade.css','fsConfigBairrosCidade');
  appendScript('js/config-modal-bootstrap.js','fsConfigModalBootstrap');
  appendScript('js/public-store-link-config.js','fsPublicStoreLinkConfig');
  appendScript('js/config-bairros-cidade.js','fsConfigBairrosCidade');
  appendScript('js/config-bairros-importacao-segura.js','fsConfigBairrosImportacaoSegura');
}

if(matchesPage('app')||matchesPage('configuracoes')||matchesPage('assinatura')){
  appendScript('js/subscription-entry.js','fsSubscriptionEntry');
  appendScript('js/assinatura-complemento.js','fsSubscriptionGuards');
}

if(matchesPage('loja')||matchesPage('balcao')||matchesPage('cardapio')||matchesPage('app')){
  appendScript('js/clientes-enderecos.js','fsClientesEnderecos');
}

if(matchesPage('balcao')){
  window.addEventListener('DOMContentLoaded',()=>appendScript('js/balcao-fluxos.js','fsBalcaoFluxos',{defer:false,target:document.body}),{once:true});
}

if(matchesPage('loja')){
  appendScript('js/loja-fluxos-pedido.js','fsLojaFluxos');
  appendScript('js/loja-pos-envio.js','fsLojaPosEnvio');
  appendScript('js/loja-publica-consolidado.js','fsLojaPublicaConsolidada');
}

if(matchesPage('app')){
  appendStyle('css/app-orders-operational.css','fsAppOrdersOperational');
  appendScript('js/app-orders-operational.js','fsAppOrdersOperational');
  appendScript('js/app-orders-type-filters.js','fsAppOrdersTypeFilters');
}

if(matchesPage('app')||matchesPage('balcao')||matchesPage('cardapio')||matchesPage('caixa')||matchesPage('cozinha')||matchesPage('entregador')){
  appendStyle('css/mobile-density.css','fsMobileDensity');
}
