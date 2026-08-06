import { readFile } from 'node:fs/promises';

const files = new Map();
const failures = [];

async function source(file) {
  if (!files.has(file)) {
    files.set(file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  return files.get(file);
}

function check(label, passed, file = '') {
  if (passed) console.log(`✓ ${label}`);
  else {
    failures.push({ label, file });
    console.error(`✗ ${label}${file ? ` (${file})` : ''}`);
  }
}

function has(content, pattern) {
  return pattern.test(content);
}

const requiredFiles = [
  'vercel.json',
  'js/supabase.js',
  'js/pedido-status.js',
  'js/app-orders-operational.js',
  'js/app-orders-type-filters.js',
  'js/loja-fluxos-pedido.js',
  'js/loja-pos-envio.js',
  'js/loja-publica-consolidado.js',
  'js/garcom-salao.js',
  'js/balcao-fluxos.js',
  'caixa.html',
  'supabase/migrations/20260805_auditoria_pedidos_unificada.sql',
  'supabase/migrations/20260805_corrigir_pagamento_pedido_mesa.sql'
];

for (const file of requiredFiles) {
  try {
    await source(file);
    check(`Arquivo presente: ${file}`, true);
  } catch {
    check(`Arquivo presente: ${file}`, false, file);
  }
}

if (failures.length) {
  console.error(`\nAuditoria interrompida: ${failures.length} arquivo(s) obrigatório(s) ausente(s).`);
  process.exit(1);
}

const vercel = JSON.parse(await source('vercel.json'));
check('Vercel usa URLs limpas', vercel.cleanUrls === true, 'vercel.json');
check('Vercel não força barra final', vercel.trailingSlash === false, 'vercel.json');

const loader = await source('js/supabase.js');
check('Carregador normaliza extensão .html', has(loader, /replace\(\/\\\.html\$\/i,''\)/), 'js/supabase.js');
check('Carregador expõe contrato único de rota', has(loader, /window\.FSDeliveryRoute/), 'js/supabase.js');
check('Loja pública recebe fluxo consolidado', has(loader, /loja-publica-consolidado\.js/), 'js/supabase.js');
check('Balcão recebe fluxo operacional', has(loader, /balcao-fluxos\.js/), 'js/supabase.js');
check('Painel recebe módulo operacional de pedidos', has(loader, /app-orders-operational\.js/), 'js/supabase.js');
check('Links gerados pelo carregador não usam .html', !/location\.(?:href|replace)\s*=\s*['"`][^'"`]*\.html/i.test(loader), 'js/supabase.js');

const status = await source('js/pedido-status.js');
for (const item of ['aguardando_aprovacao', 'confirmado', 'preparo', 'pronto', 'servido', 'saiu_entrega', 'finalizado', 'cancelado']) {
  check(`Status canônico disponível: ${item}`, status.includes(item), 'js/pedido-status.js');
}
check('Status legado novo é normalizado', has(status, /novo:'confirmado'/), 'js/pedido-status.js');
check('Status legado entregue é normalizado', has(status, /entregue:'finalizado'/), 'js/pedido-status.js');

const appOrders = await source('js/app-orders-operational.js');
check('Painel funciona em /app e /app.html', has(appOrders, /app\(\?:\\\.html\)\?/), 'js/app-orders-operational.js');
check('Novo pedido do painel abre o balcão', has(appOrders, /location\.href='balcao'/), 'js/app-orders-operational.js');
check('Painel usa RPC operacional para transições', has(appOrders, /atualizar_status_pedido_operacional/), 'js/app-orders-operational.js');
check('Painel publica evento depois da renderização', has(appOrders, /fs:orders:rendered/), 'js/app-orders-operational.js');
check('Painel atualiza sem recarregar toda a página', has(appOrders, /fs:orders:refresh/), 'js/app-orders-operational.js');

const typeFilters = await source('js/app-orders-type-filters.js');
check('Filtros funcionam em URL limpa', has(typeFilters, /app\(\?:\\\.html\)\?/), 'js/app-orders-type-filters.js');
check('Rejeição usa a RPC específica', has(typeFilters, /rejeitar_pedido_operacional/), 'js/app-orders-type-filters.js');
check('Rejeição não força location.reload', !has(typeFilters, /location\.reload/), 'js/app-orders-type-filters.js');

const publicFlow = await source('js/loja-fluxos-pedido.js');
check('Fluxo público funciona em /loja e /loja.html', has(publicFlow, /loja\(\?:\\\.html\)\?/), 'js/loja-fluxos-pedido.js');
check('Página pública oferece entrega', has(publicFlow, /value="delivery"/), 'js/loja-fluxos-pedido.js');
check('Página pública oferece retirada', has(publicFlow, /value="pickup"/), 'js/loja-fluxos-pedido.js');
check('Página pública não oferece consumo local no seletor online', !has(publicFlow, /value="local"/), 'js/loja-fluxos-pedido.js');
check('Pedido online exige modalidade', has(publicFlow, /Escolha Entrega ou Retirada/), 'js/loja-fluxos-pedido.js');
check('Entrega exige rua, número e bairro', has(publicFlow, /Informe rua, número e bairro/), 'js/loja-fluxos-pedido.js');
check('Envio público possui bloqueio contra duplicidade visual', has(publicFlow, /confirmedSubmission/), 'js/loja-fluxos-pedido.js');

const publicPost = await source('js/loja-pos-envio.js');
check('Acompanhamento funciona em URL limpa', has(publicPost, /loja\(\?:\\\.html\)\?/), 'js/loja-pos-envio.js');
check('Histórico do cliente usa URL limpa', has(publicPost, /link\.href=`cliente\?/), 'js/loja-pos-envio.js');
check('Acompanhamento consulta pedidos pelo cliente', has(publicPost, /consultar_pedidos_cliente/), 'js/loja-pos-envio.js');

const consolidatedPublic = await source('js/loja-publica-consolidado.js');
check('Checkout público usa RPC única', has(consolidatedPublic, /criar_pedido_publico/), 'js/loja-publica-consolidado.js');
check('Checkout público envia endereço estruturado', has(consolidatedPublic, /endereco_dados/), 'js/loja-publica-consolidado.js');
check('Checkout público envia token idempotente', has(consolidatedPublic, /checkout_token/), 'js/loja-publica-consolidado.js');

const waiter = await source('js/garcom-salao.js');
check('Garçom é restrito a pedido de mesa', has(waiter, /value=["']mesa["']|value===?["']mesa["']/i), 'js/garcom-salao.js');
check('Garçom exige mesa selecionada', has(waiter, /Selecione uma mesa antes de enviar o pedido/i), 'js/garcom-salao.js');
check('Garçom oculta endereço', has(waiter, /waiter-address-field/), 'js/garcom-salao.js');

const counter = await source('js/balcao-fluxos.js');
check('Balcão diferencia origem caixa e balcão', has(counter, /requestedOrigin.*caixa.*balcao/s), 'js/balcao-fluxos.js');
check('Payload do balcão envia origem', has(counter, /origem:requestedOrigin/), 'js/balcao-fluxos.js');
check('Payload do balcão envia CEP', has(counter, /cep:currentType===['"]entrega['"]/), 'js/balcao-fluxos.js');
check('Payload do balcão envia endereço estruturado', has(counter, /endereco_dados/), 'js/balcao-fluxos.js');
check('Payload do balcão envia troco separado das observações', has(counter, /troco_para:change/), 'js/balcao-fluxos.js');
check('Entrega do balcão valida CEP completo', has(counter, /address\.cep\.length!==8/), 'js/balcao-fluxos.js');
check('Fluxo efetivo não depende de counter-address inexistente', !has(counter, /counter-address['"]/), 'js/balcao-fluxos.js');
check('Balcão usa a RPC interna única', has(counter, /criar_pedido_garcom/), 'js/balcao-fluxos.js');

const cashHtml = await source('caixa.html');
check('Caixa oferece venda rápida', has(cashHtml, />Venda rápida</), 'caixa.html');
check('Venda rápida abre balcão com origem caixa', has(cashHtml, /balcao\?origem=caixa/), 'caixa.html');
check('Navegação do caixa não expõe .html', !has(cashHtml, /(?:href|location\.href)=?["'][^"']*\.html/i), 'caixa.html');

const migration = await source('supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('Schema registra origem do pedido', has(migration, /add column if not exists origem text/i), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
for (const origin of ['publico', 'qr_mesa', 'painel', 'garcom', 'balcao', 'caixa']) {
  check(`Origem SQL permitida: ${origin}`, migration.includes(`'${origin}'`), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
}
check('Pedidos públicos online aguardam aprovação', has(migration, /new\.origem = 'publico'.*new\.tipo in \('entrega','retirada'\).*'aguardando_aprovacao'/s), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('Pedidos internos entram confirmados', has(migration, /else 'confirmado'/), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('Pedido sem entrega limpa endereço e taxa', has(migration, /if new\.tipo <> 'entrega'.*new\.endereco_entrega := null.*new\.taxa_entrega := 0/s), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('RPC pública retorna código textual', has(migration, /function public\.criar_pedido_publico[\s\S]*?returns text/i), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('RPC administrativa retorna código textual', has(migration, /function public\.criar_pedido_garcom[\s\S]*?returns text/i), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('RPC da equipe retorna código textual', has(migration, /function public\.criar_pedido_equipe_garcom[\s\S]*?returns text/i), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');
check('RPC administrativa não fica disponível ao anon', has(migration, /revoke all on function public\.criar_pedido_garcom[\s\S]*?grant execute on function public\.criar_pedido_garcom\(jsonb\) to authenticated/i), 'supabase/migrations/20260805_auditoria_pedidos_unificada.sql');

const tablePaymentFix = await source('supabase/migrations/20260805_corrigir_pagamento_pedido_mesa.sql');
check('Pedido de mesa não exige pagamento antecipado', has(tablePaymentFix, /v_tipo <> ''mesa'' and v_tem_cfg/), 'supabase/migrations/20260805_corrigir_pagamento_pedido_mesa.sql');

if (failures.length) {
  console.error(`\nAuditoria reprovada: ${failures.length} falha(s).`);
  for (const failure of failures) console.error(`- ${failure.label}${failure.file ? ` — ${failure.file}` : ''}`);
  process.exit(1);
}

console.log('\nAuditoria estática unificada dos pedidos aprovada.');
