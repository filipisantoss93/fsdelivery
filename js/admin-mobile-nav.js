(()=>{
  const adminPages=new Set(['app.html','caixa.html','mesas-operacao.html','configuracoes.html']);
  const page=(location.pathname.split('/').pop()||'app.html').toLowerCase();
  if(!adminPages.has(page))return;

  const icons={
    inicio:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
    pedidos:'<path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    caixa:'<path d="M3 7h18v12H3z"/><path d="M7 7V4h10v3"/>',
    mesas:'<path d="M4 10h16M6 10v9M18 10v9M8 5h8v5H8z"/>',
    mais:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };
  const active=page==='caixa.html'?'caixa':page==='mesas-operacao.html'?'mesas':page==='configuracoes.html'?'mais':location.hash==='#pedidos'?'pedidos':'inicio';
  const item=(key,label,url)=>`<button type="button" class="${active===key?'active':''}" data-fs-nav="${key}"${url?` data-url="${url}"`:''}><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${label}</span></button>`;

  const nav=document.querySelector('.mobile-nav');
  if(!nav)return;
  nav.classList.add('fs-admin-mobile-nav');
  nav.innerHTML=[
    item('inicio','Início','app.html'),
    item('pedidos','Pedidos','app.html#pedidos'),
    item('caixa','Caixa','caixa.html'),
    item('mesas','Mesas','mesas-operacao.html'),
    item('mais','Mais','')
  ].join('');

  let backdrop=document.querySelector('.fs-more-backdrop');
  let sheet=document.querySelector('.fs-more-sheet');
  if(!backdrop){backdrop=document.createElement('button');backdrop.type='button';backdrop.className='fs-more-backdrop';backdrop.hidden=true;backdrop.setAttribute('aria-label','Fechar menu');document.body.appendChild(backdrop)}
  if(!sheet){
    sheet=document.createElement('section');
    sheet.className='fs-more-sheet';
    sheet.hidden=true;
    sheet.setAttribute('aria-label','Mais opções');
    sheet.innerHTML='<div class="fs-more-handle"></div><div class="fs-more-head"><div><strong>Mais opções</strong><small>Gestão e configurações</small></div><button type="button" class="fs-more-close" aria-label="Fechar">×</button></div><div class="fs-more-grid"><a href="app.html#cardapio"><b>Cardápio</b><small>Produtos e categorias</small></a><a href="app.html#clientes"><b>Clientes</b><small>Histórico e relacionamento</small></a><a href="app.html#financeiro"><b>Relatórios</b><small>Vendas e operação</small></a><a href="configuracoes.html"><b>Configurações</b><small>Loja, equipe e conta</small></a><a href="loja.html" target="_blank" rel="noopener"><b>Loja pública</b><small>Abrir cardápio on-line</small></a></div>';
    document.body.appendChild(sheet);
  }

  const moreButton=nav.querySelector('[data-fs-nav="mais"]');
  const close=()=>{sheet.hidden=true;backdrop.hidden=true;document.body.classList.remove('fs-more-open');moreButton?.setAttribute('aria-expanded','false')};
  const open=()=>{sheet.hidden=false;backdrop.hidden=false;document.body.classList.add('fs-more-open');moreButton?.setAttribute('aria-expanded','true')};
  nav.addEventListener('click',event=>{
    const button=event.target.closest('[data-fs-nav]');
    if(!button)return;
    if(button.dataset.fsNav==='mais'){open();return}
    location.href=button.dataset.url;
  });
  backdrop.addEventListener('click',close);
  sheet.querySelector('.fs-more-close')?.addEventListener('click',close);
  sheet.querySelectorAll('a').forEach(link=>link.addEventListener('click',close));

  document.querySelectorAll('.topbar .btn,.topbar a.btn').forEach(button=>{
    const text=(button.textContent||'').trim().toLowerCase();
    if(text==='config'||text==='configurações'||text==='estabelecimento'||text==='voltar ao painel')button.classList.add('fs-mobile-top-duplicate');
  });
  document.documentElement.classList.add('fs-admin-nav-ready');
})();
