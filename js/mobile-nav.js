(()=>{
  'use strict';

  if(window.__fsUnifiedMobileNav)return;
  window.__fsUnifiedMobileNav=true;

  const route=window.FSDeliveryRoute||{};
  const page=route.currentPage||String(location.pathname.split('/').filter(Boolean).pop()||'index').replace(/\.html$/i,'').toLowerCase();
  const mainPages=new Set(['app','caixa','mesas-operacao','configuracoes','balcao','pagamentos']);

  const icons={
    inicio:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    pedidos:'<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    caixa:'<path d="M3 7h18v12H3z"/><path d="M7 7V4h10v3"/>',
    mesas:'<path d="M4 10h16M6 10v9M18 10v9M8 5h8v5H8z"/>',
    mais:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    cardapio:'<path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M12 16v4M10 18h4"/>',
    fila:'<path d="M7 4h10l2 3v14H5V7z"/><path d="M9 11h6M9 15h6"/>',
    local:'<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>',
    online:'<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M3 12h18M12 3c2.2 2.5 3.2 5.5 3.2 9S14.2 18.5 12 21M12 3c-2.2 2.5-3.2 5.5-3.2 9S9.8 18.5 12 21"/>',
    rota:'<path d="M5 4h5l4 16h5"/><circle cx="5" cy="4" r="2"/><circle cx="19" cy="20" r="2"/>',
    atualizar:'<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-12-2L4 11M6 15a7 7 0 0 0 12 2l2-4"/>',
    entregas:'<path d="M3 6h11v11H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'
  };

  const svg=key=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]||icons.mais}</svg>`;
  const button=(key,label,attrs='',extra='')=>`<button type="button" ${attrs}>${svg(key)}<span>${label}</span>${extra}</button>`;

  function profile(){
    if(page==='cardapio'&&document.body.classList.contains('waiter-menu-body'))return'waiter';
    if(page==='cozinha')return'kitchen';
    if(page==='entregador')return'delivery';
    if(mainPages.has(page))return'main';
    return null;
  }

  function mainActive(){
    if(page==='caixa')return'caixa';
    if(page==='mesas-operacao')return'mesas';
    if(['configuracoes','pagamentos'].includes(page))return'mais';
    if(page==='balcao')return'pedidos';
    const active=document.querySelector('.page.active')?.id||'';
    const hash=location.hash.replace(/^#/,'');
    if(active==='pedidos'||hash==='pedidos')return'pedidos';
    if(['cardapio','clientes','financeiro','configuracoes'].includes(active)||['cardapio','clientes','financeiro','configuracoes'].includes(hash))return'mais';
    return'inicio';
  }

  function mainMarkup(){
    return[
      button('inicio','Início','data-fs-nav="inicio" aria-label="Início"'),
      button('pedidos','Pedidos','data-fs-nav="pedidos" aria-label="Pedidos"'),
      button('caixa','Caixa','data-fs-nav="caixa" aria-label="Caixa"'),
      button('mesas','Mesas','data-fs-nav="mesas" aria-label="Mesas"'),
      button('mais','Mais','data-fs-nav="mais" aria-label="Mais opções" aria-expanded="false"')
    ].join('');
  }

  function waiterMarkup(){
    return[
      button('mesas','Mesas','class="active" data-waiter-page="mesas" aria-label="Mesas"'),
      button('cardapio','Novo pedido','data-waiter-page="cardapio" aria-label="Novo pedido"'),
      button('fila','Pedidos','data-waiter-page="pedidos" aria-label="Pedidos"','<b class="waiter-nav-badge" id="waiter-ready-nav-count" hidden>0</b>')
    ].join('');
  }

  function kitchenMarkup(){
    return[
      button('local','Local','class="active" data-kitchen-scope="local" aria-label="Pedidos locais"'),
      button('online','On-line','data-kitchen-scope="online" aria-label="Pedidos on-line"')
    ].join('');
  }

  function deliveryMarkup(){
    return[
      button('entregas','Entregas','class="active" data-fs-action="delivery-top" aria-label="Entregas"'),
      button('rota','Rota','data-fs-action="delivery-route" aria-label="Abrir rota"'),
      button('atualizar','Atualizar','data-fs-action="delivery-refresh" aria-label="Atualizar entregas"')
    ].join('');
  }

  function ensureMoreSheet(){
    let backdrop=document.querySelector('.fs-mobile-more-backdrop');
    let sheet=document.querySelector('.fs-mobile-more-sheet');
    if(!backdrop){
      backdrop=document.createElement('button');
      backdrop.type='button';
      backdrop.className='fs-mobile-more-backdrop';
      backdrop.hidden=true;
      backdrop.setAttribute('aria-label','Fechar menu');
      document.body.appendChild(backdrop);
    }
    if(!sheet){
      sheet=document.createElement('section');
      sheet.className='fs-mobile-more-sheet';
      sheet.hidden=true;
      sheet.setAttribute('aria-label','Mais opções');
      sheet.innerHTML='<div class="fs-mobile-more-handle"></div><div class="fs-mobile-more-head"><div><strong>Mais opções</strong><small>Gestão e configurações</small></div><button type="button" class="fs-mobile-more-close" aria-label="Fechar">×</button></div><div class="fs-mobile-more-grid"><a href="app#cardapio"><b>Cardápio</b><small>Produtos e categorias</small></a><a href="app#clientes"><b>Clientes</b><small>Histórico e relacionamento</small></a><a href="app#financeiro"><b>Relatórios</b><small>Vendas e operação</small></a><a href="configuracoes"><b>Configurações</b><small>Loja, equipe e conta</small></a><a href="loja" target="_blank" rel="noopener"><b>Loja pública</b><small>Abrir cardápio on-line</small></a></div>';
      document.body.appendChild(sheet);
    }
    return{backdrop,sheet};
  }

  function closeMore(){
    const backdrop=document.querySelector('.fs-mobile-more-backdrop');
    const sheet=document.querySelector('.fs-mobile-more-sheet');
    if(backdrop)backdrop.hidden=true;
    if(sheet)sheet.hidden=true;
    document.body.classList.remove('fs-mobile-more-open');
    document.querySelector('[data-fs-nav="mais"]')?.setAttribute('aria-expanded','false');
  }

  function openMore(){
    const{backdrop,sheet}=ensureMoreSheet();
    backdrop.hidden=false;
    sheet.hidden=false;
    document.body.classList.add('fs-mobile-more-open');
    document.querySelector('[data-fs-nav="mais"]')?.setAttribute('aria-expanded','true');
  }

  function openAppSection(section){
    if(page!=='app'){
      location.href=section==='inicio'?'app':`app#${section}`;
      return;
    }
    const target=document.querySelector(`[data-page="${section}"]`);
    if(target){
      target.click();
      history.replaceState(null,'',section==='inicio'?'app':`#${section}`);
      requestAnimationFrame(syncMainActive);
      return;
    }
    location.hash=section;
  }

  function navigateMain(key){
    if(key==='inicio')return openAppSection('inicio');
    if(key==='pedidos')return openAppSection('pedidos');
    if(key==='caixa')return location.href='caixa';
    if(key==='mesas')return location.href='mesas-operacao';
    if(key==='mais')return openMore();
  }

  function syncMainActive(){
    if(profile()!=='main')return;
    const active=mainActive();
    document.querySelectorAll('.fs-mobile-nav [data-fs-nav]').forEach(el=>el.classList.toggle('active',el.dataset.fsNav===active));
  }

  function mount(){
    const kind=profile();
    if(!kind)return;

    document.querySelectorAll('.mobile-nav').forEach(nav=>nav.remove());
    document.querySelectorAll('.mobile-more-menu,.fs-more-backdrop,.fs-more-sheet').forEach(el=>el.remove());

    const nav=document.createElement('nav');
    nav.className=`mobile-nav fs-mobile-nav fs-mobile-nav--${kind}`;
    nav.dataset.fsMobileNav='true';
    nav.setAttribute('aria-label',kind==='waiter'?'Navegação do garçom':kind==='kitchen'?'Navegação da cozinha':kind==='delivery'?'Navegação do entregador':'Navegação principal');
    nav.innerHTML=kind==='main'?mainMarkup():kind==='waiter'?waiterMarkup():kind==='kitchen'?kitchenMarkup():deliveryMarkup();
    document.body.appendChild(nav);
    document.documentElement.classList.add('fs-mobile-nav-ready');
    document.body.dataset.fsMobileNavProfile=kind;
    if(kind==='main'){ensureMoreSheet();syncMainActive();}
  }

  document.addEventListener('click',event=>{
    const mainButton=event.target.closest('.fs-mobile-nav [data-fs-nav]');
    if(mainButton){event.preventDefault();navigateMain(mainButton.dataset.fsNav);return;}

    const action=event.target.closest('.fs-mobile-nav [data-fs-action]')?.dataset.fsAction;
    if(action==='delivery-top'){event.preventDefault();window.scrollTo({top:0,behavior:'smooth'});return;}
    if(action==='delivery-route'){event.preventDefault();document.getElementById('delivery-route')?.click();return;}
    if(action==='delivery-refresh'){event.preventDefault();document.getElementById('delivery-refresh')?.click();return;}

    if(event.target.closest('.fs-mobile-more-close')||event.target.classList.contains('fs-mobile-more-backdrop')){event.preventDefault();closeMore();return;}
    if(event.target.closest('.fs-mobile-more-sheet a'))closeMore();

    if(profile()==='main'&&event.target.closest('[data-page]'))requestAnimationFrame(syncMainActive);
  },false);

  window.addEventListener('hashchange',()=>requestAnimationFrame(syncMainActive));

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
