-- Entrega ao cardápio somente a configuração operacional e as regiões que são
-- públicas por natureza, sem abrir as tabelas administrativas via RLS.

create or replace function public.contexto_publico_loja(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_estabelecimento_id uuid;
begin
  if p_slug is null
    or length(trim(p_slug)) < 3
    or length(trim(p_slug)) > 120
    or lower(trim(p_slug)) !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' then
    return null;
  end if;

  select e.id into v_estabelecimento_id
  from public.estabelecimentos e
  where e.slug = lower(trim(p_slug));

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'operacional', coalesce((
      select jsonb_build_object(
        'formas_pagamento', coalesce(c.formas_pagamento, '[]'::jsonb),
        'taxa_servico_percentual', coalesce(c.taxa_servico_percentual, 0),
        'cupons_ativos', coalesce(c.cupons_ativos, false),
        'usar_horarios', coalesce(c.usar_horarios, false)
      )
      from public.configuracoes_operacionais c
      where c.estabelecimento_id = v_estabelecimento_id
    ), jsonb_build_object(
      'formas_pagamento', '[]'::jsonb,
      'taxa_servico_percentual', 0,
      'cupons_ativos', false,
      'usar_horarios', false
    )),
    'regioes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'nome', r.nome,
        'taxa', r.taxa,
        'prazo_adicional', r.prazo_adicional,
        'cidade', r.cidade,
        'estado', r.estado
      ) order by r.nome)
      from public.taxas_entrega_regioes r
      where r.estabelecimento_id = v_estabelecimento_id
        and r.ativo = true
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.contexto_publico_loja(text) from public;
grant execute on function public.contexto_publico_loja(text) to anon, authenticated, service_role;

comment on function public.contexto_publico_loja(text) is
  'Retorna apenas meios de pagamento, regras comerciais públicas e regiões ativas do cardápio.';
