(()=>{
  const button=document.getElementById('notification-button');
  const panel=document.getElementById('notification-panel');
  const list=document.getElementById('notification-list');
  const badge=document.getElementById('notification-badge');
  const markAll=document.getElementById('notification-mark-all');
  if(!button||!panel||!list||!badge)return;

  let items=[];
  let channel=null;
  let loading=false;

  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const relativeTime=value=>{
    const minutes=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));
    if(minutes<1)return'Agora';if(minutes<60)return`${minutes} min`;if(minutes<1440)return`${Math.floor(minutes/60)}h`;return new Date(value).toLocaleDateString('pt-BR');
  };

  function render(){
    const unread=items.filter(item=>!item.lida).length;
    badge.textContent=unread>9?'9+':String(unread);
    badge.classList.toggle('show',unread>0);
    list.innerHTML=items.length?items.map(item=>`<button class="notification-item ${item.lida?'':'unread'}" data-notification="${item.id}" data-order="${item.pedido_id||''}"><span class="notification-dot"></span><span class="notification-copy"><b>${escapeHtml(item.titulo)}</b><small>${escapeHtml(item.mensagem)} • ${relativeTime(item.created_at)}</small></span></button>`).join(''):'<div class="notification-empty">Nenhuma notificação no momento.</div>';
    list.querySelectorAll('[data-notification]').forEach(item=>item.onclick=()=>openNotification(item));
  }

  async function load(){
    if(loading||typeof db==='undefined'||typeof store==='undefined'||!store?.id)return;
    loading=true;
    try{
      const result=await db.from('notificacoes_operacionais').select('id,pedido_id,titulo,mensagem,lida,lida_em,created_at').eq('estabelecimento_id',store.id).in('destinatario',['admin','caixa']).order('created_at',{ascending:false}).limit(30);
      if(result.error)throw result.error;
      items=result.data||[];render();
    }catch(error){console.warn('Notificações operacionais indisponíveis:',error)}finally{loading=false}
  }

  async function openNotification(element){
    const id=element.dataset.notification,orderId=Number(element.dataset.order);
    const item=items.find(entry=>String(entry.id)===String(id));
    if(item&&!item.lida){
      item.lida=true;item.lida_em=new Date().toISOString();render();
      await db.from('notificacoes_operacionais').update({lida:true,lida_em:item.lida_em}).eq('id',id);
    }
    panel.classList.remove('open');button.setAttribute('aria-expanded','false');
    if(orderId&&typeof openPage==='function'&&typeof openOrder==='function'){
      openPage('pedidos');openOrder(orderId);
    }
  }

  async function markEverything(){
    const ids=items.filter(item=>!item.lida).map(item=>item.id);if(!ids.length)return;
    const value=new Date().toISOString();items.forEach(item=>{if(ids.includes(item.id)){item.lida=true;item.lida_em=value}});render();
    await db.from('notificacoes_operacionais').update({lida:true,lida_em:value}).in('id',ids);
  }

  function subscribe(){
    if(channel||typeof store==='undefined'||!store?.id)return;
    channel=db.channel(`operational-notifications-${store.id}`).on('postgres_changes',{event:'*',schema:'public',table:'notificacoes_operacionais',filter:`estabelecimento_id=eq.${store.id}`},load).subscribe();
  }

  function setup(){
    if(typeof db==='undefined'||typeof store==='undefined'||!store?.id)return setTimeout(setup,250);
    load();subscribe();
  }

  button.onclick=event=>{event.stopPropagation();const open=panel.classList.toggle('open');button.setAttribute('aria-expanded',String(open));if(open)load()};
  panel.onclick=event=>event.stopPropagation();
  document.addEventListener('click',()=>{panel.classList.remove('open');button.setAttribute('aria-expanded','false')});
  markAll?.addEventListener('click',markEverything);
  setup();
})();

(()=>{const script=document.createElement('script');script.src='js/operational-admin.js';script.onerror=()=>console.error('Falha ao carregar painel operacional.');document.body.appendChild(script)})();
