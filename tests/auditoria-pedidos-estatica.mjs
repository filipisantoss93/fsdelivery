import { readFile, access } from 'node:fs/promises';

const files=new Map();
const failures=[];
const source=async file=>{if(!files.has(file))files.set(file,await readFile(new URL(`../${file}`,import.meta.url),'utf8'));return files.get(file)};
const exists=async file=>{try{await access(new URL(`../${file}`,import.meta.url));return true}catch{return false}};
const check=(label,passed,file='')=>{if(passed)console.log(`✓ ${label}`);else{failures.push({label,file});console.error(`✗ ${label}${file?` (${file})`:''}`)}};
const has=(content,pattern)=>pattern.test(content);

const requiredFiles=[
  'vercel.json','js/supabase.js','css/orders.css','js/pedido-status.js',
  'js/app-orders-operational.js','js/app-orders-type-filters.js',
  'js/loja-fluxos-pedido.js','js/loja-publica-consolidado.js','js/loja-pos-envio.js',
  'js/customer-order-access.js','js/cliente.js','cliente.html','js/balcao.js','js/garcom-salao.js','caixa.html',
  'supabase/migrations/20260805_auditoria_pedidos_unificada.sql',
  'supabase/migrations/20260805_corrigir_pagamento_pedido_mesa.sql',
  'supabase/migrations/20260805_fase2_hardening_pedidos.sql',
  'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql',
  'supabase/migrations/20260809175445_preservar_limite_tentativas_rastreamento.sql',
  'supabase/migrations/20260809180256_indexar_chaves_rastreamento.sql'
];
for(const file of requiredFiles){try{await source(file);check(`Arquivo presente: ${file}`,true)}catch{check(`Arquivo presente: ${file}`,false,file)}}
if(failures.length){console.error(`\nAuditoria interrompida: ${failures.length} arquivo(s) obrigatório(s) ausente(s).`);process.exit(1)}

for(const legacy of ['js/balcao-fluxos.js','js/cliente-submit-fix.js','css/app-orders-operational.css']){
  check(`Módulo legado removido: ${legacy}`,!(await exists(legacy)),legacy);
}

const vercel=JSON.parse(await source('vercel.json'));
check('Vercel usa URLs limpas',vercel.cleanUrls===true,'vercel.json');
check('Vercel não força barra final',vercel.trailingSlash===false,'vercel.json');

const loader=await source('js/supabase.js');
check('Carregador expõe contrato único de rota',has(loader,/window\.FSDeliveryRoute/),'js/supabase.js');
check('Carregador usa folha consolidada de pedidos',has(loader,/css\/orders\.css/),'js/supabase.js');
check('Carregador não referencia CSS antigo',!has(loader,/app-orders-operational\.css/),'js/supabase.js');
check('Carregador não injeta correção legada do balcão',!has(loader,/balcao-fluxos\.js/),'js/supabase.js');
check('Loja pública recebe fluxo consolidado',has(loader,/loja-publica-consolidado\.js/),'js/supabase.js');
check('Painel recebe módulo operacional de pedidos',has(loader,/app-orders-operational\.js/),'js/supabase.js');

const orderCss=await source('css/orders.css');
for(const selector of ['.fs-orders-shell','.customer-order-card','.fs-order-tracker','.fs-public-order-timeline','.receipt-line'])check(`CSS consolidado contém ${selector}`,orderCss.includes(selector),'css/orders.css');
check('Timeline pública possui namespace próprio',!has(orderCss,/\.fs-order-step\{/),'css/orders.css');

const status=await source('js/pedido-status.js');
for(const item of ['aguardando_aprovacao','confirmado','preparo','pronto','servido','saiu_entrega','finalizado','cancelado'])check(`Status canônico disponível: ${item}`,status.includes(item),'js/pedido-status.js');
check('Status legado novo é normalizado',has(status,/novo:'confirmado'/),'js/pedido-status.js');
check('Status legado entregue é normalizado',has(status,/entregue:'finalizado'/),'js/pedido-status.js');

const appOrders=await source('js/app-orders-operational.js');
check('Novo pedido do painel abre o balcão',has(appOrders,/location\.href='balcao'/),'js/app-orders-operational.js');
check('Painel usa RPC operacional para transições',has(appOrders,/atualizar_status_pedido_operacional/),'js/app-orders-operational.js');
check('Painel atualiza sem recarregar toda a página',has(appOrders,/fs:orders:refresh/),'js/app-orders-operational.js');

const publicFlow=await source('js/loja-fluxos-pedido.js');
check('Página pública oferece entrega',has(publicFlow,/value="delivery"/),'js/loja-fluxos-pedido.js');
check('Página pública oferece retirada',has(publicFlow,/value="pickup"/),'js/loja-fluxos-pedido.js');
check('Página pública não oferece consumo local on-line',!has(publicFlow,/value="local"/),'js/loja-fluxos-pedido.js');

const consolidatedPublic=await source('js/loja-publica-consolidado.js');
check('Checkout público usa RPC única',has(consolidatedPublic,/criar_pedido_publico/),'js/loja-publica-consolidado.js');
check('Checkout público envia token idempotente',has(consolidatedPublic,/checkout_token:checkout\.token/),'js/loja-publica-consolidado.js');
check('Checkout publica comprovante do dispositivo',has(consolidatedPublic,/fs:public-order-completed/)&&has(consolidatedPublic,/checkoutToken:checkout\.token/),'js/loja-publica-consolidado.js');
check('Checkout normaliza WhatsApp antes de validar',has(consolidatedPublic,/phone=normalizePhone\(formData\.get\('phone'\)\)/)&&has(consolidatedPublic,/phone\.length>11/),'js/loja-publica-consolidado.js');

const publicPost=await source('js/loja-pos-envio.js');
check('Pedido é vinculado pelo checkout token',has(publicPost,/vincular_pedido_dispositivo/)&&has(publicPost,/p_checkout_token:proof\.checkoutToken/),'js/loja-pos-envio.js');
check('Evento concluído inicia vínculo diretamente',has(publicPost,/fs:public-order-completed[\s\S]{0,180}claimCompletedOrder/),'js/loja-pos-envio.js');
check('Vínculo não depende de transição ou atraso fixo',!has(publicPost,/transitionend|setTimeout\(enhanceSuccess|180\)/),'js/loja-pos-envio.js');
check('Acompanhamento exige token do dispositivo',has(publicPost,/p_token:token/),'js/loja-pos-envio.js');
check('Falha de vínculo pode ser retomada',has(publicPost,/checkoutToken:proof\.checkoutToken/)&&has(publicPost,/fs-retry-order-claim/),'js/loja-pos-envio.js');
check('Acompanhamento não injeta CSS',!has(publicPost,/createElement\(['"]style['"]\)/),'js/loja-pos-envio.js');
check('Acompanhamento não usa polling contínuo',!has(publicPost,/setInterval\s*\(/),'js/loja-pos-envio.js');
check('Histórico não expõe telefone no link',has(publicPost,/new URLSearchParams\(\{loja:slug,pedido:code\}\)/),'js/loja-pos-envio.js');

const customerAccess=await source('js/customer-order-access.js');
check('WhatsApp brasileiro remove DDI +55',has(customerAccess,/raw\.length===12\|\|raw\.length===13[\s\S]{0,80}startsWith\('55'\)[\s\S]{0,40}slice\(2\)/),'js/customer-order-access.js');
check('Token do aparelho possui 64 caracteres aleatórios',has(customerAccess,/createDeviceToken=.*64/),'js/customer-order-access.js');
check('Código de recuperação usa alfabeto sem ambiguidades',has(customerAccess,/ABCDEFGHJKLMNPQRSTUVWXYZ23456789/),'js/customer-order-access.js');
const customer=await source('js/cliente.js');
check('Histórico lê token pelo contrato central',has(customer,/Access\.keys\.token\(slug,normalized\)/),'js/cliente.js');
check('Histórico envia token ao banco',has(customer,/p_token:token/),'js/cliente.js');
check('Histórico sem token oferece recuperação segura',has(customer,/Aparelho ainda não vinculado/)&&has(customer,/recuperar_pedido_dispositivo/),'js/cliente.js');
check('Histórico recupera pedidos anteriores ao corte',has(customer,/vincular_pedido_legado_dispositivo/),'js/cliente.js');
check('Histórico atualiza pedidos ativos automaticamente',has(customer,/setTimeout\(async\(\)=>[\s\S]{0,120}automatic:true/),'js/cliente.js');
check('Histórico não injeta CSS',!has(customer,/createElement\(['"]style['"]\)/),'js/cliente.js');
check('Histórico não usa polling contínuo',!has(customer,/setInterval\s*\(/),'js/cliente.js');
const customerHtml=await source('cliente.html');
check('Página do cliente não carrega correção legada',!has(customerHtml,/cliente-submit-fix\.js/),'cliente.html');
check('Contrato de acesso carrega antes do Supabase',customerHtml.indexOf('customer-order-access.js')<customerHtml.indexOf('supabase.js'),'cliente.html');
check('Página oferece formulário profissional de recuperação',has(customerHtml,/customer-recovery-form/)&&has(customerHtml,/recovery-code/),'cliente.html');

const counter=await source('js/balcao.js');
check('Balcão diferencia origem caixa e balcão',has(counter,/requestedOrigin.*caixa.*balcao/s),'js/balcao.js');
check('Payload do balcão envia origem',has(counter,/origem:requestedOrigin/),'js/balcao.js');
check('Payload do balcão envia CEP',has(counter,/cep:currentType==='entrega'/),'js/balcao.js');
check('Payload do balcão envia endereço estruturado',has(counter,/endereco_dados:currentType==='entrega'/),'js/balcao.js');
check('Payload do balcão envia troco separado',has(counter,/troco_para:change/),'js/balcao.js');
check('Consumo local vira pedido de mesa',has(counter,/tipo:currentType==='local'\?'mesa':currentType/),'js/balcao.js');
check('Balcão não depende de counter-address inexistente',!has(counter,/counter-address['"]/),'js/balcao.js');
check('Balcão usa RPC interna única',has(counter,/criar_pedido_garcom/),'js/balcao.js');

const waiter=await source('js/garcom-salao.js');
check('Garçom permanece restrito a pedido de mesa',has(waiter,/value=["']mesa["']|value===?["']mesa["']/i),'js/garcom-salao.js');
check('Garçom exige mesa selecionada',has(waiter,/Selecione uma mesa antes de enviar o pedido/i),'js/garcom-salao.js');

const cashHtml=await source('caixa.html');
check('Caixa oferece venda rápida',has(cashHtml,/>Venda rápida</),'caixa.html');
check('Venda rápida abre balcão com origem caixa',has(cashHtml,/balcao\?origem=caixa/),'caixa.html');

const migration=await source('supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('Schema registra origem do pedido',has(migration,/add column if not exists origem text/i),'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
for(const origin of ['publico','qr_mesa','painel','garcom','balcao','caixa'])check(`Origem SQL permitida: ${origin}`,migration.includes(`'${origin}'`),'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('RPC pública retorna código textual',has(migration,/function public\.criar_pedido_publico[\s\S]*?returns text/i),'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('RPC administrativa retorna código textual',has(migration,/function public\.criar_pedido_garcom[\s\S]*?returns text/i),'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');

const hardening=await source('supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Migração cria registro de dispositivos',has(hardening,/create table if not exists public\.cliente_dispositivos/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Token é armazenado somente como hash',has(hardening,/token_hash text not null unique/)&&has(hardening,/digest\(v_token, 'sha256'\)/),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Vínculo exige checkout token',has(hardening,/vincular_dispositivo_cliente[\s\S]*p_checkout_token uuid/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Consulta exige terceiro argumento token',has(hardening,/consultar_pedidos_cliente\([\s\S]*p_token text/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Consulta antiga por telefone é removida',has(hardening,/drop function if exists public\.consultar_pedidos_cliente\(text, text\)/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Funções internas deixam de ser públicas',has(hardening,/revoke all on function public\.abrir_caixa[\s\S]*from public, anon/i)&&has(hardening,/revoke all on function public\.concluir_pedido_cozinha[\s\S]*from public, anon/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Políticas redundantes são removidas',has(hardening,/drop policy if exists "dono visualiza enderecos de clientes"/i)&&has(hardening,/drop policy if exists notificacoes_operacionais_owner_select/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('RLS usa auth.uid inicializado uma vez',has(hardening,/\(select auth\.uid\(\)\)/),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');
check('Índice duplicado é removido',has(hardening,/drop index if exists public\.idx_notificacoes_operacionais_destino/i),'supabase/migrations/20260805_fase2_hardening_pedidos.sql');

const tracking=await source('supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Rastreamento relaciona aparelhos a pedidos específicos',has(tracking,/create table if not exists public\.cliente_dispositivo_pedidos/i)&&has(tracking,/unique \(dispositivo_id, pedido_id\)/i),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Consulta retorna somente pedidos vinculados',has(tracking,/join public\.cliente_dispositivo_pedidos vinculo[\s\S]{0,180}vinculo\.dispositivo_id = v_dispositivo/i),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Credenciais de recuperação ficam somente em hash',has(tracking,/codigo_recuperacao_hash text not null/)&&has(tracking,/digest\(v_codigo, 'sha256'\)/),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Recuperação rotaciona o código antigo',has(tracking,/set codigo_recuperacao_hash = encode\(extensions\.digest\(v_novo_codigo/),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Recuperação bloqueia excesso de tentativas',has(tracking,/tentativas_invalidas[\s\S]*v_tentativas >= 5[\s\S]*interval '15 minutes'/),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Transição legada expira e se limita a um pedido',has(tracking,/corte_legado_em/)&&has(tracking,/p\.created_at >= v_corte - interval '24 hours'/),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Tabelas de rastreamento não expõem Data API',has(tracking,/revoke all on table public\.cliente_dispositivo_pedidos from public, anon, authenticated/)&&has(tracking,/revoke all on table public\.pedido_rastreamento_credenciais from public, anon, authenticated/),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');
check('Normalização canônica trata DDI 55',has(tracking,/left\(limpo, 2\) = '55'[\s\S]{0,80}substring\(limpo from 3\)/),'supabase/migrations/20260809175202_profissionalizar_rastreamento_pedidos_cliente.sql');

const trackingRateLimit=await source('supabase/migrations/20260809175445_preservar_limite_tentativas_rastreamento.sql');
check('Tentativa inválida persiste antes da resposta',has(trackingRateLimit,/if v_hash <> v_hash_esperado then[\s\S]*update public\.pedido_rastreamento_credenciais[\s\S]*return jsonb_build_object/),'supabase/migrations/20260809175445_preservar_limite_tentativas_rastreamento.sql');
check('Negativa de recuperação não aborta o contador',!has(trackingRateLimit,/update public\.pedido_rastreamento_credenciais[\s\S]{0,500}raise exception/),'supabase/migrations/20260809175445_preservar_limite_tentativas_rastreamento.sql');

const trackingIndexes=await source('supabase/migrations/20260809180256_indexar_chaves_rastreamento.sql');
check('Chaves estrangeiras do rastreamento possuem índices',has(trackingIndexes,/\(cliente_id\)/)&&has(trackingIndexes,/\(dispositivo_inicial_id\)/),'supabase/migrations/20260809180256_indexar_chaves_rastreamento.sql');

const tablePaymentFix=await source('supabase/migrations/20260805_corrigir_pagamento_pedido_mesa.sql');
check('Pedido de mesa não exige pagamento antecipado',has(tablePaymentFix,/v_tipo <> ''mesa'' and v_tem_cfg/),'supabase/migrations/20260805_corrigir_pagamento_pedido_mesa.sql');

if(failures.length){console.error(`\nAuditoria reprovada: ${failures.length} falha(s).`);for(const failure of failures)console.error(`- ${failure.label}${failure.file?` — ${failure.file}`:''}`);process.exit(1)}
console.log('\nAuditoria estática unificada dos pedidos aprovada.');
