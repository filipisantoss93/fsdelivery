import {readFile,access} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=file=>readFile(new URL(file,root),'utf8');
const failures=[];
const check=(condition,message)=>{if(!condition)failures.push(message)};

const[html,cash,counter,counterHtml,orders,tables,migration]=await Promise.all([
  read('caixa.html'),
  read('js/caixa.js'),
  read('js/balcao.js'),
  read('balcao.html'),
  read('js/app-orders-operational.js'),
  read('js/mesas-operacao.js'),
  read('supabase/migrations/20260809211109_profissionalizar_fluxo_caixa.sql')
]);

check(!html.includes('caixa-sessao.js'),'Controlador legado do caixa não pode voltar a ser carregado.');
try{await access(new URL('js/caixa-sessao.js',root));check(false,'Controlador legado do caixa deve permanecer removido.')}catch{}
check(html.includes('id="cash-session-toggle"'),'Caixa deve oferecer abertura e fechamento da sessão.');
check(html.includes('id="cash-session-summary"'),'Caixa deve exibir resumo financeiro da sessão.');
check(html.includes('id="finalize-order"'),'Caixa deve oferecer finalização explícita de atendimentos quitados.');
check(cash.includes("ONLINE_PAID=new Set(['autorizado','pago'])"),'Caixa deve reconhecer pagamento on-line autorizado ou pago.');
check(cash.includes('pedido_ids:selectedOrders.map'),'Conta de mesa deve enviar todos os pedidos selecionados.');
check(cash.includes("db.rpc('obter_resumo_caixa'"),'Resumo do caixa deve vir do contrato transacional do banco.');
check(cash.includes('cashSummary.valor_esperado'),'Fechamento deve usar somente o dinheiro esperado na gaveta.');
check(counter.includes("db.rpc('registrar_venda_rapida_caixa'"),'Venda rápida deve usar RPC atômica própria.');
check(counter.includes('idempotency_key:saleToken'),'Venda rápida deve possuir chave idempotente.');
check(counter.includes("if(quickSale){el('counter-table-field').hidden=true"),'Venda rápida deve ocultar mesa e dados do cliente.');
check(counterHtml.includes('id="counter-change-label"'),'Campo de valor recebido deve possuir rótulo adaptável.');
check(orders.includes("['autorizado','pago'].includes(order.pagamento_status)"),'Painel deve reconhecer quitação on-line.');
check(tables.includes("['autorizado','pago'].includes(order.pagamento_status)"),'Mapa de mesas deve reconhecer quitação on-line.');

for(const contract of [
  'caixas_um_aberto_por_estabelecimento_uidx',
  'pagamentos_caixa_id_fkey',
  'function public.obter_resumo_caixa',
  'function public.registrar_pagamento_caixa',
  'function public.registrar_venda_rapida_caixa',
  "pagamento_status in ('autorizado', 'pago')",
  "cliente_id,\n    codigo",
  "status = 'finalizado'",
  'pg_advisory_xact_lock',
  'for update'
])check(migration.includes(contract),`Migração do caixa sem garantia obrigatória: ${contract}`);

check(/revoke all on function public\.registrar_venda_rapida_caixa\(jsonb\) from public, anon/i.test(migration),'RPC de venda rápida deve revogar execução pública.');
check(/grant execute on function public\.registrar_venda_rapida_caixa\(jsonb\) to authenticated/i.test(migration),'RPC de venda rápida deve ser exclusiva de usuário autenticado.');

if(failures.length){
  console.error('Auditoria do caixa reprovada:');
  failures.forEach(message=>console.error(`- ${message}`));
  process.exit(1);
}

console.log('Auditoria do caixa aprovada: sessão, cobrança, finalização e venda rápida protegidas.');
