import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('supabase/migrations/20261005005214_20261004211500_sessoes_seguras_e_limitar_pin_equipe.sql', root), 'utf8');
const login = await readFile(new URL('js/acesso-equipe.js', root), 'utf8');
const legacyLogin = await readFile(new URL('js/equipe-acesso.js', root), 'utf8');
const waiter = await readFile(new URL('js/garcom-core.js', root), 'utf8');
const courier = await readFile(new URL('js/entregador-core.js', root), 'utf8');

assert.ok(migration.includes("v_tentativas >= 8"));
assert.ok(migration.includes("now()+interval '15 minutes'"));
assert.ok(migration.includes("extensions.digest(v_token,'sha256')"));
assert.ok(migration.includes("create table if not exists public.equipe_sessoes_operacionais"));
assert.ok(migration.includes("create table if not exists public.equipe_limite_login"));
for (const fn of [
  'atualizar_entrega_equipe','carregar_operacao_garcom','criar_pedido_equipe_garcom',
  'finalizar_pedido_equipe_garcom','fsdelivery_membro_operacional','listar_entregas_equipe',
  'listar_notificacoes_equipe','marcar_notificacao_equipe_lida','marcar_pedido_servido_equipe_garcom',
  'registrar_localizacao_entregador','registrar_push_equipe'
]) assert.ok(migration.includes('public.' + fn), 'sessão deve proteger ' + fn);
assert.ok(login.includes('pin:session_token||pin'));
assert.ok(!login.includes('...member,'));
assert.ok(legacyLogin.includes('pin:session_token'));
assert.ok(waiter.includes('encerrar_sessao_equipe'));
assert.ok(courier.includes('encerrar_sessao_equipe'));
console.log('Regressões das sessões da equipe aprovadas.');
