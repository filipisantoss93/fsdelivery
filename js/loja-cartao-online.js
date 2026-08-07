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
      script.src='https://cdn.jsdelivr.net/gh/efipay/js-payment-token-efi/dist/payment-token-efi-umd.min.js';
      script.async=true;script.dataset.fsEfiToken='true';script.onload=()=>resolve();script.onerror=()=>reject(new Error('Falha ao carregar tokenização Efí.'));document.head.appendChild(script);
    });
  }

  function installStyles(){
    if(byId('fs-card-online-style'))return;
    const style=document.createElement('style');style.id='fs-card-online-style';style.textContent=`
      .fs-card-online{display:grid;gap:12px;margin-top:4px;padding:14px;border:1px solid var(--store-line,var(--border));border-radius:14px;background:var(--surface-2)}
      .fs-card-online[hidden]{display:none!important}.fs-card-online h3{margin:0;font-size:16px}.fs-card-online p{margin:0;color:var(--muted);font-size:12px;line-height:1.45}
      .fs-card-online-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fs-card-online-grid .full{grid-column:1/-1}
      @media(max-width:560px){.fs-card-online-grid{grid-template-columns:1fr}.fs-card-online-grid .full{grid-column:auto}}
    `;document.head.appendChild(style);
  }

  function installPanel(){
    const select=byId('payment-method');if(!select||!config?.cartao_online||!config?.tokenizacao?.account_identifier)return false;
    if(![...select.options].some(option=>option.value==='Cartão on-line'))select.add(new Option('Cartão on-line','Cartão on-line'));
    if(byId('card-online-fields'))return true;
    installStyles();
    const host=document.createElement('section');host.id='card-online-fields';host.className='field full fs-card-online';host.hidden=true;
    host.innerHTML=`<h3>Cartão on-line</h3><p>Ambiente de homologação. Os dados do cartão são tokenizados pela Efí e não são armazenados pelo FS Delivery.</p><div class="fs-card-online-grid">
      <div class="field full"><label for="card-number">Número do cartão</label><input id="card-number" inputmode="numeric" autocomplete="cc-number" maxlength="23"></div>
      <div class="field"><label for="card-exp-month">Mês</label><input id="card-exp-month" inputmode="numeric" autocomplete="cc-exp-month" maxlength="2" placeholder="MM"></div>
      <div class="field"><label for="card-exp-year">Ano</label><input id="card-exp-year" inputmode="numeric" autocomplete="cc-exp-year" maxlength="4" placeholder="AAAA"></div>
      <div class="field"><label for="card-cvv">CVV</label><input id="card-cvv" type="password" inputmode="numeric" autocomplete="cc-csc" maxlength="4"></div>
      <div class="field"><label for="card-installments">Parcelas</label><select id="card-installments"><option value="1">1x</option></select></div>
      <div class="field full"><label for="card-holder">Nome do titular</label><input id="card-holder" autocomplete="cc-name"></div>
      <div class="field"><label for="card-cpf">CPF do titular</label><input id="card-cpf" inputmode="numeric" maxlength="14"></div>
      <div class="field"><label for="card-birth">Nascimento</label><input id="card-birth" type="date"></div>
      <div class="field full"><label for="card-email">E-mail</label><input id="card-email" type="email" autocomplete="email"></div>
      <div class="field"><label for="billing-cep">CEP de cobrança</label><input id="billing-cep" inputmode="numeric" maxlength="9"></div>
      <div class="field"><label for="billing-state">UF</label><input id="billing-state" maxlength="2" placeholder="SP"></div>
      <div class="field full"><label for="billing-street">Rua</label><input id="billing-street"></div>
      <div class="field"><label for="billing-number">Número</label><input id="billing-number"></div>
      <div class="field"><label for="billing-neighborhood">Bairro</label><input id="billing-neighborhood"></div>
      <div class="field"><label for="billing-city">Cidade</label><input id="billing-city"></div>
      <div class="field"><label for="billing-complement">Complemento</label><input id="billing-complement"></div>
    </div>`;
    select.closest('.field')?.insertAdjacentElement('afterend',host);
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
    const number=digits(val('card-number')),cvv=digits(val('card-cvv')),expirationMonth=digits(val('card-exp-month')).padStart(2,'0'),expirationYear=digits(val('card-exp-year')),holderName=val('card-holder')||name,holderDocument=digits(val('card-cpf'));
    if(number.length<13||number.length>19)throw new Error('Informe um número de cartão válido.');
    if(cvv.length<3)throw new Error('Informe o CVV do cartão.');
    if(!/^(0[1-9]|1[0-2])$/.test(expirationMonth)||expirationYear.length!==4)throw new Error('Informe a validade do cartão.');
    if(holderName.length<3||holderDocument.length!==11)throw new Error('Informe nome e CPF do titular.');
    const birth=val('card-birth'),email=val('card-email');if(!birth||!email.includes('@'))throw new Error('Informe nascimento e e-mail do pagador.');
    const billing={zipcode:digits(val('billing-cep')),street:val('billing-street'),number:val('billing-number'),neighborhood:val('billing-neighborhood'),city:val('billing-city'),complement:val('billing-complement'),state:val('billing-state').toUpperCase()};
    if(billing.zipcode.length!==8||!billing.street||!billing.number||!billing.neighborhood||!billing.city||!/^[A-Z]{2}$/.test(billing.state))throw new Error('Preencha o endereço de cobrança completo.');
    const blocked=await window.EfiPay.CreditCard.isScriptBlocked();if(blocked)throw new Error('O navegador está bloqueando a validação de segurança do cartão. Desative o bloqueio e tente novamente.');
    const brand=await window.EfiPay.CreditCard.setCardNumber(number).verifyCardBrand();if(!brand||['undefined','unsupported'].includes(String(brand)))throw new Error('Bandeira do cartão não suportada.');
    const token=await window.EfiPay.CreditCard.setAccount(config.tokenizacao.account_identifier).setEnvironment('sandbox').setCreditCardData({brand,number,cvv,expirationMonth,expirationYear,holderName,holderDocument,reuse:false}).getPaymentToken();
    if(!token?.payment_token)throw new Error('Não foi possível tokenizar o cartão.');
    return {payment_token:token.payment_token,cartao_mascara:token.card_mask||null,installments:Number(val('card-installments'))||1,customer:{name,cpf:holderDocument,email,phone_number:digits(phone),birth},billing_address:billing};
  }

  async function charge({checkoutToken,payment}){
    if(!payment)return null;
    const key=`fsdelivery_card_attempt_${checkoutToken}`;let requestKey=sessionStorage.getItem(key);if(!requestKey){requestKey=crypto.randomUUID();sessionStorage.setItem(key,requestKey)}
    const {data,error}=await db.functions.invoke('criar-cobranca-cartao-pedido',{body:{slug,checkout_token:checkoutToken,idempotency_key:requestKey,...payment}});
    if(error)throw error;
    const status=data?.cobranca?.pagamento_status;
    if(['recusado','cancelado','estornado','chargeback'].includes(status)){sessionStorage.removeItem(key);throw new Error(status==='recusado'?'Pagamento não autorizado. Revise o cartão ou tente outro.':'O pagamento não pôde ser concluído.');}
    if(data?.sucesso)sessionStorage.removeItem(key);
    return data;
  }

  window.FSDeliveryOnlineCard=Object.freeze({ensureReady,isSelected,prepare,charge});
  let attempts=0;const timer=setInterval(async()=>{attempts++;await ensureReady();if(installPanel()||attempts>40)clearInterval(timer)},150);
})();