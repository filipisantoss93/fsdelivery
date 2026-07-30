-- FS Delivery — operação segura do garçom por WhatsApp/PIN
-- Nenhuma tabela operacional é liberada ao papel anon.

begin;

create or replace function public.carregar_operacao_garcom(
  p_telefone text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membro jsonb;
  v_estabelecimento_id uuid;
  v_resultado jsonb;
begin
  v_membro := public.autenticar_equipe_por_whatsapp(p_telefone, p_pin, 'garcom');
  v_estabelecimento_id := nullif(v_membro->>'estabelecimento_id','')::uuid;

  if v_estabelecimento_id is null then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'estabelecimento', jsonb_build_object(
      'id', e.id,
      'nome', e.nome,
      'slug', e.slug,
      'aberto', e.aberto,
      'taxa_entrega', e.taxa_entrega
    ),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'descricao', p.descricao,
        'preco', p.preco,
        'categoria', coalesce(c.nome,'Sem categoria')
      ) order by p.nome)
      from public.produtos p
      left join public.categorias c on c.id = p.categoria_id
      where p.estabelecimento_id = e.id
        and p.ativo = true
    ), '[]'::jsonb),
    'mesas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'numero', coalesce(to_jsonb(m)->>'numero', to_jsonb(m)->>'identificacao'),
        'nome', m.nome,
        'token', coalesce(to_jsonb(m)->>'codigo_qr', to_jsonb(m)->>'token_publico')
      ) order by coalesce(to_jsonb(m)->>'numero', to_jsonb(m)->>'identificacao'))
      from public.mesas m
      where m.estabelecimento_id = e.id
        and m.ativo = true
    ), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'codigo', p.codigo,
        'status', p.status,
        'tipo', p.tipo,
        'total', p.total,
        'created_at', p.created_at,
        'mesa_id', p.mesa_id,
        'cliente_nome', c.nome,
        'cliente_telefone', c.telefone,
        'mesa_nome', m.nome,
        'mesa_numero', coalesce(to_jsonb(m)->>'numero', to_jsonb(m)->>'identificacao'),
        'itens', coalesce((
          select jsonb_agg(jsonb_build_object(
            'quantidade', i.quantidade,
            'nome', i.nome_produto
          ) order by i.id)
          from public.itens_pedido i
          where i.pedido_id = p.id
        ), '[]'::jsonb)
      ) order by p.created_at desc)
      from public.pedidos p
      left join public.clientes c on c.id = p.cliente_id
      left join public.mesas m on m.id = p.mesa_id
      where p.estabelecimento_id = e.id
      limit 100
    ), '[]'::jsonb)
  ) into v_resultado
  from public.estabelecimentos e
  where e.id = v_estabelecimento_id;

  if v_resultado is null then
    raise exception 'Estabelecimento não encontrado.';
  end if;

  return v_resultado;
end;
$$;

create or replace function public.criar_pedido_equipe_garcom(
  p_telefone text,
  p_pin text,
  payload jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_membro jsonb;
  v_slug text;
  v_payload jsonb;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Dados do pedido inválidos.';
  end if;

  v_membro := public.autenticar_equipe_por_whatsapp(p_telefone, p_pin, 'garcom');
  v_slug := nullif(v_membro->>'slug','');

  if v_slug is null then
    raise exception 'Credenciais inválidas.' using errcode = '28000';
  end if;

  v_payload := jsonb_set(payload, '{slug}', to_jsonb(v_slug), true);
  return public.criar_pedido_publico(v_payload);
end;
$$;

revoke all on function public.carregar_operacao_garcom(text, text) from public;
revoke all on function public.criar_pedido_equipe_garcom(text, text, jsonb) from public;
grant execute on function public.carregar_operacao_garcom(text, text) to anon, authenticated;
grant execute on function public.criar_pedido_equipe_garcom(text, text, jsonb) to anon, authenticated;

comment on function public.carregar_operacao_garcom(text, text) is
  'Retorna somente os dados operacionais necessários após validar garçom ativo por WhatsApp/PIN.';
comment on function public.criar_pedido_equipe_garcom(text, text, jsonb) is
  'Cria pedido do garçom após autenticação e reaproveita a validação integral de preços do pedido público.';

commit;