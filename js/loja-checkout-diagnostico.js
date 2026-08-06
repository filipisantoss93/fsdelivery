(()=>{
  'use strict';
  if(window.__fsCheckoutDiagnostico)return;
  window.__fsCheckoutDiagnostico=true;

  const params=new URLSearchParams(location.search);
  const byId=id=>document.getElementById(id);
  const token=()=>{
    const key=`fsdelivery_checkout_${params.get('loja')||'public'}_${params.get('mesa')||'online'}`;
    let value=sessionStorage.getItem(key);
    if(!value){value=crypto.randomUUID();sessionStorage.setItem(key,value)}
    return value;
  };
  const safe=value=>String(value??'').slice(0,500);

  async function log(etapa,mensagem='',detalhes={}){
    try{
      await window.supabaseClient?.rpc('registrar_checkout_publico_log',{payload:{
        slug:params.get('loja')||'',checkout_token:token(),etapa,mensagem:safe(mensagem),
        detalhes,user_agent:navigator.userAgent
      }});
    }catch(error){console.warn('Falha ao registrar diagnóstico do checkout:',error)}
  }

  function modalFeedback(message,type='error'){
    const form=byId('checkout-form');
    if(!form)return;
    let node=byId('checkout-inline-feedback');
    if(!node){
      node=document.createElement('div');
      node.id='checkout-inline-feedback';
      node.className='feedback';
      node.setAttribute('role','alert');
      node.setAttribute('aria-live','assertive');
      form.prepend(node);
    }
    node.hidden=false;
    node.className=`feedback${type==='error'?' error':''}`;
    node.textContent=message;
    node.scrollIntoView({behavior:'smooth',block:'center'});
  }

  function install(){
    const form=byId('checkout-form');
    const button=byId('submit-order-btn');
    if(!form||!button)return false;
    if(form.dataset.fsCheckoutDiagnostic==='true')return true;
    form.dataset.fsCheckoutDiagnostic='true';

    button.addEventListener('click',()=>log('clique_botao','Botão Revisar e enviar pedido acionado',{
      disabled:button.disabled,form_valid:form.checkValidity(),tipo:byId('delivery-type')?.value||'',
      cep:byId('customer-cep')?.value||'',bairro:byId('delivery-neighborhood')?.value||''
    }),true);

    form.addEventListener('submit',()=>log('submit_disparado','Evento submit recebido pelo formulário',{
      form_valid:form.checkValidity(),tipo:byId('delivery-type')?.value||''
    }),true);

    form.addEventListener('invalid',event=>{
      const field=event.target;
      const message=field.validationMessage||'Campo obrigatório inválido.';
      log('campo_invalido',message,{id:field.id||'',name:field.name||'',value:safe(field.value)});
      modalFeedback(message);
    },true);

    window.addEventListener('error',event=>log('erro_javascript',event.message,{arquivo:event.filename||'',linha:event.lineno||0,coluna:event.colno||0}));
    window.addEventListener('unhandledrejection',event=>log('promessa_rejeitada',event.reason?.message||String(event.reason||'Erro assíncrono')));
    log('diagnostico_instalado','Diagnóstico do checkout carregado');
    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{tries++;if(install()||tries>50)clearInterval(timer)},100);
})();