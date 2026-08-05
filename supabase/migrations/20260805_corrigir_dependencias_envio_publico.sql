-- Corrige dependências obrigatórias da função criar_pedido_publico.

create or replace function public.normalizar_whatsapp(valor text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select regexp_replace(valor, '\D', '', 'g');
$$;

alter table public.clientes
  add column if not exists telefone_normalizado text,
  add column if not exists primeiro_pedido_em timestamptz,
  add column if not exists ultimo_pedido_em timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.clientes
set telefone_normalizado = public.normalizar_whatsapp(telefone)
where telefone_normalizado is null and telefone is not null;

create unique index if not exists clientes_estabelecimento_whatsapp_uidx
  on public.clientes(estabelecimento_id, telefone_normalizado)
  where telefone_normalizado is not null and telefone_normalizado <> '';

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

create table if not exists public.cliente_enderecos (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  apelido text,
  cep text,
  logradouro text not null,
  numero text not null,
  complemento text,
  bairro text,
  cidade text,
  estado text,
  referencia text,
  latitude double precision,
  longitude double precision,
  principal boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cliente_enderecos_estado_check
    check (estado is null or char_length(trim(estado)) between 2 and 30)
);

create index if not exists cliente_enderecos_cliente_idx
  on public.cliente_enderecos(cliente_id, ativo, principal desc, created_at desc);
create index if not exists cliente_enderecos_estabelecimento_idx
  on public.cliente_enderecos(estabelecimento_id, cliente_id);
create unique index if not exists cliente_endereco_principal_uidx
  on public.cliente_enderecos(cliente_id)
  where principal = true and ativo = true;

alter table public.pedidos
  add column if not exists cliente_endereco_id uuid
    references public.cliente_enderecos(id) on delete set null;

create index if not exists pedidos_cliente_endereco_idx
  on public.pedidos(cliente_endereco_id)
  where cliente_endereco_id is not null;

create or replace function public.validar_cliente_endereco_estabelecimento()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cliente_estabelecimento uuid;
begin
  select estabelecimento_id into v_cliente_estabelecimento
  from public.clientes where id = new.cliente_id;

  if v_cliente_estabelecimento is null then
    raise exception 'Cliente não encontrado.';
  end if;
  if v_cliente_estabelecimento <> new.estabelecimento_id then
    raise exception 'Cliente e endereço pertencem a estabelecimentos diferentes.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_validar_cliente_endereco_estabelecimento on public.cliente_enderecos;
create trigger trg_validar_cliente_endereco_estabelecimento
before insert or update on public.cliente_enderecos
for each row execute function public.validar_cliente_endereco_estabelecimento();

create or replace function public.desmarcar_outros_enderecos_principais()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.principal = true and new.ativo = true then
    update public.cliente_enderecos
    set principal = false, updated_at = now()
    where cliente_id = new.cliente_id
      and id <> new.id
      and principal = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_desmarcar_outros_enderecos_principais on public.cliente_enderecos;
create trigger trg_desmarcar_outros_enderecos_principais
before insert or update of principal, ativo on public.cliente_enderecos
for each row execute function public.desmarcar_outros_enderecos_principais();

alter table public.cliente_enderecos enable row level security;

drop policy if exists "dono visualiza enderecos de clientes" on public.cliente_enderecos;
create policy "dono visualiza enderecos de clientes"
on public.cliente_enderecos for select to authenticated
using (
  exists (
    select 1 from public.estabelecimentos e
    where e.id = cliente_enderecos.estabelecimento_id
      and e.usuario_id = auth.uid()
  )
);

drop policy if exists "dono gerencia enderecos de clientes" on public.cliente_enderecos;
create policy "dono gerencia enderecos de clientes"
on public.cliente_enderecos for all to authenticated
using (
  exists (
    select 1 from public.estabelecimentos e
    where e.id = cliente_enderecos.estabelecimento_id
      and e.usuario_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.estabelecimentos e
    where e.id = cliente_enderecos.estabelecimento_id
      and e.usuario_id = auth.uid()
  )
);

grant execute on function public.normalizar_whatsapp(text) to anon, authenticated;
