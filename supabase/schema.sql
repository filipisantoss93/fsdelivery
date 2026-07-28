-- FS Delivery — estrutura inicial para Supabase/PostgreSQL
create extension if not exists pgcrypto;

create table public.estabelecimentos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  slug text not null unique,
  descricao text,
  categoria text,
  telefone text,
  logo_url text,
  banner_url text,
  aberto boolean default false,
  pedido_minimo numeric(10,2) default 0,
  taxa_entrega numeric(10,2) default 0,
  tempo_entrega_min integer default 30,
  tempo_entrega_max integer default 45,
  plano text default 'teste',
  assinatura_status text default 'trial',
  created_at timestamptz default now()
);

create table public.categorias (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  nome text not null,
  ordem integer default 0,
  ativo boolean default true
);

create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  categoria_id uuid references public.categorias(id) on delete set null,
  nome text not null,
  descricao text,
  preco numeric(10,2) not null check(preco >= 0),
  imagem_url text,
  ativo boolean default true,
  destaque boolean default false,
  created_at timestamptz default now()
);

create table public.grupos_adicionais (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  nome text not null,
  minimo integer default 0,
  maximo integer default 1,
  obrigatorio boolean default false
);

create table public.adicionais (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.grupos_adicionais(id) on delete cascade,
  nome text not null,
  preco numeric(10,2) default 0,
  ativo boolean default true
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  nome text not null,
  telefone text not null,
  email text,
  created_at timestamptz default now(),
  unique(estabelecimento_id, telefone)
);

create table public.enderecos_cliente (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  apelido text,
  logradouro text not null,
  numero text,
  bairro text,
  complemento text,
  cidade text,
  cep text
);

create table public.pedidos (
  id bigint generated always as identity primary key,
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  codigo text not null,
  status text not null default 'novo' check(status in ('novo','confirmado','preparo','pronto','saiu_entrega','entregue','cancelado')),
  tipo text not null default 'entrega' check(tipo in ('entrega','retirada')),
  subtotal numeric(10,2) not null default 0,
  taxa_entrega numeric(10,2) not null default 0,
  desconto numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  forma_pagamento text,
  troco_para numeric(10,2),
  endereco_entrega jsonb,
  observacoes text,
  created_at timestamptz default now(),
  atualizado_em timestamptz default now(),
  unique(estabelecimento_id, codigo)
);

create table public.itens_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id bigint not null references public.pedidos(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  nome_produto text not null,
  quantidade integer not null check(quantidade > 0),
  valor_unitario numeric(10,2) not null,
  observacoes text,
  total numeric(10,2) not null
);

create table public.itens_pedido_adicionais (
  id uuid primary key default gen_random_uuid(),
  item_pedido_id uuid not null references public.itens_pedido(id) on delete cascade,
  nome text not null,
  valor numeric(10,2) not null default 0
);

create table public.movimentacoes_financeiras (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  pedido_id bigint references public.pedidos(id) on delete set null,
  tipo text not null check(tipo in ('entrada','saida','estorno')),
  descricao text not null,
  valor numeric(10,2) not null,
  forma_pagamento text,
  status text default 'confirmado',
  created_at timestamptz default now()
);

create index idx_produtos_estabelecimento on public.produtos(estabelecimento_id);
create index idx_pedidos_estabelecimento_status on public.pedidos(estabelecimento_id,status);
create index idx_pedidos_created_at on public.pedidos(created_at desc);
create index idx_clientes_estabelecimento on public.clientes(estabelecimento_id);

alter table public.estabelecimentos enable row level security;
alter table public.categorias enable row level security;
alter table public.produtos enable row level security;
alter table public.grupos_adicionais enable row level security;
alter table public.adicionais enable row level security;
alter table public.clientes enable row level security;
alter table public.enderecos_cliente enable row level security;
alter table public.pedidos enable row level security;
alter table public.itens_pedido enable row level security;
alter table public.itens_pedido_adicionais enable row level security;
alter table public.movimentacoes_financeiras enable row level security;

create policy "dono gerencia estabelecimento" on public.estabelecimentos for all to authenticated using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy "cardapio publico visivel" on public.estabelecimentos for select to anon using (true);
create policy "produtos publicos visiveis" on public.produtos for select to anon using (ativo = true);
create policy "categorias publicas visiveis" on public.categorias for select to anon using (ativo = true);

-- As tabelas filhas devem receber políticas adicionais vinculando estabelecimento_id
-- ao usuário autenticado antes da entrada em produção. Pedidos públicos devem ser
-- criados por uma Edge Function para validar preços, adicionais e total no servidor.