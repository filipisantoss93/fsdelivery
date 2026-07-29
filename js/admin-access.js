(async()=>{
  const db=window.supabaseClient;
  if(!db)return;
  const {data:{session}}=await db.auth.getSession();
  if(session?.user?.app_metadata?.role!=='admin')return;
  const nav=document.querySelector('.sidebar .nav');
  if(nav&&!nav.querySelector('[data-admin-link]')){
    const link=document.createElement('a');
    link.href='admin.html';
    link.dataset.adminLink='true';
    link.textContent='Administração';
    link.style.cssText='display:block;color:var(--muted);padding:12px 14px;border-radius:10px;font-weight:600';
    link.onmouseenter=()=>{link.style.background='var(--surface-2)';link.style.color='var(--text)'};
    link.onmouseleave=()=>{link.style.background='transparent';link.style.color='var(--muted)'};
    nav.appendChild(link);
  }
})();