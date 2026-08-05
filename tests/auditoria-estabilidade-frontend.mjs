import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const failures=[];
const assert=(condition,message)=>{if(!condition)failures.push(message)};

const supabase=read('js/supabase.js');
const customers=read('js/clientes-enderecos.js');
const orderFilters=read('js/app-orders-type-filters.js');
const postOrder=read('js/loja-pos-envio.js');

assert(!/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(supabase),'supabase.js não pode bloquear zoom do navegador.');
assert(!/db\.rpc\s*=|supabaseClient\.rpc\s*=/.test(customers),'clientes-enderecos.js não pode sobrescrever o método RPC global.');
assert(!/document\.documentElement[\s\S]{0,160}MutationObserver|MutationObserver[\s\S]{0,160}document\.documentElement/.test(orderFilters),'Filtros de pedidos não podem observar o documento inteiro.');
assert(!/document\.createElement\(['"]style['"]\)/.test(orderFilters),'CSS dos filtros deve permanecer na folha de estilos consolidada.');
assert(!/setInterval\s*\(/.test(postOrder),'Pós-envio da loja não pode usar polling contínuo.');
assert(/matchesPage\('loja\.html'\)/.test(supabase),'Carregamento da loja deve ser condicionado à página atual.');
assert(/matchesPage\('app\.html'\)/.test(supabase),'Carregamento do painel deve ser condicionado à página atual.');

if(failures.length){
  console.error('\nFalhas na auditoria de estabilidade:');
  failures.forEach(item=>console.error(`- ${item}`));
  process.exit(1);
}

console.log('Auditoria de estabilidade frontend aprovada.');
