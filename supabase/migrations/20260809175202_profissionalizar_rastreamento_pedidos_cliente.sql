-- FS Delivery - rastreamento profissional e seguro de pedidos do cliente.
-- Cada aparelho acessa somente os pedidos explicitamente vinculados a ele.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.normalizar_whatsapp(valor text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when char_length(limpo) between 12 and 13 and left(limpo, 2) = '55'
      then substring(limpo from 3)
    when char_length(limpo) between 11 and 12 and left(limpo, 1) = '0'
      then substring(limpo from 2)
    else limpo
  end
  from (select regexp_replace(valor, '\D', '', 'g') as limpo) dados;
$$;

do $$
begin
  if exists (
    select 1
    from public.clientes c
    where public.normalizar_whatsapp(coalesce(c.telefone, '')) <> ''
    group by c.estabelecimento_id, public.normalizar_whatsapp(coalesce(c.telefone, ''))
    having count(*) > 1
  ) then
    raise exception 'A normalização brasileira de WhatsApp encontrou clientes duplicados';
  end if;
end;
$$;

update public.clientes
set telefone = public.normalizar_whatsapp(telefone),
    telefone_normalizado = public.normalizar_whatsapp(telefone)
where telefone is not null
  and public.normalizar_whatsapp(telefone) <> ''
  and (
    telefone is distinct from public.normalizar_whatsapp(telefone)
    or telefone_normalizado is distinct from public.normalizar_whatsapp(telefone)
  );

create table if not exists public.cliente_dispositivo_pedidos (
  id uuid primary key default gen_random_uuid(),
  dispositivo_id uuid not null references public.cliente_dispositivos(id) on delete cascade,
  pedido_id bigint not null references public.pedidos(id) on delete cascade,
  origem text not null check (origem in ('checkout', 'recuperacao', 'legado')),
  criado_em timestamptz not null default now(),
  unique (dispositivo_id, pedido_id)
);

create index if not exists cliente_dispositivo_pedidos_pedido_idx
  on public.cliente_dispositivo_pedidos (pedido_id, criado_em desc);

create table if not exists public.pedido_rastreamento_credenciais (
  pedido_id bigint primary key references public.pedidos(id) on delete cascade,
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  dispositivo_inicial_id uuid not null references public.cliente_dispositivos(id) on delete restrict,
  codigo_recuperacao_hash text not null check (char_length(codigo_recuperacao_hash) = 64),
  tentativas_invalidas smallint not null default 0 check (tentativas_invalidas between 0 and 20),
  bloqueado_ate timestamptz,
  ultima_tentativa_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists pedido_rastreamento_credenciais_cliente_idx
  on public.pedido_rastreamento_credenciais (estabelecimento_id, cliente_id, criado_em desc);

create table if not exists public.pedido_rastreamento_config (
  id boolean primary key default true check (id),
  corte_legado_em timestamptz not null
);

insert into public.pedido_rastreamento_config (id, corte_legado_em)
values (true, now())
on conflict (id) do nothing;

alter table public.cliente_dispositivo_pedidos enable row level security;
alter table public.pedido_rastreamento_credenciais enable row level security;
alter table public.pedido_rastreamento_config enable row level security;

revoke all on table public.cliente_dispositivo_pedidos from public, anon, authenticated;
revoke all on table public.pedido_rastreamento_credenciais from public, anon, authenticated;
revoke all on table public.pedido_rastreamento_config from public, anon, authenticated;
grant select, insert, update, delete on table public.cliente_dispositivo_pedidos to service_role;
grant select, insert, update, delete on table public.pedido_rastreamento_credenciais to service_role;
grant select on table public.pedido_rastreamento_config to service_role;

create or replace function private.normalizar_codigo_rastreamento(valor text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select upper(regexp_replace(coalesce(valor, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function private.obter_ou_criar_dispositivo(
  p_estabelecimento uuid,
  p_cliente uuid,
  p_token text
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  v_token text := lower(trim(coalesce(p_token, '')));
  v_hash text;
  v_dispositivo public.cliente_dispositivos%rowtype;
begin
  if v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Credencial do aparelho inválida';
  end if;

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  select d.* into v_dispositivo
  from public.cliente_dispositivos d
  where d.token_hash = v_hash
  for update;

  if found then
    if v_dispositivo.estabelecimento_id <> p_estabelecimento
       or v_dispositivo.cliente_id <> p_cliente
       or v_dispositivo.revogado_em is not null then
      raise exception 'Credencial do aparelho inválida';
    end if;

    update public.cliente_dispositivos
    set ultimo_acesso_em = now(),
        expira_em = greatest(expira_em, now() + interval '180 days')
    where id = v_dispositivo.id;

    return v_dispositivo.id;
  end if;

  insert into public.cliente_dispositivos (
    estabelecimento_id,
    cliente_id,
    token_hash,
    criado_em,
    ultimo_acesso_em,
    expira_em
  ) values (
    p_estabelecimento,
    p_cliente,
    v_hash,
    now(),
    now(),
    now() + interval '180 days'
  )
  returning id into v_dispositivo.id;

  return v_dispositivo.id;
exception
  when unique_violation then
    select d.* into v_dispositivo
    from public.cliente_dispositivos d
    where d.token_hash = v_hash
    for update;

    if not found
       or v_dispositivo.estabelecimento_id <> p_estabelecimento
       or v_dispositivo.cliente_id <> p_cliente
       or v_dispositivo.revogado_em is not null then
      raise exception 'Credencial do aparelho inválida';
    end if;

    return v_dispositivo.id;
end;
$$;

create or replace function public.vincular_pedido_dispositivo(
  p_slug text,
  p_telefone text,
  p_checkout_token uuid,
  p_token text,
  p_codigo_recuperacao text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_codigo_recuperacao text := private.normalizar_codigo_rastreamento(p_codigo_recuperacao);
  v_codigo_hash text;
  v_pedido public.pedidos%rowtype;
  v_dispositivo uuid;
  v_credencial public.pedido_rastreamento_credenciais%rowtype;
begin
  if char_length(v_telefone) not between 10 and 11 then
    raise exception 'WhatsApp inválido';
  end if;
  if p_checkout_token is null then
    raise exception 'Comprovante do pedido ausente';
  end if;
  if char_length(v_codigo_recuperacao) <> 10 then
    raise exception 'Código de recuperação inválido';
  end if;

  select p.* into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  join public.clientes c on c.id = p.cliente_id
  where e.slug = trim(p_slug)
    and p.checkout_token = p_checkout_token
    and p.cliente_id is not null
    and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
    and p.origem in ('publico', 'qr_mesa')
    and p.created_at >= now() - interval '24 hours'
  limit 1
  for update of p;

  if not found then
    raise exception 'Não foi possível validar o acompanhamento deste pedido';
  end if;

  v_dispositivo := private.obter_ou_criar_dispositivo(
    v_pedido.estabelecimento_id,
    v_pedido.cliente_id,
    p_token
  );
  v_codigo_hash := encode(extensions.digest(v_codigo_recuperacao, 'sha256'), 'hex');

  select r.* into v_credencial
  from public.pedido_rastreamento_credenciais r
  where r.pedido_id = v_pedido.id
  for update;

  if found then
    if v_credencial.dispositivo_inicial_id <> v_dispositivo
       or v_credencial.codigo_recuperacao_hash <> v_codigo_hash then
      raise exception 'O comprovante deste pedido já foi utilizado';
    end if;
    update public.pedido_rastreamento_credenciais
    set atualizado_em = now()
    where pedido_id = v_pedido.id;
  else
    insert into public.pedido_rastreamento_credenciais (
      pedido_id,
      estabelecimento_id,
      cliente_id,
      dispositivo_inicial_id,
      codigo_recuperacao_hash
    ) values (
      v_pedido.id,
      v_pedido.estabelecimento_id,
      v_pedido.cliente_id,
      v_dispositivo,
      v_codigo_hash
    );
  end if;

  insert into public.cliente_dispositivo_pedidos (dispositivo_id, pedido_id, origem)
  values (v_dispositivo, v_pedido.id, 'checkout')
  on conflict (dispositivo_id, pedido_id) do nothing;

  return jsonb_build_object(
    'vinculado', true,
    'pedido', v_pedido.codigo,
    'expira_em', now() + interval '180 days'
  );
end;
$$;

-- Compatibilidade segura com o frontend anterior durante a troca de versão.
create or replace function public.vincular_dispositivo_cliente(
  p_slug text,
  p_telefone text,
  p_checkout_token uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_token text;
  v_codigo text;
begin
  if p_checkout_token is null then
    raise exception 'Comprovante do pedido ausente';
  end if;

  v_token := encode(extensions.digest(p_checkout_token::text || ':fsdelivery-device-v2', 'sha256'), 'hex');
  v_codigo := upper(substring(encode(extensions.digest(p_checkout_token::text || ':fsdelivery-recovery-v2', 'sha256'), 'hex') from 1 for 10));

  perform public.vincular_pedido_dispositivo(
    p_slug,
    p_telefone,
    p_checkout_token,
    v_token,
    v_codigo
  );

  return v_token;
end;
$$;

create or replace function public.recuperar_pedido_dispositivo(
  p_slug text,
  p_telefone text,
  p_codigo_pedido text,
  p_codigo_recuperacao text,
  p_token text,
  p_novo_codigo_recuperacao text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_codigo text := private.normalizar_codigo_rastreamento(p_codigo_recuperacao);
  v_novo_codigo text := private.normalizar_codigo_rastreamento(p_novo_codigo_recuperacao);
  v_pedido_id bigint;
  v_pedido_codigo text;
  v_estabelecimento uuid;
  v_cliente uuid;
  v_hash text;
  v_hash_esperado text;
  v_tentativas smallint;
  v_bloqueado_ate timestamptz;
  v_dispositivo uuid;
begin
  if char_length(v_telefone) not between 10 and 11
     or char_length(v_codigo) <> 10
     or char_length(v_novo_codigo) <> 10 then
    raise exception 'Não foi possível recuperar este pedido';
  end if;

  select p.id, p.codigo, p.estabelecimento_id, p.cliente_id,
         r.codigo_recuperacao_hash, r.tentativas_invalidas, r.bloqueado_ate
    into v_pedido_id, v_pedido_codigo, v_estabelecimento, v_cliente,
         v_hash_esperado, v_tentativas, v_bloqueado_ate
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  join public.clientes c on c.id = p.cliente_id
  join public.pedido_rastreamento_credenciais r on r.pedido_id = p.id
  where e.slug = trim(p_slug)
    and upper(p.codigo) = upper(trim(p_codigo_pedido))
    and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
    and p.created_at >= now() - interval '90 days'
  limit 1
  for update of r;

  if not found then
    raise exception 'Não foi possível recuperar este pedido';
  end if;

  if v_bloqueado_ate is not null and v_bloqueado_ate > now() then
    raise exception 'Muitas tentativas. Aguarde alguns minutos e tente novamente';
  end if;
  if v_bloqueado_ate is not null and v_bloqueado_ate <= now() then
    v_tentativas := 0;
  end if;

  v_hash := encode(extensions.digest(v_codigo, 'sha256'), 'hex');
  if v_hash <> v_hash_esperado then
    v_tentativas := least(20, coalesce(v_tentativas, 0) + 1);
    update public.pedido_rastreamento_credenciais
    set tentativas_invalidas = v_tentativas,
        ultima_tentativa_em = now(),
        bloqueado_ate = case when v_tentativas >= 5 then now() + interval '15 minutes' else null end,
        atualizado_em = now()
    where pedido_id = v_pedido_id;
    raise exception 'Não foi possível recuperar este pedido';
  end if;

  v_dispositivo := private.obter_ou_criar_dispositivo(v_estabelecimento, v_cliente, p_token);

  insert into public.cliente_dispositivo_pedidos (dispositivo_id, pedido_id, origem)
  values (v_dispositivo, v_pedido_id, 'recuperacao')
  on conflict (dispositivo_id, pedido_id) do nothing;

  update public.pedido_rastreamento_credenciais
  set codigo_recuperacao_hash = encode(extensions.digest(v_novo_codigo, 'sha256'), 'hex'),
      tentativas_invalidas = 0,
      bloqueado_ate = null,
      ultima_tentativa_em = now(),
      atualizado_em = now()
  where pedido_id = v_pedido_id;

  delete from public.cliente_dispositivo_pedidos vinculo
  where vinculo.id in (
    select antigo.id
    from public.cliente_dispositivo_pedidos antigo
    where antigo.pedido_id = v_pedido_id
    order by antigo.criado_em desc, antigo.id desc
    offset 3
  );

  return jsonb_build_object('recuperado', true, 'pedido', v_pedido_codigo);
end;
$$;

-- Transição única para pedidos criados nas 24 horas anteriores ao corte.
create or replace function public.vincular_pedido_legado_dispositivo(
  p_slug text,
  p_telefone text,
  p_codigo_pedido text,
  p_criado_em_aproximado timestamptz,
  p_token text,
  p_codigo_recuperacao text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_codigo text := private.normalizar_codigo_rastreamento(p_codigo_recuperacao);
  v_corte timestamptz;
  v_pedido public.pedidos%rowtype;
  v_dispositivo uuid;
begin
  if char_length(v_telefone) not between 10 and 11
     or char_length(v_codigo) <> 10
     or p_criado_em_aproximado is null then
    raise exception 'Não foi possível restaurar o acompanhamento';
  end if;

  select corte_legado_em into v_corte
  from public.pedido_rastreamento_config
  where id = true;

  select p.* into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  join public.clientes c on c.id = p.cliente_id
  where e.slug = trim(p_slug)
    and upper(p.codigo) = upper(trim(p_codigo_pedido))
    and p.origem in ('publico', 'qr_mesa')
    and p.created_at >= v_corte - interval '24 hours'
    and p.created_at < v_corte
    and abs(extract(epoch from (p.created_at - p_criado_em_aproximado))) <= 600
    and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
  limit 1
  for update of p;

  if not found or exists (
    select 1 from public.pedido_rastreamento_credenciais r where r.pedido_id = v_pedido.id
  ) then
    raise exception 'Não foi possível restaurar o acompanhamento';
  end if;

  v_dispositivo := private.obter_ou_criar_dispositivo(
    v_pedido.estabelecimento_id,
    v_pedido.cliente_id,
    p_token
  );

  insert into public.pedido_rastreamento_credenciais (
    pedido_id,
    estabelecimento_id,
    cliente_id,
    dispositivo_inicial_id,
    codigo_recuperacao_hash
  ) values (
    v_pedido.id,
    v_pedido.estabelecimento_id,
    v_pedido.cliente_id,
    v_dispositivo,
    encode(extensions.digest(v_codigo, 'sha256'), 'hex')
  );

  insert into public.cliente_dispositivo_pedidos (dispositivo_id, pedido_id, origem)
  values (v_dispositivo, v_pedido.id, 'legado')
  on conflict (dispositivo_id, pedido_id) do nothing;

  return jsonb_build_object('vinculado', true, 'pedido', v_pedido.codigo);
end;
$$;

create or replace function public.consultar_pedidos_cliente(
  p_slug text,
  p_telefone text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_token text := lower(trim(coalesce(p_token, '')));
  v_token_hash text;
  v_estabelecimento uuid;
  v_cliente uuid;
  v_dispositivo uuid;
  v_resultado jsonb;
begin
  if char_length(v_telefone) not between 10 and 11
     or v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Acesso não autorizado';
  end if;

  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

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
    raise exception 'Acesso não autorizado';
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
      'pagamento_status', p.pagamento_status,
      'troco_para', p.troco_para,
      'endereco_entrega', p.endereco_entrega,
      'observacoes', p.observacoes,
      'created_at', p.created_at,
      'atualizado_em', p.atualizado_em,
      'saiu_para_entrega_em', p.saiu_para_entrega_em,
      'entregue_em', p.entregue_em,
      'origem', p.origem,
      'eventos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', ev.status_novo,
          'created_at', ev.created_at
        ) order by ev.created_at)
        from public.pedido_eventos ev
        where ev.pedido_id = p.id
      ), '[]'::jsonb),
      'itens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
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
    join public.cliente_dispositivo_pedidos vinculo
      on vinculo.pedido_id = p.id
     and vinculo.dispositivo_id = v_dispositivo
    where p.estabelecimento_id = v_estabelecimento
      and p.cliente_id = v_cliente
      and p.created_at >= now() - interval '90 days'
    order by p.created_at desc
    limit 50
  ) dados;

  return v_resultado;
end;
$$;

revoke all on function public.normalizar_whatsapp(text) from public, anon, authenticated;
revoke all on function private.normalizar_codigo_rastreamento(text) from public, anon, authenticated;
revoke all on function private.obter_ou_criar_dispositivo(uuid, uuid, text) from public, anon, authenticated;

revoke all on function public.vincular_pedido_dispositivo(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.vincular_pedido_dispositivo(text, text, uuid, text, text) to anon, authenticated;

revoke all on function public.vincular_dispositivo_cliente(text, text, uuid) from public, anon, authenticated;
grant execute on function public.vincular_dispositivo_cliente(text, text, uuid) to anon, authenticated;

revoke all on function public.recuperar_pedido_dispositivo(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.recuperar_pedido_dispositivo(text, text, text, text, text, text) to anon, authenticated;

revoke all on function public.vincular_pedido_legado_dispositivo(text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.vincular_pedido_legado_dispositivo(text, text, text, timestamptz, text, text) to anon, authenticated;

revoke all on function public.consultar_pedidos_cliente(text, text, text) from public, anon, authenticated;
grant execute on function public.consultar_pedidos_cliente(text, text, text) to anon, authenticated;

comment on table public.cliente_dispositivo_pedidos is
  'Permissões explícitas de acompanhamento: um token de aparelho acessa somente pedidos vinculados.';
comment on table public.pedido_rastreamento_credenciais is
  'Credenciais de recuperação por pedido armazenadas exclusivamente como hash e protegidas contra tentativas.';
comment on function public.vincular_pedido_dispositivo(text, text, uuid, text, text) is
  'Vincula idempotentemente o pedido recém-criado ao aparelho que possui o checkout token.';
comment on function public.recuperar_pedido_dispositivo(text, text, text, text, text, text) is
  'Recupera somente um pedido, limita tentativas e rotaciona o código após o uso.';
comment on function public.consultar_pedidos_cliente(text, text, text) is
  'Retorna apenas pedidos explicitamente vinculados ao token do aparelho; telefone sozinho nunca autoriza histórico.';
