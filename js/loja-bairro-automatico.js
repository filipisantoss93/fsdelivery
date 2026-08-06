(()=>{
  'use strict';
  if(window.__fsLojaBairroAutomatico)return;
  window.__fsLojaBairroAutomatico=true;

  const byId=id=>document.getElementById(id);
  const normalize=value=>String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\bii\b/g,'2').replace(/\biii\b/g,'3').replace(/\biv\b/g,'4')
    .replace(/\b(residencial|bairro|jardim|jd|conjunto|cj|loteamento|lot)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

  function resolveAutomaticRegion(){
    const neighborhood=byId('delivery-neighborhood')||byId('customer-neighborhood')||byId('address-neighborhood');
    const value=String(neighborhood?.value||'').trim();
    if(typeof regions==='undefined'||!Array.isArray(regions)||!regions.length){
      if(typeof selectedRegion!=='undefined')selectedRegion=null;
      return null;
    }
    const target=normalize(value);
    const match=target?regions.find(region=>{
      const candidate=normalize(region.nome);
      return candidate===target||candidate.includes(target)||target.includes(candidate);
    })||null:null;
    if(typeof selectedRegion!=='undefined')selectedRegion=match;
    return match;
  }

  function removeManualRegionField(){
    byId('region-field')?.remove();
  }

  function updateTotalsWithoutRegionField(){
    if(typeof settings==='undefined'||!settings)return;
    const delivery=typeof type==='function'&&type()==='delivery';
    if(delivery)resolveAutomaticRegion();
    const subtotalValue=typeof subtotal==='function'?subtotal():0;
    const feeValue=delivery?Number((typeof selectedRegion!=='undefined'&&selectedRegion?.taxa)??settings.taxa_entrega??0):0;
    const serviceValue=typeof service==='function'?service():0;
    const totalValue=subtotalValue+feeValue+serviceValue;
    const set=(id,value)=>{const node=byId(id);if(node)node.textContent=typeof money==='function'?money(value):String(value)};
    const address=byId('address-field');if(address)address.style.display=delivery?'grid':'none';
    set('cart-subtotal',subtotalValue);set('cart-delivery-fee',feeValue);set('cart-total',totalValue);
    set('mobile-total',totalValue);set('checkout-subtotal',subtotalValue);set('checkout-delivery-fee',feeValue);set('checkout-total',totalValue);
    const label=byId('checkout-total-label');if(label)label.textContent=serviceValue>0?`Total (serviço ${operational.taxa_servico_percentual}%)`:delivery?'Total com entrega':'Total';
    const count=typeof cart!=='undefined'?cart.reduce((sum,item)=>sum+item.qty,0):0;
    if(byId('mobile-cart-count')){byId('mobile-cart-count').textContent=count;byId('mobile-cart-count').hidden=!count}
    if(byId('mobile-cart-label'))byId('mobile-cart-label').textContent=`${count} ${count===1?'item':'itens'} • ${typeof money==='function'?money(totalValue):totalValue}`;
    const minimum=Number(settings.pedido_minimo)||0;
    const missing=Math.max(0,minimum-subtotalValue);
    if(byId('minimum-order-hint')){byId('minimum-order-hint').textContent=typeof table==='undefined'||!table?missing>0&&count?`Faltam ${money(missing)} para o pedido mínimo.`:'':'';byId('minimum-order-hint').style.color=missing>0?'#a52a2a':''}
  }

  function install(){
    removeManualRegionField();
    if(typeof window.updateTotal==='function')window.updateTotal=updateTotalsWithoutRegionField;
    const neighborhood=byId('delivery-neighborhood')||byId('customer-neighborhood')||byId('address-neighborhood');
    if(neighborhood&&!neighborhood.dataset.fsAutomaticRegion){
      neighborhood.dataset.fsAutomaticRegion='true';
      neighborhood.addEventListener('input',()=>{resolveAutomaticRegion();updateTotalsWithoutRegionField()});
      neighborhood.addEventListener('change',()=>{resolveAutomaticRegion();updateTotalsWithoutRegionField()});
    }
    resolveAutomaticRegion();
    updateTotalsWithoutRegionField();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true});
  else setTimeout(install,0);
  window.addEventListener('pageshow',install);
})();
