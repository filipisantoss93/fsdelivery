(() => {
  const splash=document.getElementById('store-splash');
  const name=document.getElementById('store-splash-name');
  const logo=document.getElementById('store-splash-logo');
  const message=document.getElementById('store-splash-message');
  const retry=document.getElementById('store-splash-retry');

  const safe=value=>{try{const url=new URL(value,location.origin);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return ''}};
  let finished=false;

  function update(store){
    if(!store||finished)return;
    name.textContent=store.nome||'FS Delivery';
    const image=safe(store.logo_url);
    if(image){logo.textContent='';logo.style.backgroundImage=`url("${image}")`;logo.classList.add('has-image')}
    else{logo.style.backgroundImage='';logo.classList.remove('has-image');logo.textContent=(store.nome||'FS').split(/\s+/).slice(0,2).map(item=>item[0]).join('').toUpperCase()}
    message.textContent='Preparando o cardápio...';
  }

  function finish(){
    if(finished||!splash)return;
    finished=true;
    requestAnimationFrame(()=>{
      document.body.classList.remove('store-loading');
      splash.classList.add('is-hidden');
      setTimeout(()=>splash.remove(),350);
    });
  }

  function fail(text='Não foi possível carregar o cardápio.'){
    if(finished||!splash)return;
    document.body.classList.add('store-loading');
    splash.classList.remove('is-hidden');
    message.textContent=text;
    retry.hidden=false;
    retry.onclick=()=>location.reload();
  }

  window.storeSplash={update,finish,fail};

  const observer=new MutationObserver(()=>{
    const storeName=document.getElementById('public-store-name')?.textContent?.trim();
    const status=document.getElementById('public-store-status')?.textContent?.trim();
    if(storeName&&storeName!=='FS Delivery'&&status&&status!=='Carregando')finish();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});

  window.addEventListener('error',event=>{
    if(document.body.classList.contains('store-loading'))fail('Não foi possível carregar o cardápio.');
  });
  window.addEventListener('unhandledrejection',()=>{
    if(document.body.classList.contains('store-loading'))fail('Não foi possível carregar o cardápio.');
  });

  setTimeout(()=>{
    if(document.body.classList.contains('store-loading'))fail('O carregamento está demorando mais que o esperado.');
  },12000);
})();
