-- FS Delivery — endurecimento de permissões públicas e RLS
-- Mantém apenas leitura pública necessária ao cardápio/QR e execução explícita
-- das funções públicas. Escritas devem ocorrer exclusivamente pelas RPCs validadas.

begin;

-- RLS deve permanecer habilitado nas tabelas operacionais, mesmo quando a
-- migration original tiver sido aplicada parcialmente.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'estabelecimentos',
    'categorias',
    'produtos',
    'mesas',
    'clientes',
    'pedidos',
    'itens_pedido',
    'pagamentos',
    'equipe'
  ] loop
    if to_regclass(format('public.%I',v_table)) is not null then
      execute format('alter table public.%I enable row level security',v_table);

      -- Nenhuma dessas tabelas pode aceitar escrita direta de visitante.
      execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from anon',v_table);
      execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from public',v_table);
    end if;
  end loop;
end
$$;

-- Dados operacionais e financeiros nunca devem ser legíveis diretamente por
-- visitantes. Consultas públicas devem passar por funções específicas que
-- retornem somente os campos necessários.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'clientes',
    'pedidos',
    'itens_pedido',
    'pagamentos',
    'equipe'
  ] loop
    if to_regclass(format('public.%I',v_table)) is not null then
      execute format('revoke select on table public.%I from anon',v_table);
      execute format('revoke select on table public.%I from public',v_table);
    end if;
  end loop;
end
$$;

-- Evita execução implícita de funções sensíveis pelo papel PUBLIC. As funções
-- necessárias recebem grants explícitos abaixo ou nas migrations de origem.
do $$
declare
  v_signature regprocedure;
begin
  foreach v_signature in array array[
    to_regprocedure('public.criar_pedido_publico(jsonb)'),
    to_regprocedure('public.criar_pedido_garcom(jsonb)'),
    to_regprocedure('public.registrar_pagamento_caixa(jsonb)'),
    to_regprocedure('public.listar_entregas_equipe(text,text,text)'),
    to_regprocedure('public.atualizar_entrega_equipe(text,text,text,bigint,text)')
  ] loop
    if v_signature is not null then
      execute format('revoke all on function %s from public',v_signature);
    end if;
  end loop;
end
$$;

-- Pedido público é o único fluxo anônimo de escrita permitido.
do $$
begin
  if to_regprocedure('public.criar_pedido_publico(jsonb)') is not null then
    grant execute on function public.criar_pedido_publico(jsonb) to anon, authenticated;
  end if;

  if to_regprocedure('public.criar_pedido_garcom(jsonb)') is not null then
    grant execute on function public.criar_pedido_garcom(jsonb) to authenticated;
  end if;

  if to_regprocedure('public.registrar_pagamento_caixa(jsonb)') is not null then
    grant execute on function public.registrar_pagamento_caixa(jsonb) to authenticated;
  end if;
end
$$;

-- Bloqueio adicional: mesmo que uma policy permissiva antiga exista, estes
-- papéis não recebem privilégios SQL diretos de alteração das tabelas.
comment on schema public is
  'FS Delivery: escritas públicas somente por RPCs validadas; tabelas operacionais protegidas por RLS.';

commit;
