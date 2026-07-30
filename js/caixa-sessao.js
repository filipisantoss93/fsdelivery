(()=>{
  const db=window.supabaseClient;
  const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);

  function configurarAprovacao(){
    if(typeof openStatuses==='undefined'||typeof labels==='undefined'||typeof showOrder!=='function')return setTimeout(configurarAprovacao,100);
    if(!openStatuses.includes('aguardando_aprovacao'))openStatuses.unshift('aguardando_aprovacao');
    labels.aguardando_aprovacao='Aguardando aprovação';

    const originalShowOrder=showOrder;
    showOrder=function(id){
      originalShowOrder(id);
      let button=document.getElementById('approve-order');
      if(!button){
        button=document.createElement('button');
        button.id='approve-order';
        button.className='btn btn-primary';
        button.textContent='Aprovar pedido';
        document.getElementById('charge-order')?.before(button);
      }
      const waiting=selected?.status==='aguardando_aprovacao';
      button.style.display=waiting?'inline-flex':'none';
      document.getElementById('charge-order').style.display=waiting?'none':document.getElementById('charge-order').style.display;
      button.onclick=async()=>{
        if(!selected||selected.status!=='aguardando_aprovacao')return;
        if(!confirm('Aprovar este pedido e enviar para a cozinha?'))return;
        button.disabled=true;
        button.textContent='Aprovando...';
        const {error}=await db.rpc('aprovar_pedido_caixa',{p_pedido_id:Number(selected.id)});
        button.disabled=false;
        button.textContent='Aprovar pedido';
        if(error)return alert(error.message||'Não foi possível aprovar o pedido.');
        close();
        await refresh();
      };
    };
    render();
  }

  async function setup(){
    if(typeof store==='undefined'||!store)return setTimeout(setup,200);
    const {data:cfg}=await db.from('configuracoes_operacionais').select('exige_abertura_caixa').eq('estabelecimento_id',store.id).maybeSingle();
    const {data:openCash}=await db.from('caixas').select('*').eq('estabelecimento_id',store.id).eq('status','aberto').order('aberto_em',{ascending:false}).limit(1).maybeSingle();
    const head=document.querySelector('.topbar-actions'),status=head.querySelector('.status');
    status.id='cash-session-status';status.textContent=openCash?'Caixa aberto':'Caixa fechado';status.className=`status ${openCash?'pronto':'cancelado'}`;
    const button=document.createElement('button');button.className=openCash?'btn btn-danger':'btn btn-primary';button.textContent=openCash?'Fechar caixa':'Abrir caixa';head.insertBefore(button,head.lastElementChild);
    button.onclick=async()=>{
      if(openCash){
        const value=prompt('Valor final contado no caixa:',String(document.getElementById('m-paid').textContent||'0').replace(/[^0-9,]/g,''));if(value===null)return;
        const obs=prompt('Observação do fechamento (opcional):','')||'';
        const {error}=await db.rpc('fechar_caixa',{p_estabelecimento:store.id,p_valor:Number(String(value).replace('.','').replace(',','.'))||0,p_obs:obs});
        if(error)return alert(error.message);location.reload();
      }else{
        const value=prompt('Valor inicial do caixa:','0,00');if(value===null)return;
        const {error}=await db.rpc('abrir_caixa',{p_estabelecimento:store.id,p_valor:Number(String(value).replace('.','').replace(',','.'))||0});
        if(error)return alert(error.message);location.reload();
      }
    };
    if(cfg?.exige_abertura_caixa&&!openCash){
      document.querySelectorAll('#charge-order,.page-head .btn-primary').forEach(el=>{el.disabled=true;el.title='Abra o caixa para realizar vendas'});
      document.querySelector('.page-head p').textContent='Abra o caixa para liberar novos pedidos e recebimentos.';
    }
  }

  configurarAprovacao();
  setup();
})();