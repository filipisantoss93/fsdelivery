(()=>{
  if(!/(^|\/)app\.html$/i.test(location.pathname))return;

  const validPages=new Set(['inicio','pedidos','cardapio','clientes','financeiro']);
  let navigating=false;

  const titleFor=id=>({inicio:'Início',pedidos:'Pedidos',cardapio:'Cardápio',clientes:'Clientes',financeiro:'Relatórios'}[id]||'Início');

  function pageFromLocation(){
    const hash=location.hash.replace('#','').trim();
    return validPages.has(hash)?hash:'inicio';
  }

  function activate(id,{writeHistory=true}={}){
    if(!validPages.has(id))id='inicio';

    document.querySelectorAll('.page').forEach(page=>{
      const active=page.id===id;
      page.classList.toggle('active',active);
      page.hidden=!active;
      page.setAttribute('aria-hidden',String(!active));
    });

    document.querySelectorAll('[data-page]').forEach(button=>{
      const active=button.dataset.page===id;
      button.classList.toggle('active',active);
      if(active)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });

    const title=document.getElementById('page-title');
    if(title)title.textContent=titleFor(id);

    const more=document.getElementById('mobile-more-menu');
    const moreButton=document.getElementById('mobile-more-button');
    if(more){more.hidden=true}
    if(moreButton)moreButton.setAttribute('aria-expanded','false');

    if(writeHistory){
      const target=id==='inicio'?location.pathname:`${location.pathname}#${id}`;
      history.replaceState({page:id},'',target);
    }
    window.scrollTo({top:0,left:0,behavior:'auto'});
  }

  function handleNavigation(event){
    const button=event.target.closest?.('[data-page]');
    if(!button)return;
    const id=button.dataset.page;
    if(!validPages.has(id))return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if(navigating)return;
    navigating=true;
    activate(id);
    setTimeout(()=>{navigating=false},120);
  }

  document.addEventListener('click',handleNavigation,true);
  document.addEventListener('pointerup',event=>{
    if(event.pointerType==='touch')handleNavigation(event);
  },true);

  window.addEventListener('hashchange',()=>activate(pageFromLocation(),{writeHistory:false}));
  window.addEventListener('pageshow',()=>activate(pageFromLocation(),{writeHistory:false}));
  document.addEventListener('DOMContentLoaded',()=>activate(pageFromLocation(),{writeHistory:false}),{once:true});

  window.FSAppNavigation={open:activate,current:pageFromLocation};
})();
