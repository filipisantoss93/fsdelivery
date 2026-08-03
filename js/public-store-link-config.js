(async function publicStoreLinkConfig(){
  if(!/(^|\/)configuracoes\.html$/i.test(location.pathname))return;

  const db=window.supabaseClient;
  const normalizeSlug=value=>String(value||'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,60);
  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const waitFor=(selector,timeout=10000)=>new Promise(resolve=>{
    const found=document.querySelector(selector);
    if(found)return resolve(found);
    const observer=new MutationObserver(()=>{
      const node=document.querySelector(selector);
      if(node){observer.disconnect();resolve(node)}
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(()=>{observer.disconnect();resolve(document.querySelector(selector))},timeout);
  });

  const {data:{session}}=await db.auth.getSession();
  if(!session)return;
  const {data:store,error}=await db.from('estabelecimentos').select('id,nome,slug').eq('usuario_id',session.user.id).maybeSingle();
  if(error||!store){console.warn('Não foi possível preparar o link público da loja.',error);return}

  let currentSlug=normalizeSlug(store.slug||store.nome);
  const publicUrl=()=>{
    const url=new URL('loja.html',location.origin+'/');
    if(currentSlug)url.searchParams.set('loja',currentSlug);
    else url.searchParams.set('estabelecimento',store.id);
    return url.href;
  };

  function refreshLinks(){
    const url=publicUrl();
    document.querySelectorAll('a[href]').forEach(link=>{
      try{
        const parsed=new URL(link.getAttribute('href'),location.href);
        if(/(^|\/)loja\.html$/i.test(parsed.pathname))link.href=url;
      }catch(_){ }
    });
    document.querySelectorAll('input[readonly]').forEach(input=>{
      if(/loja\.html(?:\?|$)/i.test(input.value)||input.id==='public-store-link')input.value=url;
    });
    const open=document.getElementById('public-store-open');
    const field=document.getElementById('public-store-link');
    if(open)open.href=url;
    if(field)field.value=url;
    const preview=document.getElementById('restaurant-slug-preview');
    if(preview)preview.textContent=currentSlug?`Seu link: ${url}`:'Defina um endereço para gerar o link público.';
  }

  function injectPublicLinkCard(){
    if(document.getElementById('public-store-access'))return;
    const groups=[...document.querySelectorAll('.config-group')];
    const group=groups.find(item=>item.querySelector('.config-group-head h2')?.textContent.trim()==='Estabelecimento')||groups[0];
    if(!group)return;
    const card=document.createElement('div');
    card.id='public-store-access';
    card.className='operational-links';
    card.innerHTML=`<div class="config-group-head operational-links-head"><h3>Loja pública</h3><p>Link correto para abrir, copiar e compartilhar o cardápio com os clientes.</p></div><div class="operational-links-grid"><article class="operational-link-card"><div><strong>Cardápio on-line</strong><small>Endereço público identificado pelo slug da loja</small></div><input id="public-store-link" value="${escapeHtml(publicUrl())}" readonly aria-label="Link público da loja"><div class="inline-actions operational-link-actions"><a class="btn btn-secondary" id="public-store-open" href="${escapeHtml(publicUrl())}" target="_blank" rel="noopener">Abrir</a><button class="btn btn-secondary" id="public-store-copy" type="button">Copiar link</button><button class="btn btn-primary" id="public-store-share" type="button">Compartilhar</button></div></article></div>`;
    group.appendChild(card);
    document.getElementById('public-store-copy').onclick=async event=>{
      const input=document.getElementById('public-store-link');
      try{await navigator.clipboard.writeText(input.value);const button=event.currentTarget;const old=button.textContent;button.textContent='Link copiado';setTimeout(()=>button.textContent=old,1500)}catch(_){input.focus();input.select();document.execCommand('copy')}
    };
    document.getElementById('public-store-share').onclick=async()=>{
      const url=publicUrl();
      if(navigator.share){try{await navigator.share({title:`Cardápio — ${store.nome||'Loja'}`,text:`Confira o cardápio de ${store.nome||'nossa loja'}.`,url});return}catch(error){if(error?.name==='AbortError')return}}
      await navigator.clipboard.writeText(url);
      alert('Link público copiado.');
    };
  }

  function injectSlugEditor(){
    if(document.getElementById('restaurant-slug'))return;
    const nameInput=document.getElementById('restaurant-name');
    const formGrid=nameInput?.closest('.form-grid');
    if(!formGrid)return;
    const field=document.createElement('div');
    field.className='field full';
    field.innerHTML=`<label for="restaurant-slug">Endereço personalizado da loja</label><div class="copy-field"><span style="align-self:center;color:var(--muted);white-space:nowrap">/loja.html?loja=</span><input id="restaurant-slug" maxlength="60" autocomplete="off" placeholder="nome-da-loja" value="${escapeHtml(currentSlug)}"><button class="btn btn-secondary" id="save-restaurant-slug" type="button">Salvar endereço</button></div><small id="restaurant-slug-preview" style="display:block;margin-top:7px;color:var(--muted)"></small>`;
    nameInput.closest('.field')?.after(field);
    const input=document.getElementById('restaurant-slug');
    input.addEventListener('input',()=>{
      const normalized=normalizeSlug(input.value);
      if(input.value!==normalized)input.value=normalized;
      const url=new URL('loja.html',location.origin+'/');
      if(normalized)url.searchParams.set('loja',normalized);
      document.getElementById('restaurant-slug-preview').textContent=normalized?`Seu link será: ${url.href}`:'Use letras, números e hífens.';
    });
    document.getElementById('save-restaurant-slug').onclick=async event=>{
      const button=event.currentTarget;
      const nextSlug=normalizeSlug(input.value);
      if(nextSlug.length<3)return alert('O endereço precisa ter pelo menos 3 caracteres.');
      button.disabled=true;button.textContent='Salvando...';
      const {data:existing,error:checkError}=await db.from('estabelecimentos').select('id').eq('slug',nextSlug).neq('id',store.id).maybeSingle();
      if(checkError){button.disabled=false;button.textContent='Salvar endereço';return alert(checkError.message)}
      if(existing){button.disabled=false;button.textContent='Salvar endereço';return alert('Este endereço já está em uso. Escolha outro.')}
      const {error:updateError}=await db.from('estabelecimentos').update({slug:nextSlug}).eq('id',store.id);
      button.disabled=false;button.textContent='Salvar endereço';
      if(updateError)return alert(updateError.message);
      currentSlug=nextSlug;store.slug=nextSlug;input.value=nextSlug;refreshLinks();alert('Endereço público da loja salvo.');
    };
    refreshLinks();
  }

  await waitFor('.config-groups');
  injectPublicLinkCard();
  injectSlugEditor();
  refreshLinks();
  setTimeout(()=>{injectPublicLinkCard();injectSlugEditor();refreshLinks()},1200);
})();