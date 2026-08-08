const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const db=window.supabaseClient;
const params=new URLSearchParams(location.search);
const slug=params.get('loja');
const tableToken=params.get('mesa');
let settings;
let operational={};
let table=null;
let products=[];
let cart=[];
let regions=[];
let current=null;
let qty=1;
let selectedRegion=null;
let appliedCoupon='';
let activeCategory='';
let submitting=false;
const $=id=>document.getElementById(id);
const cartKey=()=>`fsdelivery_cart_${slug||'public'}_${tableToken||'online'}`;
const customerKey=()=>`fsdelivery_customer_${slug||'public'}`;
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const safeImage=value=>{try{const url=new URL(value,location.origin);return ['http:','https:'].includes(url.protocol)?url.href:''}catch{return ''}};
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const categoryIcon=category=>{const value=normalize(category);if(value.includes('lanche')||value.includes('hamburg'))return '🍔';if(value.includes('porç')||value.includes('porc'))return '🍟';if(value.includes('bebida')||value.includes('suco')||value.includes('refrigerante'))return '🥤';if(value.includes('sobremesa')||value.includes('doce'))return '🍰';return '•'};

function setFeedback(message,type='success',timeout=3200){
  const node=$('store-feedback');
  node.hidden=false;
  node.className=`feedback${type==='error'?' error':''}`;
  node.textContent=message;
  clearTimeout(setFeedback.timer);
  if(timeout)setFeedback.timer=setTimeout(()=>node.hidden=true,timeout);
  node.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function saveCart(){localStorage.setItem(cartKey(),JSON.stringify(cart))}
function loadCart(){try{cart=JSON.parse(localStorage.getItem(cartKey())||'[]');if(!Array.isArray(cart))cart=[]}catch{cart=[]}}
function saveCustomer(form){localStorage.setItem(customerKey(),JSON.stringify({name:String(form.get('name')||''),phone:String(form.get('phone')||''),address:String(form.get('address')||'')}))}
function loadCustomer(){try{const data=JSON.parse(localStorage.getItem(customerKey())||'{}');$('customer-name').value=data.name||'';$('customer-phone').value=data.phone||'';$('customer-address').value=data.address||''}catch{}}

async function init(){
  if(!slug)return showFatal('Loja não informada.');
  try{
    const {data:est,error:storeError}=await db.from('estabelecimentos').select('*').eq('slug',slug).maybeSingle();
    if(storeError)throw storeError;
    if(!est)return showFatal('Loja não encontrada.');
    settings=est;

    const [{data:publicContext,error:contextError},{data:open,error:openError}]=await Promise.all([
      db.rpc('contexto_publico_loja',{p_slug:slug}),
      db.rpc('loja_disponivel',{p_estabelecimento:est.id})
    ]);
    if(contextError)throw contextError;
    if(openError)throw openError;
    operational=publicContext?.operacional||{};
    regions=Array.isArray(publicContext?.regioes)?publicContext.regioes:[];
    settings.aberto=Boolean(settings.aberto&&open!==false);

    if(tableToken){
      const {data:mesa,error:tableError}=await db.from('mesas').select('id,nome,numero,ativo,codigo_qr').eq('estabelecimento_id',est.id).eq('codigo_qr',tableToken).eq('ativo',true).maybeSingle();
      if(tableError)throw tableError;
      if(!mesa)return showFatal('Mesa inválida ou indisponível.');
      table=mesa;
    }

    const {data,error:productsError}=await db.from('produtos').select('*,categorias(nome)').eq('estabelecimento_id',est.id).eq('ativo',true).order('created_at');
    if(productsError)throw productsError;
    products=(data||[]).map(product=>({
      id:product.id,
      name:product.nome,
      category:product.categorias?.nome||'Cardápio',
      price:Number(product.preco),
      description:product.descricao||'',
      image:safeImage(product.imagem_url),
      featured:Boolean(product.destaque)
    }));

    loadCart();
    decorateStore();
    configureContext();
    bind();
    loadCustomer();
    renderMenu();
    renderCart();
  }catch(error){
    console.error(error);
    showFatal('Não foi possível carregar o cardápio. Atualize a página e tente novamente.');
  }
}

function showFatal(message){
  $('menu-content').innerHTML=`<div class="empty-state"><h3>${escapeHtml(message)}</h3></div>`;
  $('category-tabs').innerHTML='';
  $('store-summary').hidden=true;
  $('mobile-cart').hidden=true;
}

function decorateStore(){
  document.title=`${settings.nome} — Cardápio`;
  $('public-store-name').textContent=settings.nome;
  $('public-store-meta').textContent=settings.categoria||settings.descricao||'Delivery';
  const logo=$('public-store-logo');
  if(settings.logo_url){logo.textContent='';logo.style.backgroundImage=`url("${safeImage(settings.logo_url)}")`;logo.style.backgroundSize='cover';logo.style.backgroundPosition='center'}
  else logo.textContent=settings.nome.split(/\s+/).slice(0,2).map(item=>item[0]).join('').toUpperCase();
  if(settings.banner_url){const banner=safeImage(settings.banner_url);if(banner)document.querySelector('.store-header').style.backgroundImage=`linear-gradient(rgba(42,23,13,.78),rgba(42,23,13,.78)),url("${banner}")`}
  const status=$('public-store-status');
  status.textContent=settings.aberto?'Aberto agora':'Fechado agora';
  status.classList.toggle('is-open',settings.aberto);
  status.classList.toggle('is-closed',!settings.aberto);
  $('store-delivery-time').textContent=`${settings.tempo_entrega_min||30}–${settings.tempo_entrega_max||45} min`;
  $('store-minimum-order').textContent=money(settings.pedido_minimo);
  $('store-delivery-fee').textContent=regions.length?'Conforme região':money(settings.taxa_entrega);
  $('store-contact').textContent=settings.telefone||'Consulte no pedido';
  $('closed-notice').hidden=settings.aberto;
  $('customer-orders-link').href=`cliente.html?loja=${encodeURIComponent(slug)}`;
  $('track-order-link').href=`cliente.html?loja=${encodeURIComponent(slug)}`;
  const phone=String(settings.telefone||'').replace(/\D/g,'');
  if(phone){$('store-whatsapp').href=`https://wa.me/${phone.startsWith('55')?phone:`55${phone}`}`;$('store-whatsapp').hidden=false}
}

function configureContext(){
  const select=$('delivery-type');
  if(table){
    const name=table.nome||`Mesa ${table.numero}`;
    $('table-context').hidden=false;
    $('table-context').textContent=`Pedido local • ${name}`;
    $('order-context-label').textContent=name;
    select.innerHTML='<option value="mesa">Pedido nesta mesa</option>';
    $('address-field').style.display='none';
    $('customer-orders-link').style.display='none';
  }else{
    select.innerHTML='<option value="delivery">Entrega</option><option value="pickup">Retirada</option><option value="local">Comer no local</option>';
    $('order-context-label').textContent='Pedido on-line';
  }
  const payments=Array.isArray(operational.formas_pagamento)&&operational.formas_pagamento.length?operational.formas_pagamento:['PIX','Cartão de crédito','Cartão de débito','Dinheiro'];
  $('payment-method').innerHTML=payments.map(item=>`<option>${escapeHtml(item)}</option>`).join('');
  const regionField=document.createElement('div');
  regionField.className='field full';
  regionField.id='region-field';
  regionField.innerHTML=`<label for="delivery-region">Bairro ou região</label><select id="delivery-region"><option value="">Selecione</option>${regions.map(region=>`<option value="${escapeHtml(region.id)}">${escapeHtml(region.nome)} • ${money(region.taxa)}</option>`).join('')}</select>`;
  $('address-field').before(regionField);
  if(operational.cupons_ativos){
    const coupon=document.createElement('div');
    coupon.className='field full';
    coupon.innerHTML='<label for="coupon-code">Cupom</label><div class="copy-field"><input id="coupon-code" placeholder="Digite o código"><button class="btn btn-secondary" id="apply-coupon" type="button">Aplicar</button></div>';
    $('checkout-subtotal').closest('.row-card').before(coupon);
  }
  updateTotal();
}

function bind(){
  window.FSRuntime.bindModalDismiss(close);
  $('checkout-btn').onclick=checkout;
  $('mobile-cart').onclick=checkout;
  $('delivery-type').onchange=()=>{selectedRegion=null;$('delivery-region').value='';updateTotal()};
  $('delivery-region').onchange=event=>{selectedRegion=regions.find(region=>String(region.id)===event.target.value)||null;updateTotal()};
  $('menu-search').oninput=renderMenu;
  $('payment-method').onchange=event=>$('change-field').hidden=event.target.value!=='Dinheiro';
  $('apply-coupon')?.addEventListener('click',()=>{appliedCoupon=$('coupon-code').value.trim().toUpperCase();setFeedback(appliedCoupon?'Cupom adicionado e será validado ao enviar o pedido.':'Informe um código de cupom.',appliedCoupon?'success':'error')});
  $('share-store').onclick=shareStore;
  $('new-order-after-success').onclick=()=>location.reload();
  $('customer-phone').addEventListener('input',event=>{let digits=event.target.value.replace(/\D/g,'').slice(0,11);event.target.value=digits.length>10?digits.replace(/(\d{2})(\d{5})(\d{4})/,'($1) $2-$3'):digits.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3').replace(/-$/,'')});
}

async function shareStore(){
  try{
    if(navigator.share)await navigator.share({title:settings.nome,text:`Confira o cardápio de ${settings.nome}`,url:location.href});
    else{await navigator.clipboard.writeText(location.href);setFeedback('Link do cardápio copiado.')}
  }catch(error){if(error?.name!=='AbortError')setFeedback('Não foi possível compartilhar o cardápio.','error')}
}

function open(id){$(id).classList.add('open');document.body.style.overflow='hidden'}
function close(){document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));document.body.style.overflow=''}

function renderMenu(){
  const query=($('menu-search').value||'').trim().toLowerCase();
  const categories=[...new Set(products.map(product=>product.category))];
  if(!activeCategory||!categories.includes(activeCategory))activeCategory=categories.find(category=>normalize(category)==='lanches')||categories[0]||'';
  $('category-tabs').innerHTML=categories.map(category=>`<button class="${category===activeCategory?'active':''}" data-cat="${escapeHtml(category)}"><span>${categoryIcon(category)}</span>${escapeHtml(category)}</button>`).join('');
  const visible=query?products.filter(product=>`${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query)):products.filter(product=>product.category===activeCategory);
  const title=query?'Resultados':activeCategory;
  const cards=visible.map(product=>`<article class="menu-product" data-product="${escapeHtml(product.id)}" tabindex="0" role="button"><div class="menu-product-media">${product.image?`<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">`:'<div class="menu-product-image-placeholder">Sem foto</div>'}${product.featured?'<span class="menu-product-badge">Mais pedido</span>':''}</div><div class="menu-product-copy"><div class="menu-product-head"><h3>${escapeHtml(product.name)}</h3><span class="menu-favorite" aria-hidden="true">♡</span></div><p>${escapeHtml(product.description||'Sem descrição.')}</p><div class="menu-product-footer"><strong>${money(product.price)}</strong><button class="menu-product-add" type="button" data-add-product="${escapeHtml(product.id)}"><span>＋</span>Adicionar</button></div></div></article>`).join('');
  $('menu-content').innerHTML=visible.length?`<section class="menu-section"><div class="menu-section-head"><h2>${escapeHtml(title)}</h2></div><div class="menu-products">${cards}</div></section>`:'<div class="empty-state">Nenhum produto encontrado.</div>';
  document.querySelectorAll('.menu-product img').forEach(image=>image.onerror=()=>image.replaceWith(Object.assign(document.createElement('div'),{className:'menu-product-image-placeholder',textContent:'Sem foto'})));
  document.querySelectorAll('[data-product]').forEach(card=>{card.onclick=event=>{if(event.target.closest('button'))return;showProduct(card.dataset.product)};card.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showProduct(card.dataset.product)}}});
  document.querySelectorAll('[data-add-product]').forEach(button=>button.onclick=event=>{event.stopPropagation();showProduct(button.dataset.addProduct)});
  document.querySelectorAll('[data-cat]').forEach(button=>button.onclick=()=>{activeCategory=button.dataset.cat;$('menu-search').value='';renderMenu()});
}

function showProduct(id){
  if(!settings.aberto)return setFeedback('A loja está fechada no momento.','error');
  current=products.find(product=>String(product.id)===String(id));
  if(!current)return;
  qty=1;
  $('qty-value').textContent='1';
  $('store-product-title').textContent=current.name;
  $('store-product-description').textContent=current.description||'Escolha a quantidade e adicione uma observação, se necessário.';
  $('item-note').value='';
  updateAdd();
  open('product-store-modal');
}

function updateAdd(){
  $('add-cart-btn').textContent=`Adicionar • ${money(current.price*qty)}`;
  $('qty-minus').onclick=()=>{qty=Math.max(1,qty-1);$('qty-value').textContent=qty;updateAdd()};
  $('qty-plus').onclick=()=>{qty++;$('qty-value').textContent=qty;updateAdd()};
  $('add-cart-btn').onclick=()=>{
    cart.push({cartId:crypto.randomUUID(),productId:current.id,name:current.name,price:current.price,qty,note:$('item-note').value.trim()});
    saveCart();
    close();
    renderCart();
    setFeedback(`${current.name} adicionado ao pedido.`);
  };
}

const subtotal=()=>cart.reduce((sum,item)=>sum+item.price*item.qty,0);
const type=()=>table?'mesa':$('delivery-type').value;
const fee=()=>type()==='delivery'?Number(selectedRegion?.taxa??settings.taxa_entrega??0):0;
const service=()=>['mesa','local'].includes(type())?subtotal()*Number(operational.taxa_servico_percentual||0)/100:0;
const total=()=>subtotal()+fee()+service();

function renderCart(){
  $('cart-items').innerHTML=cart.length?cart.map(item=>`<div class="cart-item"><div class="cart-item-line"><b>${item.qty}x ${escapeHtml(item.name)}</b><b>${money(item.qty*item.price)}</b></div>${item.note?`<small>${escapeHtml(item.note)}</small>`:''}<div class="inline-actions"><button class="btn btn-secondary" data-minus="${escapeHtml(item.cartId)}" type="button">−</button><button class="btn btn-secondary" data-plus="${escapeHtml(item.cartId)}" type="button">+</button><button class="link-button" data-remove="${escapeHtml(item.cartId)}" type="button">Remover</button></div></div>`).join(''):'<div class="cart-empty">Seu carrinho está vazio.</div>';
  document.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>change(button.dataset.minus,-1));
  document.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>change(button.dataset.plus,1));
  document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{cart=cart.filter(item=>item.cartId!==button.dataset.remove);saveCart();renderCart()});
  updateTotal();
}

function change(id,delta){const item=cart.find(entry=>entry.cartId===id);if(!item)return;item.qty+=delta;if(item.qty<=0)cart=cart.filter(entry=>entry.cartId!==id);saveCart();renderCart()}

function updateTotal(){
  if(!settings)return;
  const delivery=type()==='delivery';
  const addressField=$('address-field');
  const regionField=$('region-field');
  if(addressField)addressField.style.display=delivery?'grid':'none';
  if(regionField)regionField.style.display=delivery&&regions.length?'grid':'none';
  $('cart-subtotal').textContent=money(subtotal());
  $('cart-delivery-fee').textContent=money(fee());
  $('cart-total').textContent=money(total());
  $('mobile-total').textContent=money(total());
  $('checkout-subtotal').textContent=money(subtotal());
  $('checkout-delivery-fee').textContent=money(fee());
  $('checkout-total').textContent=money(total());
  $('checkout-total-label').textContent=service()>0?`Total (serviço ${operational.taxa_servico_percentual}%)`:delivery?'Total com entrega':'Total';
  const itemCount=cart.reduce((sum,item)=>sum+item.qty,0);
  $('mobile-cart-count').textContent=itemCount;
  $('mobile-cart-count').hidden=!itemCount;
  $('mobile-cart-label').textContent=`${itemCount} ${itemCount===1?'item':'itens'} • ${money(total())}`;
  const minimum=Number(settings.pedido_minimo)||0;
  const missing=Math.max(0,minimum-subtotal());
  $('minimum-order-hint').textContent=!table&&missing>0&&cart.length?`Faltam ${money(missing)} para o pedido mínimo.`:'';
  $('minimum-order-hint').style.color=missing>0?'#a52a2a':'';
}

function checkout(){
  if(!settings.aberto)return setFeedback('A loja está fechada no momento.','error');
  if(!cart.length)return setFeedback('Adicione ao menos um produto ao pedido.','error');
  if(type()==='delivery'&&regions.length&&!selectedRegion)return setFeedback('Selecione o bairro ou região para calcular a entrega.','error');
  if(!table&&subtotal()<Number(settings.pedido_minimo))return setFeedback(`O pedido mínimo é ${money(settings.pedido_minimo)}.`,'error');
  updateTotal();
  open('checkout-modal');
}

$('checkout-form').onsubmit=async event=>{
  event.preventDefault();
  if(submitting)return;
  const form=event.currentTarget;
  const data=new FormData(form);
  const orderType=type();
  const name=String(data.get('name')||'').trim();
  const phone=String(data.get('phone')||'').replace(/\D/g,'');
  const address=String(data.get('address')||'').trim();
  if(name.length<2)return setFeedback('Informe seu nome.','error');
  if(phone.length<10)return setFeedback('Informe um WhatsApp válido.','error');
  if(orderType==='delivery'&&!address)return setFeedback('Informe o endereço completo.','error');
  if(orderType==='delivery'&&regions.length&&!selectedRegion)return setFeedback('Selecione o bairro ou região.','error');
  const payload={slug,nome:name,telefone:phone,tipo:orderType,endereco:orderType==='delivery'?address:null,bairro:selectedRegion?.nome||'',pagamento:data.get('payment'),troco_para:data.get('payment')==='Dinheiro'?data.get('change')||null:null,observacoes:String(data.get('notes')||'').trim(),mesa_token:tableToken||null,cupom:appliedCoupon,itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))};
  const button=$('submit-order-btn');
  submitting=true;
  button.disabled=true;
  const original=button.textContent;
  button.textContent='Enviando pedido...';
  try{
    const {data:orderCode,error}=await db.rpc('criar_pedido_publico',{payload});
    if(error)throw error;
    saveCustomer(data);
    close();
    $('success-message').textContent=`Pedido #${orderCode} enviado com sucesso. O total foi validado pelo estabelecimento.`;
    cart=[];
    saveCart();
    renderCart();
    open('success-modal');
  }catch(error){
    console.error(error);
    setFeedback(error?.message||'Não foi possível enviar o pedido. Tente novamente.','error',0);
  }finally{
    submitting=false;
    button.disabled=false;
    button.textContent=original;
  }
};

init();
