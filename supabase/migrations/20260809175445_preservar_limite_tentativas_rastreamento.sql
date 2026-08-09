-- Preserva o contador de tentativas: respostas negativas não podem abortar a própria atualização.
-- Correção transacional registrada no histórico remoto do Supabase.

create or replace function public.recuperar_pedido_dispositivo(
  p_slug text,
  p_telefone text,
  p_codigo_pedido text,
  p_codigo_recuperacao text,
  p_token text,
  p_novo_codigo_recuperacao text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_telefone text := public.normalizar_whatsapp(coalesce(p_telefone, ''));
  v_codigo text := private.normalizar_codigo_rastreamento(p_codigo_recuperacao);
  v_novo_codigo text := private.normalizar_codigo_rastreamento(p_novo_codigo_recuperacao);
  v_pedido_id bigint;
  v_pedido_codigo text;
  v_estabelecimento uuid;
  v_cliente uuid;
  v_hash text;
  v_hash_esperado text;
  v_tentativas smallint;
  v_bloqueado_ate timestamptz;
  v_dispositivo uuid;
begin
  if char_length(v_telefone) not between 10 and 11
     or char_length(v_codigo) <> 10
     or char_length(v_novo_codigo) <> 10 then
    return jsonb_build_object('recuperado', false, 'motivo', 'credenciais_invalidas');
  end if;

  select p.id, p.codigo, p.estabelecimento_id, p.cliente_id,
         r.codigo_recuperacao_hash, r.tentativas_invalidas, r.bloqueado_ate
    into v_pedido_id, v_pedido_codigo, v_estabelecimento, v_cliente,
         v_hash_esperado, v_tentativas, v_bloqueado_ate
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  join public.clientes c on c.id = p.cliente_id
  join public.pedido_rastreamento_credenciais r on r.pedido_id = p.id
  where e.slug = trim(p_slug)
    and upper(p.codigo) = upper(trim(p_codigo_pedido))
    and coalesce(c.telefone_normalizado, public.normalizar_whatsapp(c.telefone)) = v_telefone
    and p.created_at >= now() - interval '90 days'
  limit 1
  for update of r;

  if not found then
    return jsonb_build_object('recuperado', false, 'motivo', 'credenciais_invalidas');
  end if;

  if v_bloqueado_ate is not null and v_bloqueado_ate > now() then
    return jsonb_build_object(
      'recuperado', false,
      'motivo', 'temporariamente_bloqueado',
      'tente_em', v_bloqueado_ate
    );
  end if;
  if v_bloqueado_ate is not null and v_bloqueado_ate <= now() then
    v_tentativas := 0;
  end if;

  v_hash := encode(extensions.digest(v_codigo, 'sha256'), 'hex');
  if v_hash <> v_hash_esperado then
    v_tentativas := least(20, coalesce(v_tentativas, 0) + 1);
    update public.pedido_rastreamento_credenciais
    set tentativas_invalidas = v_tentativas,
        ultima_tentativa_em = now(),
        bloqueado_ate = case when v_tentativas >= 5 then now() + interval '15 minutes' else null end,
        atualizado_em = now()
    where pedido_id = v_pedido_id;

    return jsonb_build_object(
      'recuperado', false,
      'motivo', case when v_tentativas >= 5 then 'temporariamente_bloqueado' else 'credenciais_invalidas' end
    );
  end if;

  v_dispositivo := private.obter_ou_criar_dispositivo(v_estabelecimento, v_cliente, p_token);

  insert into public.cliente_dispositivo_pedidos (dispositivo_id, pedido_id, origem)
  values (v_dispositivo, v_pedido_id, 'recuperacao')
  on conflict (dispositivo_id, pedido_id) do nothing;

  update public.pedido_rastreamento_credenciais
  set codigo_recuperacao_hash = encode(extensions.digest(v_novo_codigo, 'sha256'), 'hex'),
      tentativas_invalidas = 0,
      bloqueado_ate = null,
      ultima_tentativa_em = now(),
      atualizado_em = now()
  where pedido_id = v_pedido_id;

  delete from public.cliente_dispositivo_pedidos vinculo
  where vinculo.id in (
    select antigo.id
    from public.cliente_dispositivo_pedidos antigo
    where antigo.pedido_id = v_pedido_id
    order by antigo.criado_em desc, antigo.id desc
    offset 3
  );

  return jsonb_build_object('recuperado', true, 'pedido', v_pedido_codigo);
end;
$$;

revoke all on function public.recuperar_pedido_dispositivo(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.recuperar_pedido_dispositivo(text, text, text, text, text, text) to anon, authenticated;

comment on function public.recuperar_pedido_dispositivo(text, text, text, text, text, text) is
  'Recupera um pedido, persiste tentativas inválidas, bloqueia abuso e rotaciona o código após o uso.';
