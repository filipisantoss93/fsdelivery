import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const operational = await readFile(new URL('js/loja-operacional.js', root), 'utf8');
const migration = await readFile(new URL('supabase/migrations/20261004211400_corrigir_escopo_publico_garcom.sql', root), 'utf8');

assert.ok(operational.includes('<option value="delivery">Entrega</option><option value="pickup">Retirada</option>'));
assert.ok(!operational.includes('<option value="local">Comer no local</option>'));
assert.ok(migration.includes("if lower(coalesce(payload->>'tipo','')) = 'local'"));
assert.ok(migration.includes("Para consumo local, faça o pedido pelo QR Code da mesa."));
assert.ok(migration.includes("where pedido->>'tipo' = 'mesa'"));
assert.ok(migration.includes("pedido - 'cliente_nome' - 'cliente_telefone'"));
assert.ok(migration.includes("if lower(coalesce(payload->>'tipo','')) <> 'mesa'"));
assert.ok(migration.includes("nullif(payload->>'mesa_id','') is null"));
console.log('Regressões do checkout público e escopo do garçom aprovadas.');
