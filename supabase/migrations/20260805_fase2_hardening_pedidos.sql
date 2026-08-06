begin;

create table if not exists public.cliente_dispositivos (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  criado_em timestamptz not null default now(),
  ultimo_acesso_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '180 days'),
  revogado_em timestamptz
);

alter table public.cliente_dispositivos enable row level security;
revoke all on table public.cliente_dispositivos from public, anon, authenticated;
grant select, insert, update, delete on table public.cliente_dispositivos to service_role;

create index if not exists cliente_dispositivos_cliente_ativo_idx
  on public.cliente_dispositivos (estabelecimento_id, cliente_id, expira_em desc)
  where revogado_em is null;

create or replace function public.vincular_dispositivo_cliente(
  p_slug text,
  p_telefone text,
  p_checkout_token uuid
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_estabelecimento uuid;
  v_cliente uuid;
  v_token text;
  v_token_hash text;
begin
  if char_length(v_telefone) < 10 or char_length(v_telefone) > 13 then
    raise exception 'WhatsApp inválido';
  end if;

  if p_checkout_token is null then
    raise exception 'Comprovante do pedido ausente';
  end if;

  select p.estabelecimento_id, p.cliente_id
    into v_estabelecimento, v_cliente
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  join public.clientes c on c.id = p.cliente_id
  where e.slug = trim(p_slug)
    and p.checkout_token = p_checkout_token
    and p.cliente_id is not null
    and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
    and p.origem in ('publico', 'qr_mesa')
    and p.created_at >= now() - interval '24 hours'
  limit 1;

  if v_cliente is null then
    raise exception 'Pedido não localizado para vincular este dispositivo';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.cliente_dispositivos (
    estabelecimento_id,
    cliente_id,
    token_hash,
    criado_em,
    ultimo_acesso_em,
    expira_em
  ) values (
    v_estabelecimento,
    v_cliente,
    v_token_hash,
    now(),
    now(),
    now() + interval '180 days'
  );

  update public.cliente_dispositivos d
  set revogado_em = now()
  where d.id in (
    select antigo.id
    from public.cliente_dispositivos antigo
    where antigo.estabelecimento_id = v_estabelecimento
      and antigo.cliente_id = v_cliente
      and antigo.revogado_em is null
    order by antigo.criado_em desc
    offset 5
  );

  return v_token;
end;
$$;

revoke all on function public.vincular_dispositivo_cliente(text, text, uuid) from public, anon, authenticated;
grant execute on function public.vincular_dispositivo_cliente(text, text, uuid) to anon, authenticated;

revoke all on function public.consultar_pedidos_cliente(text, text) from public, anon, authenticated;
drop function if exists public.consultar_pedidos_cliente(text, text);

create or replace function public.consultar_pedidos_cliente(
  p_slug text,
  p_telefone text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_token_hash text;
  v_estabelecimento uuid;
  v_cliente uuid;
  v_dispositivo uuid;
  v_resultado jsonb;
begin
  if char_length(v_telefone) < 10 or char_length(v_telefone) > 13 then
    raise exception 'WhatsApp inválido';
  end if;

  if char_length(trim(coalesce(p_token, ''))) <> 64 then
    raise exception 'Dispositivo não autorizado';
  end if;

  v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  select d.id, d.estabelecimento_id, d.cliente_id
    into v_dispositivo, v_estabelecimento, v_cliente
  from public.cliente_dispositivos d
  join public.estabelecimentos e on e.id = d.estabelecimento_id
  join public.clientes c on c.id = d.cliente_id
  where e.slug = trim(p_slug)
    and d.token_hash = v_token_hash
    and d.revogado_em is null
    and d.expira_em > now()
    and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
  limit 1;

  if v_dispositivo is null then
    raise exception 'Dispositivo não autorizado';
  end if;

  update public.cliente_dispositivos
  set ultimo_acesso_em = now()
  where id = v_dispositivo;

  select coalesce(jsonb_agg(pedido order by (pedido->>'created_at')::timestamptz desc), '[]'::jsonb)
    into v_resultado
  from (
    select jsonb_build_object(
      'id', p.id,
      'codigo', p.codigo,
      'status', p.status,
      'status_entrega', p.status_entrega,
      'tipo', p.tipo,
      'subtotal', p.subtotal,
      'taxa_entrega', p.taxa_entrega,
      'taxa_servico', p.taxa_servico,
      'desconto', p.desconto,
      'total', p.total,
      'forma_pagamento', p.forma_pagamento,
      'troco_para', p.troco_para,
      'endereco_entrega', p.endereco_entrega,
      'observacoes', p.observacoes,
      'created_at', p.created_at,
      'atualizado_em', p.atualizado_em,
      'saiu_para_entrega_em', p.saiu_para_entrega_em,
      'entregue_em', p.entregue_em,
      'origem', p.origem,
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'produto_id', i.produto_id,
          'nome', i.nome_produto,
          'quantidade', i.quantidade,
          'valor_unitario', i.valor_unitario,
          'observacoes', i.observacoes,
          'total', i.total
        ) order by i.id)
        from public.itens_pedido i
        where i.pedido_id = p.id
      ), '[]'::jsonb)
    ) as pedido
    from public.pedidos p
    where p.estabelecimento_id = v_estabelecimento
      and p.cliente_id = v_cliente
      and p.created_at >= now() - interval '90 days'
    order by p.created_at desc
    limit 50
  ) dados;

  return v_resultado;
end;
$$;

revoke all on function public.consultar_pedidos_cliente(text, text, text) from public, anon, authenticated;
grant execute on function public.consultar_pedidos_cliente(text, text, text) to anon, authenticated;

-- Funções exclusivamente internas não devem herdar EXECUTE do papel PUBLIC.
revoke all on function public.abrir_caixa(uuid, numeric) from public, anon;
grant execute on function public.abrir_caixa(uuid, numeric) to authenticated;
revoke all on function public.fechar_caixa(uuid, numeric, text) from public, anon;
grant execute on function public.fechar_caixa(uuid, numeric, text) to authenticated;
revoke all on function public.caixa_aberto(uuid) from public, anon;
grant execute on function public.caixa_aberto(uuid) to authenticated;
revoke all on function public.concluir_pedido_cozinha(bigint) from public, anon;
grant execute on function public.concluir_pedido_cozinha(bigint) to authenticated;

-- Tabelas internas continuam acessíveis apenas por funções controladas ou service role.
revoke all on table public.app_runtime_secrets from anon, authenticated;
revoke all on table public.checkout_publico_logs from anon, authenticated;
revoke all on table public.notificacoes_operacionais_leituras from anon, authenticated;
revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.webhook_eventos_efi from anon, authenticated;

-- Remove políticas redundantes e evita reavaliar auth.uid() para cada linha.
drop policy if exists "dono visualiza enderecos de clientes" on public.cliente_enderecos;
drop policy if exists notificacoes_operacionais_owner_select on public.notificacoes_operacionais;
drop policy if exists notificacoes_operacionais_owner_update on public.notificacoes_operacionais;

alter policy "dono gerencia caixas" on public.caixas
  using (exists (select 1 from public.estabelecimentos e where e.id = caixas.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = caixas.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono gerencia enderecos de clientes" on public.cliente_enderecos
  using (exists (select 1 from public.estabelecimentos e where e.id = cliente_enderecos.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = cliente_enderecos.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono gerencia configuracoes operacionais" on public.configuracoes_operacionais
  using (exists (select 1 from public.estabelecimentos e where e.id = configuracoes_operacionais.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = configuracoes_operacionais.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono gerencia cupons" on public.cupons
  using (exists (select 1 from public.estabelecimentos e where e.id = cupons.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = cupons.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono gerencia equipe operacional" on public.equipe_operacional
  using (exists (select 1 from public.estabelecimentos e where e.id = equipe_operacional.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = equipe_operacional.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono gerencia horarios" on public.horarios_funcionamento
  using (exists (select 1 from public.estabelecimentos e where e.id = horarios_funcionamento.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = horarios_funcionamento.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy proprietario_gerencia_notificacoes on public.notificacoes_operacionais
  using (exists (select 1 from public.estabelecimentos e where e.id = notificacoes_operacionais.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = notificacoes_operacionais.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono visualiza pagamentos" on public.pagamentos
  using (exists (select 1 from public.estabelecimentos e where e.id = pagamentos.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy pedido_eventos_owner_select on public.pedido_eventos
  using (exists (select 1 from public.estabelecimentos e where e.id = pedido_eventos.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy push_subscriptions_owner_select on public.push_subscriptions_operacionais
  using (exists (select 1 from public.estabelecimentos e where e.id = push_subscriptions_operacionais.estabelecimento_id and e.usuario_id = (select auth.uid())));

alter policy "dono gerencia taxas por regiao" on public.taxas_entrega_regioes
  using (exists (select 1 from public.estabelecimentos e where e.id = taxas_entrega_regioes.estabelecimento_id and e.usuario_id = (select auth.uid())))
  with check (exists (select 1 from public.estabelecimentos e where e.id = taxas_entrega_regioes.estabelecimento_id and e.usuario_id = (select auth.uid())));

-- Índices para FKs e remoção de uma duplicata comprovada.
create index if not exists assinaturas_estabelecimento_id_idx on public.assinaturas(estabelecimento_id);
create index if not exists assinaturas_plano_id_idx on public.assinaturas(plano_id);
create index if not exists caixas_aberto_por_idx on public.caixas(aberto_por);
create index if not exists caixas_estabelecimento_id_idx on public.caixas(estabelecimento_id);
create index if not exists cobrancas_cartao_assinatura_id_idx on public.cobrancas_cartao(assinatura_id);
create index if not exists cobrancas_cartao_plano_id_idx on public.cobrancas_cartao(plano_id);
create index if not exists cobrancas_pix_assinatura_id_idx on public.cobrancas_pix(assinatura_id);
create index if not exists cobrancas_pix_plano_id_idx on public.cobrancas_pix(plano_id);
create index if not exists itens_pedido_adicionais_item_pedido_id_idx on public.itens_pedido_adicionais(item_pedido_id);
create index if not exists notificacoes_operacionais_destinatario_id_idx on public.notificacoes_operacionais(destinatario_id);
create index if not exists notificacoes_operacionais_leituras_destinatario_id_idx on public.notificacoes_operacionais_leituras(destinatario_id);
create index if not exists push_subscriptions_operacionais_destinatario_id_idx on public.push_subscriptions_operacionais(destinatario_id);

drop index if exists public.idx_notificacoes_operacionais_destino;

commit;
