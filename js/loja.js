const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const db=window.supabaseClient;
const params=new URLSearchParams(location.search);
const slug=params.get('loja');
const tableToken=params.get('mesa');
let settings;
let table=null;
let products=[];
let cart=[];
let current=null;
let qty=1;

const cartKey=()=>`fsdelivery_cart_${slug||'public'}_${tableToken||'online'}`;
const saveCart=()=>localStorage.setItem(cartKey(),JSON.stringify(cart));
const loadCart=()=>{
  try{cart=JSON.parse(localStorage.getItem(cartKey())||'[]')}catch(_){cart=[]}
};

async function init(){
  if(!slug)return showError('Loja não informada');
  const {data:est,error}=await db.from('estabelecimentos').select('*').eq('slug',slug).single();
  if(error||!est)return showError('Loja não encontrada');
  settings=est;

  if(tableToken){
    const {data:mesa}=await db.from('mesas').select('id,nome,identificacao,ativo').eq('estabelecimento_id',est.id).eq('token_publico',tableToken).eq('ativo',true).maybeSingle();
    if(!mesa)return showError('Mesa inválida ou indisponível');
    table=mesa;
  }

  const {data}=await db.from('produtos').select('*,categorias(nome)').eq('estabelecimento_id',est.id).eq('ativo',true).order('created_at');
  products=(data||[]).map(product=>({
    id:product.id,
    name:product.nome,
    category:product.categorias?.nome||'Cardápio',
    price:Number(product.preco),
    description:product.descricao||'',
    image:product.imagem_url
  }));

  loadCart();
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
  document.getElementById('customer-orders-link').href=`cliente.html?loja=${encodeURIComponent(slug)}`;
  document.getElementById('track-order-link').href=`cliente.html?loja=${encodeURIComponent(slug)}`;

  configureContext();
  bindPageActions();
  renderMenu();
  renderCart();
}

function showError(message){
  document.getElementById('menu-content').innerHTML=`<div class="empty-state"><h3>${message}</h3></div>`;
}

function configureContext(){
  const select=document.getElementById('delivery-type');
  const label=document.getElementById('order-context-label');
  const tableInfo=document.getElementById('table-context');
  if(table){
    const name=table.nome||`Mesa ${table.identificacao}`;
    tableInfo.hidden=false;
    tableInfo.textContent=`Pedido local • ${name}`;
    label.textContent=name;
    select.innerHTML='<option value="mesa">Pedido nesta mesa</option>';
    document.getElementById('address-field').style.display='none';
    document.getElementById('customer-orders-link').style.display='none';
  }else{
    label.textContent='Pedido on-line';
    select.innerHTML='<option value="delivery">Entrega</option><option value="pickup">Retirada no balcão</option><option value="local">Comer no local</option>';
  }
  updateCheckoutTotal();
}

function bindPageActions(){
  document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModals);
  document.querySelectorAll('.modal').forEach(modal=>modal.onclick=event=>{if(event.target===modal)closeModals()});
  document.getElementById('checkout-btn').onclick=checkout;
  document.getElementById('mobile-cart').onclick=checkout;
  document.getElementById('delivery-type').onchange=updateCheckoutTotal;
  document.getElementById('menu-search').oninput=renderMenu;
  document.getElementById('payment-method').onchange=event=>{
    document.getElementById('change-field').hidden=event.target.value!=='Dinheiro';
  };
  document.getElementById('share-store').onclick=async()=>{
    const data={title:settings.nome,text:`Confira o cardápio de ${settings.nome}`,url:location.href};
    if(navigator.share){try{await navigator.share(data)}catch(_){}}
    else{await navigator.clipboard.writeText(location.href);alert('Link copiado.')}
  };
}

function openModal(id){
  document.getElementById(id).classList.add('open');
  document.body.style.overflow='hidden';
}

function closeModals(){
  document.querySelectorAll('.modal').forEach(modal=>modal.classList.remove('open'));
  document.body.style.overflow='';
}

function renderMenu(){
  const query=(document.getElementById('menu-search')?.value||'').trim().toLowerCase();
  const filtered=products.filter(product=>`${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query));
  const categories=[...new Set(filtered.map(product=>product.category))];
  document.getElementById('category-tabs').innerHTML=categories.map((category,index)=>`<button class="${index?'':'active'}" data-cat="${category}">${category}</button>`).join('');
  document.getElementById('menu-content').innerHTML=categories.length?categories.map(category=>`
    <section class="menu-section" id="cat-${category}">
      <h2>${category}</h2>
      <div class="menu-products">
        ${filtered.filter(product=>product.category===category).map(product=>`
          <article class="menu-product" data-product="${product.id}">
            <div><h3>${product.name}</h3><p>${product.description||'Sem descrição.'}</p><strong>${money(product.price)}</strong></div>
            ${product.image?`<img alt="${product.name}" src="${product.image}">`:''}
          </article>`).join('')}
      </div>
    </section>`).join(''):'<div class="empty-state"><h3>Nenhum produto encontrado</h3><p>Tente buscar por outro nome ou categoria.</p></div>';
  document.querySelectorAll('[data-product]').forEach(element=>element.onclick=()=>showProduct(element.dataset.product));
  document.querySelectorAll('[data-cat]').forEach(button=>button.onclick=()=>{
    document.getElementById(`cat-${button.dataset.cat}`)?.scrollIntoView({behavior:'smooth'});
    document.querySelectorAll('[data-cat]').forEach(item=>item.classList.toggle('active',item===button));
  });
}

function showProduct(id){
  if(!settings.aberto)return alert('A loja está fechada no momento.');
  current=products.find(product=>product.id===id);
  qty=1;
  document.getElementById('qty-value').textContent=qty;
  document.getElementById('store-product-title').textContent=current.name;
  document.getElementById('store-product-description').textContent=current.description;
  document.getElementById('item-note').value='';
  document.getElementById('store-options').innerHTML='';
  updateAddButton();
  openModal('product-store-modal');
}

function updateAddButton(){
  document.getElementById('add-cart-btn').textContent=`Adicionar • ${money((current?.price||0)*qty)}`;
  document.getElementById('qty-minus').onclick=()=>{qty=Math.max(1,qty-1);document.getElementById('qty-value').textContent=qty;updateAddButton()};
  document.getElementById('qty-plus').onclick=()=>{qty++;document.getElementById('qty-value').textContent=qty;updateAddButton()};
  document.getElementById('add-cart-btn').onclick=()=>{
    cart.push({cartId:crypto.randomUUID(),productId:current.id,name:current.name,price:current.price,qty,note:document.getElementById('item-note').value});
    saveCart();
    closeModals();
    renderCart();
  };
}

function subtotal(){return cart.reduce((sum,item)=>sum+item.price*item.qty,0)}
function orderType(){return table?'mesa':document.getElementById('delivery-type').value}
function deliveryFee(){return orderType()==='delivery'?Number(settings?.taxa_entrega||0):0}
function total(){return subtotal()+deliveryFee()}
function itemCount(){return cart.reduce((sum,item)=>sum+item.qty,0)}

function changeItem(cartId,delta){
  const item=cart.find(entry=>entry.cartId===cartId);
  if(!item)return;
  item.qty+=delta;
  if(item.qty<=0)cart=cart.filter(entry=>entry.cartId!==cartId);
  saveCart();
  renderCart();
}

function renderCart(){
  document.getElementById('cart-items').innerHTML=cart.length?cart.map(item=>`
    <div class="cart-item">
      <div class="cart-item-line"><b>${item.qty}x ${item.name}</b><b>${money(item.price*item.qty)}</b></div>
      ${item.note?`<small>${item.note}</small>`:''}
      <div class="inline-actions">
        <button class="btn btn-secondary" type="button" data-minus="${item.cartId}">−</button>
        <button class="btn btn-secondary" type="button" data-plus="${item.cartId}">+</button>
        <button class="link-button" type="button" data-remove="${item.cartId}">Remover</button>
      </div>
    </div>`).join(''):'<div class="cart-empty">Seu carrinho está vazio.</div>';

  const fee=deliveryFee();
  const minimum=Number(settings?.pedido_minimo||0);
  const missing=Math.max(0,minimum-subtotal());
  document.getElementById('cart-subtotal').textContent=money(subtotal());
  document.getElementById('cart-delivery-fee').textContent=fee?money(fee):'R$ 0,00';
  document.getElementById('cart-total').textContent=money(total());
  document.getElementById('mobile-total').textContent=money(total());
  document.getElementById('mobile-cart-label').textContent=itemCount()?`Ver pedido • ${itemCount()} item(ns)`:'Ver pedido';
  document.getElementById('minimum-order-hint').textContent=!table&&missing>0?`Faltam ${money(missing)} para o pedido mínimo.`:'';
  document.querySelectorAll('[data-minus]').forEach(button=>button.onclick=()=>changeItem(button.dataset.minus,-1));
  document.querySelectorAll('[data-plus]').forEach(button=>button.onclick=()=>changeItem(button.dataset.plus,1));
  document.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{cart=cart.filter(item=>item.cartId!==button.dataset.remove);saveCart();renderCart()});
  updateCheckoutTotal();
}

function updateCheckoutTotal(){
  if(!settings)return;
  const type=orderType();
  document.getElementById('address-field').style.display=type==='delivery'?'grid':'none';
  document.getElementById('checkout-total-label').textContent=type==='delivery'?'Total com entrega':'Total';
  document.getElementById('checkout-subtotal').textContent=money(subtotal());
  document.getElementById('checkout-delivery-fee').textContent=money(deliveryFee());
  document.getElementById('checkout-total').textContent=money(total());
  document.getElementById('cart-delivery-fee').textContent=money(deliveryFee());
  document.getElementById('cart-total').textContent=money(total());
  document.getElementById('mobile-total').textContent=money(total());
}

function checkout(){
  if(!settings.aberto)return alert('A loja está fechada.');
  if(!cart.length)return alert('Adicione ao menos um produto.');
  if(!table&&subtotal()<Number(settings.pedido_minimo))return alert(`O pedido mínimo é ${money(settings.pedido_minimo)}.`);
  updateCheckoutTotal();
  openModal('checkout-modal');
}

document.getElementById('checkout-form').onsubmit=async event=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const type=orderType();
  if(type==='delivery'&&!String(form.get('address')||'').trim())return alert('Informe o endereço completo.');
  const payload={
    slug,
    nome:form.get('name'),
    telefone:form.get('phone'),
    tipo:type,
    endereco:type==='delivery'?form.get('address'):null,
    pagamento:form.get('payment'),
    troco_para:form.get('payment')==='Dinheiro'?form.get('change')||null:null,
    observacoes:form.get('notes'),
    mesa_token:tableToken||null,
    itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))
  };
  const orderTotal=total();
  const {data,error}=await db.rpc('criar_pedido_publico',{payload});
  if(error)return alert(error.message);
  closeModals();
  const context=table?` para ${table.nome||`Mesa ${table.identificacao}`}`:'';
  document.getElementById('success-message').textContent=`Pedido #${data} enviado${context}. Total: ${money(orderTotal)}. Status: aguardando confirmação do restaurante.`;
  cart=[];
  saveCart();
  renderCart();
  openModal('success-modal');
};

init();