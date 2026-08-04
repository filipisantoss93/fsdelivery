import { readFile } from 'node:fs/promises';

const checks = [
  {
    file: 'js/loja-fluxos-pedido.js',
    rules: [
      ['Página pública oferece entrega', /value=\\?"delivery\\?"|value='delivery'/],
      ['Página pública oferece retirada', /value=\\?"pickup\\?"|value='pickup'/],
      ['Página pública não oferece consumo local', content => !/value=\\?"local\\?"|value='local'/.test(content)],
      ['Endereço condicionado à entrega', /delivery-street/],
      ['Modalidade obrigatória', /Escolha Entrega ou Retirada/],
      ['Proteção contra envio duplicado', /fs-order-submit-lock|Enviando pedido/]
    ]
  },
  {
    file: 'js/loja-pos-envio.js',
    rules: [
      ['Pós-envio informa aguardando confirmação', /aguardando confirma/i],
      ['Acompanhamento recebe telefone', /telefone/],
      ['Acompanhamento recebe código do pedido', /pedido/]
    ]
  },
  {
    file: 'js/garcom-restricao-salao.js',
    rules: [
      ['Garçom restrito a mesa', /mesa/i],
      ['Garçom não permite entrega', content => !/option[^>]+value=["'](?:delivery|entrega)["']/.test(content)]
    ]
  },
  {
    file: 'js/balcao-fluxos.js',
    rules: [
      ['Balcão possui local', /local/i],
      ['Balcão possui retirada', /retirada/i],
      ['Balcão possui entrega', /entrega/i],
      ['Campos são condicionais', /hidden|style\.display/]
    ]
  },
  {
    file: 'js/entregador-operational.js',
    rules: [
      ['Entregador possui retirada', /retirar|Iniciar entrega/i],
      ['Entregador possui confirmação de entrega', /Confirmar entrega/i],
      ['Entregador possui navegação', /data-map|Navegar/i]
    ]
  },
  {
    file: 'supabase/migrations/20260803_consolidar_fluxos_pedidos.sql',
    rules: [
      ['Pedido online inicia aguardando aprovação', /aguardando_aprovacao/i],
      ['Mesa não recebe endereço', /endereco/i],
      ['Entrega possui validação própria', /entrega/i]
    ]
  }
];

let failures = 0;

for (const check of checks) {
  let content;
  try {
    content = await readFile(new URL(`../${check.file}`, import.meta.url), 'utf8');
  } catch (error) {
    failures++;
    console.error(`✗ Arquivo ausente: ${check.file}`);
    continue;
  }

  for (const [label, rule] of check.rules) {
    const passed = typeof rule === 'function' ? rule(content) : rule.test(content);
    if (passed) console.log(`✓ ${label}`);
    else {
      failures++;
      console.error(`✗ ${label} (${check.file})`);
    }
  }
}

if (failures) {
  console.error(`\nAuditoria reprovada: ${failures} falha(s).`);
  process.exit(1);
}

console.log('\nAuditoria estática dos pedidos aprovada.');
