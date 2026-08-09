(()=>{
  'use strict';
  if(window.FSCustomerOrderAccess)return;

  const storage=window.localStorage;
  const cleanSlug=value=>String(value||'').trim().toLowerCase();
  const digits=value=>String(value||'').replace(/\D/g,'');
  const normalizePhone=value=>{
    const raw=digits(value);
    if((raw.length===12||raw.length===13)&&raw.startsWith('55'))return raw.slice(2);
    if((raw.length===11||raw.length===12)&&raw.startsWith('0'))return raw.slice(1);
    return raw;
  };
  const validPhone=value=>/^\d{10,11}$/.test(normalizePhone(value));
  const normalizeRecoveryCode=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const formatRecoveryCode=value=>{
    const code=normalizeRecoveryCode(value).slice(0,10);
    return code.length>5?`${code.slice(0,5)}-${code.slice(5)}`:code;
  };
  const randomCharacters=(alphabet,length)=>{
    if(!window.crypto?.getRandomValues)throw new Error('Navegador sem gerador seguro de credenciais.');
    const output=[];
    while(output.length<length){
      const bytes=new Uint8Array(Math.max(16,(length-output.length)*2));
      window.crypto.getRandomValues(bytes);
      for(const byte of bytes){
        if(byte>=Math.floor(256/alphabet.length)*alphabet.length)continue;
        output.push(alphabet[byte%alphabet.length]);
        if(output.length===length)break;
      }
    }
    return output.join('');
  };
  const createDeviceToken=()=>randomCharacters('0123456789abcdef',64);
  const createRecoveryCode=()=>randomCharacters('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',10);
  const keys={
    phone:slug=>`fsdelivery_customer_phone_${cleanSlug(slug)}`,
    token:(slug,phone)=>`fsdelivery_customer_token_${cleanSlug(slug)}_${normalizePhone(phone)}`,
    lastOrder:slug=>`fsdelivery_last_order_${cleanSlug(slug)||'public'}`,
    recovery:(slug,code)=>`fsdelivery_order_recovery_${cleanSlug(slug)}_${String(code||'').trim().toUpperCase()}`
  };
  const read=(key,fallback=null)=>{
    try{const value=storage.getItem(key);return value===null?fallback:JSON.parse(value)}catch{return fallback}
  };
  const write=(key,value)=>{
    try{storage.setItem(key,JSON.stringify(value));return true}catch{return false}
  };
  const readText=key=>{try{return storage.getItem(key)||''}catch{return''}};
  const writeText=(key,value)=>{try{storage.setItem(key,String(value));return true}catch{return false}};
  const ensureDeviceToken=(slug,phone)=>{
    const key=keys.token(slug,phone);
    const current=readText(key).toLowerCase();
    if(/^[0-9a-f]{64}$/.test(current))return current;
    const token=createDeviceToken();
    if(!writeText(key,token))throw new Error('Não foi possível salvar a autorização neste aparelho.');
    return token;
  };
  const saveRecoveryCode=(slug,orderCode,recoveryCode)=>{
    const code=normalizeRecoveryCode(recoveryCode);
    if(code.length!==10)return false;
    return write(keys.recovery(slug,orderCode),{codigo:code,atualizado_em:new Date().toISOString()});
  };
  const readRecoveryCode=(slug,orderCode)=>normalizeRecoveryCode(read(keys.recovery(slug,orderCode),{})?.codigo);
  const normalizeStatus=value=>{
    const key=String(value||'aguardando_aprovacao').toLowerCase().trim().replace(/[\s-]+/g,'_');
    return({novo:'aguardando_aprovacao',aceito:'confirmado',em_preparo:'preparo',andamento:'preparo',aguardando_retirada:'pronto',aguardando_entregador:'pronto',em_entrega:'saiu_entrega',em_rota:'saiu_entrega',saiu_para_entrega:'saiu_entrega',entregue:'finalizado',concluido:'finalizado','concluído':'finalizado'})[key]||key;
  };
  const statusFor=order=>{
    const type=String(order?.tipo||'entrega').toLowerCase();
    let status=normalizeStatus(order?.status);
    const delivery=normalizeStatus(order?.status_entrega||'');
    if(status==='rejeitado')return{key:status,step:-1,label:'Pedido não aprovado',tone:'error',terminal:true,labels:[]};
    if(status==='cancelado')return{key:status,step:-1,label:'Pedido cancelado',tone:'error',terminal:true,labels:[]};
    if(type==='entrega'&&delivery==='finalizado')status='finalizado';
    if(type==='entrega'&&delivery==='saiu_entrega'&&!['finalizado','cancelado'].includes(status))status='saiu_entrega';

    const labels=type==='entrega'
      ?['Aguardando aprovação','Pedido aprovado','Em preparo','Aguardando entregador','Saiu para entrega','Pedido entregue']
      :type==='mesa'||type==='local'
        ?['Aguardando aprovação','Pedido aprovado','Em preparo','Pronto para servir','Pedido servido','Pedido concluído']
        :['Aguardando aprovação','Pedido aprovado','Em preparo','Pronto para retirada','Pedido retirado'];
    const steps={aguardando_aprovacao:0,confirmado:1,preparo:2,pronto:3,servido:4,saiu_entrega:4,finalizado:labels.length-1};
    const step=steps[status]??0;
    const label=labels[Math.min(step,labels.length-1)]||'Aguardando atualização';
    const terminal=status==='finalizado';
    const tone=terminal?'success':status==='aguardando_aprovacao'?'warning':status==='pronto'?'warning':'info';
    return{key:status,step,label,tone,terminal,labels};
  };
  const paymentFor=order=>{
    const status=String(order?.pagamento_status||'').toLowerCase();
    if(['pago','paid','settled'].includes(status))return{label:'Pagamento confirmado',tone:'success'};
    if(['autorizado','approved'].includes(status))return{label:'Pagamento autorizado',tone:'success'};
    if(['em_analise','new','waiting','pending'].includes(status))return{label:'Pagamento em processamento',tone:'warning'};
    if(['recusado','unpaid','canceled','cancelado','refunded','estornado','chargeback'].includes(status))return{label:'Pagamento não confirmado',tone:'error'};
    return{label:String(order?.forma_pagamento||'Pagamento no atendimento'),tone:'neutral'};
  };

  window.FSCustomerOrderAccess=Object.freeze({
    normalizePhone,
    validPhone,
    normalizeRecoveryCode,
    formatRecoveryCode,
    createRecoveryCode,
    createDeviceToken,
    ensureDeviceToken,
    saveRecoveryCode,
    readRecoveryCode,
    statusFor,
    paymentFor,
    keys,
    read,
    write,
    readText,
    writeText
  });
})();
