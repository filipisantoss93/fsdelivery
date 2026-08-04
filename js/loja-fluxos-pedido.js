(()=>{
  if(!/(^|\/)loja\.html$/i.test(location.pathname))return;
  const byId=id=>document.getElementById(id);
  function install(){
    const type=byId('delivery-type'),form=byId('checkout-form'),addressField=byId('address-field');
    if(!type||!form||!addressField)return;
    const tableMode=new URLSearchParams(location.search).has('mesa');
    if(tableMode){type.innerHTML='<option value="mesa">Pedido nesta mesa</option>';addressField.hidden=true;addressField.style.display='none';return}
    type.innerHTML='<option value="delivery">Entrega</option><option value="pickup">Retirada no balcão</option>';
    if(!byId('online-address-fields')){
      const host=document.createElement('div');host.id='online-address-fields';host.className='form-grid';
      host.innerHTML='<div class="field full"><label for="delivery-street">Rua</label><input id="delivery-street" autocomplete="street-address"></div><div class="field"><label for="delivery-number">Número</label><input id="delivery-number" inputmode="numeric"></div><div class="field"><label for="delivery-neighborhood">Bairro</label><input id="delivery-neighborhood"></div><div class="field full"><label for="delivery-complement">Complemento ou referência</label><input id="delivery-complement"></div>';
      const textarea=addressField.querySelector('textarea,[name="address"]');if(textarea){textarea.hidden=true;textarea.required=false;addressField.appendChild(host)}
    }
    const sync=()=>{
      const delivery=type.value==='delivery';addressField.hidden=!delivery;addressField.style.display=delivery?'grid':'none';
      ['delivery-street','delivery-number','delivery-neighborhood'].forEach(id=>{const input=byId(id);if(input)input.required=delivery});
    };
    type.addEventListener('change',sync);sync();
    form.addEventListener('submit',event=>{
      if(type.value!=='delivery')return;
      const street=byId('delivery-street')?.value.trim()||'',number=byId('delivery-number')?.value.trim()||'',neighborhood=byId('delivery-neighborhood')?.value.trim()||'',complement=byId('delivery-complement')?.value.trim()||'';
      if(!street||!number||!neighborhood){event.preventDefault();event.stopImmediatePropagation();alert('Informe rua, número e bairro para entrega.');return}
      const textarea=addressField.querySelector('textarea,[name="address"]');if(textarea)textarea.value=[street,number,neighborhood,complement].filter(Boolean).join(', ');
    },true);
  }
  window.addEventListener('load',()=>setTimeout(install,0));
})();