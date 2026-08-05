(()=>{
  'use strict';
  if(window.__fsClientesEnderecos)return;
  window.__fsClientesEnderecos=true;

  const db=window.supabaseClient;
  const digits=value=>String(value||'').replace(/\D/g,'');
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const path=location.pathname.toLowerCase();
  const isStore=/(^|\/)loja\.html$/.test(path);
  const isCounter=/(^|\/)balcao\.html$/.test(path);
  const isWaiter=/(^|\/)cardapio\.html$/.test(path);
  const isApp=/(^|\/)app\.html$/.test(path);

  function createAddressSelector(anchor,id,label='Endereços salvos'){
    if(!anchor||document.getElementById(id))return null;
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
    select.innerHTML='<option value="">Usar outro endereço</option>'+addresses.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.apelido||'Endereço')} — ${escapeHtml(item.endereco_formatado||'')}</option>`).join('');
    field.hidden=!addresses.length;
    if(addresses.length){
      const preferred=addresses.find(item=>item.principal)||addresses[0];
      select.value=preferred.id;
      onSelect(preferred);
    }
    select.onchange=()=>onSelect(addresses.find(item=>String(item.id)===select.value)||null);
  }

  function publicTokenKey(slug,phone){return `fsdelivery_customer_token_${slug}_${digits(phone)}`}

  async function setupPublicStore(){
    const phone=document.getElementById('customer-phone');
    const address=document.getElementById('customer-address');
    const addressField=document.getElementById('address-field');
    if(!phone||!address||!addressField)return;
    const slug=new URLSearchParams(location.search).get('loja')||'';
    const selector=createAddressSelector(addressField,'public-saved-addresses','Escolha um endereço salvo');
    let loading=false;

    async function loadAddresses(){
      const normalized=digits(phone.value);
      if(normalized.length<10||loading)return;
      const token=localStorage.getItem(publicTokenKey(slug,normalized));
      if(!token){selector.hidden=true;return}
      loading=true;
      const {data,error}=await db.rpc('listar_enderecos_cliente_publico',{p_slug:slug,p_telefone:normalized,p_token:token});
      loading=false;
      if(error){console.warn('Endereços salvos indisponíveis:',error);selector.hidden=true;return}
      renderAddressOptions(selector,data||[],selected=>fillTextAddress(address,selected));
    }

    phone.addEventListener('blur',loadAddresses);
    phone.addEventListener('change',loadAddresses);
    if(digits(phone.value).length>=10)setTimeout(loadAddresses,400);

    const originalRpc=db.rpc.bind(db);
    db.rpc=function(functionName,args,...rest){
      const request=originalRpc(functionName,args,...rest);
      if(functionName!=='criar_pedido_publico')return request;
      return request.then(async result=>{
        if(result?.error||!result?.data)return result;
        const payload=args?.payload||{};
        const normalized=digits(payload.telefone);
        if(normalized.length<10)return result;
        try{
          const validation=await originalRpc('vincular_dispositivo_cliente',{p_slug:payload.slug||slug,p_telefone:normalized,p_codigo_pedido:String(result.data)});
          if(!validation.error&&validation.data)localStorage.setItem(publicTokenKey(payload.slug||slug,normalized),String(validation.data));
        }catch(error){console.warn('Não foi possível vincular o dispositivo do cliente:',error)}
        return result;
      });
    };
  }

  async function resolveOwnerStore(){
    const {data:{session}}=await db.auth.getSession();
    if(!session)return null;
    const {data}=await db.from('estabelecimentos').select('id').eq('usuario_id',session.user.id).maybeSingle();
    return data||null;
  }

  async function findInternalAddresses(storeId,phoneValue){
    const normalized=digits(phoneValue);
    if(!storeId||normalized.length<10)return [];
    const {data:clients,error}=await db.from('clientes').select('id').eq('estabelecimento_id',storeId).eq('telefone_normalizado',normalized).limit(1);
    if(error||!clients?.length)return [];
    const {data}=await db.from('cliente_enderecos').select('id,apelido,cep,logradouro,numero,complemento,bairro,cidade,estado,referencia,principal').eq('cliente_id',clients[0].id).eq('ativo',true).order('principal',{ascending:false}).order('updated_at',{ascending:false});
    return (data||[]).map(item=>({...item,endereco_formatado:[item.logradouro,item.numero,item.complemento,item.bairro,item.cidade,item.estado,item.cep?`CEP ${item.cep}`:'',item.referencia].filter(Boolean).join(', ')}));
  }

  async function setupCounter(){
    const phone=document.getElementById('counter-phone');
    const addressField=document.getElementById('counter-address-field');
    if(!phone||!addressField)return;
    const selector=createAddressSelector(addressField,'counter-saved-addresses','Endereço do cliente');
    const store=await resolveOwnerStore();
    const fields={cep:'counter-cep',logradouro:'counter-street',numero:'counter-number',complemento:'counter-complement',bairro:'counter-neighborhood',cidade:'counter-city',referencia:'counter-reference'};
    const apply=item=>Object.entries(fields).forEach(([key,id])=>{const node=document.getElementById(id);if(node)node.value=item?.[key]||''});
    const load=async()=>renderAddressOptions(selector,await findInternalAddresses(store?.id,phone.value),apply);
    phone.addEventListener('blur',load);phone.addEventListener('change',load);
  }

  async function setupWaiter(){
    const phone=document.getElementById('waiter-phone');
    const address=document.getElementById('waiter-address');
    const addressField=document.getElementById('waiter-address-field');
    if(!phone||!address||!addressField)return;
    const selector=createAddressSelector(addressField,'waiter-saved-addresses','Endereço do cliente');
    const store=await resolveOwnerStore();
    const load=async()=>renderAddressOptions(selector,await findInternalAddresses(store?.id,phone.value),item=>fillTextAddress(address,item));
    phone.addEventListener('blur',load);phone.addEventListener('change',load);
  }

  async function setupCustomersPage(){
    const table=document.getElementById('customer-table');
    if(!table)return;
    const store=await resolveOwnerStore();
    if(!store)return;
    const {data,error}=await db.rpc('listar_clientes_resumo',{p_estabelecimento:store.id});
    if(error){console.warn('Resumo profissional de clientes indisponível:',error);return}
    table.innerHTML=(data||[]).map(customer=>`<tr data-customer-id="${escapeHtml(customer.id)}"><td><b>${escapeHtml(customer.nome||'Cliente')}</b></td><td>${escapeHtml(customer.telefone||'-')}</td><td>${Number(customer.quantidade_pedidos||0)}</td><td>${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(customer.total_gasto)||0)}</td><td>${customer.ultimo_pedido_em?new Date(customer.ultimo_pedido_em).toLocaleDateString('pt-BR'):'-'}</td></tr>`).join('')||'<tr><td colspan="5">Nenhum cliente cadastrado.</td></tr>';
  }

  function start(){
    if(isStore)setupPublicStore();
    if(isCounter)setupCounter();
    if(isWaiter){setTimeout(setupWaiter,900)}
    if(isApp){setTimeout(setupCustomersPage,900);document.addEventListener('click',event=>{if(event.target.closest?.('[data-page="clientes"]'))setTimeout(setupCustomersPage,250)})}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
