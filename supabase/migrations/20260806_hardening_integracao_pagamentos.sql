-- FS Delivery — hardening da integração Efí Marketplace
-- Preserva o contrato unificado de pedidos já existente na main.

create table if not exists public.integracoes_pagamento_estabelecimento (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null unique references public.estabelecimentos(id) on delete cascade,
  provedor text not null default 'efi' check (provedor = 'efi'),
  tipo_pessoa text not null check (tipo_pessoa in ('pf','pj')),
  payee_code text,
  conta_validada boolean not null default false,
  cartao_online_solicitado boolean not null default false,
  pix_online_solicitado boolean not null default false,
  split_solicitado boolean not null default false,
  cartao_online_ativo boolean not null default false,
  pix_online_ativo boolean not null default false,
  split_ativo boolean not null default false,
  percentual_comissao_bps integer not null default 0 check (percentual_comissao_bps between 0 and 3000),
  modo_tarifa smallint not null default 2 check (modo_tarifa in (1,2)),
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao','producao')),
  status text not null default 'pendente' check (status in ('pendente','em_analise','ativo','bloqueado','erro')),
  erro_ultima_validacao text,
  validado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integracoes_pagamento_estabelecimento
  add column if not exists cartao_online_solicitado boolean not null default false,
  add column if not exists pix_online_solicitado boolean not null default false,
  add column if not exists split_solicitado boolean not null default false;

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

create or replace function public.proteger_campos_validacao_pagamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();

  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      new.conta_validada := false;
      new.cartao_online_ativo := false;
      new.pix_online_ativo := false;
      new.split_ativo := false;
      new.ambiente := 'homologacao';
      new.status := 'pendente';
      new.erro_ultima_validacao := null;
      new.validado_em := null;
    else
      new.conta_validada := old.conta_validada;
      new.cartao_online_ativo := old.cartao_online_ativo;
      new.pix_online_ativo := old.pix_online_ativo;
      new.split_ativo := old.split_ativo;
      new.ambiente := old.ambiente;
      new.status := case
        when new.payee_code is distinct from old.payee_code
          or new.tipo_pessoa is distinct from old.tipo_pessoa
          then 'pendente'
        else old.status
      end;
      new.validado_em := case
        when new.payee_code is distinct from old.payee_code
          or new.tipo_pessoa is distinct from old.tipo_pessoa
          then null
        else old.validado_em
      end;
      new.erro_ultima_validacao := case
        when new.payee_code is distinct from old.payee_code
          or new.tipo_pessoa is distinct from old.tipo_pessoa
          then null
        else old.erro_ultima_validacao
      end;
      if new.payee_code is distinct from old.payee_code
         or new.tipo_pessoa is distinct from old.tipo_pessoa then
        new.conta_validada := false;
        new.cartao_online_ativo := false;
        new.pix_online_ativo := false;
        new.split_ativo := false;
        new.ambiente := 'homologacao';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_campos_validacao_pagamento
  on public.integracoes_pagamento_estabelecimento;
create trigger trg_proteger_campos_validacao_pagamento
before insert or update on public.integracoes_pagamento_estabelecimento
for each row execute function public.proteger_campos_validacao_pagamento();

alter table public.pedidos
  add column if not exists pagamento_status text not null default 'nao_iniciado',
  add column if not exists pagamento_provedor text,
  add column if not exists efi_charge_id bigint,
  add column if not exists pagamento_confirmado_em timestamptz;

alter table public.pedidos drop constraint if exists pedidos_pagamento_status_check;
alter table public.pedidos add constraint pedidos_pagamento_status_check
check (pagamento_status in (
  'nao_iniciado','aguardando','em_analise','pago','recusado',
  'cancelado','estornado','chargeback'
));

create unique index if not exists pedidos_efi_charge_id_uidx
  on public.pedidos(efi_charge_id)
  where efi_charge_id is not null;

create index if not exists pedidos_pagamento_pendente_idx
  on public.pedidos(estabelecimento_id,pagamento_status,created_at desc)
  where pagamento_status in ('aguardando','em_analise');

create table if not exists public.pagamento_eventos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null check (provedor = 'efi'),
  evento_id text not null,
  pedido_id bigint references public.pedidos(id) on delete set null,
  efi_charge_id bigint,
  tipo text not null,
  payload jsonb not null default '{}'::jsonb,
  processado_em timestamptz,
  erro_processamento text,
  created_at timestamptz not null default now(),
  unique (provedor,evento_id)
);

alter table public.pagamento_eventos enable row level security;
revoke all on table public.pagamento_eventos from anon, authenticated;

create index if not exists pagamento_eventos_charge_idx
  on public.pagamento_eventos(efi_charge_id,created_at desc)
  where efi_charge_id is not null;

comment on table public.integracoes_pagamento_estabelecimento is
  'Configuração não secreta da conta recebedora. Campos de homologação são controlados somente pelo backend da plataforma.';
comment on table public.pagamento_eventos is
  'Eventos idempotentes recebidos do provedor de pagamentos. Não expor diretamente pela Data API.';