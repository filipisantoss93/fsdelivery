const db=window.supabaseClient;
let store=null;
let tables=[];
const qrInstances=new Map();

const bellSvg=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16h14M7 16c0-5 2-8 5-8s5 3 5 8M10 7h4M12 4v3M4 19h16" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const escapeHtml=window.FSRuntime.escapeHtml;
const publicTableUrl=table=>`${location.origin}/mesa.html?loja=${encodeURIComponent(store.slug)}&mesa=${encodeURIComponent(table.numero)}&token=${encodeURIComponent(table.codigo_qr)}`;
const nextAvailableNumber=()=>{let number=1;const used=new Set(tables.map(table=>Number(table.numero)));while(used.has(number))number++;return number};

async function init(){
  const context=await window.FSRuntime.requireOwnedStore();if(!context)return;
  store=context.store;
  bindActions();
  await loadTables();
}

async function loadTables(){
  const {data,error}=await db.from('mesas').select('*').eq('estabelecimento_id',store.id).order('numero');
  if(error){document.getElementById('tables-grid').innerHTML=`<div class="empty-state qr-empty">${escapeHtml(error.message)}</div>`;return}
  tables=data||[];
  render();
  suggestNextNumber();
}

function suggestNextNumber(){
  const input=document.getElementById('table-number');
  if(input&&!input.value)input.value=nextAvailableNumber();
}

function render(){
  const grid=document.getElementById('tables-grid');
  qrInstances.clear();
  if(!tables.length){grid.innerHTML='<div class="empty-state qr-empty">Nenhuma mesa cadastrada.</div>';return}
  grid.innerHTML=tables.map(table=>`
    <article class="panel table-admin-card" data-table-card="${table.id}" data-table-number="${table.numero}">
      <div class="table-admin-head">
        <div><h2>${escapeHtml(table.nome||`Mesa ${table.numero}`)}</h2><small>Mesa ${String(table.numero).padStart(2,'0')}</small></div>
        <label class="switch" title="Ativar ou desativar mesa"><input type="checkbox" data-toggle="${table.id}" ${table.ativo?'checked':''}><span></span></label>
      </div>
      <div class="qr-plate" id="plate-${table.id}">
        <div class="qr-table-title">MESA <span style="color:var(--primary)">${String(table.numero).padStart(2,'0')}</span></div>
        <div class="qr-instruction">ESCANEIE PARA PEDIR</div>
        <div class="qr-box"><div class="qr-code" id="qr-${table.id}"></div><div class="qr-bell">${bellSvg}</div></div>
        <div class="qr-brand"><span>FS</span> DELIVERY</div>
        <div class="qr-tagline">RÁPIDO, FÁCIL E PRÁTICO</div>
        <div class="qr-wave"></div>
      </div>
      <div class="table-actions">
        <button class="btn btn-secondary" type="button" data-png="${table.id}">Baixar PNG</button>
        <button class="btn btn-secondary" type="button" data-svg="${table.id}">Baixar SVG</button>
        <button class="btn btn-secondary" type="button" data-print="${table.id}">Imprimir</button>
        <button class="btn btn-secondary" type="button" data-regenerate="${table.id}">Novo QR</button>
        <button class="btn btn-danger" type="button" data-delete="${table.id}">Excluir</button>
      </div>
    </article>`).join('');

  if(typeof QRCode!=='function'){
    document.querySelectorAll('.qr-code').forEach(element=>element.innerHTML='<div class="qr-error">Falha ao carregar o gerador de QR Code. Atualize a página.</div>');
  }else{
    tables.forEach(table=>{
      try{
        const instance=new QRCode(document.getElementById(`qr-${table.id}`),{text:publicTableUrl(table),width:720,height:720,colorDark:'#111111',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});
        qrInstances.set(String(table.id),instance);
      }catch(error){
        console.error('Falha ao gerar QR Code:',error);
        document.getElementById(`qr-${table.id}`).innerHTML='<div class="qr-error">Não foi possível gerar este QR Code.</div>';
      }
    });
  }
  bindCardActions();
}

function bindActions(){
  document.getElementById('table-form').onsubmit=async event=>{
    event.preventDefault();
    const number=Number(document.getElementById('table-number').value);
    const name=document.getElementById('table-name').value.trim()||`Mesa ${number}`;
    const existing=tables.find(table=>Number(table.numero)===number);
    if(existing){
      alert(`A Mesa ${String(number).padStart(2,'0')} já está cadastrada. Use outro número.`);
      document.querySelector(`[data-table-number="${number}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});
      document.getElementById('table-number').focus();
      return;
    }
    const {error}=await db.from('mesas').insert({estabelecimento_id:store.id,numero:number,nome:name,codigo_qr:crypto.randomUUID().replaceAll('-',''),ativo:true});
    if(error){
      if(error.code==='23505'||String(error.message).includes('mesas_estabelecimento_id_numero_key')){
        alert(`A Mesa ${String(number).padStart(2,'0')} já está cadastrada. Use outro número.`);
        await loadTables();
        document.getElementById('table-number').focus();
        return;
      }
      alert('Não foi possível criar a mesa. Tente novamente.');
      console.error('Falha ao criar mesa:',error);
      return;
    }
    event.currentTarget.reset();
    await loadTables();
    document.getElementById('table-name').focus();
  };
  document.getElementById('new-table-focus').onclick=()=>{document.getElementById('table-number').value=nextAvailableNumber();document.getElementById('table-name').focus()};
  document.getElementById('print-all').onclick=()=>window.print();
}

function bindCardActions(){
  document.querySelectorAll('[data-toggle]').forEach(input=>input.onchange=async()=>{
    const {error}=await db.from('mesas').update({ativo:input.checked}).eq('id',input.dataset.toggle);
    if(error){input.checked=!input.checked;alert(error.message)}
  });
  document.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{
    const table=tables.find(item=>String(item.id)===button.dataset.delete);
    if(!confirm(`Excluir ${table.nome||`Mesa ${table.numero}`}?`))return;
    const {error}=await db.from('mesas').delete().eq('id',table.id);
    if(error)return alert(error.message);
    await loadTables();
  });
  document.querySelectorAll('[data-regenerate]').forEach(button=>button.onclick=async()=>{
    if(!confirm('O QR Code anterior deixará de funcionar. Continuar?'))return;
    const {error}=await db.from('mesas').update({codigo_qr:crypto.randomUUID().replaceAll('-','')}).eq('id',button.dataset.regenerate);
    if(error)return alert(error.message);
    await loadTables();
  });
  document.querySelectorAll('[data-png]').forEach(button=>button.onclick=()=>downloadPng(button.dataset.png));
  document.querySelectorAll('[data-svg]').forEach(button=>button.onclick=()=>downloadSvg(button.dataset.svg));
  document.querySelectorAll('[data-print]').forEach(button=>button.onclick=()=>printOne(button.dataset.print));
}

function qrCanvas(id){return document.querySelector(`#qr-${CSS.escape(String(id))} canvas`)}
function downloadPng(id){
  const table=tables.find(item=>String(item.id)===String(id));
  const source=qrCanvas(id);
  if(!table||!source)return alert('O QR Code ainda não foi gerado. Atualize a página e tente novamente.');
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle='#ff7a1a';ctx.lineWidth=12;ctx.strokeRect(30,30,1020,1290);
  ctx.fillStyle='#17110d';ctx.textAlign='center';ctx.font='900 88px Inter, sans-serif';ctx.fillText(`MESA ${String(table.numero).padStart(2,'0')}`,540,135);
  ctx.font='900 40px Inter, sans-serif';ctx.fillText('ESCANEIE PARA PEDIR',540,220);
  ctx.drawImage(source,135,270,810,810);
  ctx.fillStyle='#ff7a1a';ctx.font='900 italic 68px Inter, sans-serif';ctx.fillText('FS',405,1170);
  ctx.fillStyle='#17110d';ctx.fillText(' DELIVERY',650,1170);
  ctx.font='500 24px Inter, sans-serif';ctx.fillText('RÁPIDO, FÁCIL E PRÁTICO',540,1225);
  ctx.fillStyle='#ff7a1a';ctx.fillRect(30,1270,1020,50);
  const link=document.createElement('a');link.download=`fs-delivery-mesa-${String(table.numero).padStart(2,'0')}.png`;link.href=canvas.toDataURL('image/png');link.click();
}

function downloadSvg(id){
  const table=tables.find(item=>String(item.id)===String(id));
  const instance=qrInstances.get(String(id));
  const modules=instance?._oQRCode?.modules;
  if(!table||!modules?.length)return alert('O QR Code ainda não foi gerado. Atualize a página e tente novamente.');
  const count=modules.length,qrSize=810,cell=qrSize/count;
  let paths='';
  modules.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)paths+=`<rect x="${(135+x*cell).toFixed(3)}" y="${(270+y*cell).toFixed(3)}" width="${cell.toFixed(3)}" height="${cell.toFixed(3)}"/>`}));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#fff"/><rect x="30" y="30" width="1020" height="1290" fill="none" stroke="#ff7a1a" stroke-width="12"/><text x="540" y="140" text-anchor="middle" font-family="Inter,Arial" font-size="88" font-weight="900" fill="#17110d">MESA <tspan fill="#ff7a1a">${String(table.numero).padStart(2,'0')}</tspan></text><text x="540" y="225" text-anchor="middle" font-family="Inter,Arial" font-size="40" font-weight="900" fill="#17110d">ESCANEIE PARA PEDIR</text><g fill="#111">${paths}</g><text x="540" y="1170" text-anchor="middle" font-family="Inter,Arial" font-size="68" font-weight="900" font-style="italic"><tspan fill="#ff7a1a">FS</tspan><tspan fill="#17110d"> DELIVERY</tspan></text><text x="540" y="1225" text-anchor="middle" font-family="Inter,Arial" font-size="24" fill="#4d4036">RÁPIDO, FÁCIL E PRÁTICO</text><rect x="30" y="1270" width="1020" height="50" fill="#ff7a1a"/></svg>`;
  const blob=new Blob([svg],{type:'image/svg+xml'});const link=document.createElement('a');link.download=`fs-delivery-mesa-${String(table.numero).padStart(2,'0')}.svg`;link.href=URL.createObjectURL(blob);link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

function printOne(id){document.querySelectorAll('[data-table-card]').forEach(card=>card.classList.toggle('print-hidden',card.dataset.tableCard!==id));window.print();document.querySelectorAll('.print-hidden').forEach(card=>card.classList.remove('print-hidden'))}

init();
