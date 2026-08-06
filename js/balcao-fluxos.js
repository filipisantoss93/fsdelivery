(()=>{
  const byId=id=>document.getElementById(id);
  const originalRenderPayments=renderPayments;
  const requestedOrigin=new URLSearchParams(location.search).get('origem')==='caixa'?'caixa':'balcao';

  function clearAddress(){
    ['counter-cep','counter-street','counter-number','counter-neighborhood','counter-city','counter-complement','counter-reference'].forEach(id=>{const node=byId(id);if(node)node.value=''});
  }

  function addressData(){
    const cep=byId('counter-cep')?.value.replace(/\D/g,'')||'';
    const logradouro=byId('counter-street')?.value.trim()||'';
    const numero=byId('counter-number')?.value.trim()||'';
    const bairro=byId('counter-neighborhood')?.value.trim()||'';
    const cidade=byId('counter-city')?.value.trim()||'';
    const complemento=byId('counter-complement')?.value.trim()||'';
    const referencia=byId('counter-reference')?.value.trim()||'';
    const texto=[
      [logradouro,numero].filter(Boolean).join(', '),
      bairro,
      cidade,
      complemento,
      referencia?`Referência: ${referencia}`:'',
      cep?`CEP: ${cep.replace(/(\d{5})(\d{3})/,'$1-$2')}`:''
    ].filter(Boolean).join(', ');
    return {cep,logradouro,numero,bairro,cidade,estado:'',complemento,referencia,texto};
  }

  window.renderPayments=renderPayments=function(){
    originalRenderPayments();
    const payment=byId('counter-payment');
    if(payment)payment.onchange=()=>{byId('counter-change-field').hidden=!payment.value.toLowerCase().includes('dinheiro')};
    payment?.dispatchEvent(new Event('change'));
  };

  window.setType=setType=function(type){
    currentType=type;
    document.querySelectorAll('[data-counter-type]').forEach(item=>item.classList.toggle('active',item.dataset.counterType===type));
    if(type!=='local')byId('counter-table').value='';
    if(type!=='entrega')clearAddress();
    if(type==='local'){byId('counter-name').value='';byId('counter-phone').value=''}
    updateType();
  };

  window.updateType=updateType=function(){
    const local=currentType==='local';
    byId('counter-table-field').hidden=!local;
    byId('counter-name-field').hidden=local;
    byId('counter-phone-field').hidden=local;
    byId('counter-address-field').hidden=currentType!=='entrega';
    byId('counter-destination').textContent={retirada:'Retirada no balcão',local:'Consumo local vinculado à mesa',entrega:'Entrega ao cliente'}[currentType];
    renderCart();
  };

  window.total=total=function(){
    const base=subtotal();
    const delivery=currentType==='entrega'?Number(store?.taxa_entrega||0):0;
    const service=currentType==='local'?base*Number(config?.taxa_servico_percentual||0)/100:0;
    return base+delivery+service;
  };

  window.resetOrder=resetOrder=function(){
    cart=[];current=null;qty=1;
    ['counter-name','counter-phone','counter-cep','counter-street','counter-number','counter-neighborhood','counter-city','counter-complement','counter-reference','counter-change','counter-notes'].forEach(id=>{const node=byId(id);if(node)node.value=''});
    byId('counter-table').value='';setType('retirada');renderCart();
  };

  window.submit=submit=async function(){
    if(!canSell)return;
    if(!cart.length)return alert('Adicione ao menos um produto.');
    const name=byId('counter-name').value.trim();
    const phone=byId('counter-phone').value.replace(/\D/g,'');
    const tableId=byId('counter-table').value;
    const address=addressData();
    if(currentType==='local'&&!tableId)return alert('Selecione uma mesa para o pedido local.');
    if(currentType==='entrega'&&(!address.logradouro||!address.numero||!address.bairro||!address.cidade||address.cep.length!==8))return alert('Informe CEP, rua, número, bairro e cidade.');
    if(['entrega','retirada'].includes(currentType)&&(name.length<2||phone.length<10))return alert('Informe nome e WhatsApp válidos.');
    const selectedTable=byId('counter-table').selectedOptions[0];
    const change=!byId('counter-change-field').hidden?byId('counter-change').value.trim():'';
    const payload={
      origem:requestedOrigin,
      tipo:currentType==='local'?'mesa':currentType,
      mesa_id:currentType==='local'?tableId:null,
      mesa_token:currentType==='local'?selectedTable?.dataset.token:null,
      nome:name||'Atendimento local',
      telefone:phone,
      cep:currentType==='entrega'?address.cep:'',
      bairro:currentType==='entrega'?address.bairro:'',
      endereco:currentType==='entrega'?address.texto:'',
      endereco_dados:currentType==='entrega'?address:{},
      pagamento:byId('counter-payment').value,
      troco_para:change||null,
      observacoes:byId('counter-notes').value.trim(),
      itens:cart.map(item=>({produto_id:item.productId,quantidade:item.qty,observacoes:item.note}))
    };
    const button=byId('counter-submit'),original=button.textContent;
    button.disabled=true;button.textContent='Criando pedido...';
    try{
      const result=await db.rpc('criar_pedido_garcom',{payload});
      if(result.error)throw result.error;
      const reference=typeof result.data==='object'?(result.data?.codigo||result.data?.id||'criado'):result.data;
      resetOrder();showSuccess(reference);await window.FSOperationalNotifications?.load?.();
    }catch(error){alert(error.message||'Não foi possível criar o pedido.')}
    finally{button.disabled=!canSell;button.textContent=original}
  };

  if(requestedOrigin==='caixa'){
    document.title='Venda rápida — FS Delivery';
    const title=document.querySelector('.page-head h1');
    const subtitle=document.querySelector('.page-head p');
    if(title)title.textContent='Venda rápida no caixa';
    if(subtitle)subtitle.textContent='Registre retirada, consumo local ou entrega usando o mesmo contrato de pedidos.';
  }
})();
