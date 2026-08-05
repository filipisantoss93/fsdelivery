(()=>{
  'use strict';
  if(window.__fsAppUiSync)return;
  window.__fsAppUiSync=true;

  const cleanup=[];
  const timers=[];
  const listen=(target,type,handler,options)=>{
    target?.addEventListener(type,handler,options);
    cleanup.push(()=>target?.removeEventListener(type,handler,options));
  };
  const schedule=(handler,delay)=>{
    const timer=setTimeout(handler,delay);
    timers.push(timer);
  };

  function syncStoreStatus(){
    const button=document.getElementById('store-status-button');
    const label=document.getElementById('store-status-label');
    if(!button||!label)return;
    label.textContent=button.classList.contains('pronto')?'Loja aberta':'Loja fechada';
  }

  function syncPreparing(){
    const summary=document.getElementById('summary-preparing');
    const home=document.getElementById('home-preparing');
    if(summary&&home)home.textContent=summary.textContent;
  }

  function syncOperationalSummary(){
    syncStoreStatus();
    syncPreparing();
  }

  function setupOrderTabs(){
    const kanban=document.getElementById('orders-kanban');
    const active=document.getElementById('active-orders-tab');
    const history=document.getElementById('history-orders-tab');
    if(!kanban||!active||!history)return;
    const showActive=()=>{
      kanban.classList.add('history-hidden');
      [...kanban.children].forEach(column=>column.hidden=false);
      active.classList.add('active');
      history.classList.remove('active');
    };
    const showHistory=()=>{
      kanban.classList.remove('history-hidden');
      [...kanban.children].forEach((column,index)=>column.hidden=index!==3);
      history.classList.add('active');
      active.classList.remove('active');
    };
    listen(active,'click',showActive);
    listen(history,'click',showHistory);
  }

  function setupMoreMenu(){
    const button=document.getElementById('mobile-more-button');
    const menu=document.getElementById('mobile-more-menu');
    if(!button||!menu)return;
    const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false')};
    listen(button,'click',()=>{const open=menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',String(open))});
    menu.querySelectorAll('[data-mobile-page]').forEach(item=>listen(item,'click',()=>{document.querySelector(`[data-page="${item.dataset.mobilePage}"]`)?.click();close()}));
    listen(document,'click',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!button.contains(event.target))close()});
    listen(document,'keydown',event=>{if(event.key==='Escape')close()});
  }

  function setupExplicitSync(){
    syncOperationalSummary();
    [100,350,900,1800,3200].forEach(delay=>schedule(syncOperationalSummary,delay));
    listen(document,'fs:store-status-changed',syncStoreStatus);
    listen(document,'fs:orders-updated',syncPreparing);
    listen(document,'click',event=>{
      if(event.target.closest?.('#store-status-button,[data-page="inicio"],[data-page="pedidos"],[data-go="pedidos"]'))schedule(syncOperationalSummary,0);
    });
    listen(window,'focus',syncOperationalSummary);
  }

  function start(){
    setupExplicitSync();
    setupOrderTabs();
    setupMoreMenu();
  }

  if(document.readyState==='loading')listen(document,'DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('pagehide',()=>{
    timers.splice(0).forEach(clearTimeout);
    cleanup.splice(0).forEach(dispose=>dispose());
  },{once:true});
})();
