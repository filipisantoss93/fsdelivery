const db=window.supabaseClient;
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const decimal=value=>Number(String(value||'').replace(/\./g,'').replace(',','.'))||0;
let session,user,store,orders=[],team=[];
const byId=id=>document.getElementById(id);

async function init(){
  const {data:{session:s}}=await db.auth.getSession();
  if(!s){location.replace('auth.html');return}
  session=s;user=s.user;
  const {data:est,error}=await db.from('estabelecimentos').select('*').eq('usuario_id',user.id).single();
  if(error||!est){alert('Não foi possível carregar o estabelecimento.');return}
  store=est;
  const [ordersResult,teamResult]=await Promise.all([
    db.from('pedidos').select('id,status,total,created_at').eq('estabelecimento_id',store.id).order('created_at',{ascending:false}),
    db.from('equipe_operacional').select('*').eq('estabelecimento_id',store.id).order('created_at',{ascending:false})
  ]);
  orders=ordersResult.data||[];
  team=teamResult.data||[];
  fillStore();renderTeam();renderReports();bindActions();openRequestedSection();
}

function fillStore(){
  byId('delivery-fee-config').value=String(store.taxa_entrega||0).replace('.',',');
  byId('minimum-order-config').value=String(store.pedido_minimo||0).replace('.',',');
  byId('delivery-min-config').value=store.tempo_entrega_min??30;
  byId('delivery-max-config').value=store.tempo_entrega_max??45;
  byId('restaurant-name').value=store.nome||'';
  byId('restaurant-phone').value=store.telefone||'';
  byId('restaurant-category').value=store.categoria||'Restaurante';
  byId('restaurant-description').value=store.descricao||'';
  byId('restaurant-open').checked=Boolean(store.aberto);
  byId('restaurant-status-title').textContent=store.aberto?'Loja aberta':'Loja fechada';
  byId('profile-email').textContent=user.email||'—';
}

function bindActions(){
  document.querySelectorAll('[data-target]').forEach(button=>button.onclick=()=>byId(button.dataset.target)?.scrollIntoView({behavior:'smooth',block:'start'}));
  document.querySelectorAll('[data-link]').forEach(button=>button.onclick=()=>location.href=button.dataset.link);
  byId('restaurant-open').onchange=e=>byId('restaurant-status-title').textContent=e.target.checked?'Loja aberta':'Loja fechada';
  byId('save-delivery').onclick=saveDelivery;
  byId('save-restaurant').onclick=saveRestaurant;
  document.querySelectorAll('.team-form').forEach(form=>form.onsubmit=saveTeamMember);
  byId('logout-config').onclick=async()=>{await db.auth.signOut();location.replace('auth.html')};
  byId('delete-account-config').onclick=async()=>{if(!confirm('Excluir permanentemente a conta e todos os dados?'))return;const {error}=await db.functions.invoke('delete-account',{body:{confirm:true}});if(error)return alert('Não foi possível excluir a conta.');await db.auth.signOut();location.replace('auth.html')};
}

async function saveDelivery(){
  const min=Math.max(0,Number(byId('delivery-min-config').value)||0);
  const max=Math.max(min,Number(byId('delivery-max-config').value)||min);
  const payload={taxa_entrega:decimal(byId('delivery-fee-config').value),pedido_minimo:decimal(byId('minimum-order-config').value),tempo_entrega_min:min,tempo_entrega_max:max};
  const {data,error}=await db.from('estabelecimentos').update(payload).eq('id',store.id).select().single();
  if(error)return alert(error.message);store=data;alert('Configurações de entrega salvas.');
}

async function saveRestaurant(){
  const payload={nome:byId('restaurant-name').value.trim(),telefone:byId('restaurant-phone').value.trim(),categoria:byId('restaurant-category').value,descricao:byId('restaurant-description').value.trim(),aberto:byId('restaurant-open').checked};
  if(!payload.nome)return alert('Informe o nome do estabelecimento.');
  const {data,error}=await db.from('estabelecimentos').update(payload).eq('id',store.id).select().single();
  if(error)return alert(error.message);store=data;fillStore();alert('Dados do restaurante salvos.');
}

async function saveTeamMember(event){
  event.preventDefault();
  const section=event.currentTarget.closest('[data-team-role]');
  const role=section.dataset.teamRole;
  const form=new FormData(event.currentTarget);
  const pin=String(form.get('pin')||'').replace(/\D/g,'');
  if(pin.length<4||pin.length>6)return alert('O PIN deve ter entre 4 e 6 números.');
  const payload={estabelecimento_id:store.id,nome:String(form.get('name')).trim(),telefone:String(form.get('phone')).trim(),pin,funcao:role,ativo:true};
  const {data,error}=await db.from('equipe_operacional').insert(payload).select().single();
  if(error)return alert(error.message);
  team.unshift(data);event.currentTarget.reset();renderTeam();
}

function renderTeam(){
  document.querySelectorAll('[data-team-role]').forEach(section=>{
    const role=section.dataset.teamRole;
    const items=team.filter(member=>member.funcao===role);
    section.querySelector('.team-list').innerHTML=items.length?items.map(member=>`<div class="row-card team-member"><div><b>${member.nome}</b><small>${member.telefone} • PIN ${member.pin}</small></div><div class="inline-actions"><button class="btn btn-secondary" data-toggle-team="${member.id}">${member.ativo?'Desativar':'Ativar'}</button><button class="btn btn-danger" data-delete-team="${member.id}">Excluir</button></div></div>`).join(''):'<div class="empty-state">Nenhum cadastro nesta função.</div>';
  });
  document.querySelectorAll('[data-toggle-team]').forEach(button=>button.onclick=async()=>{const member=team.find(item=>item.id===button.dataset.toggleTeam);const {error}=await db.from('equipe_operacional').update({ativo:!member.ativo,updated_at:new Date().toISOString()}).eq('id',member.id);if(error)return alert(error.message);member.ativo=!member.ativo;renderTeam()});
  document.querySelectorAll('[data-delete-team]').forEach(button=>button.onclick=async()=>{const member=team.find(item=>item.id===button.dataset.deleteTeam);if(!confirm(`Excluir ${member.nome}?`))return;const {error}=await db.from('equipe_operacional').delete().eq('id',member.id);if(error)return alert(error.message);team=team.filter(item=>item.id!==member.id);renderTeam()});
}

function renderReports(){
  const valid=orders.filter(order=>order.status!=='cancelado');
  const revenue=valid.reduce((sum,order)=>sum+Number(order.total||0),0);
  const done=valid.filter(order=>order.status==='entregue');
  const received=done.reduce((sum,order)=>sum+Number(order.total||0),0);
  byId('report-revenue').textContent=money(revenue);
  byId('report-ticket').textContent=money(revenue/(valid.length||1));
  byId('report-received').textContent=money(received);
  byId('report-pending').textContent=money(revenue-received);
  byId('report-orders').textContent=valid.length;
  byId('report-new').textContent=valid.filter(order=>order.status==='novo').length;
  byId('report-preparing').textContent=valid.filter(order=>order.status==='preparo').length;
  byId('report-done').textContent=done.length;
}

function openRequestedSection(){
  const id=location.hash.slice(1);
  if(id)requestAnimationFrame(()=>byId(id)?.scrollIntoView({block:'start'}));
}

init();