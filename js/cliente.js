(()=>{
const db=window.supabaseClient;
const params=new URLSearchParams(location.search);
const slug=params.get('loja');
const requestedPhone=params.get('telefone')||'';
const requestedOrder=params.get('pedido')||'';
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const labels={novo:'Recebido',confirmado:'Confirmado',preparo:'Em preparo',pronto:'Pronto',saiu_entrega:'Saiu para entrega',entregue:'Entregue',cancelado:'Cancelado'};
const normalize=value=>String(value||'').replace(/\D/g,'');
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const container=document.getElementById('customer-orders');
const form=document.getElementById('customer-lookup-form');
const modal=document.getElementById('customer-order-modal');
let orders=[];

function addressLabel(order){
 const address=order.endereco_entrega;
 if(!address)return order.tipo==='retirada'?'Retirada no estabelecimento':order.tipo==='local'?'Consumo no local':order.tipo==='mesa'?'Pedido na mesa':'Não informado';
 if(typeof address==='string')return address;
 if(address.texto)return String(address.texto);
 return [address.endereco,address.logradouro,address.numero,address.complemento,address.bairro,address.cidade,address.referencia].filter(Boolean).join(', ')||'Não informado';
}

function render(){
 container.innerHTML=orders.length?`<div class="page-head"><div><h2>Seus pedidos</h2><p>${orders.length} pedido(s) encontrado(s) nos últimos 90 dias.</p></div></div><div class="customer-order-grid">${orders.map(order=>`<article class="customer-order-card" data-id="${escapeHtml(order.id)}"><div><small>Pedido #${escapeHtml(order.codigo||order.id)} • ${new Date(order.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</small><h3>${escapeHtml(labels[order.status]||order.status)}</h3><p>${(order.itens||[]).map(item=>`${item.quantidade}x ${escapeHtml(item.nome)}`).join(' • ')}</p></div><strong>${money(order.total)}</strong></article>`).join('')}</div>`:'<div class="empty-state"><h3>Nenhum pedido encontrado</h3><p>Confira o WhatsApp informado ou faça seu primeiro pedido.</p><a class="btn btn-primary" href="loja.html?loja='+encodeURIComponent(slug||'')+'">Abrir cardápio</a></div>';
 container.querySelectorAll('[data-id]').forEach(element=>element.onclick=()=>openOrder(element.dataset.id));
}

function openOrder(id){
 const order=orders.find(item=>String(item.id)===String(id)||String(item.codigo).toLowerCase()===String(id).toLowerCase());
 if(!order)return;
 document.getElementById('customer-order-title').textContent=`Pedido #${order.codigo||order.id}`;
 const progress=['novo','confirmado','preparo','pronto',...(order.tipo==='entrega'?['saiu_entrega']:[]),'entregue'];
 const current=progress.indexOf(order.status);
 const cancelled=order.status==='cancelado';
 const progressHtml=cancelled?'<div class="empty-state"><h3>Pedido cancelado</h3><p>Este pedido não seguirá para as próximas etapas.</p></div>':`<div class="order-progress">${progress.map((status,index)=>`<div class="${current>=index?'done':''}"><span></span><small>${escapeHtml(labels[status])}</small></div>`).join('')}</div>`;
 document.getElementById('customer-order-detail').innerHTML=`${progressHtml}<div class="receipt"><p><b>Destino:</b> ${escapeHtml(addressLabel(order))}</p><p><b>Pagamento:</b> ${escapeHtml(order.forma_pagamento||'Não informado')}</p>${(order.itens||[]).map(item=>`<div class="receipt-line"><span>${item.quantidade}x ${escapeHtml(item.nome)}${item.observacoes?`<small>${escapeHtml(item.observacoes)}</small>`:''}</span><b>${money(item.total)}</b></div>`).join('')}<div class="receipt-total"><span>Total</span><b>${money(order.total)}</b></div></div>`;
 modal.classList.add('open');document.body.style.overflow='hidden';
}

async function lookup(phone){
 if(!slug){container.innerHTML='<div class="empty-state"><h3>Loja não informada</h3><p>Abra esta página pelo link do cardápio.</p></div>';return;}
 const normalized=normalize(phone);
 if(normalized.length<10||normalized.length>11){container.innerHTML='<div class="empty-state">Informe um WhatsApp válido.</div>';return;}
 localStorage.setItem(`fsdelivery_customer_phone_${slug}`,normalized);
 container.innerHTML='<div class="empty-state">Consultando pedidos...</div>';
 const {data,error}=await db.rpc('consultar_pedidos_cliente',{p_slug:slug,p_telefone:normalized});
 if(error){console.error(error);container.innerHTML='<div class="empty-state">Não foi possível consultar os pedidos. Tente novamente.</div>';return;}
 orders=data||[];render();
 if(requestedOrder)openOrder(requestedOrder);
}

form.onsubmit=event=>{event.preventDefault();lookup(document.getElementById('lookup-phone').value)};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{modal.classList.remove('open');document.body.style.overflow=''});
if(slug){
 document.querySelectorAll('a[href="loja.html"]').forEach(link=>link.href=`loja.html?loja=${encodeURIComponent(slug)}`);
 const saved=requestedPhone||localStorage.getItem(`fsdelivery_customer_phone_${slug}`);
 if(saved){document.getElementById('lookup-phone').value=saved;lookup(saved)}
}
})();