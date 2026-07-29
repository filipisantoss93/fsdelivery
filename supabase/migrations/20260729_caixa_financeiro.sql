-- FS Delivery — caixa, pagamentos e integração financeira
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  pedido_id bigint not null references public.pedidos(id) on delete cascade,
  valor numeric(10,2) not null check (valor > 0),
  forma_pagamento text not null check (forma_pagamento in ('pix','dinheiro','credito','debito','vale')),
  referencia text,
  observacoes text,
  recebido_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pagamentos_estabelecimento_data
  on public.pagamentos(estabelecimento_id, created_at desc);
create index if not exists idx_pagamentos_pedido
  on public.pagamentos(pedido_id);

alter table public.pagamentos enable row level security;

create policy "equipe visualiza pagamentos do estabelecimento"
on public.pagamentos for select to authenticated
using (
  exists (
    select 1 from public.estabelecimentos e
    where e.id = pagamentos.estabelecimento_id
      and e.usuario_id = auth.uid()
  )
);

create or replace function public.registrar_pagamento_caixa(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_pagamento_id uuid;
  v_total_pago numeric(10,2);
  v_valor numeric(10,2);
begin
  select p.* into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  where p.id = (payload->>'pedido_id')::bigint
    and e.usuario_id = auth.uid()
  for update;

  if v_pedido.id is null then
    raise exception 'Pedido não encontrado ou sem permissão.';
  end if;

  if v_pedido.status = 'cancelado' then
    raise exception 'Pedido cancelado não pode ser recebido.';
  end if;

  v_valor := round((payload->>'valor')::numeric, 2);
  if v_valor <= 0 then
    raise exception 'Valor de pagamento inválido.';
  end if;

  select coalesce(sum(valor),0) into v_total_pago
  from public.pagamentos
  where pedido_id = v_pedido.id;

  if v_total_pago + v_valor > v_pedido.total then
    raise exception 'O valor informado ultrapassa o saldo do pedido.';
  end if;

  insert into public.pagamentos(
    estabelecimento_id,pedido_id,valor,forma_pagamento,referencia,observacoes,recebido_por
  ) values (
    v_pedido.estabelecimento_id,v_pedido.id,v_valor,payload->>'forma_pagamento',
    nullif(trim(payload->>'referencia'),''),nullif(trim(payload->>'observacoes'),''),auth.uid()
  ) returning id into v_pagamento_id;

  if v_total_pago + v_valor >= v_pedido.total then
    update public.pedidos
    set status = 'entregue',
        forma_pagamento = payload->>'forma_pagamento',
        atualizado_em = now()
    where id = v_pedido.id;
  end if;

  return v_pagamento_id;
end;
$$;

grant execute on function public.registrar_pagamento_caixa(jsonb) to authenticated;

-- Uma mesa é considerada ocupada enquanto possuir qualquer pedido nos status:
-- novo, preparo ou pronto. Ao receber integralmente, o pedido passa para entregue
-- e a mesa volta automaticamente a ficar disponível.