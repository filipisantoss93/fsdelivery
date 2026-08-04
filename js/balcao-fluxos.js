(()=>{
  const byId=id=>document.getElementById(id);
  const originalRenderPayments=renderPayments;

  function clearAddress(){
    ['counter-cep','counter-street','counter-number','counter-neighborhood','counter-city','counter-complement','counter-reference'].forEach(id=>{const node=byId(id);if(node)node.value=''});
  }

  function addressText(){
    return [
      byId('counter-street')?.value.trim(),
      byId('counter-number')?.value.trim(),
      byId('counter-neighborhood')?.value.trim(),
      byId('counter-city')?.value.trim(),
      byId('counter-complement')?.value.trim(),
      byId('counter-reference')?.value.trim()?`Referência: ${byId('counter-reference').value.trim()}`:'',
      byId('counter-cep')?.value.trim()?`CEP: ${byId('counter-cep').value.trim()}`:''
    ].filter(Boolean).join(', ');
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
    if(currentType==='local'&&!tableId)return alert('Selecione uma mesa para o pedido local.');
    if(currentType==='entrega'&&(!byId('counter-street').value.trim()||!byId('counter-number').value.trim()||!byId('counter-neighborhood').value.trim()||!byId('counter-city').value.trim()))return alert('Informe rua, número, bairro e cidade.');
    if(['entrega','retirada'].includes(currentType)&&(name.length<2||phone.length<10))return alert('Informe nome e WhatsApp válidos.');
    const selectedTable=byId('counter-table').selectedOptions[0];
    const notes=[byId('counter-notes').value.trim(),!byId('counter-change-field').hidden&&byId('counter-change').value.trim()?`Troco para R$ ${byId('counter-change').value.trim()}`:''].filter(Boolean).join(' • ');
    const payload={
      tipo:currentType==='local'?'mesa':currentType,
      mesa_id:currentType==='local'?tableId:null,
      mesa_token:currentType==='local'?selectedTable?.dataset.token:null,
      nome:name||'Atendimento local',
      telefone:phone||'local',
      endereco:currentType==='entrega'?addressText():'',
      pagamento:byId('counter-payment').value,
      observacoes:notes,
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
})();
