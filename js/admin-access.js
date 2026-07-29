(async()=>{
  const db=window.supabaseClient;
  if(!db)return;
  const {data:{session}}=await db.auth.getSession();
  if(session?.user?.app_metadata?.role!=='admin')return;
  const nav=document.querySelector('.sidebar .nav');
  if(nav&&!nav.querySelector('[data-admin-link]')){
    const button=document.createElement('button');
    button.type='button';
    button.dataset.adminLink='true';
    button.textContent='Administração';
    button.onclick=()=>location.href='admin.html';
    nav.appendChild(button);
  }
})();