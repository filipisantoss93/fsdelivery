-- FS Delivery — configuração Efí por estabelecimento e preparação do marketplace

create table if not exists public.integracoes_pagamento_estabelecimento (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null unique references public.estabelecimentos(id) on delete cascade,
  provedor text not null default 'efi' check (provedor = 'efi'),
  tipo_pessoa text not null check (tipo_pessoa in ('pf','pj')),
  payee_code text,
  conta_validada boolean not null default false,
  cartao_online_ativo boolean not null default false,
  pix_online_ativo boolean not null default false,
  split_ativo boolean not null default false,
  percentual_comissao_bps integer not null default 0 check (percentual_comissao_bps between 0 and 10000),
  modo_tarifa smallint not null default 2 check (modo_tarifa in (1,2)),
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao','producao')),
  status text not null default 'pendente' check (status in ('pendente','em_analise','ativo','bloqueado','erro')),
  erro_ultima_validacao text,
  validado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integracoes_pagamento_estabelecimento enable row level security;

revoke all on table public.integracoes_pagamento_estabelecimento from anon;
grant select, insert, update on table public.integracoes_pagamento_estabelecimento to authenticated;

drop policy if exists "dono visualiza integracao de pagamento" on public.integracoes_pagamento_estabelecimento;
create policy "dono visualiza integracao de pagamento"
on public.integracoes_pagamento_estabelecimento for select to authenticated
using (exists (
  select 1 from public.estabelecimentos e
  where e.id = integracoes_pagamento_estabelecimento.estabelecimento_id
    and e.usuario_id = (select auth.uid())
));

drop policy if exists "dono cadastra integracao de pagamento" on public.integracoes_pagamento_estabelecimento;
create policy "dono cadastra integracao de pagamento"
on public.integracoes_pagamento_estabelecimento for insert to authenticated
with check (exists (
  select 1 from public.estabelecimentos e
  where e.id = integracoes_pagamento_estabelecimento.estabelecimento_id
    and e.usuario_id = (select auth.uid())
));

drop policy if exists "dono atualiza integracao de pagamento" on public.integracoes_pagamento_estabelecimento;
create policy "dono atualiza integracao de pagamento"
on public.integracoes_pagamento_estabelecimento for update to authenticated
using (exists (
  select 1 from public.estabelecimentos e
  where e.id = integracoes_pagamento_estabelecimento.estabelecimento_id
    and e.usuario_id = (select auth.uid())
))
with check (exists (
  select 1 from public.estabelecimentos e
  where e.id = integracoes_pagamento_estabelecimento.estabelecimento_id
    and e.usuario_id = (select auth.uid())
));

alter table public.pedidos
  add column if not exists pagamento_status text not null default 'nao_iniciado',
  add column if not exists pagamento_provedor text,
  add column if not exists efi_charge_id bigint,
  add column if not exists pagamento_confirmado_em timestamptz;

comment on table public.integracoes_pagamento_estabelecimento is
  'Configuração não secreta da conta Efí recebedora. Nunca armazenar client secret, certificado ou dados do cartão.';
comment on column public.integracoes_pagamento_estabelecimento.percentual_comissao_bps is
  'Comissão em basis points. 100 = 1,00%.';
