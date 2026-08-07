-- FS Delivery — histórico interno das validações automáticas de recebedor Efí

create table if not exists public.validacoes_payee_efi (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid not null references public.integracoes_pagamento_estabelecimento(id) on delete cascade,
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  solicitado_por uuid null references auth.users(id) on delete set null,
  sucesso boolean not null default false,
  efi_charge_id bigint null,
  efi_status text null,
  cancelado boolean not null default false,
  erro text null,
  detalhes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists validacoes_payee_efi_integracao_idx
  on public.validacoes_payee_efi(integracao_id, created_at desc);

create index if not exists validacoes_payee_efi_estabelecimento_idx
  on public.validacoes_payee_efi(estabelecimento_id, created_at desc);

alter table public.validacoes_payee_efi enable row level security;
revoke all on table public.validacoes_payee_efi from public, anon, authenticated;

comment on table public.validacoes_payee_efi is 'Auditoria interna de testes sandbox usados para validar payee_code Efí. Acesso somente backend/service role.';
