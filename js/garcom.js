(()=>{
 const loadStyle=href=>{if(document.querySelector(`link[href="${href}"]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link)};
 const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.body.appendChild(script)});
 loadStyle('css/operational.css');
 load('js/pedido-status.js').then(()=>load('js/garcom-core.js')).then(()=>load('js/garcom-operational.js')).then(()=>load('js/operational-notifications.js')).then(()=>{const team=JSON.parse(sessionStorage.getItem('fsdelivery_team')||'null');window.FSOperationalNotifications.start({role:'garcom',storeId:team?.estabelecimento_id,team})}).catch(error=>{console.error(error);document.getElementById('waiter-store-status').textContent='Erro ao carregar';document.getElementById('waiter-store-status').className='status cancelado'});
})();
