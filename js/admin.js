const db=window.supabaseClient;
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
const date=value=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
let stores=[],subscriptions=[],orders=[],products=[],customers=[];

async function initAdmin(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){location.replace('auth.html');return}
  const role=session.user.app_metadata?.role;
  if(role!=='admin'){
    await db.auth.refreshSession();
    const {data:{session:refreshed}}=await db.auth.getSession();
    if(refreshed?.user?.app_metadata?.role!=='admin'){location.replace('app.html');return}
  }
  bindAdminNavigation();
  bindAdminActions();
  await loadAdminData();
}

async function loadAdminData(){
  setFeedback('Carregando dados administrativos...');
  const results=await Promise.all([
    db.from('estabelecimentos').select('*').order('created_at',{ascending:false}),
    db.from('assinaturas').select('*').order('created_at',{ascending:false}),
    db.from('pedidos').select('id,estabelecimento_id,status,total,created_at').order('created_at',{ascending:false}),
    db.from('produtos').select('id,estabelecimento_id,ativo'),
    db.from('clientes').select('id,estabelecimento_id')
  ]);
  const firstError=results.find(result=>result.error)?.error;
  if(firstError){setFeedback(`Não foi possível carregar o painel: ${firstError.message}`,true);return}
  [stores,subscriptions,orders,products,customers]=results.map(result=>result.data||[]);
  setFeedback('');
  renderAdmin();
}

function renderAdmin(){
  const validOrders=orders.filter(order=>order.status!=='cancelado');
  const delivered=validOrders.filter(order=>order.status==='entregue');
  const totalRevenue=validOrders.reduce((sum,order)=>sum+Number(order.total||0),0);
  const deliveredRevenue=delivered.reduce((sum,order)=>sum+Number(order.total||0),0);
  const activeSubscriptions=subscriptions.filter(item=>['ativa','active','pago','paid'].includes(String(item.status||'').toLowerCase()));
  const mrr=activeSubscriptions.reduce((sum,item)=>sum+(Number(item.preco_contratado_centavos||0)/100)/Math.max(Number(item.periodicidade_meses||1),1),0);

  text('admin-stores',stores.length);
  text('admin-subscriptions',activeSubscriptions.length);
  text('admin-orders',orders.length);
  text('admin-revenue',money(totalRevenue));
  text('admin-open-stores',stores.filter(store=>store.aberto).length);
  text('admin-active-products',products.filter(product=>product.ativo).length);
  text('admin-customers',customers.length);
  text('admin-ticket',money(totalRevenue/(validOrders.length||1)));
  text('admin-finance-revenue',money(totalRevenue));
  text('admin-finance-received',money(deliveredRevenue));
  text('admin-finance-pending',money(totalRevenue-deliveredRevenue));
  text('admin-mrr',money(mrr));

  document.getElementById('admin-recent-stores').innerHTML=stores.slice(0,5).map(store=>`<article class="row-card"><div class="order-main"><b>${escapeHtml(store.nome||'Sem nome')}</b><small>${escapeHtml(store.categoria||'Sem categoria')} • ${date(store.created_at)}</small></div><span class="status ${store.aberto?'pronto':'cancelado'}">${store.aberto?'Aberta':'Fechada'}</span></article>`).join('')||'<div class="empty-state">Nenhum estabelecimento cadastrado.</div>';
  renderStores();
  renderSubscriptions();
}

function renderStores(){
  const query=(document.getElementById('admin-store-search').value||'').trim().toLowerCase();
  const filter=document.getElementById('admin-store-filter').value;
  const subscriptionByStore=new Map(subscriptions.map(item=>[item.estabelecimento_id,item]));
  const list=stores.filter(store=>{
    const haystack=[store.nome,store.slug,store.categoria,store.telefone].filter(Boolean).join(' ').toLowerCase();
    if(query&&!haystack.includes(query))return false;
    const subscription=subscriptionByStore.get(store.id);
    if(filter==='aberta'&&!store.aberto)return false;
    if(filter==='fechada'&&store.aberto)return false;
    if(filter==='ativa'&&!['ativa','active','pago','paid'].includes(String(subscription?.status||store.assinatura_status||'').toLowerCase()))return false;
    return true;
  });
  document.getElementById('admin-store-table').innerHTML=list.map(store=>{
    const subscription=subscriptionByStore.get(store.id);
    const status=subscription?.status||store.assinatura_status||'sem assinatura';
    return `<tr><td><b>${escapeHtml(store.nome||'Sem nome')}</b><br><small>${escapeHtml(store.slug||'')}</small></td><td>${escapeHtml(store.categoria||'—')}</td><td>${escapeHtml(store.plano||'—')}</td><td><span class="status ${store.aberto?'pronto':'cancelado'}">${escapeHtml(status)}</span></td><td>${date(store.created_at)}</td></tr>`;
  }).join('')||'<tr><td colspan="5">Nenhum estabelecimento encontrado.</td></tr>';
}

function renderSubscriptions(){
  const storeNames=new Map(stores.map(store=>[store.id,store.nome]));
  document.getElementById('admin-subscription-table').innerHTML=subscriptions.map(item=>`<tr><td>${escapeHtml(storeNames.get(item.estabelecimento_id)||'Conta sem estabelecimento')}</td><td>${escapeHtml(item.status||'—')}</td><td>${money(Number(item.preco_contratado_centavos||0)/100)}</td><td>${date(item.proxima_cobranca_em||item.acesso_valido_ate)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma assinatura cadastrada.</td></tr>';
}

function bindAdminNavigation(){
  document.querySelectorAll('[data-admin-page]').forEach(button=>button.onclick=()=>{
    const target=button.dataset.adminPage;
    document.querySelectorAll('.page').forEach(page=>page.classList.toggle('active',page.id===target));
    document.querySelectorAll('[data-admin-page]').forEach(item=>item.classList.toggle('active',item.dataset.adminPage===target));
    document.getElementById('admin-page-title').textContent=target==='visao-geral'?'Visão geral':target[0].toUpperCase()+target.slice(1);
    window.scrollTo(0,0);
  });
}

function bindAdminActions(){
  document.getElementById('admin-refresh').onclick=loadAdminData;
  document.getElementById('admin-store-search').oninput=renderStores;
  document.getElementById('admin-store-filter').onchange=renderStores;
  document.getElementById('admin-logout').onclick=async()=>{await db.auth.signOut();location.replace('auth.html')};
  document.getElementById('admin-export').onclick=exportCsv;
}

function exportCsv(){
  const storeNames=new Map(stores.map(store=>[store.id,store.nome]));
  const rows=[['Estabelecimento','Status','Valor','Próxima cobrança'],...subscriptions.map(item=>[storeNames.get(item.estabelecimento_id)||'',item.status||'',Number(item.preco_contratado_centavos||0)/100,item.proxima_cobranca_em||item.acesso_valido_ate||''])];
  const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(';')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download=`fs-delivery-financeiro-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function text(id,value){document.getElementById(id).textContent=value}
function setFeedback(message,error=false){const el=document.getElementById('admin-feedback');el.className=message?`feedback${error?' error':''}`:'';el.textContent=message}
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}

initAdmin();