(()=>{
  'use strict';
  if(window.__fsClientesEnderecos)return;
  window.__fsClientesEnderecos=true;

  const db=window.supabaseClient;
  if(!db)return;
  const digits=value=>String(value||'').replace(/\D/g,'');
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const page=location.pathname.split('/').pop().toLowerCase();
  const initialized=new Set();

  function createAddressSelector(anchor,id,label='Endereços salvos'){
    if(!anchor)return null;
    const existing=document.getElementById(id);
    if(existing)return existing;
    const field=document.createElement('div');
    field.className='field full fs-saved-addresses';
    field.id=id;
    field.hidden=true;
    field.innerHTML=`<label>${label}</label><select><option value="">Usar outro endereço</option></select><small>Selecione um endereço anterior ou mantenha “Usar outro endereço”.</small>`;
    anchor.before(field);
    return field;
  }

  function fillTextAddress(target,address){
    if(!target)return;
    target.value=address?.endereco_formatado||'';
    target.dispatchEvent(new Event('input',{bubbles:true}));
  }

  function renderAddressOptions(field,addresses,onSelect){
    if(!field)return;
    const select=field.querySelector('select');
    if(!select)return;
    const items=Array.isArray(addresses)?addresses:[];
    select.innerHTML='<option value="">Usar outro endereço</option>'+items.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.apelido||'Endereço')} — ${escapeHtml(item.endereco_formatado||'')}</option>`).join('');
    field.hidden=!items.length;
    if(items.length){
      const preferred=items.find(item=>item.principal)||items[0];
      select.value=preferred.id;
      onSelect(preferred);
    }
    select.onchange=()=>onSelect(items.find(item=>String(item.id)===select.value)||null);
  }

  function publicTokenKey(slug,phone){return `fsdelivery_customer_token_${slug}_${digits(phone)}`}

  async function setupPublicStore(){
    if(initialized.has('store'))return true;
    const phone=document.getElementById('customer-phone');
    const address=document.getElementById('customer-address');
    const addressField=document.getElementById('address-field');
    if(!phone||!address||!addressField)return false;
    initialized.add('store');
    const slug=new URLSearchParams(location.search).get('loja')||'';
    const selector=createAddressSelector(addressField,'public-saved-addresses','Escolha um endereço salvo');
    let requestId=0;

    async function loadAddresses(){
      const normalized=digits(phone.value);
      const currentRequest=++requestId;
      if(normalized.length<10){selector.hidden=true;return}
      const token=localStorage.getItem(publicTokenKey(slug,normalized));
      if(!token){selector.hidden=true;return}
      const {data,error}=await db.rpc('listar_enderecos_cliente_publico',{p_slug:slug,p_telefone:normalized,p_token:token});
      if(currentRequest!==requestId)return;
      if(error){console.warn('Endereços salvos indisponíveis:',error);selector.hidden=true;return}
      renderAddressOptions(selector,data||[],selected=>fillTextAddress(address,selected));
    }

    phone.addEventListener('blur',loadAddresses);
    phone.addEventListener('change',loadAddresses);
    if(digits(phone.value).length>=10)loadAddresses();
    return true;
  }

  async function resolveOwnerStore(){
    const {data:{session}}=await db.auth.getSession();
    if(!session)return null;
    const {data,error}=await db.from('estabelecimentos').select('id').eq('usuario_id',session.user.id).maybeSingle();
    if(error){console.warn('Estabelecimento indisponível:',error);return null}
    return data||null;
  }

  async function findInternalAddresses(storeId,phoneValue){
    const normalized=digits(phoneValue);
    if(!storeId||normalized.length<10)return [];
    const {data:clients,error}=await db.from('clientes').select('id').eq('estabelecimento_id',storeId).eq('telefone_normalizado',normalized).limit(1);
    if(error||!clients?.length)return [];
    const {data,addressError}=await db.from('cliente_enderecos').select('id,apelido,cep,logradouro,numero,complemento,bairro,cidade,estado,referencia,principal').eq('cliente_id',clients[0].id).eq('ativo',true).order('principal',{ascending:false}).order('updated_at',{ascending:false});
    if(addressError){console.warn('Endereços do cliente indisponíveis:',addressError);return []}
    return (data||[]).map(item=>({...item,endereco_formatado:[item.logradouro,item.numero,item.complemento,item.bairro,item.cidade,item.estado,item.cep?`CEP ${item.cep}`:'',item.referencia].filter(Boolean).join(', ')}));
  }

  async function setupCounter(){
    if(initialized.has('counter'))return true;
    const phone=document.getElementById('counter-phone');
    const addressField=document.getElementById('counter-address-field');
    if(!phone||!addressField)return false;
    initialized.add('counter');
    const selector=createAddressSelector(addressField,'counter-saved-addresses','Endereço do cliente');
    const store=await resolveOwnerStore();
    const fields={cep:'counter-cep',logradouro:'counter-street',numero:'counter-number',complemento:'counter-complement',bairro:'counter-neighborhood',cidade:'counter-city',referencia:'counter-reference'};
    const apply=item=>Object.entries(fields).forEach(([key,id])=>{const node=document.getElementById(id);if(node)node.value=item?.[key]||''});
    let requestId=0;
    const load=async()=>{
      const currentRequest=++requestId;
      const addresses=await findInternalAddresses(store?.id,phone.value);
      if(currentRequest===requestId)renderAddressOptions(selector,addresses,apply);
    };
    phone.addEventListener('blur',load);
    phone.addEventListener('change',load);
    return true;
  }

  async function setupWaiter(){
    if(initialized.has('waiter'))return true;
    const phone=document.getElementById('waiter-phone');
    const address=document.getElementById('waiter-address');
    const addressField=document.getElementById('waiter-address-field');
    if(!phone||!address||!addressField)return false;
    initialized.add('waiter');
    const selector=createAddressSelector(addressField,'waiter-saved-addresses','Endereço do cliente');
    const store=await resolveOwnerStore();
    let requestId=0;
    const load=async()=>{
      const currentRequest=++requestId;
      const addresses=await findInternalAddresses(store?.id,phone.value);
      if(currentRequest===requestId)renderAddressOptions(selector,addresses,item=>fillTextAddress(address,item));
    };
    phone.addEventListener('blur',load);
    phone.addEventListener('change',load);
    return true;
  }

  async function setupCustomersPage(){
    const table=document.getElementById('customer-table');
    if(!table)return false;
    if(table.dataset.fsCustomersLoading==='true')return true;
    table.dataset.fsCustomersLoading='true';
    const store=await resolveOwnerStore();
    if(!store){delete table.dataset.fsCustomersLoading;return true}
    const {data,error}=await db.rpc('listar_clientes_resumo',{p_estabelecimento:store.id});
    delete table.dataset.fsCustomersLoading;
    if(error){console.warn('Resumo profissional de clientes indisponível:',error);return true}
    table.innerHTML=(data||[]).map(customer=>`<tr data-customer-id="${escapeHtml(customer.id)}"><td><b>${escapeHtml(customer.nome||'Cliente')}</b></td><td>${escapeHtml(customer.telefone||'-')}</td><td>${Number(customer.quantidade_pedidos||0)}</td><td>${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(customer.total_gasto)||0)}</td><td>${customer.ultimo_pedido_em?new Date(customer.ultimo_pedido_em).toLocaleDateString('pt-BR'):'-'}</td></tr>`).join('')||'<tr><td colspan="5">Nenhum cliente cadastrado.</td></tr>';
    return true;
  }

  function initializePage(){
    if(page==='loja.html')setupPublicStore();
    if(page==='balcao.html')setupCounter();
    if(page==='cardapio.html')setupWaiter();
    if(page==='app.html'&&document.getElementById('clientes')?.classList.contains('active'))setupCustomersPage();
  }

  document.addEventListener('click',event=>{
    if(page==='app.html'&&event.target.closest?.('[data-page="clientes"]'))requestAnimationFrame(setupCustomersPage);
  });
  document.addEventListener('fs:page:changed',event=>{
    if(page==='app.html'&&event.detail?.page==='clientes')setupCustomersPage();
  });

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initializePage,{once:true});
  else initializePage();
})();
