const db=window.supabaseClient;
const params=new URLSearchParams(location.search);
const slug=params.get('loja');
const numero=Number(params.get('mesa'));
const token=params.get('token');
const statusElement=document.getElementById('mesa-status');

async function init(){
  if(!slug||!numero||!token)return fail('QR Code incompleto ou inválido.');
  const {data:store,error:storeError}=await db.from('estabelecimentos').select('id,slug').eq('slug',slug).maybeSingle();
  if(storeError||!store)return fail('Estabelecimento não encontrado.');
  const {data:table,error}=await db.from('mesas').select('id,numero,nome,codigo_qr,ativo').eq('estabelecimento_id',store.id).eq('numero',numero).eq('codigo_qr',token).eq('ativo',true).maybeSingle();
  if(error||!table)return fail('Esta mesa está inativa ou o QR Code não é mais válido.');
  statusElement.textContent=`Mesa ${String(table.numero).padStart(2,'0')} identificada. Abrindo o cardápio...`;
  location.replace(`loja.html?loja=${encodeURIComponent(slug)}&mesa=${encodeURIComponent(table.codigo_qr)}`);
}

function fail(message){statusElement.textContent=message;statusElement.style.color='var(--danger)'}
init();