-- FS Delivery — integridade financeira do caixa
-- Centraliza no banco a autorização, o saldo e a baixa do pedido.

begin;

create index if not exists idx_pagamentos_pedido_validos
  on public.pagamentos(pedido_id, created_at desc);

create or replace function public.registrar_pagamento_caixa(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_estabelecimento_id uuid;
  v_pedido public.pedidos%rowtype;
  v_valor numeric(10,2);
  v_total_pago numeric(10,2);
  v_saldo numeric(10,2);
  v_forma text;
  v_pagamento_id bigint;
begin
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do pagamento inválidos.';
  end if;

  begin
    v_estabelecimento_id := (payload->>'estabelecimento_id')::uuid;
  exception when others then
    raise exception 'Estabelecimento inválido.';
  end;

  if not exists (
    select 1
    from public.estabelecimentos e
    where e.id = v_estabelecimento_id
      and e.usuario_id = v_uid
  ) then
    raise exception 'Você não possui acesso a este estabelecimento.';
  end if;

  begin
    v_valor := round((payload->>'valor')::numeric, 2);
  exception when others then
    raise exception 'Valor do pagamento inválido.';
  end;

  if v_valor is null or v_valor <= 0 or v_valor > 999999.99 then
    raise exception 'Informe um valor de pagamento válido.';
  end if;

  v_forma := lower(trim(coalesce(payload->>'forma_pagamento','')));
  if v_forma not in ('dinheiro','pix','credito','debito','voucher','outro') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  select p.* into v_pedido
  from public.pedidos p
  where p.id = (payload->>'pedido_id')::bigint
    and p.estabelecimento_id = v_estabelecimento_id
  for update;

  if v_pedido.id is null then
    raise exception 'Pedido não encontrado.';
  end if;

  if v_pedido.status = 'cancelado' then
    raise exception 'Não é possível receber um pedido cancelado.';
  end if;

  select coalesce(sum(pg.valor),0)::numeric(10,2)
    into v_total_pago
  from public.pagamentos pg
  where pg.pedido_id = v_pedido.id
    and pg.estabelecimento_id = v_estabelecimento_id;

  v_saldo := greatest(round(coalesce(v_pedido.total,0) - v_total_pago,2),0);

  if v_saldo <= 0 then
    raise exception 'Este pedido já está integralmente pago.';
  end if;

  if v_valor > v_saldo then
    raise exception 'O valor excede o saldo restante de R$ %.',
      replace(to_char(v_saldo,'FM999G999G990D00'),'.',',');
  end if;

  insert into public.pagamentos(
    estabelecimento_id,
    pedido_id,
    valor,
    forma_pagamento,
    referencia,
    observacoes
  ) values (
    v_estabelecimento_id,
    v_pedido.id,
    v_valor,
    v_forma,
    nullif(left(trim(payload->>'referencia'),120),''),
    nullif(left(trim(payload->>'observacoes'),500),'')
  )
  returning id into v_pagamento_id;

  v_total_pago := round(v_total_pago + v_valor,2);
  v_saldo := greatest(round(coalesce(v_pedido.total,0) - v_total_pago,2),0);

  if v_saldo = 0 and v_pedido.status not in ('entregue','cancelado') then
    update public.pedidos
       set status = 'entregue'
     where id = v_pedido.id;
  end if;

  return jsonb_build_object(
    'pagamento_id', v_pagamento_id,
    'pedido_id', v_pedido.id,
    'valor', v_valor,
    'total_pago', v_total_pago,
    'saldo', v_saldo,
    'quitado', v_saldo = 0
  );
exception
  when invalid_text_representation then
    raise exception 'Identificador do pedido inválido.';
end;
$$;

revoke all on function public.registrar_pagamento_caixa(jsonb) from public, anon;
grant execute on function public.registrar_pagamento_caixa(jsonb) to authenticated;

comment on function public.registrar_pagamento_caixa(jsonb) is
  'Registra pagamentos do caixa com autorização do proprietário, bloqueio concorrente, controle de saldo e baixa atômica do pedido.';

commit;