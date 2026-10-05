-- Troca PIN reutilizado por sessões aleatórias de curta duração e limita tentativas de login.
create table if not exists public.equipe_sessoes_operacionais (
  token_hash text primary key,
  equipe_id uuid not null references public.equipe_operacional(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index if not exists equipe_sessoes_operacionais_expira_idx
  on public.equipe_sessoes_operacionais (expira_em);
create index if not exists equipe_limite_login_janela_idx
  on public.equipe_limite_login (janela_inicio);
alter table public.equipe_sessoes_operacionais enable row level security;
revoke all on table public.equipe_sessoes_operacionais from public, anon, authenticated;

create table if not exists public.equipe_limite_login (
  chave_hash text primary key,
  tentativas integer not null default 0,
  janela_inicio timestamptz not null default now(),
  bloqueado_ate timestamptz
);
alter table public.equipe_limite_login enable row level security;
revoke all on table public.equipe_limite_login from public, anon, authenticated;

create or replace function public.resolver_pin_equipe(
  p_telefone text,
  p_token text,
  p_funcao text,
  p_slug text default null
)
returns text
language sql
security definer
set search_path = public
as $function$
  select m.pin
  from public.equipe_sessoes_operacionais s
  join public.equipe_operacional m on m.id = s.equipe_id
  join public.estabelecimentos e on e.id = m.estabelecimento_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex')
    and s.expira_em > now()
    and m.ativo = true
    and m.funcao = p_funcao
    and regexp_replace(m.telefone, '[^0-9]', '', 'g') = regexp_replace(coalesce(p_telefone,''), '[^0-9]', '', 'g')
    and (p_slug is null or e.slug = p_slug)
  limit 1
$function$;
revoke all on function public.resolver_pin_equipe(text,text,text,text) from public, anon, authenticated;

create or replace function public.encerrar_sessao_equipe(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
begin
  delete from public.equipe_sessoes_operacionais
  where token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
  return found;
end;
$function$;
revoke all on function public.encerrar_sessao_equipe(text) from public;
grant execute on function public.encerrar_sessao_equipe(text) to anon, authenticated;

create or replace function public.autenticar_equipe_por_whatsapp(p_telefone text, p_pin text, p_funcao text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_telefone text := regexp_replace(coalesce(p_telefone,''), '[^0-9]', '', 'g');
  v_chave text;
  v_tentativas integer := 0;
  v_bloqueado timestamptz;
  v_contagem integer;
  v_m public.equipe_operacional%rowtype;
  v_est public.estabelecimentos%rowtype;
  v_token text;
  v_funcao_valida boolean;
begin
  v_chave := encode(extensions.digest(v_telefone, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtext(v_chave));
  with stale as (
    select chave_hash from public.equipe_limite_login
    where janela_inicio < now() - interval '1 day'
    order by janela_inicio limit 100
  ) delete from public.equipe_limite_login l using stale s where l.chave_hash=s.chave_hash;

  select tentativas, bloqueado_ate
    into v_tentativas, v_bloqueado
  from public.equipe_limite_login
  where chave_hash = v_chave;

  if v_bloqueado > now() then
    return jsonb_build_object('error', 'Telefone ou PIN inválido ou temporariamente bloqueado. Aguarde 15 minutos.');
  end if;

  v_funcao_valida := p_funcao in ('garcom','entregador','equipe');
  if length(v_telefone) not between 10 and 11
     or coalesce(p_pin,'') !~ '^[0-9]{4,6}$'
     or not v_funcao_valida then
    v_contagem := 0;
  else
    select count(*) into v_contagem
    from public.equipe_operacional m
    where regexp_replace(m.telefone, '[^0-9]', '', 'g') = v_telefone
      and m.pin = p_pin
      and m.ativo = true
      and (
        (p_funcao = 'equipe' and m.funcao in ('garcom','entregador'))
        or m.funcao = p_funcao
      );
  end if;

  if v_contagem <> 1 then
    if exists (
      select 1 from public.equipe_limite_login
      where chave_hash = v_chave and janela_inicio >= now() - interval '15 minutes'
    ) then
      v_tentativas := v_tentativas + 1;
    else
      v_tentativas := 1;
    end if;

    insert into public.equipe_limite_login(chave_hash,tentativas,janela_inicio,bloqueado_ate)
    values(v_chave,v_tentativas,now(),case when v_tentativas >= 8 then now()+interval '15 minutes' else null end)
    on conflict(chave_hash) do update set
      tentativas = excluded.tentativas,
      janela_inicio = case when public.equipe_limite_login.janela_inicio < now()-interval '15 minutes' then now() else public.equipe_limite_login.janela_inicio end,
      bloqueado_ate = excluded.bloqueado_ate;

    return jsonb_build_object('error', 'Telefone ou PIN inválido ou temporariamente bloqueado. Aguarde 15 minutos.');
  end if;

  select * into v_m
  from public.equipe_operacional m
  where regexp_replace(m.telefone, '[^0-9]', '', 'g') = v_telefone
    and m.pin = p_pin
    and m.ativo = true
    and (
      (p_funcao = 'equipe' and m.funcao in ('garcom','entregador'))
      or m.funcao = p_funcao
    )
  limit 1;
  select * into v_est from public.estabelecimentos where id = v_m.estabelecimento_id;

  delete from public.equipe_limite_login where chave_hash = v_chave;
  delete from public.equipe_sessoes_operacionais where expira_em <= now();

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.equipe_sessoes_operacionais(token_hash,equipe_id,expira_em)
  values(encode(extensions.digest(v_token,'sha256'),'hex'),v_m.id,now()+interval '12 hours');

  return jsonb_build_object(
    'id',v_m.id,
    'nome',v_m.nome,
    'funcao',v_m.funcao,
    'estabelecimento_id',v_m.estabelecimento_id,
    'restaurante',v_est.nome,
    'slug',v_est.slug,
    'permissoes',coalesce(v_m.permissoes,'{}'::jsonb),
    'session_token',v_token
  );
end;
$function$;
revoke all on function public.autenticar_equipe_por_whatsapp(text,text,text) from public;
grant execute on function public.autenticar_equipe_por_whatsapp(text,text,text) to anon, authenticated;

create or replace function public.autenticar_equipe(p_slug text, p_telefone text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_member jsonb;
begin
  v_member := public.autenticar_equipe_por_whatsapp(p_telefone,p_pin,'equipe');
  if v_member ? 'error' then return v_member; end if;
  if v_member->>'slug' is distinct from lower(trim(coalesce(p_slug,''))) then
    delete from public.equipe_sessoes_operacionais
    where token_hash = encode(extensions.digest(v_member->>'session_token','sha256'),'hex');
    return jsonb_build_object('error','Telefone, PIN ou restaurante inválido.');
  end if;
  return v_member;
end;
$function$;
revoke all on function public.autenticar_equipe(text,text,text) from public;
grant execute on function public.autenticar_equipe(text,text,text) to anon, authenticated;

-- As funções RPC mantêm os mesmos nomes e formatos, mas p_pin agora é o token da sessão.
do $block$
declare
  r record;
  v_oid oid;
  v_definition text;
  v_marker integer;
  v_begin integer;
  v_role text;
  v_slug text;
begin
  for r in
    select * from (values
      ('public.atualizar_entrega_equipe(text,text,text,bigint,text)','entregador','p_slug'),
      ('public.carregar_operacao_garcom(text,text)','garcom',null),
      ('public.criar_pedido_equipe_garcom(text,text,jsonb)','garcom',null),
      ('public.finalizar_pedido_equipe_garcom(text,text,bigint)','garcom',null),
      ('public.fsdelivery_membro_operacional(text,text,text)','p_funcao',null),
      ('public.listar_entregas_equipe(text,text,text)','entregador','p_slug'),
      ('public.listar_notificacoes_equipe(text,text,text,integer)','p_funcao',null),
      ('public.marcar_notificacao_equipe_lida(text,text,text,uuid)','p_funcao',null),
      ('public.marcar_pedido_servido_equipe_garcom(text,text,bigint)','garcom',null),
      ('public.registrar_localizacao_entregador(text,text,text,double precision,double precision)','entregador','p_slug'),
      ('public.registrar_push_equipe(text,text,text,text,text,text,text)','p_funcao',null)
    ) as x(signature,role_expr,slug_expr)
  loop
    v_oid := to_regprocedure(r.signature);
    if v_oid is null then
      raise exception 'Função operacional não encontrada: %', r.signature;
    end if;
    v_definition := pg_get_functiondef(v_oid);
    v_marker := strpos(v_definition, 'AS $function$');
    if v_marker = 0 then raise exception 'Não foi possível localizar o corpo de %', r.signature; end if;
    v_begin := strpos(lower(substr(v_definition,v_marker+length('AS $function$'))), 'begin');
    if v_begin = 0 then raise exception 'Não foi possível localizar BEGIN em %', r.signature; end if;
    v_begin := v_marker + length('AS $function$') + v_begin - 1;
    v_role := case when r.role_expr='p_funcao' then 'p_funcao' else quote_literal(r.role_expr) end;
    v_slug := case when r.slug_expr is null then 'null' else r.slug_expr end;
    v_definition :=
      substr(v_definition,1,v_begin+4)
      || format(E'\n  p_pin := public.resolver_pin_equipe(p_telefone,p_pin,%s,%s);\n',v_role,v_slug)
      || substr(v_definition,v_begin+5);
    execute v_definition;
  end loop;
end;
$block$;
