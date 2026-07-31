-- FS Delivery: operação profissional de entregas
alter table if exists public.pedidos
  add column if not exists tipo_entrega text default 'retirada',
  add column if not exists endereco_entrega text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists entregador_id uuid references auth.users(id) on delete set null,
  add column if not exists status_entrega text default 'aguardando',
  add column if not exists saiu_para_entrega_em timestamptz,
  add column if not exists entregue_em timestamptz,
  add column if not exists comprovante_entrega text,
  add column if not exists ordem_rota integer,
  add column if not exists distancia_estimada_km numeric(8,2),
  add column if not exists duracao_estimada_min integer;

create table if not exists public.entregadores (
  id uuid primary key references auth.users(id) on delete cascade,
  estabelecimento_id uuid not null,
  nome text not null,
  telefone text,
  ativo boolean not null default true,
  disponivel boolean not null default true,
  latitude double precision,
  longitude double precision,
  ultima_localizacao_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pedidos_entregador_status_idx
  on public.pedidos(entregador_id,status_entrega);
create index if not exists pedidos_entrega_pendente_idx
  on public.pedidos(tipo_entrega,status_entrega,ordem_rota);

alter table public.entregadores enable row level security;

drop policy if exists entregador_le_proprio_perfil on public.entregadores;
create policy entregador_le_proprio_perfil on public.entregadores
for select to authenticated using (id = auth.uid());

drop policy if exists entregador_atualiza_proprio_perfil on public.entregadores;
create policy entregador_atualiza_proprio_perfil on public.entregadores
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Ajuste as políticas de pedidos conforme o nome real da coluna de estabelecimento.
-- Entregadores autenticados devem visualizar e atualizar somente pedidos atribuídos a eles.
