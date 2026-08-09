const db=window.supabaseClient;
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const el=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const requestedOrigin=new URLSearchParams(location.search).get('origem')==='caixa'?'caixa':'balcao';
const quickSale=requestedOrigin==='caixa';
const createUuid=()=>crypto.randomUUID?.()||'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,char=>(Number(char)^crypto.getRandomValues(new Uint8Array(1))[0]&15>>Number(char)/4).toString(16));
let store=null,config=null,products=[],tables=[],cart=[],current=null,qty=1,currentType='retirada',currentCategory='',canSell=true,saleToken=createUuid();

async function init(){
  try{
    const{data:{session}}=await db.auth.getSession();if(!session){location.replace('auth');return}
    const storeResult=await db.from('estabelecimentos').select('*').eq('usuario_id',session.user.id).single();if(storeResult.error||!storeResult.data)throw storeResult.error||new Error('Estabelecimento não encontrado.');store=storeResult.data;
    const[productResult,tableResult,configResult,cashResult]=await Promise.all([
      db.from('produtos').select('id,nome,descricao,preco,imagem_url,destaque,categorias(nome)').eq('estabelecimento_id',store.id).eq('ativo',true).order('nome'),
      db.from('mesas').select('id,numero,nome,codigo_qr').eq('estabelecimento_id',store.id).eq('ativo',true).order('numero'),
      db.from('configuracoes_operacionais').select('*').eq('estabelecimento_id',store.id).maybeSingle(),
      db.from('caixas').select('id').eq('estabelecimento_id',store.id).eq('status','aberto').limit(1).maybeSingle()
    ]);
    if(productResult.error)throw productResult.error;if(tableResult.error)throw tableResult.error;
    products=(productResult.data||[]).map(product=>({id:product.id,name:product.nome,description:product.descricao||'',price:Number(product.preco),imageUrl:product.imagem_url||'',featured:Boolean(product.destaque),category:product.categorias?.nome||'Sem categoria'}));
    tables=tableResult.data||[];config=configResult.data||{};
    if(config.exige_abertura_caixa&&!cashResult.data){canSell=false;showWarning('Abra o caixa antes de criar novos pedidos.')}
    bind();renderPayments();renderTables();renderCategories();renderProducts();renderCart();updateType();configureOrigin();
    el('counter-status').textContent=`${store.nome} • ${canSell?'Operação disponível':'Operação bloqueada'}`;el('counter-submit').disabled=!canSell;
    window.FSOperationalNotifications?.start({role:'caixa',storeId:store.id,owner:true});
  }catch(error){console.error(error);el('counter-products').innerHTML=`<div class="empty-state">${escapeHtml(error.message||'Não foi possível carregar a operação.')}</div>`;el('counter-status').textContent='Erro ao carregar'}
}
function configureOrigin(){
  if(!quickSale)return;
  document.title='Venda rápida — FS Delivery';
  document.body.dataset.counterMode='quick-sale';
  document.querySelector('.counter-topbar b').textContent='Venda rápida';
  document.querySelector('.counter-topbar .btn').textContent='Voltar ao caixa';
  document.querySelector('.counter-topbar .btn').href='caixa';
  document.querySelector('.page-head h1').textContent='Venda rápida no caixa';
  document.querySelector('.page-head p').textContent='Selecione os itens, escolha a forma de pagamento e cobre. Cliente, mesa e endereço não são necessários.';
  el('counter-type-grid').hidden=true;
  el('counter-success').querySelector('a').href='caixa';
  el('counter-success').querySelector('a').textContent='Voltar ao caixa';
}
function showWarning(message){const warning=el('counter-warning');warning.textContent=message;warning.hidden=false}
function showSuccess(reference){const success=el('counter-success');el('counter-success-text').textContent=`Pedido #${reference} criado com sucesso. O balcão está pronto para o próximo atendimento.`;success.hidden=false;window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>{success.hidden=true},9000)}
function showQuickSaleSuccess(result){const success=el('counter-success'),change=Number(result?.troco||0);el('counter-success-text').textContent=`Venda #${result?.codigo||result?.pedido_id||'concluída'} recebida e finalizada${change>0?` • Troco: ${money(change)}`:''}.`;success.hidden=false;window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>{success.hidden=true},9000)}
function bind(){el('counter-search').oninput=renderProducts;document.querySelectorAll('[data-counter-type]').forEach(button=>button.onclick=()=>setType(button.dataset.counterType));document.querySelectorAll('[data-close]').forEach(button=>button.onclick=closeModal);el('counter-product-modal').onclick=event=>{if(event.target===el('counter-product-modal'))closeModal()};el('counter-minus').onclick=()=>{qty=Math.max(1,qty-1);updateProductModal()};el('counter-plus').onclick=()=>{qty+=1;updateProductModal()};el('counter-add').onclick=addProduct;el('counter-submit').onclick=submit;el('counter-mobile-cart').onclick=()=>el('counter-order-panel').scrollIntoView({behavior:'smooth',block:'start'})}
function setType(type){currentType=type;document.querySelectorAll('[data-counter-type]').forEach(item=>item.classList.toggle('active',item.dataset.counterType===type));if(type!=='local')el('counter-table').value='';if(type!=='entrega')clearAddress();if(type==='local'){el('counter-name').value='';el('counter-phone').value=''}updateType()}
function renderPayments(){
  const payment=el('counter-payment');
  if(quickSale){
    const values=[['pix','Pix'],['dinheiro','Dinheiro'],['credito','Cartão de crédito'],['debito','Cartão de débito'],['vale','Vale-refeição']];
    payment.innerHTML=values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
    el('counter-change-label').textContent='Valor recebido';
    el('counter-change').placeholder='Em branco = valor exato';
  }else{
    let values=Array.isArray(config?.formas_pagamento)?config.formas_pagamento:['PIX','Cartão','Dinheiro','Pagamento no caixa'];
    if(!values.length)values=['PIX','Cartão','Dinheiro'];
    payment.innerHTML=values.map(value=>`<option>${escapeHtml(value)}</option>`).join('');
  }
  payment.onchange=()=>{el('counter-change-field').hidden=!payment.value.toLowerCase().includes('dinheiro')};
  payment.dispatchEvent(new Event('change'));
}
function renderTables(){el('counter-table').innerHTML='<option value="">Selecione uma mesa</option>'+tables.map(table=>`<option value="${table.id}" data-token="${escapeHtml(table.codigo_qr||'')}">${escapeHtml(table.nome||`Mesa ${String(table.numero).padStart(2,'0')}`)}</option>`).join('')}
function renderCategories(){const categories=[...new Set(products.map(product=>product.category))];el('counter-category-tabs').innerHTML=[{value:'',label:'Todos'},...categories.map(category=>({value:category,label:category}))].map(item=>`<button class="${item.value===currentCategory?'active':''}" type="button" data-category="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`).join('');el('counter-category-tabs').querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{currentCategory=button.dataset.category;renderCategories();renderProducts()})}
function renderProducts(){const term=el('counter-search').value.trim().toLowerCase(),filtered=products.filter(product=>(!currentCategory||product.category===currentCategory)&&(!term||`${product.name} ${product.description}`.toLowerCase().includes(term)));el('counter-products').innerHTML=filtered.length?filtered.map(product=>`<button class="counter-product" type="button" data-product="${product.id}"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description||product.category)}</p><strong>${money(product.price)}</strong></div>${product.imageUrl?`<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.remove()">`:''}</button>`).join(''):'<div class="empty-state">Nenhum produto encontrado.</div>';el('counter-products').querySelectorAll('[data-product]').forEach(button=>button.onclick=()=>openProduct(button.dataset.product))}
function openProduct(id){current=products.find(product=>String(product.id)===String(id));if(!current)return;qty=1;el('counter-item-note').value='';el('counter-product-title').textContent=current.name;el('counter-product-description').textContent=current.description||'Sem descrição.';updateProductModal();el('counter-product-modal').classList.add('open');document.body.style.overflow='hidden'}
function updateProductModal(){el('counter-qty').textContent=qty;el('counter-add').textContent=`Adicionar • ${money((current?.price||0)*qty)}`}
function closeModal(){el('counter-product-modal').classList.remove('open');document.body.style.overflow=''}
function addProduct(){if(!current)return;const cartId=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;cart.push({cartId,productId:current.id,name:current.name,price:current.price,qty,note:el('counter-item-note').value.trim()});closeModal();renderCart()}
function subtotal(){return cart.reduce((sum,item)=>sum+item.price*item.qty,0)}
function total(){const base=subtotal(),delivery=currentType==='entrega'?Number(store?.taxa_entrega||0):0,service=currentType==='local'?base*Number(config?.taxa_servico_percentual||0)/100:0;return base+delivery+service}
function renderCart(){el('counter-cart').innerHTML=cart.length?cart.map(item=>`<div class="row-card"><div class="order-main"><b>${item.qty}x ${escapeHtml(item.name)}</b><small>${escapeHtml(item.note||money(item.price))}</small></div><div><b>${money(item.qty*item.price)}</b><button class="link-button" data-remove="${item.cartId}" type="button">Remover</button></div></div>`).join(''):'<div class="empty-state">Nenhum item adicionado.</div>';el('counter-cart').querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{cart=cart.filter(item=>item.cartId!==button.dataset.remove);renderCart()});const count=cart.reduce((sum,item)=>sum+item.qty,0),value=total();el('counter-total').textContent=money(value);el('counter-mobile-count').textContent=`${count} ${count===1?'item':'itens'}`;el('counter-mobile-total').textContent=money(value);el('counter-mobile-cart').hidden=count===0;if(quickSale)el('counter-submit').textContent=count?`Cobrar • ${money(value)}`:'Selecione os itens'}
function updateType(){if(quickSale){el('counter-table-field').hidden=true;el('counter-name-field').hidden=true;el('counter-phone-field').hidden=true;el('counter-address-field').hidden=true;el('counter-destination').textContent='Venda avulsa sem vínculo';renderCart();return}const local=currentType==='local';el('counter-table-field').hidden=!local;el('counter-name-field').hidden=local;el('counter-phone-field').hidden=local;el('counter-address-field').hidden=currentType!=='entrega';el('counter-destination').textContent={retirada:'Retirada no balcão',local:'Consumo local vinculado à mesa',entrega:'Entrega ao cliente'}[currentType];renderCart()}
function clearAddress(){['counter-cep','counter-street','counter-number','counter-neighborhood','counter-city','counter-complement','counter-reference'].forEach(id=>{el(id).value=''})}
function addressData(){const cep=el('counter-cep').value.replace(/\D/g,''),logradouro=el('counter-street').value.trim(),numero=el('counter-number').value.trim(),bairro=el('counter-neighborhood').value.trim(),cidade=el('counter-city').value.trim(),complemento=el('counter-complement').value.trim(),referencia=el('counter-reference').value.trim();const texto=[ [logradouro,numero].filter(Boolean).join(', '),bairro,cidade,complemento,referencia?`Referência: ${referencia}`:'',cep?`CEP: ${cep.replace(/(\d{5})(\d{3})/,'$1-$2')}`:'' ].filter(Boolean).join(', ');return{cep,logradouro,numero,bairro,cidade,estado:'',complemento,referencia,texto}}
function resetOrder(){cart=[];current=null;qty=1;saleToken=createUuid();['counter-name','counter-phone','counter-cep','counter-street','counter-number','counter-neighborhood','counter-city','counter-complement','counter-reference','counter-change','counter-notes'].forEach(id=>{el(id).value=''});el('counter-table').value='';setType('retirada');renderCart()}
function parseMoney(value){const normalized=String(value??'').trim().replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.');return Number(normalized)}
async function submitQuickSale(){
  if(!cart.length)return alert('Adicione ao menos um produto.');
  const method=el('counter-payment').value,receivedText=el('counter-change').value.trim(),saleTotal=total();
  const received=method==='dinheiro'&&receivedText?parseMoney(receivedText):saleTotal;
  if(!Number.isFinite(received)||received<saleTotal)return alert(`O valor recebido deve ser igual ou maior que ${money(saleTotal)}.`);
  const payload={idempotency_key:saleToken,forma_pagamento:method,valor_recebido:received,observacoes:el('counter-notes').value.trim(),itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))};
  const button=el('counter-submit'),original=button.textContent;button.disabled=true;button.textContent='Registrando cobrança...';
  try{const result=await db.rpc('registrar_venda_rapida_caixa',{payload});if(result.error)throw result.error;const data=result.data;resetOrder();showQuickSaleSuccess(data);await window.FSOperationalNotifications?.load?.()}
  catch(error){alert(error.message||'Não foi possível concluir a venda rápida.')}
  finally{button.disabled=!canSell;renderCart();if(!cart.length)button.textContent='Selecione os itens';else button.textContent=original}
}
async function submit(){if(!canSell)return;if(quickSale)return submitQuickSale();if(!cart.length)return alert('Adicione ao menos um produto.');const name=el('counter-name').value.trim(),phone=el('counter-phone').value.replace(/\D/g,''),tableId=el('counter-table').value,address=addressData();if(currentType==='local'&&!tableId)return alert('Selecione uma mesa para o pedido local.');if(currentType==='entrega'&&(!address.logradouro||!address.numero||!address.bairro||!address.cidade||address.cep.length!==8))return alert('Informe CEP, rua, número, bairro e cidade.');if(['entrega','retirada'].includes(currentType)&&(name.length<2||phone.length<10))return alert('Informe nome e WhatsApp válidos.');const selectedTable=el('counter-table').selectedOptions[0],change=!el('counter-change-field').hidden?el('counter-change').value.trim():'';const payload={origem:requestedOrigin,tipo:currentType==='local'?'mesa':currentType,mesa_id:currentType==='local'?tableId:null,mesa_token:currentType==='local'?selectedTable?.dataset.token:null,nome:name||'Atendimento local',telefone:phone,cep:currentType==='entrega'?address.cep:'',bairro:currentType==='entrega'?address.bairro:'',endereco:currentType==='entrega'?address.texto:'',endereco_dados:currentType==='entrega'?address:{},pagamento:el('counter-payment').value,troco_para:change||null,observacoes:el('counter-notes').value.trim(),itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))};const button=el('counter-submit'),original=button.textContent;button.disabled=true;button.textContent='Criando pedido...';try{const result=await db.rpc('criar_pedido_garcom',{payload});if(result.error)throw result.error;const reference=typeof result.data==='object'?(result.data?.codigo||result.data?.id||'criado'):result.data;resetOrder();showSuccess(reference);await window.FSOperationalNotifications?.load?.()}catch(error){alert(error.message||'Não foi possível criar o pedido.')}finally{button.disabled=!canSell;button.textContent=original}}
init();
