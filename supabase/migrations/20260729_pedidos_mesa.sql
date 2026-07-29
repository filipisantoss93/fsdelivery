-- FS Delivery — cardápio único com pedidos remotos e pedidos locais por QR Code

create table if not exists public.mesas (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  identificacao text not null,
  nome text,
  token_publico uuid not null default gen_random_uuid() unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (estabelecimento_id, identificacao)
);

alter table public.mesas enable row level security;

create policy "mesas publicas por token"
on public.mesas for select to anon
using (ativo = true);

create policy "dono gerencia mesas"
on public.mesas for all to authenticated
using (
  exists (
    select 1 from public.estabelecimentos e
    where e.id = mesas.estabelecimento_id
      and e.usuario_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.estabelecimentos e
    where e.id = mesas.estabelecimento_id
      and e.usuario_id = auth.uid()
  )
);

alter table public.pedidos
  add column if not exists mesa_id uuid references public.mesas(id) on delete set null,
  add column if not exists origem text not null default 'publico';

alter table public.pedidos drop constraint if exists pedidos_tipo_check;
alter table public.pedidos add constraint pedidos_tipo_check
  check (tipo in ('entrega','retirada','local','mesa'));

alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check
  check (origem in ('publico','qr_mesa','painel'));

create index if not exists idx_mesas_estabelecimento
  on public.mesas(estabelecimento_id, ativo);

create index if not exists idx_pedidos_mesa
  on public.pedidos(mesa_id, created_at desc);

create or replace function public.criar_pedido_publico(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estabelecimento public.estabelecimentos%rowtype;
  v_cliente_id uuid;
  v_mesa public.mesas%rowtype;
  v_pedido_id bigint;
  v_codigo text;
  v_tipo text;
  v_subtotal numeric(10,2) := 0;
  v_taxa numeric(10,2) := 0;
  v_item jsonb;
  v_produto public.produtos%rowtype;
  v_quantidade integer;
begin
  select * into v_estabelecimento
  from public.estabelecimentos
  where slug = trim(payload->>'slug')
  limit 1;

  if v_estabelecimento.id is null then
    raise exception 'Loja não encontrada.';
  end if;

  if not coalesce(v_estabelecimento.aberto, false) then
    raise exception 'A loja está fechada no momento.';
  end if;

  v_tipo := coalesce(payload->>'tipo', 'retirada');

  if v_tipo not in ('entrega','retirada','local','mesa') then
    raise exception 'Tipo de pedido inválido.';
  end if;

  if v_tipo = 'mesa' then
    select * into v_mesa
    from public.mesas
    where estabelecimento_id = v_estabelecimento.id
      and token_publico::text = payload->>'mesa_token'
      and ativo = true
    limit 1;

    if v_mesa.id is null then
      raise exception 'Mesa inválida ou indisponível.';
    end if;
  elsif nullif(payload->>'mesa_token','') is not null then
    raise exception 'O QR Code de mesa só pode gerar pedido local.';
  end if;

  if jsonb_array_length(coalesce(payload->'itens','[]'::jsonb)) = 0 then
    raise exception 'Adicione ao menos um produto.';
  end if;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_quantidade := greatest(coalesce((v_item->>'quantidade')::integer, 0), 0);
    if v_quantidade <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    select * into v_produto
    from public.produtos
    where id = (v_item->>'produto_id')::uuid
      and estabelecimento_id = v_estabelecimento.id
      and ativo = true;

    if v_produto.id is null then
      raise exception 'Produto inválido ou indisponível.';
    end if;

    v_subtotal := v_subtotal + (v_produto.preco * v_quantidade);
  end loop;

  if v_tipo <> 'mesa' and v_subtotal < coalesce(v_estabelecimento.pedido_minimo,0) then
    raise exception 'O pedido não atingiu o valor mínimo.';
  end if;

  if v_tipo = 'entrega' then
    if nullif(trim(payload->>'endereco'),'') is null then
      raise exception 'Informe o endereço completo.';
    end if;
    v_taxa := coalesce(v_estabelecimento.taxa_entrega,0);
  end if;

  insert into public.clientes(estabelecimento_id,nome,telefone)
  values (
    v_estabelecimento.id,
    trim(payload->>'nome'),
    trim(payload->>'telefone')
  )
  on conflict (estabelecimento_id,telefone)
  do update set nome = excluded.nome
  returning id into v_cliente_id;

  v_codigo := upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.pedidos(
    estabelecimento_id,cliente_id,codigo,status,tipo,subtotal,taxa_entrega,total,
    forma_pagamento,endereco_entrega,observacoes,mesa_id,origem
  ) values (
    v_estabelecimento.id,v_cliente_id,v_codigo,'novo',v_tipo,v_subtotal,v_taxa,
    v_subtotal + v_taxa,payload->>'pagamento',
    case when v_tipo = 'entrega' then jsonb_build_object('texto',payload->>'endereco') else null end,
    nullif(payload->>'observacoes',''),v_mesa.id,
    case when v_tipo = 'mesa' then 'qr_mesa' else 'publico' end
  ) returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(payload->'itens') loop
    v_quantidade := (v_item->>'quantidade')::integer;
    select * into v_produto from public.produtos where id = (v_item->>'produto_id')::uuid;

    insert into public.itens_pedido(
      pedido_id,produto_id,nome_produto,quantidade,valor_unitario,observacoes,total
    ) values (
      v_pedido_id,v_produto.id,v_produto.nome,v_quantidade,v_produto.preco,
      nullif(v_item->>'observacoes',''),v_produto.preco * v_quantidade
    );
  end loop;

  return v_codigo;
end;
$$;

grant execute on function public.criar_pedido_publico(jsonb) to anon, authenticated;

-- URL pública: /loja.html?loja=slug-da-lanchonete
-- URL da mesa: /loja.html?loja=slug-da-lanchonete&mesa=TOKEN_PUBLICO
-- O QR Code deve conter exclusivamente a URL da mesa correspondente.
