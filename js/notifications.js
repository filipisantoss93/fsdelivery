(() => {
  const button=document.getElementById('notification-button');
  const panel=document.getElementById('notification-panel');
  const list=document.getElementById('notification-list');
  const badge=document.getElementById('notification-badge');
  const markAll=document.getElementById('notification-mark-all');
  if(!button||!panel||!list||!badge)return;
  const storageKey='fsdelivery_notifications_read';
  const readIds=new Set(JSON.parse(localStorage.getItem(storageKey)||'[]'));
  const saveRead=()=>localStorage.setItem(storageKey,JSON.stringify([...readIds].slice(-200)));
  const getNotifications=()=>{try{return (orders||[]).filter(order=>order.status!=='cancelado').slice(0,20).map(order=>({id:String(order.id),orderId:order.id,title:order.status==='novo'?`Novo pedido #${order.id}`:`Pedido #${order.id} — ${labels[order.status]||order.status}`,detail:`${order.customer} • ${order.time} • ${money(order.total)}`}))}catch(_){return[]}};
  function renderNotifications(){
    const notifications=getNotifications(),unread=notifications.filter(item=>!readIds.has(item.id));
    badge.textContent=unread.length>9?'9+':String(unread.length);badge.classList.toggle('show',unread.length>0);
    list.innerHTML=notifications.length?notifications.map(item=>`<button class="notification-item ${readIds.has(item.id)?'':'unread'}" type="button" data-notification-id="${item.id}" data-order-id="${item.orderId}"><span class="notification-dot"></span><span class="notification-copy"><b>${item.title}</b><small>${item.detail}</small></span></button>`).join(''):'<div class="notification-empty">Nenhuma notificação no momento.</div>';
    list.querySelectorAll('[data-notification-id]').forEach(item=>item.onclick=()=>{readIds.add(item.dataset.notificationId);saveRead();renderNotifications();panel.classList.remove('open');button.setAttribute('aria-expanded','false');if(typeof openPage==='function')openPage('pedidos');if(typeof openOrder==='function')openOrder(Number(item.dataset.orderId))});
  }
  button.onclick=event=>{event.stopPropagation();const open=panel.classList.toggle('open');button.setAttribute('aria-expanded',String(open));if(open)renderNotifications()};
  panel.onclick=event=>event.stopPropagation();
  document.addEventListener('click',()=>{panel.classList.remove('open');button.setAttribute('aria-expanded','false')});
  markAll?.addEventListener('click',()=>{getNotifications().forEach(item=>readIds.add(item.id));saveRead();renderNotifications()});
  renderNotifications();setInterval(renderNotifications,15000);
})();

(() => {
  const sidebarNav=document.querySelector('.sidebar .nav');
  const mobileNav=document.querySelector('.mobile-nav');
  if(!sidebarNav||!mobileNav)return;

  sidebarNav.innerHTML=`
    <button class="active" type="button" data-main-page="inicio">Início</button>
    <button type="button" data-main-page="pedidos">Pedidos</button>
    <button type="button" data-main-link="caixa.html">Caixa</button>
    <button type="button" data-main-link="garcom.html">Cardápio</button>
    <button type="button" data-main-link="mesas-operacao.html">Mesas</button>
    <button type="button" data-main-link="configuracoes.html">Config</button>`;

  mobileNav.classList.add('config-mobile-nav');
  mobileNav.innerHTML=`
    <button class="active" type="button" data-main-page="inicio"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg><span>Início</span></button>
    <button type="button" data-main-page="pedidos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6"/></svg><span>Pedidos</span></button>
    <button type="button" data-main-link="caixa.html"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v12H3z"/><path d="M7 7V4h10v3M7 13h4"/></svg><span>Caixa</span></button>
    <button type="button" data-main-link="garcom.html"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8"/></svg><span>Cardápio</span></button>
    <button type="button" data-main-link="mesas-operacao.html"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16M6 10v9M18 10v9M8 5h8v5H8z"/></svg><span>Mesas</span></button>
    <button type="button" data-main-link="configuracoes.html"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09a1.7 1.7 0 0 0-.4-1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09a1.7 1.7 0 0 0 1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09a1.7 1.7 0 0 0 .4 1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.2.37.54.72 1 .9.3.12.64.18 1 .18H21v4h-.09a1.7 1.7 0 0 0-1 .4c-.22.14-.4.32-.51.52z"/></svg><span>Config</span></button>`;

  const activatePage=id=>{
    if(typeof openPage==='function')openPage(id);
    document.querySelectorAll('[data-main-page]').forEach(button=>button.classList.toggle('active',button.dataset.mainPage===id));
  };
  document.querySelectorAll('[data-main-page]').forEach(button=>button.onclick=()=>activatePage(button.dataset.mainPage));
  document.querySelectorAll('[data-main-link]').forEach(button=>button.onclick=()=>location.href=button.dataset.mainLink);

  const oldSettings=document.getElementById('configuracoes');
  if(oldSettings)oldSettings.remove();
  const settingsTopButton=document.getElementById('store-settings-button');
  if(settingsTopButton){settingsTopButton.textContent='Config';settingsTopButton.onclick=()=>location.href='configuracoes.html'}

  const requested=location.hash.slice(1).split('&')[0];
  if(['inicio','pedidos'].includes(requested))activatePage(requested);
})();