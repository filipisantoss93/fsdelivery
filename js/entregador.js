(()=>{
 const loadStyle=href=>{if(document.querySelector(`link[href="${href}"]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link)};
 const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.body.appendChild(script)});
 loadStyle('css/operational.css');
 load('js/pedido-status.js').then(()=>load('js/entregador-core.js')).then(()=>load('js/entregador-operational.js')).then(()=>load('js/operational-notifications.js')).then(()=>{const team=JSON.parse(sessionStorage.getItem('fsdelivery_team')||'null');window.FSOperationalNotifications.start({role:'entregador',storeId:team?.estabelecimento_id,team})}).catch(error=>{console.error(error);document.getElementById('delivery-orders').innerHTML='<div class="empty-state">Não foi possível carregar as entregas.</div>'});
})();
