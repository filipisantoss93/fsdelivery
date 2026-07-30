const db=window.supabaseClient;
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const decimal=value=>Number(String(value||'').replace(/\./g,'').replace(',','.'))||0;
const byId=id=>document.getElementById(id);
const normalizePhone=value=>String(value||'').replace(/\D/g,'');
const days=['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const paymentCatalog=['PIX','Cartão de crédito','Cartão de débito','Dinheiro','Vale-refeição'];
let session,user,store,orders=[],team=[],operational={},hours=[],regions=[];

async function init(){
  const {data:{session:s}}=await db.auth.getSession();
  if(!s){location.replace('auth.html');return}
  session=s;user=s.user;
  const {data:est,error}=await db.from('estabelecimentos').select('*').eq('usuario_id',user.id).single();
  if(error||!est){alert('Não foi possível carregar o estabelecimento.');return}
  store=est;
  const [ordersResult,teamResult,opResult,hoursResult,regionsResult]=await Promise.all([
    db.from('pedidos').select('id,status,total,created_at').eq('estabelecimento_id',store.id).order('created_at',{ascending:false}),
    db.from('equipe_operacional').select('*').eq('estabelecimento_id',store.id).order('created_at',{ascending:false}),
    db.from('configuracoes_operacionais').select('*').eq('estabelecimento_id',store.id).maybeSingle(),
    db.from('horarios_funcionamento').select('*').eq('estabelecimento_id',store.id).order('dia_semana'),
    db.from('taxas_entrega_regioes').select('*').eq('estabelecimento_id',store.id).order('nome')
  ]);
  orders=ordersResult.data||[];team=teamResult.data||[];operational=opResult.data||{estabelecimento_id:store.id};hours=hoursResult.data||[];regions=regionsResult.data||[];
  fillStore();renderTeam();renderReports();renderHours();renderPayments();renderRegions();renderOperationalLinks();bindActions();openRequestedSection();
}

function fillStore(){
  byId('delivery-fee-config').value=String(store.taxa_entrega||0).replace('.',',');
  byId('minimum-order-config').value=String(store.pedido_minimo||0).replace('.',',');
  byId('delivery-min-config').value=store.tempo_entrega_min??30;
  byId('delivery-max-config').value=store.tempo_entrega_max??45;
  byId('restaurant-name').value=store.nome||'';byId('restaurant-phone').value=store.telefone||'';byId('restaurant-category').value=store.categoria||'Restaurante';byId('restaurant-description').value=store.descricao||'';byId('restaurant-logo').value=store.logo_url||'';byId('restaurant-banner').value=store.banner_url||'';byId('restaurant-open').checked=Boolean(store.aberto);byId('restaurant-status-title').textContent=store.aberto?'Loja aberta':'Loja fechada';
  byId('profile-email').textContent=user.email||'—';byId('plan-name').textContent=store.plano||'Teste';byId('plan-status').textContent=store.assinatura_status||'Trial';
  byId('printer-name').value=operational.impressora_nome||'';byId('auto-print').checked=Boolean(operational.impressao_automatica);byId('sound-orders').checked=operational.som_novo_pedido!==false;byId('browser-notifications').checked=operational.notificacao_navegador!==false;byId('service-fee').value=String(operational.taxa_servico_percentual||0).replace('.',',');byId('coupons-active').checked=Boolean(operational.cupons_ativos);byId('manual-discount').checked=Boolean(operational.permite_desconto_manual);byId('require-cash-open').checked=Boolean(operational.exige_abertura_caixa);byId('waiter-cancel').checked=Boolean(operational.permite_garcom_cancelar);byId('waiter-discount').checked=Boolean(operational.permite_garcom_desconto);byId('delivery-see-values').checked=Boolean(operational.permite_entregador_ver_valores);
}

function renderOperationalLinks(){
  const shortcuts=document.querySelector('.config-shortcuts');
  if(!shortcuts||byId('operational-links'))return;
  const publicPath=store.slug?`loja.html?loja=${encodeURIComponent(store.slug)}`:'loja.html';
  const links=[
    {label:'Página pública',path:publicPath},
    {label:'Cozinha',path:'cozinha.html'},
    {label:'Garçom',path:'garcom.html'},
    {label:'Entrega',path:'entregador.html'}
  ];
  const section=document.createElement('section');
  section.id='operational-links';
  section.className='panel';
  section.setAttribute('aria-labelledby','operational-links-title');
  section.innerHTML=`<div class="panel-head"><div><h2 id="operational-links-title">Links de acesso</h2><p>Copie ou abra cada página para conferir o acesso.</p></div></div><div class="form-grid">${links.map((item,index)=>{const url=new URL(item.path,location.href).href;return `<div class="field full"><label for="operational-link-${index}">${item.label}</label><div class="inline-actions operational-link-actions"><input id="operational-link-${index}" value="${url}" readonly aria-label="Link de acesso da área ${item.label}"><button class="btn btn-secondary" type="button" data-copy-operational-link="operational-link-${index}">Copiar</button><a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener">Abrir</a></div></div>`}).join('')}</div>`;
  shortcuts.insertAdjacentElement('afterend',section);
  section.querySelectorAll('[data-copy-operational-link]').forEach(button=>button.onclick=()=>copyOperationalLink(button));
}

async function copyOperationalLink(button){
  const input=byId(button.dataset.copyOperationalLink);
  if(!input)return;
  try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(input.value);
    else{input.focus();input.select();document.execCommand('copy');input.setSelectionRange(0,0)}
    const original=button.textContent;button.textContent='Copiado';button.disabled=true;
    setTimeout(()=>{button.textContent=original;button.disabled=false},1600);
  }catch(error){
    input.focus();input.select();
    alert('Não foi possível copiar automaticamente. O link foi selecionado para cópia manual.');
  }
}

function openConfigModal(id){
  const modal=byId(id);
  if(!modal||modal.tagName!=='DIALOG')return;
  document.querySelectorAll('.config-modal[open]').forEach(item=>{if(item!==modal)item.close()});
  if(!modal.open)modal.showModal();
  document.body.classList.add('config-modal-open');
  history.replaceState(null,'',`#${id}`);
}
function closeConfigModal(modal){if(!modal)return;modal.close();document.body.classList.remove('config-modal-open');history.replaceState(null,'',location.pathname+location.search)}
function bindActions(){
  document.querySelectorAll('[data-target]').forEach(button=>button.onclick=()=>openConfigModal(button.dataset.target));
  document.querySelectorAll('.config-modal-close').forEach(button=>button.onclick=()=>closeConfigModal(button.closest('dialog')));
  document.querySelectorAll('.config-modal').forEach(modal=>{modal.addEventListener('click',event=>{if(event.target===modal)closeConfigModal(modal)});modal.addEventListener('close',()=>{if(!document.querySelector('.config-modal[open]'))document.body.classList.remove('config-modal-open')})});
  byId('restaurant-open').onchange=e=>byId('restaurant-status-title').textContent=e.target.checked?'Loja aberta':'Loja fechada';
  byId('save-delivery').onclick=saveDelivery;byId('save-restaurant').onclick=saveRestaurant;byId('save-hours').onclick=saveHours;byId('save-payments').onclick=savePayments;byId('save-print').onclick=()=>saveOperational({impressora_nome:byId('printer-name').value.trim(),impressao_automatica:byId('auto-print').checked},'Configurações de impressão salvas.');byId('save-notifications').onclick=saveNotifications;byId('save-cash').onclick=saveCashRules;
  byId('region-form').onsubmit=saveRegion;document.querySelectorAll('.team-form').forEach(form=>form.onsubmit=saveTeamMember);
  ['waiter-cancel','waiter-discount','delivery-see-values'].forEach(id=>byId(id).onchange=savePermissions);
  byId('logout-config').onclick=async()=>{await db.auth.signOut();location.replace('auth.html')};
  byId('delete-account-config').onclick=async()=>{if(!confirm('Excluir permanentemente a conta e todos os dados?'))return;const {error}=await db.functions.invoke('delete-account',{body:{confirm:true}});if(error)return alert('Não foi possível excluir a conta.');await db.auth.signOut();location.replace('auth.html')};
}
async function saveOperational(patch,message){const payload={...operational,...patch,estabelecimento_id:store.id,updated_at:new Date().toISOString()};const {data,error}=await db.from('configuracoes_operacionais').upsert(payload,{onConflict:'estabelecimento_id'}).select().single();if(error)return alert(error.message);operational=data;fillStore();if(message)alert(message)}
async function saveDelivery(){const min=Math.max(0,Number(byId('delivery-min-config').value)||0),max=Math.max(min,Number(byId('delivery-max-config').value)||min);const payload={taxa_entrega:decimal(byId('delivery-fee-config').value),pedido_minimo:decimal(byId('minimum-order-config').value),tempo_entrega_min:min,tempo_entrega_max:max};const {data,error}=await db.from('estabelecimentos').update(payload).eq('id',store.id).select().single();if(error)return alert(error.message);store=data;alert('Configurações de entrega salvas.')}
async function saveRestaurant(){const payload={nome:byId('restaurant-name').value.trim(),telefone:byId('restaurant-phone').value.trim(),categoria:byId('restaurant-category').value,descricao:byId('restaurant-description').value.trim(),logo_url:byId('restaurant-logo').value.trim()||null,banner_url:byId('restaurant-banner').value.trim()||null,aberto:byId('restaurant-open').checked};if(!payload.nome)return alert('Informe o nome do estabelecimento.');const {data,error}=await db.from('estabelecimentos').update(payload).eq('id',store.id).select().single();if(error)return alert(error.message);store=data;fillStore();alert('Dados do restaurante salvos.')}
function renderHours(){const map=new Map(hours.map(item=>[Number(item.dia_semana),item]));byId('hours-list').innerHTML=days.map((name,index)=>{const h=map.get(index)||{dia_semana:index,aberto:true,abertura:'08:00:00',fechamento:'22:00:00'};return `<div class="hours-row" data-day="${index}"><label class="switch"><input class="day-open" type="checkbox" ${h.aberto?'checked':''}><span></span></label><b>${name}</b><input class="day-start" type="time" value="${String(h.abertura||'08:00').slice(0,5)}"><span>até</span><input class="day-end" type="time" value="${String(h.fechamento||'22:00').slice(0,5)}"></div>`}).join('')}
async function saveHours(){const payload=[...document.querySelectorAll('.hours-row')].map(row=>({estabelecimento_id:store.id,dia_semana:Number(row.dataset.day),aberto:row.querySelector('.day-open').checked,abertura:row.querySelector('.day-start').value||null,fechamento:row.querySelector('.day-end').value||null}));const {data,error}=await db.from('horarios_funcionamento').upsert(payload,{onConflict:'estabelecimento_id,dia_semana'}).select();if(error)return alert(error.message);hours=data||payload;alert('Horários salvos.')}
function renderPayments(){const selected=new Set(Array.isArray(operational.formas_pagamento)?operational.formas_pagamento:paymentCatalog.slice(0,4));byId('payment-options').innerHTML=paymentCatalog.map(item=>`<label class="option-card"><input type="checkbox" value="${item}" ${selected.has(item)?'checked':''}><span><b>${item}</b><small>Disponível no checkout</small></span></label>`).join('')}
async function savePayments(){const values=[...byId('payment-options').querySelectorAll('input:checked')].map(input=>input.value);if(!values.length)return alert('Selecione ao menos uma forma de pagamento.');await saveOperational({formas_pagamento:values},'Formas de pagamento salvas.');renderPayments()}
async function saveNotifications(){if(byId('browser-notifications').checked&&'Notification' in window&&Notification.permission==='default')await Notification.requestPermission();await saveOperational({som_novo_pedido:byId('sound-orders').checked,notificacao_navegador:byId('browser-notifications').checked},'Notificações salvas.')}
async function saveCashRules(){await saveOperational({taxa_servico_percentual:decimal(byId('service-fee').value),cupons_ativos:byId('coupons-active').checked,permite_desconto_manual:byId('manual-discount').checked,exige_abertura_caixa:byId('require-cash-open').checked},'Regras de caixa salvas.')}
async function savePermissions(){await saveOperational({permite_garcom_cancelar:byId('waiter-cancel').checked,permite_garcom_desconto:byId('waiter-discount').checked,permite_entregador_ver_valores:byId('delivery-see-values').checked})}
async function saveRegion(event){event.preventDefault();const form=new FormData(event.currentTarget);const payload={estabelecimento_id:store.id,nome:String(form.get('name')).trim(),taxa:decimal(form.get('fee')),prazo_adicional:Math.max(0,Number(form.get('extra'))||0),ativo:true};const {data,error}=await db.from('taxas_entrega_regioes').insert(payload).select().single();if(error)return alert(error.message);regions.push(data);event.currentTarget.reset();renderRegions()}
function renderRegions(){byId('region-list').innerHTML=regions.length?regions.map(item=>`<div class="row-card"><div><b>${item.nome}</b><small>${money(item.taxa)} • +${item.prazo_adicional||0} min</small></div><div class="inline-actions"><button class="btn btn-secondary" data-toggle-region="${item.id}">${item.ativo?'Desativar':'Ativar'}</button><button class="btn btn-danger" data-delete-region="${item.id}">Excluir</button></div></div>`).join(''):'<div class="empty-state">Nenhuma região específica cadastrada.</div>';document.querySelectorAll('[data-toggle-region]').forEach(button=>button.onclick=async()=>{const item=regions.find(r=>r.id===button.dataset.toggleRegion);const {error}=await db.from('taxas_entrega_regioes').update({ativo:!item.ativo}).eq('id',item.id);if(error)return alert(error.message);item.ativo=!item.ativo;renderRegions()});document.querySelectorAll('[data-delete-region]').forEach(button=>button.onclick=async()=>{if(!confirm('Excluir esta região?'))return;const {error}=await db.from('taxas_entrega_regioes').delete().eq('id',button.dataset.deleteRegion);if(error)return alert(error.message);regions=regions.filter(r=>r.id!==button.dataset.deleteRegion);renderRegions()})}
function renderTeam(){document.querySelectorAll('[data-team-role]').forEach(section=>{const role=section.dataset.teamRole;section.querySelector('.team-list').innerHTML=team.filter(item=>item.funcao===role).map(item=>`<div class="row-card"><div><b>${item.nome}</b><small>${item.telefone}</small></div><button class="btn btn-danger" data-delete-team="${item.id}">Excluir</button></div>`).join('')||'<div class="empty-state">Nenhum cadastro.</div>'});document.querySelectorAll('[data-delete-team]').forEach(button=>button.onclick=async()=>{const {error}=await db.from('equipe_operacional').delete().eq('id',button.dataset.deleteTeam);if(error)return alert(error.message);team=team.filter(item=>item.id!==button.dataset.deleteTeam);renderTeam()})}
async function saveTeamMember(event){event.preventDefault();const section=event.currentTarget.closest('[data-team-role]'),form=new FormData(event.currentTarget);const payload={estabelecimento_id:store.id,funcao:section.dataset.teamRole,nome:String(form.get('name')).trim(),telefone:normalizePhone(form.get('phone')),pin:String(form.get('pin')).trim(),ativo:true};const {data,error}=await db.from('equipe_operacional').insert(payload).select().single();if(error)return alert(error.message);team.unshift(data);event.currentTarget.reset();renderTeam()}
function renderReports(){const valid=orders.filter(item=>item.status!=='cancelado'),revenue=valid.reduce((sum,item)=>sum+Number(item.total||0),0),received=valid.filter(item=>['entregue','finalizado'].includes(item.status)).reduce((sum,item)=>sum+Number(item.total||0),0);byId('report-revenue').textContent=money(revenue);byId('report-ticket').textContent=money(revenue/(valid.length||1));byId('report-received').textContent=money(received);byId('report-pending').textContent=money(revenue-received);byId('report-orders').textContent=valid.length;byId('report-new').textContent=valid.filter(item=>item.status==='novo').length;byId('report-preparing').textContent=valid.filter(item=>item.status==='preparo').length;byId('report-done').textContent=valid.filter(item=>['entregue','finalizado'].includes(item.status)).length}
function openRequestedSection(){const id=location.hash.slice(1);if(id)openConfigModal(id)}
init();