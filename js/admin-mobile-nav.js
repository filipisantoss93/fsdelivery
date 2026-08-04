(()=>{
  'use strict';

  if(window.__fsAdminMobileNav)return;
  window.__fsAdminMobileNav=true;

  const adminPages=new Set(['app.html','caixa.html','mesas-operacao.html','configuracoes.html']);
  const pathPage=(location.pathname.split('/').pop()||'').toLowerCase();
  const page=pathPage||'index.html';
  if(!adminPages.has(page))return;

  const icons={
    inicio:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    pedidos:'<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    caixa:'<path d="M3 7h18v12H3z"/><path d="M7 7V4h10v3"/>',
    mesas:'<path d="M4 10h16M6 10v9M18 10v9M8 5h8v5H8z"/>',
    mais:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };

  const currentSection=()=>{
    if(page==='caixa.html')return'caixa';
    if(page==='mesas-operacao.html')return'mesas';
    if(page==='configuracoes.html')return'mais';
    const active=document.querySelector('.page.active')?.id;
    if(active==='pedidos'||location.hash==='#pedidos')return'pedidos';
    if(['cardapio','clientes','financeiro','configuracoes'].includes(active)||['#cardapio','#clientes','#financeiro','#configuracoes'].includes(location.hash))return'mais';
    return'inicio';
  };

  const item=(key,label)=>`<button type="button" data-fs-nav="${key}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${label}</span></button>`;
  const markup=['inicio','pedidos','caixa','mesas','mais'].map((key,index)=>item(key,['Início','Pedidos','Caixa','Mesas','Mais'][index])).join('');

  let backdrop=document.querySelector('.fs-more-backdrop');
  let sheet=document.querySelector('.fs-more-sheet');

  function ensureSheet(){
    if(!backdrop){
      backdrop=document.createElement('button');
      backdrop.type='button';
      backdrop.className='fs-more-backdrop';
      backdrop.hidden=true;
      backdrop.setAttribute('aria-label','Fechar menu');
      document.body.appendChild(backdrop);
    }
    if(!sheet){
      sheet=document.createElement('section');
      sheet.className='fs-more-sheet';
      sheet.hidden=true;
      sheet.setAttribute('aria-label','Mais opções');
      sheet.innerHTML='<div class="fs-more-handle"></div><div class="fs-more-head"><div><strong>Mais opções</strong><small>Gestão e configurações</small></div><button type="button" class="fs-more-close" aria-label="Fechar">×</button></div><div class="fs-more-grid"><a href="app.html#cardapio"><b>Cardápio</b><small>Produtos e categorias</small></a><a href="app.html#clientes"><b>Clientes</b><small>Histórico e relacionamento</small></a><a href="app.html#financeiro"><b>Relatórios</b><small>Vendas e operação</small></a><a href="configuracoes.html"><b>Configurações</b><small>Loja, equipe e conta</small></a><a href="loja.html" target="_blank" rel="noopener"><b>Loja pública</b><small>Abrir cardápio on-line</small></a></div>';
      document.body.appendChild(sheet);
    }
  }

  function closeMore(){
    if(sheet)sheet.hidden=true;
    if(backdrop)backdrop.hidden=true;
    document.body.classList.remove('fs-more-open');
    document.querySelector('[data-fs-nav="mais"]')?.setAttribute('aria-expanded','false');
  }

  function openMore(){
    ensureSheet();
    sheet.hidden=false;
    backdrop.hidden=false;
    document.body.classList.add('fs-more-open');
    document.querySelector('[data-fs-nav="mais"]')?.setAttribute('aria-expanded','true');
  }

  function openAppSection(section){
    if(page!=='app.html'){
      location.href=`app.html#${section}`;
      return;
    }
    const target=document.querySelector(`[data-page="${section}"]`);
    if(target){
      target.click();
      history.replaceState(null,'',section==='inicio'?'app.html':`#${section}`);
      requestAnimationFrame(syncActive);
      return;
    }
    location.hash=section;
  }

  function navigate(key){
    if(key==='inicio')return openAppSection('inicio');
    if(key==='pedidos')return openAppSection('pedidos');
    if(key==='caixa')return location.href='caixa.html';
    if(key==='mesas')return location.href='mesas-operacao.html';
    if(key==='mais')return openMore();
  }

  function syncActive(){
    const active=currentSection();
    document.querySelectorAll('[data-fs-nav]').forEach(button=>button.classList.toggle('active',button.dataset.fsNav===active));
  }

  function consolidate(){
    let nav=document.querySelector('.mobile-nav');
    if(!nav){
      nav=document.createElement('nav');
      nav.className='mobile-nav';
      nav.setAttribute('aria-label','Navegação principal');
      document.body.appendChild(nav);
    }
    nav.classList.add('fs-admin-mobile-nav');
    if(nav.dataset.fsConsolidated!=='true'||nav.querySelectorAll('[data-fs-nav]').length!==5){
      nav.innerHTML=markup;
      nav.dataset.fsConsolidated='true';
    }
    syncActive();
    ensureSheet();
    document.querySelectorAll('.mobile-more-menu').forEach(menu=>menu.hidden=true);
    document.querySelectorAll('.topbar .btn,.topbar a.btn').forEach(button=>{
      const text=(button.textContent||'').trim().toLowerCase();
      if(['config','configurações','estabelecimento','voltar ao painel'].includes(text))button.classList.add('fs-mobile-top-duplicate');
    });
    document.documentElement.classList.add('fs-admin-nav-ready');
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-fs-nav]');
    if(button){event.preventDefault();navigate(button.dataset.fsNav);return}
    if(event.target.closest('.fs-more-close')||event.target===backdrop)closeMore();
    if(event.target.closest('.fs-more-sheet a'))closeMore();
  });

  window.addEventListener('hashchange',()=>{setTimeout(()=>{if(page==='app.html'&&location.hash)openAppSection(location.hash.slice(1));syncActive()},0)});
  document.addEventListener('DOMContentLoaded',()=>{
    consolidate();
    if(page==='app.html'&&location.hash)setTimeout(()=>openAppSection(location.hash.slice(1)),0);
    const observer=new MutationObserver(()=>consolidate());
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),5000);
  });

  if(document.readyState!=='loading')consolidate();
})();