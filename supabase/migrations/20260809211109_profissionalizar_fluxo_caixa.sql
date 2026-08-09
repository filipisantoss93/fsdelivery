-- FS Delivery — fluxo profissional do caixa, cobranças e venda rápida
-- Mantém cobrança, baixa financeira e finalização no mesmo contrato transacional.

begin;

alter table public.pagamentos
  add column if not exists caixa_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pagamentos_caixa_id_fkey'
      and conrelid = 'public.pagamentos'::regclass
  ) then
    alter table public.pagamentos
      add constraint pagamentos_caixa_id_fkey
      foreign key (caixa_id) references public.caixas(id) on delete set null;
  end if;
end
$$;

create index if not exists pagamentos_caixa_created_idx
  on public.pagamentos(caixa_id, created_at desc)
  where caixa_id is not null;

alter table public.caixas
  add column if not exists valor_esperado numeric(12,2),
  add column if not exists diferenca numeric(12,2);

-- Preserva apenas a sessão mais recente caso algum ambiente legado possua
-- mais de um caixa aberto para o mesmo estabelecimento.
with duplicados as (
  select id,
         row_number() over (
           partition by estabelecimento_id
           order by aberto_em desc, id desc
         ) as ordem
  from public.caixas
  where status = 'aberto'
)
update public.caixas c
set status = 'fechado',
    fechado_em = coalesce(c.fechado_em, now()),
    valor_final = coalesce(c.valor_final, c.valor_inicial),
    observacoes = concat_ws(
      E'\n',
      nullif(c.observacoes, ''),
      'Sessão duplicada encerrada automaticamente pela auditoria do caixa.'
    )
from duplicados d
where d.id = c.id
  and d.ordem > 1;

create unique index if not exists caixas_um_aberto_por_estabelecimento_uidx
  on public.caixas(estabelecimento_id)
  where status = 'aberto';

-- Relaciona lançamentos anteriores à sessão que estava aberta no momento
-- do recebimento. Ambientes sem sessão continuam com caixa_id nulo.
update public.pagamentos p
set caixa_id = (
  select c.id
  from public.caixas c
  where c.estabelecimento_id = p.estabelecimento_id
    and c.aberto_em <= p.created_at
    and (c.fechado_em is null or p.created_at <= c.fechado_em)
  order by c.aberto_em desc, c.id desc
  limit 1
)
where p.caixa_id is null
  and exists (
    select 1
    from public.caixas c
    where c.estabelecimento_id = p.estabelecimento_id
      and c.aberto_em <= p.created_at
      and (c.fechado_em is null or p.created_at <= c.fechado_em)
  );

update public.caixas c
set valor_esperado = round(
      coalesce(c.valor_inicial, 0) + coalesce((
        select sum(p.valor)
        from public.pagamentos p
        where p.caixa_id = c.id
          and p.forma_pagamento = 'dinheiro'
      ), 0),
      2
    ),
    diferenca = case
      when c.valor_final is null then null
      else round(
        c.valor_final - (
          coalesce(c.valor_inicial, 0) + coalesce((
            select sum(p.valor)
            from public.pagamentos p
            where p.caixa_id = c.id
              and p.forma_pagamento = 'dinheiro'
          ), 0)
        ),
        2
      )
    end;

create or replace function public.abrir_caixa(
  p_estabelecimento uuid,
  p_valor numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_valor numeric(12,2) := round(coalesce(p_valor, 0), 2);
begin
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.estabelecimentos e
    where e.id = p_estabelecimento
      and e.usuario_id = v_uid
  ) then
    raise exception 'Você não possui acesso a este estabelecimento.' using errcode = '42501';
  end if;

  if v_valor < 0 or v_valor > 999999.99 then
    raise exception 'Informe um valor inicial válido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_estabelecimento::text, 0));

  if exists (
    select 1
    from public.caixas c
    where c.estabelecimento_id = p_estabelecimento
      and c.status = 'aberto'
  ) then
    raise exception 'Já existe um caixa aberto para este estabelecimento.';
  end if;

  insert into public.caixas(
    estabelecimento_id,
    aberto_por,
    valor_inicial,
    valor_esperado,
    status
  ) values (
    p_estabelecimento,
    v_uid,
    v_valor,
    v_valor,
    'aberto'
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.fechar_caixa(
  p_estabelecimento uuid,
  p_valor numeric,
  p_obs text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caixa public.caixas%rowtype;
  v_valor_final numeric(12,2) := round(coalesce(p_valor, 0), 2);
  v_dinheiro numeric(12,2) := 0;
  v_esperado numeric(12,2);
begin
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.estabelecimentos e
    where e.id = p_estabelecimento
      and e.usuario_id = v_uid
  ) then
    raise exception 'Você não possui acesso a este estabelecimento.' using errcode = '42501';
  end if;

  if v_valor_final < 0 or v_valor_final > 999999.99 then
    raise exception 'Informe um valor final válido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_estabelecimento::text, 0));

  select c.*
  into v_caixa
  from public.caixas c
  where c.estabelecimento_id = p_estabelecimento
    and c.status = 'aberto'
  order by c.aberto_em desc, c.id desc
  limit 1
  for update;

  if not found then
    raise exception 'Não existe caixa aberto para fechar.';
  end if;

  select coalesce(sum(p.valor), 0)::numeric(12,2)
  into v_dinheiro
  from public.pagamentos p
  where p.caixa_id = v_caixa.id
    and p.forma_pagamento = 'dinheiro';

  v_esperado := round(coalesce(v_caixa.valor_inicial, 0) + v_dinheiro, 2);

  update public.caixas
  set status = 'fechado',
      fechado_em = now(),
      valor_final = v_valor_final,
      valor_esperado = v_esperado,
      diferenca = round(v_valor_final - v_esperado, 2),
      observacoes = nullif(left(trim(coalesce(p_obs, '')), 500), '')
  where id = v_caixa.id;

  return true;
end;
$$;

create or replace function public.obter_resumo_caixa(
  p_estabelecimento uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_caixa public.caixas%rowtype;
  v_total numeric(12,2) := 0;
  v_dinheiro numeric(12,2) := 0;
  v_pix numeric(12,2) := 0;
  v_credito numeric(12,2) := 0;
  v_debito numeric(12,2) := 0;
  v_vale numeric(12,2) := 0;
  v_quantidade integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.estabelecimentos e
    where e.id = p_estabelecimento
      and e.usuario_id = v_uid
  ) then
    raise exception 'Você não possui acesso a este estabelecimento.' using errcode = '42501';
  end if;

  select c.*
  into v_caixa
  from public.caixas c
  where c.estabelecimento_id = p_estabelecimento
    and c.status = 'aberto'
  order by c.aberto_em desc, c.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'aberto', false,
      'caixa_id', null,
      'valor_inicial', 0,
      'total_recebido', 0,
      'dinheiro', 0,
      'pix', 0,
      'credito', 0,
      'debito', 0,
      'vale', 0,
      'valor_esperado', 0,
      'quantidade_pagamentos', 0
    );
  end if;

  select coalesce(sum(p.valor), 0)::numeric(12,2),
         coalesce(sum(p.valor) filter (where p.forma_pagamento = 'dinheiro'), 0)::numeric(12,2),
         coalesce(sum(p.valor) filter (where p.forma_pagamento = 'pix'), 0)::numeric(12,2),
         coalesce(sum(p.valor) filter (where p.forma_pagamento = 'credito'), 0)::numeric(12,2),
         coalesce(sum(p.valor) filter (where p.forma_pagamento = 'debito'), 0)::numeric(12,2),
         coalesce(sum(p.valor) filter (where p.forma_pagamento = 'vale'), 0)::numeric(12,2),
         count(*)::integer
  into v_total, v_dinheiro, v_pix, v_credito, v_debito, v_vale, v_quantidade
  from public.pagamentos p
  where p.caixa_id = v_caixa.id;

  return jsonb_build_object(
    'aberto', true,
    'caixa_id', v_caixa.id,
    'aberto_em', v_caixa.aberto_em,
    'valor_inicial', v_caixa.valor_inicial,
    'total_recebido', v_total,
    'dinheiro', v_dinheiro,
    'pix', v_pix,
    'credito', v_credito,
    'debito', v_debito,
    'vale', v_vale,
    'valor_esperado', round(coalesce(v_caixa.valor_inicial, 0) + v_dinheiro, 2),
    'quantidade_pagamentos', v_quantidade
  );
end;
$$;

create or replace function public.registrar_pagamento_caixa(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_estabelecimento uuid;
  v_pedido public.pedidos%rowtype;
  v_ids bigint[];
  v_quantidade_ids integer := 0;
  v_quantidade_pedidos integer := 0;
  v_valor numeric(12,2);
  v_forma text;
  v_total_pago numeric(12,2);
  v_saldo_pedido numeric(12,2);
  v_saldo_total numeric(12,2) := 0;
  v_restante numeric(12,2);
  v_alocar numeric(12,2);
  v_caixa_id uuid;
  v_exige_caixa boolean := false;
  v_pagamento_id uuid;
  v_primeiro_pagamento_id uuid;
  v_finalizados integer := 0;
  v_lancamentos jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = '28000';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do pagamento inválidos.';
  end if;

  begin
    v_estabelecimento := (payload->>'estabelecimento_id')::uuid;
  exception when others then
    raise exception 'Estabelecimento inválido.';
  end;

  if not exists (
    select 1
    from public.estabelecimentos e
    where e.id = v_estabelecimento
      and e.usuario_id = v_uid
  ) then
    raise exception 'Você não possui acesso a este estabelecimento.' using errcode = '42501';
  end if;

  begin
    if jsonb_typeof(payload->'pedido_ids') = 'array' then
      select array_agg(q.id order by q.id)
      into v_ids
      from (
        select distinct value::bigint as id
        from jsonb_array_elements_text(payload->'pedido_ids')
      ) q;
    else
      v_ids := array[(payload->>'pedido_id')::bigint];
    end if;
  exception when others then
    raise exception 'Identificador de pedido inválido.';
  end;

  v_quantidade_ids := coalesce(cardinality(v_ids), 0);
  if v_quantidade_ids = 0 then
    raise exception 'Selecione ao menos um pedido para receber.';
  end if;

  begin
    v_valor := round(replace(coalesce(payload->>'valor', '0'), ',', '.')::numeric, 2);
  exception when others then
    raise exception 'Valor do pagamento inválido.';
  end;

  if v_valor <= 0 or v_valor > 999999.99 then
    raise exception 'Informe um valor de pagamento válido.';
  end if;

  v_forma := lower(trim(coalesce(payload->>'forma_pagamento', '')));
  if v_forma = 'voucher' then
    v_forma := 'vale';
  end if;
  if v_forma not in ('pix', 'dinheiro', 'credito', 'debito', 'vale') then
    raise exception 'Forma de pagamento inválida.';
  end if;

  select coalesce(c.exige_abertura_caixa, false)
  into v_exige_caixa
  from public.configuracoes_operacionais c
  where c.estabelecimento_id = v_estabelecimento;

  select c.id
  into v_caixa_id
  from public.caixas c
  where c.estabelecimento_id = v_estabelecimento
    and c.status = 'aberto'
  order by c.aberto_em desc, c.id desc
  limit 1
  for update;

  if v_exige_caixa and v_caixa_id is null then
    raise exception 'Abra o caixa antes de registrar recebimentos.';
  end if;

  for v_pedido in
    select p.*
    from public.pedidos p
    where p.estabelecimento_id = v_estabelecimento
      and p.id = any(v_ids)
    order by p.id
    for update
  loop
    v_quantidade_pedidos := v_quantidade_pedidos + 1;

    if v_pedido.status in ('aguardando_aprovacao', 'novo') then
      raise exception 'O pedido % precisa ser aprovado antes da cobrança.', coalesce(v_pedido.codigo, v_pedido.id::text);
    end if;
    if v_pedido.status in ('cancelado', 'finalizado', 'entregue') then
      raise exception 'O pedido % não aceita novos pagamentos.', coalesce(v_pedido.codigo, v_pedido.id::text);
    end if;

    if v_pedido.pagamento_status in ('autorizado', 'pago') then
      v_saldo_pedido := 0;
    else
      select coalesce(sum(p.valor), 0)::numeric(12,2)
      into v_total_pago
      from public.pagamentos p
      where p.pedido_id = v_pedido.id
        and p.estabelecimento_id = v_estabelecimento;
      v_saldo_pedido := greatest(round(coalesce(v_pedido.total, 0) - v_total_pago, 2), 0);
    end if;

    v_saldo_total := v_saldo_total + v_saldo_pedido;
  end loop;

  if v_quantidade_pedidos <> v_quantidade_ids then
    raise exception 'Um ou mais pedidos não foram encontrados.';
  end if;
  if v_saldo_total <= 0 then
    raise exception 'Os pedidos selecionados já estão integralmente pagos.';
  end if;
  if v_valor > v_saldo_total then
    raise exception 'O valor informado ultrapassa o saldo total de R$ %.',
      replace(to_char(v_saldo_total, 'FM999999990D00'), '.', ',');
  end if;

  v_restante := v_valor;
  perform set_config('fsdelivery.origem', 'caixa', true);
  perform set_config('fsdelivery.responsavel_id', v_uid::text, true);

  for v_pedido in
    select p.*
    from public.pedidos p
    where p.estabelecimento_id = v_estabelecimento
      and p.id = any(v_ids)
    order by p.created_at, p.id
  loop
    exit when v_restante <= 0;

    if v_pedido.pagamento_status in ('autorizado', 'pago') then
      continue;
    end if;

    select coalesce(sum(p.valor), 0)::numeric(12,2)
    into v_total_pago
    from public.pagamentos p
    where p.pedido_id = v_pedido.id
      and p.estabelecimento_id = v_estabelecimento;

    v_saldo_pedido := greatest(round(coalesce(v_pedido.total, 0) - v_total_pago, 2), 0);
    v_alocar := least(v_restante, v_saldo_pedido);
    if v_alocar <= 0 then
      continue;
    end if;

    insert into public.pagamentos(
      estabelecimento_id,
      pedido_id,
      caixa_id,
      valor,
      forma_pagamento,
      referencia,
      observacoes,
      recebido_por
    ) values (
      v_estabelecimento,
      v_pedido.id,
      v_caixa_id,
      v_alocar,
      v_forma,
      nullif(left(trim(coalesce(payload->>'referencia', '')), 120), ''),
      nullif(left(trim(coalesce(payload->>'observacoes', '')), 500), ''),
      v_uid
    )
    returning id into v_pagamento_id;

    if v_primeiro_pagamento_id is null then
      v_primeiro_pagamento_id := v_pagamento_id;
    end if;

    update public.pedidos
    set forma_pagamento = v_forma,
        status = case
          when v_alocar >= v_saldo_pedido
            and tipo in ('mesa', 'local')
            and status = 'servido' then 'finalizado'
          when v_alocar >= v_saldo_pedido
            and tipo = 'retirada'
            and status = 'pronto' then 'finalizado'
          else status
        end
    where id = v_pedido.id;

    if v_alocar >= v_saldo_pedido
       and (
         (v_pedido.tipo in ('mesa', 'local') and v_pedido.status = 'servido')
         or (v_pedido.tipo = 'retirada' and v_pedido.status = 'pronto')
       ) then
      v_finalizados := v_finalizados + 1;
    end if;

    v_lancamentos := v_lancamentos || jsonb_build_array(jsonb_build_object(
      'pagamento_id', v_pagamento_id,
      'pedido_id', v_pedido.id,
      'valor', v_alocar,
      'saldo_apos', greatest(v_saldo_pedido - v_alocar, 0)
    ));
    v_restante := round(v_restante - v_alocar, 2);
  end loop;

  return jsonb_build_object(
    'pagamento_id', v_primeiro_pagamento_id,
    'caixa_id', v_caixa_id,
    'pedido_ids', to_jsonb(v_ids),
    'valor', v_valor,
    'saldo', greatest(round(v_saldo_total - v_valor, 2), 0),
    'quitado', round(v_saldo_total - v_valor, 2) <= 0,
    'finalizado', v_finalizados > 0,
    'finalizados', v_finalizados,
    'lancamentos', v_lancamentos
  );
end;
$$;

create or replace function public.registrar_venda_rapida_caixa(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_est public.estabelecimentos%rowtype;
  v_pedido_id bigint;
  v_existente public.pedidos%rowtype;
  v_codigo text;
  v_item jsonb;
  v_produto public.produtos%rowtype;
  v_quantidade integer;
  v_subtotal numeric(12,2) := 0;
  v_forma text;
  v_recebido numeric(12,2);
  v_troco numeric(12,2) := 0;
  v_caixa_id uuid;
  v_exige_caixa boolean := false;
  v_token uuid;
  v_pagamento_id uuid;
begin
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = '28000';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados da venda rápida inválidos.';
  end if;

  select e.*
  into v_est
  from public.estabelecimentos e
  where e.usuario_id = v_uid
  limit 1;

  if not found then
    raise exception 'Estabelecimento não encontrado para esta conta.';
  end if;

  begin
    v_token := nullif(payload->>'idempotency_key', '')::uuid;
  exception when others then
    raise exception 'Identificador da venda inválido.';
  end;
  if v_token is null then
    raise exception 'Identificador da venda não informado.';
  end if;

  select p.*
  into v_existente
  from public.pedidos p
  where p.estabelecimento_id = v_est.id
    and p.checkout_token = v_token
  limit 1;

  if found then
    return jsonb_build_object(
      'pedido_id', v_existente.id,
      'codigo', v_existente.codigo,
      'total', v_existente.total,
      'troco', greatest(coalesce(v_existente.troco_para, v_existente.total) - v_existente.total, 0),
      'idempotente', true
    );
  end if;

  v_forma := lower(trim(coalesce(payload->>'forma_pagamento', '')));
  if v_forma = 'voucher' then
    v_forma := 'vale';
  end if;
  if v_forma not in ('pix', 'dinheiro', 'credito', 'debito', 'vale') then
    raise exception 'Selecione uma forma de pagamento válida.';
  end if;

  if jsonb_typeof(payload->'itens') <> 'array'
     or jsonb_array_length(payload->'itens') = 0 then
    raise exception 'Adicione ao menos um item à venda.';
  end if;

  -- A trava de leitura mantém os preços estáveis até o fim da transação.
  for v_item in
    select value
    from jsonb_array_elements(payload->'itens')
  loop
    begin
      v_quantidade := greatest(1, least(99, (v_item->>'quantidade')::integer));
      select p.*
      into v_produto
      from public.produtos p
      where p.id = (v_item->>'produto_id')::uuid
        and p.estabelecimento_id = v_est.id
        and p.ativo = true
      for key share;
    exception when others then
      raise exception 'Item da venda rápida inválido.';
    end;

    if not found then
      raise exception 'Produto inválido ou indisponível.';
    end if;
    v_subtotal := v_subtotal + round(v_produto.preco * v_quantidade, 2);
  end loop;

  if v_subtotal <= 0 then
    raise exception 'O total da venda deve ser maior que zero.';
  end if;

  begin
    v_recebido := round(replace(coalesce(payload->>'valor_recebido', v_subtotal::text), ',', '.')::numeric, 2);
  exception when others then
    raise exception 'Valor recebido inválido.';
  end;

  if v_forma = 'dinheiro' then
    if v_recebido < v_subtotal then
      raise exception 'O valor recebido é menor que o total da venda.';
    end if;
    v_troco := round(v_recebido - v_subtotal, 2);
  else
    v_recebido := v_subtotal;
    v_troco := 0;
  end if;

  select coalesce(c.exige_abertura_caixa, false)
  into v_exige_caixa
  from public.configuracoes_operacionais c
  where c.estabelecimento_id = v_est.id;

  select c.id
  into v_caixa_id
  from public.caixas c
  where c.estabelecimento_id = v_est.id
    and c.status = 'aberto'
  order by c.aberto_em desc, c.id desc
  limit 1
  for update;

  if v_exige_caixa and v_caixa_id is null then
    raise exception 'Abra o caixa antes de registrar uma venda rápida.';
  end if;

  perform set_config('fsdelivery.origem', 'caixa', true);
  perform set_config('fsdelivery.responsavel_id', v_uid::text, true);

  insert into public.pedidos(
    estabelecimento_id,
    cliente_id,
    codigo,
    status,
    tipo,
    origem,
    subtotal,
    taxa_entrega,
    taxa_servico,
    desconto,
    desconto_cupom,
    total,
    forma_pagamento,
    troco_para,
    endereco_entrega,
    observacoes,
    mesa_id,
    checkout_token
  ) values (
    v_est.id,
    null,
    'VR-' || replace(v_token::text, '-', ''),
    'confirmado',
    'retirada',
    'caixa',
    v_subtotal,
    0,
    0,
    0,
    0,
    v_subtotal,
    v_forma,
    case when v_forma = 'dinheiro' then v_recebido else null end,
    null,
    nullif(left(trim(coalesce(payload->>'observacoes', '')), 500), ''),
    null,
    v_token
  )
  returning id, codigo into v_pedido_id, v_codigo;

  for v_item in
    select value
    from jsonb_array_elements(payload->'itens')
  loop
    v_quantidade := greatest(1, least(99, (v_item->>'quantidade')::integer));
    select p.*
    into v_produto
    from public.produtos p
    where p.id = (v_item->>'produto_id')::uuid
      and p.estabelecimento_id = v_est.id
      and p.ativo = true;

    insert into public.itens_pedido(
      pedido_id,
      produto_id,
      nome_produto,
      quantidade,
      valor_unitario,
      observacoes,
      total
    ) values (
      v_pedido_id,
      v_produto.id,
      v_produto.nome,
      v_quantidade,
      v_produto.preco,
      nullif(left(trim(coalesce(v_item->>'observacoes', '')), 300), ''),
      round(v_produto.preco * v_quantidade, 2)
    );
  end loop;

  insert into public.pagamentos(
    estabelecimento_id,
    pedido_id,
    caixa_id,
    valor,
    forma_pagamento,
    referencia,
    observacoes,
    recebido_por
  ) values (
    v_est.id,
    v_pedido_id,
    v_caixa_id,
    v_subtotal,
    v_forma,
    'VENDA-RAPIDA',
    nullif(left(trim(coalesce(payload->>'observacoes', '')), 500), ''),
    v_uid
  )
  returning id into v_pagamento_id;

  update public.pedidos
  set status = 'finalizado'
  where id = v_pedido_id;

  return jsonb_build_object(
    'pedido_id', v_pedido_id,
    'codigo', v_codigo,
    'pagamento_id', v_pagamento_id,
    'caixa_id', v_caixa_id,
    'total', v_subtotal,
    'valor_recebido', v_recebido,
    'troco', v_troco,
    'status', 'finalizado',
    'idempotente', false
  );
exception when unique_violation then
  select p.*
  into v_existente
  from public.pedidos p
  where p.estabelecimento_id = v_est.id
    and p.checkout_token = v_token
  limit 1;

  if found then
    return jsonb_build_object(
      'pedido_id', v_existente.id,
      'codigo', v_existente.codigo,
      'total', v_existente.total,
      'troco', greatest(coalesce(v_existente.troco_para, v_existente.total) - v_existente.total, 0),
      'idempotente', true
    );
  end if;
  raise;
end;
$$;

create or replace function public.atualizar_status_pedido_operacional(
  p_novo_status text,
  p_pedido_id bigint,
  p_origem text default 'admin'
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
  v_usuario uuid := auth.uid();
  v_status text := case when p_novo_status = 'entregue' then 'finalizado' else p_novo_status end;
  v_origem text := case
    when p_origem in ('admin', 'caixa', 'cozinha', 'garcom', 'entregador') then p_origem
    else 'admin'
  end;
  v_total_pago numeric(12,2) := 0;
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado';
  end if;

  if v_status not in ('confirmado', 'preparo', 'pronto', 'servido', 'saiu_entrega', 'finalizado', 'cancelado') then
    raise exception 'Status inválido';
  end if;

  select p.*
  into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  where p.id = p_pedido_id
    and e.usuario_id = v_usuario
  for update of p;

  if not found then
    raise exception 'Pedido não encontrado ou sem permissão';
  end if;

  if not (
    (v_pedido.status = 'aguardando_aprovacao' and v_status = 'confirmado') or
    (v_pedido.status in ('novo', 'confirmado') and v_status = 'preparo') or
    (v_pedido.status = 'preparo' and v_status = 'pronto') or
    (v_pedido.status = 'pronto' and v_pedido.tipo in ('mesa', 'local') and v_status = 'servido') or
    (v_pedido.status = 'servido' and v_pedido.tipo in ('mesa', 'local') and v_status = 'finalizado') or
    (v_pedido.status = 'pronto' and v_pedido.tipo = 'retirada' and v_status = 'finalizado') or
    (v_pedido.status = 'pronto' and v_pedido.tipo = 'entrega' and v_status = 'saiu_entrega') or
    (v_pedido.status = 'saiu_entrega' and v_pedido.tipo = 'entrega' and v_status = 'finalizado') or
    (v_pedido.status not in ('finalizado', 'entregue', 'cancelado') and v_status = 'cancelado')
  ) then
    raise exception 'Transição de status inválida: % → %', v_pedido.status, v_status;
  end if;

  if v_status = 'finalizado'
     and (
       (v_pedido.tipo in ('mesa', 'local') and v_pedido.status = 'servido')
       or (v_pedido.tipo = 'retirada' and v_pedido.status = 'pronto')
     ) then
    if v_pedido.pagamento_status in ('autorizado', 'pago') then
      v_total_pago := v_pedido.total;
    else
      select coalesce(sum(p.valor), 0)::numeric(12,2)
      into v_total_pago
      from public.pagamentos p
      where p.pedido_id = v_pedido.id
        and p.estabelecimento_id = v_pedido.estabelecimento_id;
    end if;

    if v_total_pago < v_pedido.total then
      raise exception 'Existe pagamento pendente de R$ % antes da finalização.',
        replace(to_char(v_pedido.total - v_total_pago, 'FM999999990D00'), '.', ',');
    end if;
  end if;

  perform set_config('fsdelivery.origem', v_origem, true);
  perform set_config('fsdelivery.responsavel_id', v_usuario::text, true);

  update public.pedidos
  set status = v_status
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

revoke all on function public.abrir_caixa(uuid, numeric) from public, anon;
revoke all on function public.fechar_caixa(uuid, numeric, text) from public, anon;
revoke all on function public.obter_resumo_caixa(uuid) from public, anon;
revoke all on function public.registrar_pagamento_caixa(jsonb) from public, anon;
revoke all on function public.registrar_venda_rapida_caixa(jsonb) from public, anon;
revoke all on function public.atualizar_status_pedido_operacional(text, bigint, text) from public, anon;

grant execute on function public.abrir_caixa(uuid, numeric) to authenticated;
grant execute on function public.fechar_caixa(uuid, numeric, text) to authenticated;
grant execute on function public.obter_resumo_caixa(uuid) to authenticated;
grant execute on function public.registrar_pagamento_caixa(jsonb) to authenticated;
grant execute on function public.registrar_venda_rapida_caixa(jsonb) to authenticated;
grant execute on function public.atualizar_status_pedido_operacional(text, bigint, text) to authenticated;

comment on function public.registrar_pagamento_caixa(jsonb) is
  'Registra recebimentos simples ou de uma conta de mesa, bloqueia cobrança duplicada de pagamentos on-line e finaliza somente etapas elegíveis.';
comment on function public.registrar_venda_rapida_caixa(jsonb) is
  'Cria, recebe e finaliza uma venda avulsa sem cliente, endereço ou mesa, com preços validados no servidor e idempotência.';
comment on function public.obter_resumo_caixa(uuid) is
  'Retorna o resumo financeiro da sessão aberta, separando dinheiro físico das demais formas de pagamento.';

commit;
