const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const db=window.supabaseClient;
const params=new URLSearchParams(location.search);
let slug=params.get('loja');
const storeId=params.get('estabelecimento');
const tableToken=params.get('mesa');
if(['undefined','null',''].includes(String(slug||'').toLowerCase()))slug=null;
let settings;
let table=null;
let products=[];
let cart=[];
let current=null;
let qty=1;
let submitting=false;

const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const cartKey=()=>`fsdelivery_cart_${slug||storeId||'public'}_${tableToken||'online'}`;
const orderKey=()=>`fsdelivery_last_order_${slug||storeId||'public'}`;
const saveCart=()=>localStorage.setItem(cartKey(),JSON.stringify(cart));
const loadCart=()=>{try{cart=JSON.parse(localStorage.getItem(cartKey())||'[]')}catch(_){cart=[]}};
const friendlyError=error=>{
  const message=String(error?.message||'').toLowerCase();
  if(message.includes('fechada'))return 'A loja está fechada no momento.';
  if(message.includes('mínimo'))return 'O pedido não atingiu o valor mínimo.';
  if(message.includes('produto'))return 'Um produto do carrinho ficou indisponível. Atualize o cardápio e tente novamente.';
  if(message.includes('mesa'))return 'Esta mesa não está disponível. Leia novamente o QR Code.';
  if(message.includes('network')||message.includes('fetch'))return 'Não foi possível conectar ao restaurante. Verifique sua internet e tente novamente.';
  return 'Não foi possível enviar o pedido. Revise os dados e tente novamente.';
};

async function resolveStore(){
  if(slug){
    const result=await db.from('estabelecimentos').select('*').eq('slug',slug).maybeSingle();
    if(result.data)return result;
  }
  if(storeId){
    const result=await db.from('estabelecimentos').select('*').eq('id',storeId).maybeSingle();
    if(result.data)return result;
  }
  const {data:{session}}=await db.auth.getSession();
  if(session){
    const result=await db.from('estabelecimentos').select('*').eq('usuario_id',session.user.id).maybeSingle();
    if(result.data)return result;
  }
  return {data:null,error:null};
}

async function init(){
  const {data:est,error}=await resolveStore();
  if(error||!est)return showError(slug||storeId?'Loja não encontrada':'Loja não informada');
  settings=est;
  slug=est.slug||slug;
  if(slug&&params.get('loja')!==slug){
    const nextParams=new URLSearchParams(location.search);
    nextParams.set('loja',slug);
    nextParams.delete('estabelecimento');
    history.replaceState(null,'',`${location.pathname}?${nextParams.toString()}${location.hash}`);
  }
  if(tableToken){
    const {data:mesa,error:tableError}=await db.from('mesas').select('id,numero,nome,codigo_qr,ativo').eq('estabelecimento_id',est.id).eq('codigo_qr',tableToken).eq('ativo',true).maybeSingle();
    if(tableError||!mesa)return showError('Mesa inválida ou indisponível');
    table=mesa;
  }
  const {data}=await db.from('produtos').select('*,categorias(nome)').eq('estabelecimento_id',est.id).eq('ativo',true).order('created_at');
  products=(data||[]).map(product=>({id:product.id,name:product.nome,category:product.categorias?.nome||'Cardápio',price:Number(product.preco),description:product.descricao||'',image:product.imagem_url}));
  loadCart();
  cart=cart.filter(item=>products.some(product=>product.id===item.productId)&&Number(item.qty)>0);
  saveCart();
  document.title=`${settings.nome} — Cardápio`;
  document.getElementById('public-store-name').textContent=settings.nome;
  document.getElementById('public-store-logo').textContent=settings.nome.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase()||'FS';
  document.getElementById('public-store-meta').textContent=settings.descricao||settings.categoria||'Delivery';
  const statusElement=document.getElementById('public-store-status');
  statusElement.textContent=settings.aberto?'Aberto agora':'Fechado agora';
  statusElement.classList.toggle('is-open',Boolean(settings.aberto));
  statusElement.classList.toggle('is-closed',!settings.aberto);
  document.getElementById('store-delivery-time').textContent=`${settings.tempo_entrega_min||30}–${settings.tempo_entrega_max||45} min`;
  document.getElementById('store-minimum-order').textContent=money(settings.pedido_minimo);
  document.getElementById('store-delivery-fee').textContent=Number(settings.taxa_entrega)>0?money(settings.taxa_entrega):'Grátis';
  document.getElementById('store-contact').textContent=settings.telefone||'Consulte no pedido';
  document.getElementById('closed-notice').hidden=Boolean(settings.aberto);
  document.getElementById('customer-orders-link').href=`cliente.html?loja=${encodeURIComponent(slug||'')}`;
  document.getElementById('track-order-link').href=`cliente.html?loja=${encodeURIComponent(slug||'')}`;
  configureContext();bindPageActions();renderMenu();renderCart();
}

function showError(message){document.getElementById('menu-content').innerHTML=`<div class="empty-state"><h3>${escapeHtml(message)}</h3></div>`}
function configureContext(){
  const select=document.getElementById('delivery-type'),label=document.getElementById('order-context-label'),tableInfo=document.getElementById('table-context');
  if(table){const name=table.nome||`Mesa ${table.numero}`;tableInfo.hidden=false;tableInfo.textContent=`Pedido local • ${name}`;label.textContent=name;select.innerHTML='<option value="mesa">Pedido nesta mesa</option>';document.getElementById('address-field').style.display='none';document.getElementById('customer-orders-link').style.display='none'}
  else{label.textContent='Pedido on-line';select.innerHTML='<option value="delivery">Entrega</option><option value="pickup">Retirada no balcão</option><option value="local">Comer no local</option>'}
  updateCheckoutTotal();
}
function bindPageActions(){
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModals);
  document.querySelectorAll('.modal').forEach(modal=>modal.onclick=event=>{if(event.target===modal)closeModals()});
  document.getElementById('checkout-btn').onclick=checkout;
  document.getElementById('mobile-cart').onclick=checkout;
  document.getElementById('delivery-type').onchange=updateCheckoutTotal;
  document.getElementById('menu-search').oninput=renderMenu;
  document.getElementById('payment-method').onchange=event=>{document.getElementById('change-field').hidden=event.target.value!=='Dinheiro'};
  document.getElementById('share-store').onclick=async()=>{const data={title:settings.nome,text:`Confira o cardápio de ${settings.nome}`,url:location.href};if(navigator.share){try{await navigator.share(data)}catch(_){}}else{await navigator.clipboard.writeText(location.href);alert('Link copiado.')}};
}
function openModal(id){document.getElementById(id).classList.add('open');document.body.style.overflow='hidden'}
function closeModals(){if(submitting)return;document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));document.body.style.overflow=''}
function renderMenu(){
  const query=(document.getElementById('menu-search')?.value||'').trim().toLowerCase();
  const filtered=products.filter(product=>`${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query));
  const categories=[...new Set(filtered.map(product=>product.category))];
  document.getElementById('category-tabs').innerHTML=categories.map((category,index)=>`<button class="${index?'':'active'}" data-cat="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
  document.getElementById('menu-content').innerHTML=categories.length?categories.map(category=>`<section class="menu-section" id="cat-${escapeHtml(category)}"><h2>${escapeHtml(category)}</h2><div class="menu-products">${filtered.filter(product=>product.category===category).map(product=>`<article class="menu-product" data-product="${escapeHtml(product.id)}"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description||'Sem descrição.')}</p><strong>${money(product.price)}</strong></div>${product.image?`<img alt="${escapeHtml(product.name)}" src="${escapeHtml(product.image)}">`:''}</article>`).join('')}</div></section>`).join(''):'<div class="empty-state"><h3>Nenhum produto encontrado</h3><p>Tente buscar por outro nome ou categoria.</p></div>';
  document.querySelectorAll('[data-product]').forEach(element=>element.onclick=()=>showProduct(element.dataset.product));
  document.querySelectorAll('[data-cat]').forEach(button=>button.onclick=()=>{document.getElementById(`cat-${button.dataset.cat}`)?.scrollIntoView({behavior:'smooth'});document.querySelectorAll('[data-cat]').forEach(item=>item.classList.toggle('active',item===button))});
}
function showProduct(id){if(!settings.aberto)return alert('A loja está fechada no momento.');current=products.find(product=>product.id===id);if(!current)return;qty=1;document.getElementById('qty-value').textContent=qty;document.getElementById('store-product-title').textContent=current.name;document.getElementById('store-product-description').textContent=current.description;document.getElementById('item-note').value='';document.getElementById('store-options').innerHTML='';updateAddButton();openModal('product-store-modal')}
function updateAddButton(){
  document.getElementById('add-cart-btn').textContent=`Adicionar • ${money((current?.price||0)*qty)}`;
  document.getElementById('qty-minus').onclick=()=>{qty=Math.max(1,qty-1);document.getElementById('qty-value').textContent=qty;updateAddButton()};
  document.getElementById('qty-plus').onclick=()=>{qty++;document.getElementById('qty-value').textContent=qty;updateAddButton()};
  document.getElementById('add-cart-btn').onclick=()=>{if(!current)return;cart.push({cartId:crypto.randomUUID(),productId:current.id,name:current.name,price:current.price,qty,note:document.getElementById('item-note').value.trim()});saveCart();closeModals();renderCart()};
}
function subtotal(){return cart.reduce((sum,item)=>sum+item.price*item.qty,0)}
function orderType(){return table?'mesa':document.getElementById('delivery-type').value}
function deliveryFee(){return orderType()==='delivery'?Number(settings?.taxa_entrega||0):0}
function total(){return subtotal()+deliveryFee()}
function itemCount(){return cart.reduce((sum,item)=>sum+item.qty,0)}
function changeItem(cartId,delta){const item=cart.find(entry=>entry.cartId===cartId);if(!item)return;item.qty+=delta;if(item.qty<=0)cart=cart.filter(entry=>entry.cartId!==cartId);saveCart();renderCart()}
function renderCart(){
  document.getElementById('cart-items').innerHTML=cart.length?cart.map(item=>`<div class="cart-item"><div class="cart-item-line"><b>${item.qty}x ${escapeHtml(item.name)}</b><b>${money(item.price*item.qty)}</b></div>${item.note?`<small>${escapeHtml(item.note)}</small>`:''}<div class="inline-actions"><button class="btn btn-secondary" type="button" data-minus="${escapeHtml(item.cartId)}">−</button><button class="btn btn-secondary" type="button" data-plus="${escapeHtml(item.cartId)}">+</button><button class="link-button" type="button" data-remove="${escapeHtml(item.cartId)}">Remover</button></div></div>`).join(''):'<div class="cart-empty">Seu carrinho está vazio.</div>';
  const fee=deliveryFee(),minimum=Number(settings?.pedido_minimo||0),missing=Math.max(0,minimum-subtotal());
  document.getElementById('cart-subtotal').textContent=money(subtotal());document.getElementById('cart-delivery-fee').textContent=fee?money(fee):'R$ 0,00';document.getElementById('cart-total').textContent=money(total());document.getElementById('mobile-total').textContent=money(total());document.getElementById('mobile-cart-label').textContent=itemCount()?`Ver pedido • ${itemCount()} item(ns)`:'Ver pedido';document.getElementById('minimum-order-hint').textContent=!table&&missing>0?`Faltam ${money(missing)} para o pedido mínimo.`:'';
  document.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>changeItem(button.dataset.minus,-1));document.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>changeItem(button.dataset.plus,1));document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{cart=cart.filter(item=>item.cartId!==button.dataset.remove);saveCart();renderCart()});updateCheckoutTotal();
}
function updateCheckoutTotal(){if(!settings)return;const type=orderType();document.getElementById('address-field').style.display=type==='delivery'?'grid':'none';document.getElementById('checkout-total-label').textContent=type==='delivery'?'Total com entrega':'Total';document.getElementById('checkout-subtotal').textContent=money(subtotal());document.getElementById('checkout-delivery-fee').textContent=money(deliveryFee());document.getElementById('checkout-total').textContent=money(total());document.getElementById('cart-delivery-fee').textContent=money(deliveryFee());document.getElementById('cart-total').textContent=money(total());document.getElementById('mobile-total').textContent=money(total())}
function checkout(){if(!settings.aberto)return alert('A loja está fechada.');if(!cart.length)return alert('Adicione ao menos um produto.');if(!table&&subtotal()<Number(settings.pedido_minimo))return alert(`O pedido mínimo é ${money(settings.pedido_minimo)}.`);updateCheckoutTotal();openModal('checkout-modal')}

document.getElementById('checkout-form').onsubmit=async event=>{
  event.preventDefault();
  if(submitting)return;
  const form=new FormData(event.currentTarget),type=orderType();
  const name=String(form.get('name')||'').trim(),phone=String(form.get('phone')||'').replace(/\D/g,'');
  if(name.length<2)return alert('Informe o nome do cliente.');
  if(phone.length<10||phone.length>11)return alert('Informe um WhatsApp válido com DDD.');
  if(type==='delivery'&&!String(form.get('address')||'').trim())return alert('Informe o endereço completo.');
  if(!cart.length)return alert('Seu carrinho está vazio.');
  const button=event.currentTarget.querySelector('button[type="submit"]');
  submitting=true;button.disabled=true;button.textContent='Enviando pedido...';
  const payload={slug,nome:name,telefone:phone,tipo:type,endereco:type==='delivery'?String(form.get('address')||'').trim():null,pagamento:form.get('payment'),troco_para:form.get('payment')==='Dinheiro'?form.get('change')||null:null,observacoes:String(form.get('notes')||'').trim(),mesa_token:tableToken||null,itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))};
  const orderTotal=total();
  try{
    const {data,error}=await db.rpc('criar_pedido_publico',{payload});
    if(error)throw error;
    localStorage.setItem(orderKey(),JSON.stringify({codigo:data,slug,telefone:phone,total:orderTotal,created_at:new Date().toISOString()}));
    submitting=false;document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));document.body.style.overflow='';
    const context=table?` para ${table.nome||`Mesa ${table.numero}`}`:'';
    document.getElementById('success-message').textContent=`Pedido #${data} enviado${context}. Total: ${money(orderTotal)}. Status: aguardando confirmação do restaurante.`;
    document.getElementById('track-order-link').href=`cliente.html?loja=${encodeURIComponent(slug||'')}&telefone=${encodeURIComponent(phone)}&pedido=${encodeURIComponent(data)}`;
    cart=[];saveCart();renderCart();event.currentTarget.reset();openModal('success-modal');
  }catch(error){alert(friendlyError(error));console.error('Falha ao criar pedido público:',error)}
  finally{submitting=false;button.disabled=false;button.textContent='Confirmar pedido'}
};

init();