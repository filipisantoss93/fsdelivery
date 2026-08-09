import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

class MemoryStorage{
  #values=new Map();
  getItem(key){return this.#values.has(String(key))?this.#values.get(String(key)):null}
  setItem(key,value){this.#values.set(String(key),String(value))}
  removeItem(key){this.#values.delete(String(key))}
}

class ClassList{
  #values=new Set();
  constructor(...values){values.forEach(value=>this.#values.add(value))}
  contains(value){return this.#values.has(value)}
  add(value){this.#values.add(value)}
  remove(value){this.#values.delete(value)}
}

class TestElement extends EventTarget{
  constructor(id='',document=null){
    super();
    this.id=id;
    this.ownerDocument=document;
    this.textContent='';
    this.innerHTML='';
    this.value='';
    this.href='';
    this.className='';
    this.classList=new ClassList();
    this.style={};
    this.dataset={};
  }
  querySelector(selector){return selector==='.modal-card'?this.modalCard:null}
  querySelectorAll(){return[]}
  appendChild(child){this.ownerDocument?.register(child);return child}
  closest(){return null}
}

class TestDocument extends EventTarget{
  constructor(){super();this.readyState='complete';this.visibilityState='visible';this.body={style:{}};this.elements=new Map()}
  register(element){if(element.id)this.elements.set(element.id,element);return element}
  getElementById(id){return this.elements.get(id)||null}
  createElement(){return new TestElement('',this)}
}

const helperSource=await readFile(new URL('../js/customer-order-access.js',import.meta.url),'utf8');
const postOrderSource=await readFile(new URL('../js/loja-pos-envio.js',import.meta.url),'utf8');
const document=new TestDocument();
const form=document.register(new TestElement('checkout-form',document));
const modal=document.register(new TestElement('success-modal',document));
modal.classList.add('open');
modal.modalCard=new TestElement('success-card',document);
document.register(new TestElement('success-message',document));
document.register(new TestElement('track-order-link',document));
const phone=document.register(new TestElement('customer-phone',document));
phone.value='+55 (11) 99999-8888';

const calls=[];
const order={
  codigo:'PED-TESTE',status:'aguardando_aprovacao',status_entrega:'aguardando',tipo:'retirada',
  subtotal:29.9,taxa_entrega:0,total:29.9,forma_pagamento:'PIX',pagamento_status:'pendente',
  created_at:new Date().toISOString(),atualizado_em:new Date().toISOString(),itens:[{nome:'Lanche',quantidade:1,total:29.9}]
};
const db={
  async rpc(name,args){
    calls.push({name,args});
    if(name==='vincular_pedido_dispositivo')return{data:{vinculado:true,pedido:'PED-TESTE'},error:null};
    if(name==='consultar_pedidos_cliente')return{data:[order],error:null};
    throw new Error(`RPC inesperada: ${name}`);
  }
};
const localStorage=new MemoryStorage();
const sessionStorage=new MemoryStorage();
class TestCustomEvent extends Event{constructor(type,options={}){super(type);this.detail=options.detail}}
let timerId=0;
const windowEvents=new EventTarget();
const context={
  window:null,document,location:{pathname:'/loja',search:'?loja=fs-lanches'},URLSearchParams,
  localStorage,sessionStorage,crypto:webcrypto,navigator:{clipboard:{writeText:async()=>{}}},
  Intl,Date,FormData:class{get(){return''}},CustomEvent:TestCustomEvent,Event,EventTarget,
  console,setTimeout:()=>++timerId,clearTimeout:()=>{},
  addEventListener:(...args)=>windowEvents.addEventListener(...args),
  removeEventListener:(...args)=>windowEvents.removeEventListener(...args),
  dispatchEvent:(...args)=>windowEvents.dispatchEvent(...args),
  FSDeliveryRoute:{matchesPage:page=>page==='loja'},supabaseClient:db
};
context.window=context;
vm.createContext(context);
vm.runInContext(helperSource,context,{filename:'customer-order-access.js'});

assert.equal(context.FSCustomerOrderAccess.normalizePhone('+55 (11) 99999-8888'),'11999998888','DDI +55 deve virar o mesmo identificador do número local');
assert.equal(context.FSCustomerOrderAccess.normalizePhone('011 99999-8888'),'11999998888','zero de operadora deve ser removido');
assert.equal(context.FSCustomerOrderAccess.statusFor({status:'pronto',tipo:'retirada'}).label,'Pronto para retirada');
assert.equal(context.FSCustomerOrderAccess.statusFor({status:'finalizado',tipo:'retirada'}).label,'Pedido retirado');

vm.runInContext(postOrderSource,context,{filename:'loja-pos-envio.js'});
const proof={slug:'fs-lanches',telefone:'+55 (11) 99999-8888',checkoutToken:'11111111-1111-4111-8111-111111111111',codigo:'PED-TESTE'};
document.dispatchEvent(new TestCustomEvent('fs:public-order-completed',{detail:proof}));
await new Promise(resolve=>setImmediate(resolve));
await new Promise(resolve=>setImmediate(resolve));

assert.equal(calls[0]?.name,'vincular_pedido_dispositivo','o próprio evento de conclusão deve iniciar o vínculo');
assert.equal(calls[0]?.args.p_checkout_token,proof.checkoutToken);
assert.match(calls[0]?.args.p_token,/^[0-9a-f]{64}$/,'o token do aparelho deve ter alta entropia e formato validado');
assert.match(calls[0]?.args.p_codigo_recuperacao,/^[A-Z0-9]{10}$/,'o pedido deve receber código de recuperação');
assert.equal(calls[1]?.name,'consultar_pedidos_cliente','o acompanhamento deve consultar o pedido logo após o vínculo');
assert.equal(calls[1]?.args.p_telefone,'11999998888');
assert.equal(document.getElementById('success-message').textContent,'Pedido #PED-TESTE enviado com sucesso.');
assert.match(document.getElementById('track-order-link').href,/cliente\?loja=fs-lanches&pedido=PED-TESTE/);

const saved=JSON.parse(localStorage.getItem('fsdelivery_last_order_fs-lanches'));
assert.equal(saved.vinculado,true,'o estado local deve registrar o vínculo concluído');
assert.equal('checkoutToken' in saved,false,'o checkout token deve ser removido após o consumo');
assert.equal(saved.telefone,'11999998888');
assert.match(saved.recoveryCode,/^[A-Z0-9]{10}$/);
assert.equal(localStorage.getItem('fsdelivery_customer_phone_fs-lanches'),'11999998888');

console.log('Fluxo comportamental de rastreamento aprovado: evento → vínculo → consulta → persistência segura.');
