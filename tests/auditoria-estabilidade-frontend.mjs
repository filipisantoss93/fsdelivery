import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const failures=[];
const assert=(condition,message)=>{if(!condition)failures.push(message)};

const supabase=read('js/supabase.js');
const customers=read('js/clientes-enderecos.js');
const customerHistory=read('js/cliente.js');
const orderFilters=read('js/app-orders-type-filters.js');
const postOrder=read('js/loja-pos-envio.js');
const appHtml=read('app.html');
const appUi=read('js/app-ui-sync.js');
const orderCss=read('css/orders.css');

assert(!/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(supabase),'supabase.js não pode bloquear zoom do navegador.');
assert(/const cleanInternalUrl=/.test(supabase),'O carregador central deve possuir normalização de URLs internas.');
assert(/window\.FSDeliveryRoute=Object\.freeze\(\{[^}]*cleanUrl:cleanInternalUrl/.test(supabase),'O contrato de rota deve expor o gerador de URL limpa.');
assert(!/MutationObserver/.test(supabase),'A normalização global de URLs não deve adicionar observers ao documento.');
assert(/css\/orders\.css/.test(supabase),'Os estilos de pedidos devem ser carregados pela folha consolidada.');
assert(!/app-orders-operational\.css|balcao-fluxos\.js/.test(supabase),'O carregador não pode depender de módulos aposentados.');
assert(!/db\.rpc\s*=|supabaseClient\.rpc\s*=/.test(customers),'clientes-enderecos.js não pode sobrescrever o método RPC global.');
assert(!/document\.documentElement[\s\S]{0,160}MutationObserver|MutationObserver[\s\S]{0,160}document\.documentElement/.test(orderFilters),'Filtros de pedidos não podem observar o documento inteiro.');
assert(!/document\.createElement\(['"]style['"]\)/.test(orderFilters),'CSS dos filtros deve permanecer na folha de estilos consolidada.');
assert(!/setInterval\s*\(/.test(postOrder),'Pós-envio da loja não pode usar polling contínuo.');
assert(!/document\.createElement\(['"]style['"]\)/.test(postOrder),'Pós-envio da loja não pode injetar CSS.');
assert(!/setInterval\s*\(/.test(customerHistory),'Histórico do cliente não pode usar polling contínuo.');
assert(!/document\.createElement\(['"]style['"]\)/.test(customerHistory),'Histórico do cliente não pode injetar CSS.');
assert(/p_token:token/.test(customerHistory),'Histórico público deve enviar o token do dispositivo.');
assert(/\.fs-public-order-timeline/.test(orderCss),'Timeline pública deve ter namespace próprio.');
assert(/matchesPage\('loja'\)/.test(supabase),'Carregamento da loja deve ser condicionado à rota limpa da página atual.');
assert(/matchesPage\('app'\)/.test(supabase),'Carregamento do painel deve ser condicionado à rota limpa da página atual.');
assert(/replace\(\/\\\.html\$\/i,''\)/.test(supabase),'O contrato de rota deve continuar aceitando URLs legadas sem expor .html.');
assert(!/<style[\s>]/i.test(appHtml),'app.html não pode conter CSS operacional inline.');
assert(!/MutationObserver/.test(appHtml),'app.html não pode conter MutationObserver inline.');
assert(!/<script>(?!\s*<\/script>)/i.test(appHtml),'app.html não pode conter JavaScript inline.');
assert(/js\/app-ui-sync\.js/.test(appHtml),'app.html deve carregar o módulo externo de sincronização.');
assert(!/MutationObserver/.test(appUi),'app-ui-sync.js deve usar sincronização explícita, sem observers.');
assert(!/setInterval\s*\(/.test(appUi),'app-ui-sync.js não pode usar polling contínuo.');
assert(/pagehide/.test(appUi),'app-ui-sync.js deve limpar listeners e timers ao sair da página.');

if(failures.length){console.error('\nFalhas na auditoria de estabilidade:');failures.forEach(item=>console.error(`- ${item}`));process.exit(1)}
console.log('Auditoria de estabilidade frontend aprovada.');
