(async()=>{
  'use strict';
  const db=window.supabaseClient;
  const teamKey='fsdelivery_team';
  const maxAge=12*60*60*1000;
  let ownerSession=null;
  try{
    const result=await db.auth.getSession();
    ownerSession=result.data.session;
  }catch(error){
    console.error('Falha ao validar sessão do proprietário:',error);
  }
  const team=JSON.parse(sessionStorage.getItem(teamKey)||'null');
  const validTeam=Boolean(team&&team.funcao==='garcom'&&team.estabelecimento_id&&team.authenticated_at&&Date.now()-Number(team.authenticated_at)<=maxAge);
  if(!ownerSession&&!validTeam){
    sessionStorage.removeItem(teamKey);
    location.replace('garcom.html');
    return;
  }
  document.getElementById('waiter-logout').onclick=async()=>{
    sessionStorage.removeItem(teamKey);
    if(ownerSession)await db.auth.signOut();
    location.replace('garcom.html');
  };
  const script=document.createElement('script');
  script.src='js/garcom.js';
  script.onload=()=>{
    const title=document.getElementById('waiter-page-title');
    const readySource=document.getElementById('waiter-ready-count');
    const readyBadge=document.getElementById('waiter-ready-nav-count');
    const syncTitle=()=>{if(title.textContent==='Cardápio')title.textContent='Novo pedido'};
    const syncReadyBadge=()=>{
      const count=Math.max(0,Number(readySource.textContent)||0);
      readyBadge.textContent=count>99?'99+':String(count);
      readyBadge.hidden=count===0;
    };
    new MutationObserver(syncTitle).observe(title,{childList:true,subtree:true,characterData:true});
    new MutationObserver(syncReadyBadge).observe(readySource,{childList:true,subtree:true,characterData:true});
    syncTitle();
    syncReadyBadge();
  };
  script.onerror=()=>{
    document.getElementById('waiter-store-status').textContent='Erro ao carregar';
    document.getElementById('waiter-store-status').className='status cancelado';
  };
  document.body.appendChild(script);
})();
