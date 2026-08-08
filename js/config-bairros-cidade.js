(()=>{
  'use strict';
  if(window.__fsConfigBairrosCidade)return;
  window.__fsConfigBairrosCidade=true;

  const db=window.supabaseClient;
  const byId=id=>document.getElementById(id);
  const digits=value=>String(value||'').replace(/\D/g,'');
  const decimal=value=>Number(String(value||'').replace(/\./g,'').replace(',','.'))||0;
  const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bii\b/g,'2').replace(/\biii\b/g,'3').replace(/\biv\b/g,'4').replace(/\b(residencial|bairro|jardim|jd|conjunto|cj|loteamento|lot)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

  function feedback(id,message,error=false){
    const node=byId(id);
    if(!node)return;
    node.hidden=false;
    node.className=`feedback${error?' error':''}`;
    node.textContent=message;
  }

  function installStoreAddressUI(){
    const modal=byId('restaurante-config');
    if(!modal||byId('restaurant-cep'))return;
    const panel=modal.querySelector('.config-panel');
    const saveButton=byId('save-restaurant');
    const anchor=panel?.querySelector('.form-grid');
    if(!anchor)return;
    const section=document.createElement('section');
    section.className='config-address-section';
    section.innerHTML=`
      <div class="subsection-head"><div><h3>Endereço da loja</h3><p>O CEP define a cidade usada para sugerir bairros de entrega.</p></div></div>
      <div class="form-grid">
        <div class="field"><label for="restaurant-cep">CEP</label><input id="restaurant-cep" inputmode="numeric" placeholder="00000-000"></div>
        <div class="field"><label for="restaurant-number">Número</label><input id="restaurant-number"></div>
        <div class="field full"><label for="restaurant-street">Rua</label><input id="restaurant-street"></div>
        <div class="field"><label for="restaurant-neighborhood">Bairro</label><input id="restaurant-neighborhood"></div>
        <div class="field"><label for="restaurant-city">Cidade</label><input id="restaurant-city"></div>
        <div class="field"><label for="restaurant-state">UF</label><input id="restaurant-state" maxlength="2"></div>
      </div>
      <div id="restaurant-cep-feedback" class="feedback" hidden></div>`;
    anchor.after(section);

    const fill=()=>{
      if(typeof store==='undefined'||!store)return;
      byId('restaurant-cep').value=store.cep?String(store.cep).replace(/(\d{5})(\d{3})/,'$1-$2'):'';
      byId('restaurant-street').value=store.logradouro||'';
      byId('restaurant-number').value=store.numero||'';
      byId('restaurant-neighborhood').value=store.bairro||'';
      byId('restaurant-city').value=store.cidade||'';
      byId('restaurant-state').value=store.estado||'';
      byId('restaurant-cep').dataset.ibge=store.codigo_ibge||'';
    };
    fill();

    byId('restaurant-cep').addEventListener('input',event=>{
      const value=digits(event.target.value).slice(0,8);
      event.target.value=value.replace(/(\d{5})(\d{0,3})/,'$1-$2').replace(/-$/,'');
      if(value.length===8)lookupStoreCep(value);
    });

    if(saveButton){
      const original=saveButton.onclick;
      saveButton.onclick=async event=>{
        event.preventDefault();
        try{
          if(typeof original==='function')await original.call(saveButton,event);
          await saveStoreAddress();
          feedback('restaurant-cep-feedback','Endereço da loja salvo. A cidade já pode importar bairros.');
        }catch(error){feedback('restaurant-cep-feedback',error.message||'Não foi possível salvar o endereço.',true)}
      };
    }
  }

  async function lookupStoreCep(cep){
    feedback('restaurant-cep-feedback','Buscando endereço...');
    try{
      const response=await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data=await response.json();
      if(!response.ok||data.erro)throw new Error('CEP não encontrado.');
      byId('restaurant-street').value=data.logradouro||'';
      byId('restaurant-neighborhood').value=data.bairro||'';
      byId('restaurant-city').value=data.localidade||'';
      byId('restaurant-state').value=data.uf||'';
      byId('restaurant-cep').dataset.ibge=data.ibge||'';
      feedback('restaurant-cep-feedback','Endereço localizado. Informe o número e salve.');
      byId('restaurant-number').focus();
    }catch(error){feedback('restaurant-cep-feedback',error.message||'Falha ao consultar o CEP.',true)}
  }

  async function saveStoreAddress(){
    if(typeof store==='undefined'||!store?.id)return;
    const payload={
      cep:digits(byId('restaurant-cep')?.value)||null,
      logradouro:byId('restaurant-street')?.value.trim()||null,
      numero:byId('restaurant-number')?.value.trim()||null,
      bairro:byId('restaurant-neighborhood')?.value.trim()||null,
      cidade:byId('restaurant-city')?.value.trim()||null,
      estado:byId('restaurant-state')?.value.trim().toUpperCase()||null,
      codigo_ibge:byId('restaurant-cep')?.dataset.ibge||store.codigo_ibge||null
    };
    const {data,error}=await db.from('estabelecimentos').update(payload).eq('id',store.id).select().single();
    if(error)throw error;
    Object.assign(store,data);
  }

  function installFreeDeliveryUI(){
    const fee=byId('delivery-fee-config');
    if(fee&&!byId('default-free-delivery')){
      const field=fee.closest('.field');
      const label=document.createElement('label');
      label.className='check-row';
      label.innerHTML='<input id="default-free-delivery" type="checkbox"> Entrega grátis como taxa padrão';
      field.appendChild(label);
      const sync=()=>{fee.disabled=byId('default-free-delivery').checked;if(fee.disabled)fee.value='0,00'};
      byId('default-free-delivery').checked=Number(typeof store!=='undefined'?store.taxa_entrega:fee.value)===0;
      byId('default-free-delivery').onchange=sync;
      sync();
    }

    const form=byId('region-form');
    if(form&&!form.querySelector('[name="free"]')){
      const submit=form.querySelector('.team-submit');
      const field=document.createElement('label');
      field.className='check-row field';
      field.innerHTML='<input name="free" type="checkbox"> Entrega grátis';
      submit?.before(field);
      const feeInput=form.querySelector('[name="fee"]');
      field.querySelector('input').onchange=event=>{feeInput.disabled=event.target.checked;if(event.target.checked)feeInput.value='0,00'};
      const original=form.onsubmit;
      form.onsubmit=event=>{
        const free=form.querySelector('[name="free"]').checked;
        if(free){feeInput.disabled=false;feeInput.value='0'}
        const result=typeof original==='function'?original.call(form,event):undefined;
        Promise.resolve(result).finally(()=>{feeInput.disabled=free});
        return result;
      };
    }

    const saveDeliveryButton=byId('save-delivery');
    if(saveDeliveryButton&&!saveDeliveryButton.dataset.fsFreeBound){
      saveDeliveryButton.dataset.fsFreeBound='true';
      const original=saveDeliveryButton.onclick;
      saveDeliveryButton.onclick=event=>{
        const free=byId('default-free-delivery')?.checked;
        const feeInput=byId('delivery-fee-config');
        if(free){feeInput.disabled=false;feeInput.value='0'}
        const result=typeof original==='function'?original.call(saveDeliveryButton,event):undefined;
        Promise.resolve(result).finally(()=>{if(free)feeInput.disabled=true});
        return result;
      };
    }
  }

  function installImportUI(){
    const modal=byId('entrega-config');
    if(!modal||byId('import-city-neighborhoods'))return;
    const head=[...modal.querySelectorAll('.subsection-head')].find(node=>node.textContent.includes('Taxas por região'));
    if(!head)return;
    const actions=document.createElement('div');
    actions.className='inline-actions';
    actions.innerHTML='<button class="btn btn-secondary" id="import-city-neighborhoods" type="button">Buscar bairros da cidade</button>';
    head.appendChild(actions);
    const info=document.createElement('div');
    info.id='city-neighborhoods-feedback';
    info.className='feedback';
    info.hidden=true;
    head.after(info);
    byId('import-city-neighborhoods').onclick=importCityNeighborhoods;
  }

  async function queryNeighborhoods(city,state){
    const safeCity=String(city).replace(/["\\]/g,'');
    const safeState=String(state).replace(/["\\]/g,'');
    const query=`[out:json][timeout:30];area["ISO3166-2"="BR-${safeState}"][admin_level=4]->.uf;area(area.uf)["name"="${safeCity}"][boundary=administrative]->.city;(nwr(area.city)[place~"suburb|neighbourhood|quarter"];);out tags;`;
    const response=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:`data=${encodeURIComponent(query)}`});
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

  async function importCityNeighborhoods(){
    if(typeof store==='undefined'||!store?.id)return;
    const city=String(store.cidade||byId('restaurant-city')?.value||'').trim();
    const state=String(store.estado||byId('restaurant-state')?.value||'').trim().toUpperCase();
    if(!city||!state)return feedback('city-neighborhoods-feedback','Cadastre e salve o CEP da loja antes de buscar bairros.',true);
    const button=byId('import-city-neighborhoods');
    button.disabled=true;button.textContent='Buscando bairros...';
    feedback('city-neighborhoods-feedback',`Buscando bairros de ${city}/${state}...`);
    try{
      const names=await queryNeighborhoods(city,state);
      if(!names.length)throw new Error('Nenhum bairro foi encontrado automaticamente. Você ainda pode cadastrar manualmente.');
      const {data:current,error:currentError}=await db.from('taxas_entrega_regioes').select('*').eq('estabelecimento_id',store.id).order('nome');
      if(currentError)throw currentError;
      const existing=new Set((current||[]).map(item=>normalize(item.nome)));
      const missing=names.filter(name=>!existing.has(normalize(name)));
      if(!missing.length){
        if(typeof regions!=='undefined')regions=current||[];
        renderEditableRegions();
        return feedback('city-neighborhoods-feedback','Todos os bairros encontrados já estão cadastrados.');
      }
      const defaultFee=byId('default-free-delivery')?.checked?0:decimal(byId('delivery-fee-config')?.value);
      let inserted=0,skipped=0;
      for(const nome of missing){
        const {error}=await db.from('taxas_entrega_regioes').insert({estabelecimento_id:store.id,nome,taxa:defaultFee,prazo_adicional:0,ativo:false,origem:'cidade',cidade:city,estado:state});
        if(error){
          if(error.code==='23505'){skipped++;continue}
          throw error;
        }
        inserted++;
      }
      const {data:updated,error:updatedError}=await db.from('taxas_entrega_regioes').select('*').eq('estabelecimento_id',store.id).order('nome');
      if(updatedError)throw updatedError;
      if(typeof regions!=='undefined')regions=updated||[];
      renderEditableRegions();
      const detail=skipped?` ${skipped} duplicado(s) foram ignorados.`:'';
      feedback('city-neighborhoods-feedback',`${inserted} bairros importados.${detail} Eles entram desativados; ative e ajuste as taxas desejadas.`);
    }catch(error){console.error('Falha ao importar bairros:',error);feedback('city-neighborhoods-feedback',error.message||'Não foi possível importar os bairros.',true)}
    finally{button.disabled=false;button.textContent='Buscar bairros da cidade'}
  }

  function renderEditableRegions(){
    const list=byId('region-list');
    if(!list||typeof regions==='undefined')return;
    list.innerHTML=regions.length?regions.map(item=>`<article class="row-card" data-region-row="${escapeHtml(item.id)}"><div class="field"><label>Bairro</label><b>${escapeHtml(item.nome)}</b><small>${item.origem==='cidade'?'Importado da cidade':'Cadastro manual'}</small></div><div class="field"><label>Taxa</label><input data-region-fee inputmode="decimal" value="${Number(item.taxa||0).toFixed(2).replace('.',',')}" ${Number(item.taxa)===0?'disabled':''}></div><div class="field"><label>Prazo adicional</label><input data-region-extra type="number" min="0" value="${Number(item.prazo_adicional)||0}"></div><label class="check-row"><input data-region-free type="checkbox" ${Number(item.taxa)===0?'checked':''}> Entrega grátis</label><label class="check-row"><input data-region-active type="checkbox" ${item.ativo?'checked':''}> Atender este bairro</label><div class="inline-actions"><button class="btn btn-primary" data-save-region type="button">Salvar</button><button class="btn btn-danger" data-delete-region type="button">Excluir</button></div></article>`).join(''):'<div class="empty-state">Nenhum bairro cadastrado.</div>';
    list.querySelectorAll('[data-region-row]').forEach(row=>{
      const free=row.querySelector('[data-region-free]');
      const fee=row.querySelector('[data-region-fee]');
      free.onchange=()=>{fee.disabled=free.checked;if(free.checked)fee.value='0,00'};
      row.querySelector('[data-save-region]').onclick=async()=>{
        const id=row.dataset.regionRow;
        const patch={taxa:free.checked?0:decimal(fee.value),prazo_adicional:Math.max(0,Number(row.querySelector('[data-region-extra]').value)||0),ativo:row.querySelector('[data-region-active]').checked};
        const {data,error}=await db.from('taxas_entrega_regioes').update(patch).eq('id',id).select().single();
        if(error)return alert(error.message);
        const index=regions.findIndex(item=>String(item.id)===String(id));if(index>=0)regions[index]=data;
        renderEditableRegions();
      };
      row.querySelector('[data-delete-region]').onclick=async()=>{
        if(!confirm('Excluir este bairro?'))return;
        const {error}=await db.from('taxas_entrega_regioes').delete().eq('id',row.dataset.regionRow);
        if(error)return alert(error.message);
        regions=regions.filter(item=>String(item.id)!==String(row.dataset.regionRow));
        renderEditableRegions();
      };
    });
  }

  function install(){
    if(typeof store==='undefined'||!store)return false;
    installStoreAddressUI();
    installFreeDeliveryUI();
    installImportUI();
    if(typeof window.renderRegions==='function')window.renderRegions=renderEditableRegions;
    renderEditableRegions();
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{attempts++;if(install()||attempts>100)clearInterval(timer)},100);
})();
