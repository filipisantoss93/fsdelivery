(()=>{
  'use strict';
  if(window.__fsLojaCartaoOnline)return;
  window.__fsLojaCartaoOnline=true;
  const db=window.supabaseClient;
  const params=new URLSearchParams(location.search);
  const slug=String(params.get('loja')||'').trim();
  const byId=id=>document.getElementById(id);
  const digits=value=>String(value||'').replace(/\D/g,'');
  let config=null;
  let readyPromise=null;

  function loadScript(){
    if(window.EfiPay?.CreditCard)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-fs-efi-token]');
      if(existing){existing.addEventListener('load',()=>resolve(),{once:true});existing.addEventListener('error',()=>reject(new Error('Falha ao carregar tokenização Efí.')),{once:true});return}
      const script=document.createElement('script');
      script.src='js/vendor/payment-token-efi-3.4.1.min.js';
      script.async=true;script.dataset.fsEfiToken='true';script.onload=()=>resolve();script.onerror=()=>reject(new Error('Falha ao carregar tokenização Efí.'));document.head.appendChild(script);
    });
  }

  function installPanel(){
    const select=byId('payment-method');if(!select||!config?.cartao_online||!config?.tokenizacao?.account_identifier)return false;
    if(!select.dataset.fsOnlineCardObserved){
      select.dataset.fsOnlineCardObserved='true';
      new MutationObserver(()=>queueMicrotask(installPanel)).observe(select,{childList:true});
    }
    if(![...select.options].some(option=>option.value==='Cartão on-line'))select.add(new Option('Cartão on-line','Cartão on-line'));
    const installed=byId('card-online-fields');
    if(installed){
      const online=select.value==='Cartão on-line';
      installed.hidden=!online;
      const change=byId('change-field');if(change&&online)change.hidden=true;
      return true;
    }
    const host=document.createElement('section');host.id='card-online-fields';host.className='field full fs-card-online';host.hidden=true;
    host.innerHTML=`<h3>Cartão on-line</h3><p>Pagamento à vista. Os dados do cartão são tokenizados pela Efí e não são armazenados pelo FS Delivery.</p><div class="fs-card-online-grid">
      <div class="field full"><label for="card-number">Número do cartão</label><input id="card-number" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="0000 0000 0000 0000"></div>
      <div class="field"><label for="card-expiry">Validade</label><input id="card-expiry" inputmode="numeric" autocomplete="cc-exp" maxlength="5" placeholder="MM/AA"></div>
      <div class="field"><label for="card-cvv">CVV</label><input id="card-cvv" type="password" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="123"></div>
      <div class="field full"><label for="card-holder">Nome no cartão</label><input id="card-holder" autocomplete="cc-name"></div>
      <div class="field full"><label for="card-cpf">CPF do titular</label><input id="card-cpf" inputmode="numeric" autocomplete="off" maxlength="14"></div>
      <div class="field full"><label for="card-email">E-mail</label><input id="card-email" type="email" autocomplete="email"></div>
    </div><p class="fs-card-online-note">A cobrança é realizada em 1x. Nome e telefone do comprador são reaproveitados dos dados do pedido.</p>`;
    select.closest('.field')?.insertAdjacentElement('afterend',host);
    const expiry=byId('card-expiry');
    expiry?.addEventListener('input',()=>{const raw=digits(expiry.value).slice(0,4);expiry.value=raw.length>2?`${raw.slice(0,2)}/${raw.slice(2)}`:raw});
    const sync=()=>{const online=select.value==='Cartão on-line';host.hidden=!online;const change=byId('change-field');if(change&&online)change.hidden=true};
    select.addEventListener('change',sync);sync();
    return true;
  }

  async function loadConfig(){
    if(!slug)return null;
    const {data,error}=await db.functions.invoke('config-pagamento-loja',{body:{slug}});
    if(error)throw error;
    config=data||null;
    if(config?.cartao_online&&config?.tokenizacao?.account_identifier){await loadScript();installPanel();try{await window.EfiPay.CreditCard.isScriptBlocked()}catch{}}
    return config;
  }

  async function ensureReady(){if(!readyPromise)readyPromise=loadConfig().catch(error=>{console.warn('Cartão on-line indisponível:',error);return null});return readyPromise}
  function isSelected(){return byId('payment-method')?.value==='Cartão on-line'}
  const val=id=>String(byId(id)?.value||'').trim();

  async function prepare({name,phone}){
    await ensureReady();
    if(!isSelected())return null;
    if(!config?.cartao_online||!config?.tokenizacao?.account_identifier||!window.EfiPay?.CreditCard)throw new Error('Cartão on-line indisponível para esta loja.');
    const number=digits(val('card-number')),cvv=digits(val('card-cvv')),expiry=digits(val('card-expiry')),holderName=val('card-holder')||name,holderDocument=digits(val('card-cpf')),email=val('card-email');
    const expirationMonth=expiry.slice(0,2),expirationYear=expiry.length===4?`20${expiry.slice(2)}`:'';
    if(number.length<13||number.length>19)throw new Error('Informe um número de cartão válido.');
    if(cvv.length<3)throw new Error('Informe o CVV do cartão.');
    if(expiry.length!==4||!/^(0[1-9]|1[0-2])$/.test(expirationMonth))throw new Error('Informe a validade no formato MM/AA.');
    if(holderName.length<3||holderDocument.length!==11)throw new Error('Informe nome e CPF do titular.');
    if(!email.includes('@')||email.length<5)throw new Error('Informe um e-mail válido.');
    const blocked=await window.EfiPay.CreditCard.isScriptBlocked();if(blocked)throw new Error('O navegador está bloqueando a validação de segurança do cartão. Desative o bloqueio e tente novamente.');
    const brand=await window.EfiPay.CreditCard.setCardNumber(number).verifyCardBrand();if(!brand||['undefined','unsupported'].includes(String(brand)))throw new Error('Bandeira do cartão não suportada.');
    const token=await window.EfiPay.CreditCard.setAccount(config.tokenizacao.account_identifier).setEnvironment(config.tokenizacao.environment).setCreditCardData({brand,number,cvv,expirationMonth,expirationYear,holderName,holderDocument,reuse:false}).getPaymentToken();
    if(!token?.payment_token)throw new Error('Não foi possível tokenizar o cartão.');
    return {payment_token:token.payment_token,cartao_mascara:token.card_mask||null,customer:{name,cpf:holderDocument,email,phone_number:digits(phone)}};
  }

  async function charge({checkoutToken,payment}){
    if(!payment)return null;
    const key=`fsdelivery_card_attempt_${checkoutToken}`;let requestKey=sessionStorage.getItem(key);if(!requestKey){requestKey=crypto.randomUUID();sessionStorage.setItem(key,requestKey)}
    const {data,error}=await db.functions.invoke('criar-cobranca-cartao-pedido',{body:{slug,checkout_token:checkoutToken,idempotency_key:requestKey,...payment}});
    if(error)throw error;
    const status=data?.cobranca?.pagamento_status;
    if(data?.sucesso){sessionStorage.removeItem(key);return data}
    if(['recusado','cancelado','estornado','chargeback'].includes(status))sessionStorage.removeItem(key);
    if(data?.erro)throw new Error(data.erro);
    throw new Error('Não foi possível confirmar o pagamento. Tente novamente.');
  }

  window.FSDeliveryOnlineCard=Object.freeze({ensureReady,isSelected,prepare,charge});
  let attempts=0;const timer=setInterval(async()=>{attempts++;await ensureReady();if(installPanel()||attempts>40)clearInterval(timer)},150);
})();
