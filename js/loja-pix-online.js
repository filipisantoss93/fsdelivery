(()=>{
  'use strict';
  if(new URLSearchParams(location.search).get('demo')==='1'||window.__fsLojaPixOnline)return;
  window.__fsLojaPixOnline=true;
  const db=window.supabaseClient,byId=id=>document.getElementById(id),params=new URLSearchParams(location.search),slug=String(params.get('loja')||'').trim();
  let config=null,ready=null;
  const digits=value=>String(value||'').replace(/\D/g,'');
  function validCpf(value){const cpf=digits(value);if(cpf.length!==11||/^([0-9])\1{10}$/.test(cpf))return false;const calc=size=>{let sum=0;for(let i=0;i<size;i++)sum+=Number(cpf[i])*(size+1-i);const rest=(sum*10)%11;return rest===10?0:rest};return calc(9)===Number(cpf[9])&&calc(10)===Number(cpf[10])}
  function install(){
    const select=byId('payment-method');if(!select||!config?.pix_online)return false;
    if(![...select.options].some(o=>o.value==='Pix on-line'))select.add(new Option('Pix on-line','Pix on-line'));
    let panel=byId('pix-online-fields');
    if(!panel){panel=document.createElement('section');panel.id='pix-online-fields';panel.className='field full';panel.hidden=true;panel.innerHTML='<h3>Dados para o Pix</h3><p>Usados para emitir a cobrança Bolix da Efí e não salvos no pedido.</p><div class="form-grid"><div class="field"><label for="pix-cpf">CPF do pagador</label><input id="pix-cpf" inputmode="numeric" autocomplete="off" maxlength="14"></div><div class="field"><label for="pix-email">E-mail</label><input id="pix-email" type="email" autocomplete="email"></div><div class="field full"><label for="pix-street">Rua</label><input id="pix-street" autocomplete="address-line1"></div><div class="field"><label for="pix-number">Número</label><input id="pix-number" autocomplete="address-line2"></div><div class="field"><label for="pix-neighborhood">Bairro</label><input id="pix-neighborhood"></div><div class="field"><label for="pix-zipcode">CEP</label><input id="pix-zipcode" inputmode="numeric" autocomplete="postal-code" maxlength="9"></div><div class="field"><label for="pix-city">Cidade</label><input id="pix-city" autocomplete="address-level2"></div><div class="field"><label for="pix-state">UF</label><input id="pix-state" maxlength="2" autocomplete="address-level1"></div><div class="field full"><label for="pix-complement">Complemento</label><input id="pix-complement" autocomplete="off"></div></div>';
      select.closest('.field')?.insertAdjacentElement('afterend',panel);
      byId('pix-zipcode')?.addEventListener('input',event=>{const n=digits(event.target.value).slice(0,8);event.target.value=n.length>5?`${n.slice(0,5)}-${n.slice(5)}`:n});
      byId('pix-cpf')?.addEventListener('input',event=>{const n=digits(event.target.value).slice(0,11);event.target.value=n.length>9?`${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`:n});
    }
    const sync=()=>{panel.hidden=select.value!=='Pix on-line';if(!panel.hidden)prefill()};
    if(!select.dataset.fsPixObserved){select.dataset.fsPixObserved='true';new MutationObserver(()=>queueMicrotask(install)).observe(select,{childList:true});select.addEventListener('change',sync)}
    sync();return true;
  }
  function prefill(){
    const pairs={street:'delivery-street',number:'delivery-number',neighborhood:'delivery-neighborhood',zipcode:'customer-cep',city:'customer-city',state:'customer-state',complement:'delivery-complement'};
    for(const [target,source] of Object.entries(pairs)){const input=byId(`pix-${target}`),origin=byId(source);if(input&&origin&&origin.value&&!input.value)input.value=origin.value}
  }
  async function ensureReady(){
    if(!ready)ready=(async()=>{if(!slug||!db)return null;const {data,error}=await db.functions.invoke('config-pagamento-loja',{body:{slug}});if(error)throw error;config=data||null;install();return config})().catch(error=>{console.warn('Pix on-line indisponível:',error);return null});
    return ready;
  }
  function isSelected(){return byId('payment-method')?.value==='Pix on-line'}
  function prepare({name,phone}){
    if(!isSelected())return null;prefill();
    const cpf=digits(byId('pix-cpf')?.value),email=String(byId('pix-email')?.value||'').trim();
    const address={street:String(byId('pix-street')?.value||'').trim(),number:String(byId('pix-number')?.value||'').trim(),neighborhood:String(byId('pix-neighborhood')?.value||'').trim(),zipcode:digits(byId('pix-zipcode')?.value),city:String(byId('pix-city')?.value||'').trim(),state:String(byId('pix-state')?.value||'').trim().toUpperCase(),complement:String(byId('pix-complement')?.value||'').trim()};
    if(!validCpf(cpf))throw new Error('Informe um CPF válido para pagar com Pix on-line.');
    if(email.length<5||!email.includes('@'))throw new Error('Informe um e-mail válido para pagar com Pix on-line.');
    if(address.street.length<3||!address.number||address.neighborhood.length<2||address.zipcode.length!==8||address.city.length<2||!/^[A-Z]{2}$/.test(address.state))throw new Error('Preencha o endereço de cobrança para gerar o Pix.');
    return {name,cpf,email,phone_number:digits(phone),address};
  }
  async function charge({checkoutToken,customer}){
    if(!customer)return null;
    const key=`fsdelivery_pix_attempt_${checkoutToken}`;let requestKey=sessionStorage.getItem(key);if(!requestKey){requestKey=crypto.randomUUID();sessionStorage.setItem(key,requestKey)}
    const {data,error}=await db.functions.invoke('criar-cobranca-pix-pedido',{body:{slug,checkout_token:checkoutToken,idempotency_key:requestKey,customer}});
    if(error)throw error;if(data?.sucesso)return data;if(data?.erro)throw new Error(data.erro);throw new Error('Não foi possível gerar o QR Pix. Tente novamente.');
  }
  window.FSDeliveryOnlinePix=Object.freeze({ensureReady,isSelected,prepare,charge});
  let tries=0;const timer=setInterval(async()=>{tries++;await ensureReady();if(install()||tries>50)clearInterval(timer)},150);
})();
