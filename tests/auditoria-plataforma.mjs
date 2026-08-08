import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const list=(directory,extension)=>{
  const walk=current=>fs.readdirSync(path.join(root,directory,current),{withFileTypes:true}).flatMap(entry=>{
    const relative=path.posix.join(current,entry.name);
    return entry.isDirectory()?walk(relative):entry.name.endsWith(extension)?[relative]:[];
  });
  return walk('').sort();
};
const failures=[];
const check=(condition,message)=>{if(!condition)failures.push(message)};

function splitTopLevel(value,separator){
  const parts=[];
  let start=0,quote='',round=0,square=0;
  for(let index=0;index<value.length;index++){
    const char=value[index];
    if(quote){if(char==='\\')index++;else if(char===quote)quote='';continue}
    if(char==='"'||char==="'"){quote=char;continue}
    if(char==='(')round++;
    else if(char===')')round=Math.max(0,round-1);
    else if(char==='[')square++;
    else if(char===']')square=Math.max(0,square-1);
    else if(char===separator&&!round&&!square){parts.push(value.slice(start,index));start=index+1}
  }
  parts.push(value.slice(start));
  return parts;
}

function findClosingBrace(css,opening){
  let depth=1,quote='';
  for(let index=opening+1;index<css.length;index++){
    const char=css[index];
    if(quote){if(char==='\\')index++;else if(char===quote)quote='';continue}
    if(char==='"'||char==="'"){quote=char;continue}
    if(char==='{')depth++;
    else if(char==='}'&&!--depth)return index;
  }
  return -1;
}

function declarations(body){
  const values=[];
  for(const chunk of splitTopLevel(body,';')){
    const item=chunk.trim();
    if(!item)continue;
    const colon=splitTopLevel(item,':');
    if(colon.length<2)continue;
    const property=colon.shift().trim().toLowerCase();
    if(property&&!property.startsWith('@'))values.push(property);
  }
  return values;
}

function auditCss(file){
  const css=read(`css/${file}`).replace(/\/\*[\s\S]*?\*\//g,'');
  const seen=new Set();
  const containers=/^@(media|supports|container|layer|keyframes|-webkit-keyframes|document)\b/i;
  const walk=(source,context='root')=>{
    let cursor=0;
    while(cursor<source.length){
      let brace=-1,semicolon=-1,quote='',round=0;
      for(let index=cursor;index<source.length;index++){
        const char=source[index];
        if(quote){if(char==='\\')index++;else if(char===quote)quote='';continue}
        if(char==='"'||char==="'"){quote=char;continue}
        if(char==='(')round++;
        else if(char===')')round=Math.max(0,round-1);
        else if(char==='{'&&!round){brace=index;break}
        else if(char===';'&&!round){semicolon=index;break}
      }
      if(semicolon>=0&&(brace<0||semicolon<brace)){cursor=semicolon+1;continue}
      if(brace<0)break;
      const header=source.slice(cursor,brace).trim();
      const closing=findClosingBrace(source,brace);
      check(closing>=0,`${file}: bloco CSS sem fechamento`);
      if(closing<0)return;
      const body=source.slice(brace+1,closing);
      if(containers.test(header))walk(body,`${context}>${header.replace(/\s+/g,' ')}`);
      else if(header&&!header.startsWith('@')){
        const properties=declarations(body);
        for(const selector of splitTopLevel(header,',').map(value=>value.trim()).filter(Boolean)){
          for(const property of properties){
            const key=`${context}::${selector}::${property}`;
            check(!seen.has(key),`${file}: propriedade duplicada em ${selector} (${property})`);
            seen.add(key);
          }
        }
      }
      cursor=closing+1;
    }
  };
  walk(css);
}

const htmlFiles=fs.readdirSync(root).filter(file=>file.endsWith('.html')).sort();
const jsFiles=list('js','.js');
const cssFiles=list('css','.css');
const frontendCorpus=[...htmlFiles.map(read),...jsFiles.map(file=>read(`js/${file}`))].join('\n');
const criticalRemoteDependency=/cdn\.jsdelivr\.net\/(?:npm\/@supabase|gh\/efipay)/i;

for(const file of htmlFiles){
  const html=read(file);
  check(!/<style[\s>]/i.test(html),`${file}: CSS inline não permitido`);
  const inlineScripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter(match=>match[1].trim());
  check(inlineScripts.length===0,`${file}: JavaScript inline não permitido`);
  check(!criticalRemoteDependency.test(html),`${file}: dependência crítica não pode depender exclusivamente de CDN externo`);

  const ids=[...html.matchAll(/\bid=["']([^"']+)["']/gi)].map(match=>match[1]);
  const duplicateIds=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
  check(duplicateIds.length===0,`${file}: ids duplicados (${duplicateIds.join(', ')})`);

  const assets=[...html.matchAll(/\b(?:src|href)=["']((?:js|css)\/[^"'?#]+)[^"']*["']/gi)].map(match=>match[1]);
  const duplicateAssets=[...new Set(assets.filter((asset,index)=>assets.indexOf(asset)!==index))];
  check(duplicateAssets.length===0,`${file}: assets carregados em duplicidade (${duplicateAssets.join(', ')})`);
  for(const asset of assets)check(fs.existsSync(path.join(root,asset)),`${file}: asset local ausente (${asset})`);
}

for(const file of jsFiles){
  const source=read(`js/${file}`);
  check(!/document\.createElement\(\s*["']style["']\s*\)/.test(source),`js/${file}: injeção dinâmica de CSS não permitida`);
}

for(const file of cssFiles)auditCss(file);
for(const file of [...jsFiles.map(file=>`js/${file}`),...cssFiles.map(file=>`css/${file}`)]){
  check(frontendCorpus.includes(file),`${file}: asset sem consumidor`);
}
check(!fs.existsSync(path.join(root,'js/loja.js')),'js/loja.js: controlador legado deve permanecer removido');

const requiredFunctions=[
  'config-pagamento-loja','criar-cobranca-cartao-pedido','webhook-efi-pedidos','validar-payee-efi',
  'config-assinatura-cartao-fsdelivery','criar-assinatura-cartao-fsdelivery','webhook-efi-cobrancas',
  'cancelar-assinatura-cartao-fsdelivery','atualizar-assinatura-cartao-fsdelivery',
  'criar-pix-fsdelivery','verificar-pix-fsdelivery','cancelar-pix-fsdelivery',
];
for(const name of requiredFunctions){
  check(fs.existsSync(path.join(root,`supabase/functions/${name}/index.ts`)),`Edge Function sem fonte versionada: ${name}`);
  const source=read(`supabase/functions/${name}/index.ts`);
  check(source.includes('@supabase/supabase-js@2.112.2'),`Edge Function com cliente Supabase fora da versão homologada: ${name}`);
}

const appliedAuditMigrations=[
  '20260808190101_estabilizar_pagamentos_cartao.sql',
  '20260808190324_index_validacoes_payee.sql',
  '20260808193255_preservar_estado_pagamento_cartao.sql',
  '20260808195645_corrigir_estado_pagando_cartao.sql',
  '20260808195950_proteger_pagamento_contra_webhook_inicial.sql',
  '20260808200620_contexto_publico_loja.sql',
  '20260808201302_finalizar_maquina_estados_cartao.sql',
  '20260808201744_autorizacao_cartao_libera_pedido.sql',
  '20260808201909_estabilizar_assinatura_cartao.sql',
  '20260808202000_backfill_autorizacao_cartao.sql',
  '20260808202411_isolar_webhooks_efi_ambiente.sql',
];
const localAuditMigrations=fs.readdirSync(path.join(root,'supabase/migrations'))
  .filter(file=>file.startsWith('20260808')&&file.endsWith('.sql')).sort();
check(JSON.stringify(localAuditMigrations)===JSON.stringify(appliedAuditMigrations),
  'Histórico local das migrações da auditoria diverge do histórico aplicado no Supabase');

const orderCharge=read('supabase/functions/criar-cobranca-cartao-pedido/index.ts');
const orderWebhook=read('supabase/functions/webhook-efi-pedidos/index.ts');
const subscriptionWebhook=read('supabase/functions/webhook-efi-cobrancas/index.ts');
const storeConfig=read('supabase/functions/config-pagamento-loja/index.ts');
const subscriptionCreate=read('supabase/functions/criar-assinatura-cartao-fsdelivery/index.ts');
const cardFrontend=read('js/loja-cartao-online.js');
const publicCheckout=read('js/loja-publica-consolidado.js');
const migration=read('supabase/migrations/20260808190101_estabilizar_pagamentos_cartao.sql');
const stateMigration=read('supabase/migrations/20260808193255_preservar_estado_pagamento_cartao.sql');
const paymentRaceMigration=read('supabase/migrations/20260808201302_finalizar_maquina_estados_cartao.sql');
const subscriptionStateMigration=read('supabase/migrations/20260808201909_estabilizar_assinatura_cartao.sql');
const environmentIsolationMigration=read('supabase/migrations/20260808202411_isolar_webhooks_efi_ambiente.sql');
const authorizationMigration=read('supabase/migrations/20260808201744_autorizacao_cartao_libera_pedido.sql');
const storeRuntime=read('js/loja-operacional.js');
const adminFrontend=read('js/zxq-91m7-k4v2.js');
const finalPaymentApplyIndex=orderCharge.lastIndexOf('admin.rpc("fsdelivery_aplicar_evento_pagamento_pedido"');
const finalCardMetadataIndex=orderCharge.indexOf('cartao_mascara: cardMask',finalPaymentApplyIndex);

for(const source of [orderCharge,orderWebhook]){
  check(source.includes('https://cobrancas.api.efipay.com.br'),'Cartão externo deve suportar Efí produção');
  check(source.includes('https://cobrancas-h.api.efipay.com.br'),'Cartão externo deve suportar Efí homologação');
}
check(/case "approved":\s*return "autorizado"/.test(orderCharge),'Cobrança imediata deve distinguir autorização de liquidação');
check(/case "paid":\s*case "settled":\s*return "pago"/.test(orderCharge),'Cobrança imediata deve confirmar somente paid ou settled');
check(/case "settled":\s*return "pago"/.test(orderCharge),'Cobrança confirmada manualmente deve ser tratada como paga');
check(/case "expired":\s*return "cancelado"/.test(orderCharge),'Cobrança expirada deve bloquear o pedido');
check(/default:\s*return null/.test(orderCharge),'Status desconhecido da Efí não pode ser aceito como sucesso');
check(/\["criando", "erro", "new", "pagando"\]\.includes/.test(orderCharge),'Cobrança nova/avariada deve poder ser retomada');
check(orderCharge.includes('status: "pagando"'),'Cobrança deve reservar atomicamente a etapa de pagamento');
check(!orderCharge.includes('.eq("updated_at", attempt.updated_at)\n      .select("id")'),'Webhook inicial não pode invalidar a reserva de pagamento');
check(finalPaymentApplyIndex>=0&&finalCardMetadataIndex>finalPaymentApplyIndex,'Estado financeiro deve ser aplicado antes dos metadados não críticos');
check(!/update\(\{\s*status: providerStatus,\s*payload_pagamento: paid,/s.test(orderCharge),'Resposta síncrona não pode contornar a máquina transacional de estados');
check(orderCharge.includes('.in("status", ["criando", "new", "pagando", "erro"])'),'Falha local não pode regredir estado final recebido por webhook');
check(orderCharge.includes('`/v1/charge/${chargeId}`'),'Falha ambígua no pagamento deve ser reconciliada com a Efí');
check(orderCharge.includes('Pedido cancelado não aceita nova cobrança'),'Somente cancelamento financeiro pode aceitar nova tentativa');
check(orderCharge.includes('fsdelivery_aplicar_evento_pagamento_pedido'),'Cobrança imediata deve usar aplicação transacional de evento');
check(orderWebhook.includes('event?.id'),'Webhook de pedido deve usar o id incremental da Efí');
check(orderWebhook.includes('fsdelivery_aplicar_evento_pagamento_pedido'),'Webhook de pedido deve aplicar eventos de forma atômica');
check(subscriptionWebhook.includes('${token}:${providerEventId}'),'Webhook de assinatura deve deduplicar cada evento, não o token inteiro');
check(!/sha256\(`cobrancas:\$\{token\}`\)/.test(subscriptionWebhook),'Webhook de assinatura não pode bloquear o ciclo inteiro pelo token');
check(storeConfig.includes('environment: ambiente === "producao" ? "production" : "sandbox"'),'Configuração pública deve expor o ambiente de tokenização correto');
check(cardFrontend.includes('.setEnvironment(config.tokenizacao.environment)'),'Frontend externo deve respeitar o ambiente retornado pelo backend');
check(!cardFrontend.includes(".setEnvironment('sandbox')"),'Frontend externo não pode fixar sandbox');
check(cardFrontend.includes('new MutationObserver(()=>queueMicrotask(installPanel))'),'Cartão on-line deve sobreviver à reconstrução das formas de pagamento');
check(cardFrontend.includes('installed.hidden=!online'),'Painel do cartão deve acompanhar a forma de pagamento após reconstruções');
check(cardFrontend.includes('if(data?.sucesso){sessionStorage.removeItem(key);return data}'),'Idempotência só deve ser encerrada após resultado aceito');
check(!publicCheckout.includes('Pagamento aprovado em homologação'),'Mensagem pública não pode fixar o ambiente de pagamento');
check(subscriptionCreate.includes('efi_plan_ambiente'),'Assinatura deve separar planos Efí por ambiente');
check(subscriptionCreate.includes('efi_ambiente: provider.ambiente'),'Assinatura deve registrar o ambiente do provedor');
check(subscriptionCreate.includes('["paid", "settled"].includes(chargeStatus)'),'Assinatura deve ativar somente após confirmação financeira final');
check(migration.includes('assinaturas_recorrencia_cartao_ativa_uidx'),'Banco deve impedir recorrências concorrentes para o mesmo usuário');
check(migration.includes('fsdelivery_aplicar_evento_pagamento_pedido'),'Banco deve aplicar webhooks de pedido em transação única');
check(stateMigration.includes('when v_aplicado = v_recebido'),'Evento atrasado não pode regredir a tentativa de pagamento');
check(paymentRaceMigration.includes("when 'pagando' then 15"),'Reserva local de pagamento deve participar da ordenação de estados');
check(paymentRaceMigration.includes("when 'erro' then 15"),'Webhook inicial não pode apagar o diagnóstico de uma falha local');
check(paymentRaceMigration.includes('v_rank_recebido >= v_rank_tentativa'),'Webhook preliminar não pode derrubar uma reserva em andamento');
check(paymentRaceMigration.includes("status_efi_desconhecido"),'Status desconhecido da Efí deve ser auditado sem alterar o pedido');
check(paymentRaceMigration.includes("when 'settled' then 'pago'"),'Estado settled da Efí deve confirmar o pedido');
check(paymentRaceMigration.includes("when 'expired' then 'cancelado'"),'Estado expired da Efí deve cancelar o pagamento pendente');
check(authorizationMigration.includes("when 'approved' then 'autorizado'"),'Banco deve mapear approved como autorização');
check(authorizationMigration.includes("not in ('autorizado', 'pago')"),'Pedido deve avançar após autorização ou liquidação');
check(authorizationMigration.includes('auth.role()'),'Campos financeiros devem rejeitar alteração direta pelo cliente');
check(authorizationMigration.includes('pagamento_autorizado_em'),'Autorização deve possuir timestamp próprio');
check(publicCheckout.includes("paymentStatus==='autorizado'"),'Checkout deve informar autorização aprovada ao cliente');
check(adminFrontend.includes("autorizado:'Autorizado'"),'Central gerencial deve identificar cartão autorizado');
check(storeRuntime.includes("db.rpc('contexto_publico_loja'"),'Cardápio deve consumir o contexto público protegido por RPC');
check(!storeRuntime.includes("db.from('configuracoes_operacionais')"),'Cardápio não pode consultar configuração administrativa diretamente');
check(!storeRuntime.includes("db.from('taxas_entrega_regioes')"),'Cardápio não pode contornar RLS das regiões de entrega');
check(storeRuntime.includes('if(regionField)regionField.style.display'),'Atualização do total deve tolerar a remoção do seletor legado');
check(subscriptionStateMigration.includes("v_rank_recebido >= v_rank_anterior"),'Cobrança recorrente não pode regredir por webhook atrasado');
check(subscriptionStateMigration.includes("v_status in ('paid', 'settled')"),'Cobrança recorrente deve aceitar os estados finais de confirmação');
check(subscriptionStateMigration.includes("v_status in ('refunded', 'contested')"),'Reembolso e contestação devem ajustar o acesso concedido');
check(subscriptionStateMigration.includes('Cobrança Efí já vinculada a outra assinatura'),'Cobrança recorrente não pode cruzar assinaturas');
check(environmentIsolationMigration.includes('ambiente_efi_divergente'),'Webhook deve rejeitar cobrança de outro ambiente Efí');
check(environmentIsolationMigration.includes('add column if not exists efi_ambiente'),'Cobrança recorrente deve registrar seu ambiente Efí');
check((orderCharge.match(/p_ambiente: provider\.ambiente/g)||[]).length>=2,'Cobrança síncrona deve isolar eventos pelo ambiente Efí');
check(orderWebhook.includes('p_ambiente: config.ambiente'),'Webhook de pedido deve isolar eventos pelo ambiente Efí');
check(subscriptionCreate.includes('p_ambiente: provider.ambiente'),'Criação de assinatura deve aplicar o ambiente Efí na ativação');
check(subscriptionWebhook.includes('p_ambiente: config.ambiente'),'Webhook recorrente deve isolar eventos pelo ambiente Efí');

const subscriptionHtml=read('assinatura.html');
const authHtml=read('auth.html');
const authFrontend=read('js/auth.js');
check(/id="card-cvv"\s+type="password"/.test(subscriptionHtml),'CVV da assinatura deve usar campo protegido');
check((authHtml.match(/minlength="8"/g)||[]).length===4,'Cadastro e redefinição devem exigir senha com no mínimo 8 caracteres');
check((authFrontend.match(/length<8/g)||[]).length===2,'Validação de senha forte deve cobrir cadastro e redefinição');
check(subscriptionHtml.includes('js/vendor/payment-token-efi-3.4.1.min.js'),'Assinatura deve usar versão local e fixada da tokenização Efí');
check(cardFrontend.includes("script.src='js/vendor/payment-token-efi-3.4.1.min.js'"),'Checkout externo deve usar versão local e fixada da tokenização Efí');
for(const file of [
  'js/vendor/supabase-2.112.2.js','js/vendor/supabase-2.112.2.LICENSE',
  'js/vendor/payment-token-efi-3.4.1.min.js','js/vendor/payment-token-efi-3.4.1.LICENSE',
])check(fs.existsSync(path.join(root,file)),`Dependência crítica local ausente: ${file}`);
for(const [file,expected] of Object.entries({
  'js/vendor/supabase-2.112.2.js':'04b957f2563a40dcb02b1d9d6f7a7a23973bf8ebe4c1435be5feaf24bff91134',
  'js/vendor/payment-token-efi-3.4.1.min.js':'fb73ce70492e58bd999118ff87d4752e7c28b8adc0db3a883f6e36262d429be7',
})){
  const hash=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
  check(hash===expected,`Integridade da dependência crítica alterada: ${file}`);
}
for(const file of htmlFiles){
  if(read(file).includes('js/supabase.js')){
    check(read(file).includes('js/vendor/supabase-2.112.2.js'),`${file}: cliente Supabase local ausente`);
  }
}

if(failures.length){
  console.error(`\nAuditoria completa reprovada: ${failures.length} falha(s).`);
  failures.forEach(item=>console.error(`- ${item}`));
  process.exit(1);
}
console.log(`Auditoria completa aprovada: ${htmlFiles.length} HTML, ${jsFiles.length} JS, ${cssFiles.length} CSS e ${requiredFunctions.length} funções financeiras.`);
