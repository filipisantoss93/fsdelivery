-- FS Delivery — cobranças de cartão de pedidos em homologação

create table if not exists public.cobrancas_pedido_cartao (
  id uuid primary key default gen_random_uuid(),
  pedido_id bigint not null references public.pedidos(id) on delete cascade,
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  request_key uuid not null unique,
  provedor text not null default 'efi' check (provedor = 'efi'),
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao','producao')),
  efi_charge_id bigint unique,
  status text not null default 'criando' check (status in (
    'criando','new','waiting','identified','approved','paid','unpaid','refunded','contested','canceled','erro'
  )),
  valor_centavos integer not null check (valor_centavos > 0),
  parcelas smallint not null default 1 check (parcelas between 1 and 12),
  cartao_mascara text,
  erro text,
  payload_criacao jsonb,
  payload_pagamento jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cobrancas_pedido_cartao enable row level security;
revoke all on table public.cobrancas_pedido_cartao from anon, authenticated;

create index if not exists idx_cobrancas_pedido_cartao_pedido
  on public.cobrancas_pedido_cartao(pedido_id, created_at desc);
create index if not exists idx_cobrancas_pedido_cartao_estabelecimento
  on public.cobrancas_pedido_cartao(estabelecimento_id, created_at desc);
create index if not exists pagamento_eventos_pedido_idx
  on public.pagamento_eventos(pedido_id);

comment on table public.cobrancas_pedido_cartao is
  'Tentativas idempotentes de cartão dos pedidos. Acesso exclusivo das Edge Functions.';

create or replace function public.fsdelivery_mapear_status_efi_pedido(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_status,''))
    when 'new' then 'aguardando'
    when 'waiting' then 'aguardando'
    when 'identified' then 'em_analise'
    when 'approved' then 'em_analise'
    when 'paid' then 'pago'
    when 'unpaid' then 'recusado'
    when 'canceled' then 'cancelado'
    when 'refunded' then 'estornado'
    when 'contested' then 'chargeback'
    else 'em_analise'
  end
$$;

revoke all on function public.fsdelivery_mapear_status_efi_pedido(text) from public, anon, authenticated;
grant execute on function public.fsdelivery_mapear_status_efi_pedido(text) to service_role;

-- Função usada somente pelo trigger de proteção da configuração de pagamentos.
revoke all on function public.proteger_campos_validacao_pagamento() from public, anon, authenticated;
