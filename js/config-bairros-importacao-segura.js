(()=>{
  'use strict';
  if(window.__fsConfigBairrosImportacaoSegura)return;
  window.__fsConfigBairrosImportacaoSegura=true;

  const db=window.supabaseClient;
  const byId=id=>document.getElementById(id);
  const decimal=value=>Number(String(value||'').replace(/\./g,'').replace(',','.'))||0;
  const normalize=value=>String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\bii\b/g,'2').replace(/\biii\b/g,'3').replace(/\biv\b/g,'4')
    .replace(/\b(residencial|bairro|jardim|jd|conjunto|cj|loteamento|lot)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

  function feedback(message,error=false){
    const node=byId('city-neighborhoods-feedback');
    if(!node)return;
    node.hidden=false;
    node.className=`feedback${error?' error':''}`;
    node.textContent=message;
  }

  async function queryNeighborhoods(city,state){
    const safeCity=String(city).replace(/["\\]/g,'');
    const safeState=String(state).replace(/["\\]/g,'');
    const query=`[out:json][timeout:30];area["ISO3166-2"="BR-${safeState}"][admin_level=4]->.uf;area(area.uf)["name"="${safeCity}"][boundary=administrative]->.city;(nwr(area.city)[place~"suburb|neighbourhood|quarter"];);out tags;`;
    const response=await fetch('https://overpass-api.de/api/interpreter',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:`data=${encodeURIComponent(query)}`
    });
    if(!response.ok)throw new Error('O serviço de bairros está indisponível. Tente novamente mais tarde.');
    const json=await response.json();
    const unique=new Map();
    for(const element of json.elements||[]){
      const name=String(element.tags?.name||'').trim();
      const key=normalize(name);
      if(name&&key&&!unique.has(key))unique.set(key,name);
    }
    return [...unique.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }

  async function safeImport(){
    if(typeof store==='undefined'||!store?.id)return;
    const city=String(store.cidade||byId('restaurant-city')?.value||'').trim();
    const state=String(store.estado||byId('restaurant-state')?.value||'').trim().toUpperCase();
    if(!city||!state)return feedback('Cadastre e salve o CEP da loja antes de buscar bairros.',true);

    const button=byId('import-city-neighborhoods');
    button.disabled=true;
    button.textContent='Buscando bairros...';
    feedback(`Buscando bairros de ${city}/${state}...`);

    try{
      const names=await queryNeighborhoods(city,state);
      if(!names.length)throw new Error('Nenhum bairro foi encontrado automaticamente. Você ainda pode cadastrar manualmente.');

      const {data:current,error:currentError}=await db
        .from('taxas_entrega_regioes')
        .select('*')
        .eq('estabelecimento_id',store.id)
        .order('nome');
      if(currentError)throw currentError;

      const existing=new Set((current||[]).map(item=>normalize(item.nome)));
      const missing=names.filter(name=>!existing.has(normalize(name)));
      if(!missing.length){
        if(typeof regions!=='undefined')regions=current||[];
        if(typeof window.renderRegions==='function')window.renderRegions();
        return feedback('Todos os bairros encontrados já estão cadastrados.');
      }

      const defaultFee=byId('default-free-delivery')?.checked?0:decimal(byId('delivery-fee-config')?.value);
      let inserted=0;
      let skipped=0;

      for(const nome of missing){
        const {error}=await db.from('taxas_entrega_regioes').insert({
          estabelecimento_id:store.id,
          nome,
          taxa:defaultFee,
          prazo_adicional:0,
          ativo:false,
          origem:'cidade',
          cidade:city,
          estado:state
        });
        if(error){
          if(error.code==='23505'){skipped++;continue}
          throw error;
        }
        inserted++;
      }

      const {data:updated,error:updatedError}=await db
        .from('taxas_entrega_regioes')
        .select('*')
        .eq('estabelecimento_id',store.id)
        .order('nome');
      if(updatedError)throw updatedError;
      if(typeof regions!=='undefined')regions=updated||[];
      if(typeof window.renderRegions==='function')window.renderRegions();

      const detail=skipped?` ${skipped} duplicado(s) foram ignorados.`:'';
      feedback(`${inserted} bairros importados.${detail} Eles entram desativados; ative e configure as taxas desejadas.`);
    }catch(error){
      console.error('Falha ao importar bairros:',error);
      feedback(error?.message||'Não foi possível importar os bairros.',true);
    }finally{
      button.disabled=false;
      button.textContent='Buscar bairros da cidade';
    }
  }

  function install(){
    const button=byId('import-city-neighborhoods');
    if(!button)return false;
    button.onclick=safeImport;
    button.dataset.fsSafeImport='true';
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    if(install()||attempts>100)clearInterval(timer);
  },100);
})();
