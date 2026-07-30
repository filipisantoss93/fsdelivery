(()=>{
  const side=document.querySelector('.sidebar .nav');
  const mobile=document.querySelector('.mobile-nav');
  if(!side||!mobile)return;

  const gear='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9 6.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2.1 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.5 3.1h5l.5-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4L19 13a7 7 0 0 0 .1-1z"/></svg>';

  side.innerHTML='<button class="active" data-page-main="inicio">Início</button><button data-page-main="pedidos">Pedidos</button><button data-link-main="caixa.html">Caixa</button><button data-link-main="garcom.html">Novo pedido</button><button data-link-main="mesas-operacao.html">Mesas</button><button data-link-main="configuracoes.html">Config</button>';

  mobile.classList.add('config-mobile-nav');
  mobile.innerHTML=`<button class="active" data-page-main="inicio"><svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg><span>Início</span></button><button data-page-main="pedidos"><svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6"/></svg><span>Pedidos</span></button><button data-link-main="caixa.html"><svg viewBox="0 0 24 24"><path d="M3 7h18v12H3z"/><path d="M7 7V4h10v3"/></svg><span>Caixa</span></button><button data-link-main="garcom.html"><svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8"/></svg><span>Novo pedido</span></button><button data-link-main="mesas-operacao.html"><svg viewBox="0 0 24 24"><path d="M4 10h16M6 10v9M18 10v9M8 5h8v5H8z"/></svg><span>Mesas</span></button><button data-link-main="configuracoes.html">${gear}<span>Config</span></button>`;

  const activate=id=>{
    if(typeof openPage==='function')openPage(id);
    document.querySelectorAll('[data-page-main]').forEach(item=>item.classList.toggle('active',item.dataset.pageMain===id));
  };

  document.querySelectorAll('[data-page-main]').forEach(item=>item.onclick=()=>activate(item.dataset.pageMain));
  document.querySelectorAll('[data-link-main]').forEach(item=>item.onclick=()=>location.href=item.dataset.linkMain);

  document.getElementById('configuracoes')?.remove();
  const top=document.getElementById('store-settings-button');
  if(top){
    top.hidden=true;
    top.setAttribute('aria-hidden','true');
    top.tabIndex=-1;
  }

  const requested=location.hash.slice(1).split('&')[0];
  if(requested&&document.getElementById(requested)&&typeof openPage==='function')activate(requested);
})();
