-- FS Delivery — operação automática de clientes e múltiplos endereços

alter table if exists public.clientes
  add column if not exists token_publico uuid not null default gen_random_uuid(),
  add column if not exists origem_cadastro text not null default 'pedido';

create unique index if not exists clientes_token_publico_uidx
  on public.clientes(token_publico);

create or replace function public.preparar_cliente_whatsapp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.telefone_normalizado := public.normalizar_whatsapp(new.telefone);
  new.telefone := new.telefone_normalizado;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_preparar_cliente_whatsapp on public.clientes;
create trigger trg_preparar_cliente_whatsapp
before insert or update of telefone on public.clientes
for each row execute function public.preparar_cliente_whatsapp();

create or replace function public.endereco_texto_normalizado(valor text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(trim(valor), ''), '\s+', ' ', 'g'));
$$;

create or replace function public.formatar_cliente_endereco(endereco public.cliente_enderecos)
returns text
language sql
stable
as $$
  select concat_ws(', ',
    nullif(trim(endereco.logradouro), ''),
    nullif(trim(endereco.numero), ''),
    nullif(trim(endereco.complemento), ''),
    nullif(trim(endereco.bairro), ''),
    nullif(trim(endereco.cidade), ''),
    nullif(trim(endereco.estado), ''),
    case when nullif(trim(endereco.cep), '') is not null then 'CEP ' || trim(endereco.cep) end,
    nullif(trim(endereco.referencia), '')
  );
$$;

create or replace function public.sincronizar_cliente_endereco_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_texto text;
  v_endereco public.cliente_enderecos%rowtype;
  v_primeiro boolean;
begin
  if new.cliente_id is not null then
    update public.clientes
    set primeiro_pedido_em = coalesce(primeiro_pedido_em, new.created_at, now()),
        ultimo_pedido_em = greatest(coalesce(ultimo_pedido_em, new.created_at, now()), coalesce(new.created_at, now())),
        updated_at = now()
    where id = new.cliente_id;
  end if;

  if new.tipo <> 'entrega' or new.cliente_id is null or new.endereco_entrega is null then
    return new;
  end if;

  v_texto := case
    when jsonb_typeof(to_jsonb(new.endereco_entrega)) = 'string' then trim(both '"' from to_jsonb(new.endereco_entrega)::text)
    else coalesce(
      to_jsonb(new.endereco_entrega)->>'texto',
      concat_ws(', ',
        to_jsonb(new.endereco_entrega)->>'logradouro',
        to_jsonb(new.endereco_entrega)->>'endereco',
        to_jsonb(new.endereco_entrega)->>'numero',
        to_jsonb(new.endereco_entrega)->>'complemento',
        to_jsonb(new.endereco_entrega)->>'bairro',
        to_jsonb(new.endereco_entrega)->>'cidade',
        to_jsonb(new.endereco_entrega)->>'estado',
        to_jsonb(new.endereco_entrega)->>'referencia'
      )
    )
  end;

  v_texto := trim(regexp_replace(coalesce(v_texto, ''), '\s+', ' ', 'g'));
  if v_texto = '' then return new; end if;

  select ce.* into v_endereco
  from public.cliente_enderecos ce
  where ce.cliente_id = new.cliente_id
    and ce.ativo = true
    and public.endereco_texto_normalizado(public.formatar_cliente_endereco(ce)) = public.endereco_texto_normalizado(v_texto)
  order by ce.principal desc, ce.created_at desc
  limit 1;

  if v_endereco.id is null then
    select not exists(
      select 1 from public.cliente_enderecos ce
      where ce.cliente_id = new.cliente_id and ce.ativo = true
    ) into v_primeiro;

    insert into public.cliente_enderecos(
      estabelecimento_id, cliente_id, apelido, logradouro, numero,
      bairro, cidade, referencia, principal
    ) values (
      new.estabelecimento_id, new.cliente_id,
      case when v_primeiro then 'Principal' else 'Endereço ' || (
        select count(*) + 1 from public.cliente_enderecos ce where ce.cliente_id = new.cliente_id
      )::text end,
      v_texto, 's/n', null, null, null, v_primeiro
    ) returning * into v_endereco;
  else
    update public.cliente_enderecos
    set updated_at = now()
    where id = v_endereco.id;
  end if;

  new.cliente_endereco_id := v_endereco.id;
  return new;
end;
$$;

drop trigger if exists trg_sincronizar_cliente_endereco_pedido on public.pedidos;
create trigger trg_sincronizar_cliente_endereco_pedido
before insert on public.pedidos
for each row execute function public.sincronizar_cliente_endereco_pedido();

create or replace function public.vincular_dispositivo_cliente(
  p_slug text,
  p_telefone text,
  p_codigo_pedido text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  select c.token_publico into v_token
  from public.clientes c
  join public.estabelecimentos e on e.id = c.estabelecimento_id
  join public.pedidos p on p.cliente_id = c.id and p.estabelecimento_id = e.id
  where e.slug = trim(p_slug)
    and c.telefone_normalizado = public.normalizar_whatsapp(p_telefone)
    and upper(p.codigo) = upper(trim(p_codigo_pedido))
    and p.created_at >= now() - interval '24 hours'
    and coalesce(p.status, '') <> 'cancelado'
  order by p.created_at desc
  limit 1;

  if v_token is null then
    raise exception 'Não foi possível validar o dispositivo para este cliente.';
  end if;

  return v_token;
end;
$$;

grant execute on function public.vincular_dispositivo_cliente(text,text,text) to anon, authenticated;

create or replace function public.listar_enderecos_cliente_publico(
  p_slug text,
  p_telefone text,
  p_token uuid
)
returns table(
  id uuid,
  apelido text,
  endereco_formatado text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text,
  referencia text,
  principal boolean
)
language sql
security definer
set search_path = public
as $$
  select ce.id, ce.apelido, public.formatar_cliente_endereco(ce), ce.cep,
         ce.logradouro, ce.numero, ce.complemento, ce.bairro, ce.cidade,
         ce.estado, ce.referencia, ce.principal
  from public.cliente_enderecos ce
  join public.clientes c on c.id = ce.cliente_id
  join public.estabelecimentos e on e.id = ce.estabelecimento_id
  where e.slug = trim(p_slug)
    and c.telefone_normalizado = public.normalizar_whatsapp(p_telefone)
    and c.token_publico = p_token
    and ce.ativo = true
  order by ce.principal desc, ce.updated_at desc, ce.created_at desc;
$$;

grant execute on function public.listar_enderecos_cliente_publico(text,text,uuid) to anon, authenticated;

create or replace function public.listar_clientes_resumo(p_estabelecimento uuid)
returns table(
  id uuid,
  nome text,
  telefone text,
  quantidade_pedidos bigint,
  total_gasto numeric,
  ticket_medio numeric,
  ultimo_pedido_em timestamptz,
  quantidade_enderecos bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists(
    select 1 from public.estabelecimentos e
    where e.id = p_estabelecimento and e.usuario_id = auth.uid()
  ) then
    raise exception 'Acesso não autorizado.';
  end if;

  return query
  select c.id, c.nome, coalesce(c.telefone_normalizado, c.telefone),
         count(distinct p.id) filter (where coalesce(p.status,'') <> 'cancelado'),
         coalesce(sum(p.total) filter (where coalesce(p.status,'') <> 'cancelado'),0)::numeric,
         coalesce(avg(p.total) filter (where coalesce(p.status,'') <> 'cancelado'),0)::numeric,
         max(p.created_at) filter (where coalesce(p.status,'') <> 'cancelado'),
         count(distinct ce.id) filter (where ce.ativo = true)
  from public.clientes c
  left join public.pedidos p on p.cliente_id = c.id
  left join public.cliente_enderecos ce on ce.cliente_id = c.id
  where c.estabelecimento_id = p_estabelecimento
  group by c.id, c.nome, c.telefone_normalizado, c.telefone
  order by max(p.created_at) desc nulls last, c.nome;
end;
$$;

grant execute on function public.listar_clientes_resumo(uuid) to authenticated;
