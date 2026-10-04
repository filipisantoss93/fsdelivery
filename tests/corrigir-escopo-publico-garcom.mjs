import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const operational = await readFile(new URL('js/loja-operacional.js', root), 'utf8');
const migration = await readFile(new URL('supabase/migrations/20261004_corrigir_escopo_publico_garcom.sql', root), 'utf8');

assert.match(operational, /<option value="delivery">Entrega<\/option><option value="pickup">Retirada<\/option>/);
assert.doesNotMatch(operational, /<option value="local">Comer no local<\/option>/);
assert.match(migration, /criar_pedido_publico\(jsonb\)[\s\S]*?tipo',''\) = 'local'[\s\S]*?QR Code da mesa/i);
assert.match(migration, /carregar_operacao_garcom\(text, text\)[\s\S]*?pedido->>'tipo' = 'mesa'[\s\S]*?cliente_nome'[\s\S]*?cliente_telefone'/);
assert.match(migration, /criar_pedido_equipe_garcom\(text, text, jsonb\)[\s\S]*?tipo',''\) <> 'mesa'[\s\S]*?mesa_id/);
console.log('Regressões do checkout público e escopo do garçom aprovadas.');
