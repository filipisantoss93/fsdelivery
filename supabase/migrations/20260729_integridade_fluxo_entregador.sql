-- FS Delivery — integridade e autorização do fluxo do entregador
-- O portal da equipe usa autenticação própria por WhatsApp/PIN e, portanto,
-- executa estas RPCs sob o papel anon. Nenhuma tabela recebe acesso direto.

begin;

create extension if not exists pgcrypto;

create or replace function public.listar_entregas_equipe(
  p_slug text,
  p_telefone text,
  p_pin text
)
returns table (
  id bigint,
  codigo text,
  status text,
  total numeric,
  cliente_nome text,
  cliente_telefone text,
  endereco_entrega jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estabelecimento_id uuid;
  v_membro jsonb;
  v_pin_armazenado text;
  v_telefone text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
begin
  if length(v_telefone) not between 10 and 11 or length(v_pin) not between 4 and 6 then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  select e.id
    into v_estabelecimento_id
  from public.estabelecimentos e
  where e.slug = trim(p_slug)
  limit 1;

  if v_estabelecimento_id is null then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  select to_jsonb(eq)
    into v_membro
  from public.equipe eq
  where (to_jsonb(eq)->>'estabelecimento_id')::uuid = v_estabelecimento_id
    and regexp_replace(coalesce(to_jsonb(eq)->>'telefone', ''), '\D', '', 'g') = v_telefone
    and lower(coalesce(to_jsonb(eq)->>'funcao', '')) = 'entregador'
    and coalesce((to_jsonb(eq)->>'ativo')::boolean, true) = true
  limit 1;

  if v_membro is null then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  v_pin_armazenado := coalesce(v_membro->>'pin_hash', v_membro->>'pin', v_membro->>'codigo_acesso');

  if v_pin_armazenado is null or not (
    case
      when v_pin_armazenado like '$2%' then crypt(v_pin, v_pin_armazenado) = v_pin_armazenado
      else v_pin_armazenado = v_pin
    end
  ) then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  return query
  select
    p.id,
    p.codigo,
    p.status,
    p.total,
    c.nome,
    c.telefone,
    p.endereco_entrega,
    p.created_at
  from public.pedidos p
  left join public.clientes c on c.id = p.cliente_id
  where p.estabelecimento_id = v_estabelecimento_id
    and p.tipo = 'entrega'
    and p.status in ('pronto', 'saiu_entrega')
  order by
    case p.status when 'saiu_entrega' then 0 else 1 end,
    p.created_at asc
  limit 100;
end;
$$;

create or replace function public.atualizar_entrega_equipe(
  p_slug text,
  p_telefone text,
  p_pin text,
  p_pedido bigint,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estabelecimento_id uuid;
  v_membro jsonb;
  v_pin_armazenado text;
  v_pedido public.pedidos%rowtype;
  v_telefone text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
  v_novo_status text := lower(trim(coalesce(p_status, '')));
begin
  if p_pedido is null or p_pedido <= 0 then
    raise exception 'Pedido inválido.';
  end if;

  if v_novo_status not in ('saiu_entrega', 'entregue') then
    raise exception 'Status de entrega inválido.';
  end if;

  if length(v_telefone) not between 10 and 11 or length(v_pin) not between 4 and 6 then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  select e.id
    into v_estabelecimento_id
  from public.estabelecimentos e
  where e.slug = trim(p_slug)
  limit 1;

  if v_estabelecimento_id is null then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  select to_jsonb(eq)
    into v_membro
  from public.equipe eq
  where (to_jsonb(eq)->>'estabelecimento_id')::uuid = v_estabelecimento_id
    and regexp_replace(coalesce(to_jsonb(eq)->>'telefone', ''), '\D', '', 'g') = v_telefone
    and lower(coalesce(to_jsonb(eq)->>'funcao', '')) = 'entregador'
    and coalesce((to_jsonb(eq)->>'ativo')::boolean, true) = true
  limit 1;

  if v_membro is null then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  v_pin_armazenado := coalesce(v_membro->>'pin_hash', v_membro->>'pin', v_membro->>'codigo_acesso');

  if v_pin_armazenado is null or not (
    case
      when v_pin_armazenado like '$2%' then crypt(v_pin, v_pin_armazenado) = v_pin_armazenado
      else v_pin_armazenado = v_pin
    end
  ) then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  select *
    into v_pedido
  from public.pedidos p
  where p.id = p_pedido
    and p.estabelecimento_id = v_estabelecimento_id
    and p.tipo = 'entrega'
  for update;

  if v_pedido.id is null then
    raise exception 'Entrega não encontrada.';
  end if;

  if v_pedido.status = v_novo_status then
    return jsonb_build_object(
      'pedido_id', v_pedido.id,
      'status', v_pedido.status,
      'alterado', false
    );
  end if;

  if v_novo_status = 'saiu_entrega' and v_pedido.status <> 'pronto' then
    raise exception 'Somente pedidos prontos podem iniciar a entrega.';
  end if;

  if v_novo_status = 'entregue' and v_pedido.status <> 'saiu_entrega' then
    raise exception 'O pedido precisa estar em entrega antes de ser concluído.';
  end if;

  update public.pedidos
  set status = v_novo_status,
      atualizado_em = now()
  where id = v_pedido.id;

  return jsonb_build_object(
    'pedido_id', v_pedido.id,
    'status', v_novo_status,
    'alterado', true
  );
end;
$$;

revoke all on function public.listar_entregas_equipe(text, text, text) from public;
revoke all on function public.atualizar_entrega_equipe(text, text, text, bigint, text) from public;

grant execute on function public.listar_entregas_equipe(text, text, text) to anon, authenticated;
grant execute on function public.atualizar_entrega_equipe(text, text, text, bigint, text) to anon, authenticated;

comment on function public.listar_entregas_equipe(text, text, text) is
  'Lista somente entregas prontas ou em rota após validar entregador ativo por WhatsApp/PIN.';

comment on function public.atualizar_entrega_equipe(text, text, text, bigint, text) is
  'Permite exclusivamente as transições pronto -> saiu_entrega -> entregue para pedidos de entrega da mesma loja.';

commit;