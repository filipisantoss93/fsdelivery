alter table public.pedidos drop constraint if exists pedidos_status_check;
alter table public.pedidos
  add constraint pedidos_status_check
  check (status = any (array[
    'aguardando_aprovacao'::text,
    'novo'::text,
    'confirmado'::text,
    'preparo'::text,
    'pronto'::text,
    'servido'::text,
    'saiu_entrega'::text,
    'finalizado'::text,
    'entregue'::text,
    'cancelado'::text
  ]));

create or replace function public.atualizar_status_pedido_operacional(
  p_novo_status text,
  p_pedido_id bigint,
  p_origem text default 'admin'::text
)
returns public.pedidos
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedido public.pedidos%rowtype;
  v_usuario uuid := auth.uid();
  v_status text := case when p_novo_status = 'entregue' then 'finalizado' else p_novo_status end;
  v_origem text := case when p_origem in ('admin','caixa','cozinha','garcom','entregador') then p_origem else 'admin' end;
  v_total_pago numeric(10,2) := 0;
begin
  if v_usuario is null then raise exception 'Usuário não autenticado'; end if;
  if v_status not in ('confirmado','preparo','pronto','servido','saiu_entrega','finalizado','cancelado') then raise exception 'Status inválido'; end if;

  select p.* into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  where p.id = p_pedido_id and e.usuario_id = v_usuario
  for update of p;

  if not found then raise exception 'Pedido não encontrado ou sem permissão'; end if;

  if not (
    (v_pedido.status = 'aguardando_aprovacao' and v_status = 'confirmado') or
    (v_pedido.status in ('novo','confirmado') and v_status = 'preparo') or
    (v_pedido.status = 'preparo' and v_status = 'pronto') or
    (v_pedido.status = 'pronto' and v_pedido.tipo in ('mesa','local') and v_status = 'servido') or
    (v_pedido.status = 'servido' and v_pedido.tipo in ('mesa','local') and v_status = 'finalizado') or
    (v_pedido.status = 'pronto' and v_pedido.tipo = 'retirada' and v_status = 'finalizado') or
    (v_pedido.status = 'pronto' and v_pedido.tipo = 'entrega' and v_status = 'saiu_entrega') or
    (v_pedido.status = 'saiu_entrega' and v_pedido.tipo = 'entrega' and v_status = 'finalizado') or
    (v_pedido.status not in ('finalizado','entregue','cancelado') and v_status = 'cancelado')
  ) then
    raise exception 'Transição de status inválida: % → %', v_pedido.status, v_status;
  end if;

  if v_pedido.tipo in ('mesa','local') and v_pedido.status = 'servido' and v_status = 'finalizado' then
    select coalesce(sum(valor),0) into v_total_pago from public.pagamentos where pedido_id = v_pedido.id;
    if v_total_pago < v_pedido.total then
      raise exception 'A mesa continua ocupada: existe pagamento pendente de R$ %', to_char(v_pedido.total - v_total_pago, 'FM999999990D00');
    end if;
  end if;

  perform set_config('fsdelivery.origem', v_origem, true);
  perform set_config('fsdelivery.responsavel_id', v_usuario::text, true);
  update public.pedidos set status = v_status where id = p_pedido_id returning * into v_pedido;
  return v_pedido;
end
$function$;

create or replace function public.marcar_pedido_servido_equipe_garcom(
  p_telefone text,
  p_pin text,
  p_pedido_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m public.equipe_operacional%rowtype;
  v_pedido public.pedidos%rowtype;
  v_total_pago numeric(10,2) := 0;
  v_status_final text := 'servido';
begin
  select * into v_m
  from public.equipe_operacional m
  where regexp_replace(m.telefone,'\D','','g') = regexp_replace(p_telefone,'\D','','g')
    and m.pin = p_pin and m.funcao = 'garcom' and m.ativo = true
  limit 1;
  if not found then raise exception 'Acesso do garçom inválido'; end if;

  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
    and estabelecimento_id = v_m.estabelecimento_id
    and tipo in ('mesa','local')
  for update;
  if not found then raise exception 'Pedido não encontrado para este estabelecimento'; end if;
  if v_pedido.status <> 'pronto' then raise exception 'Somente pedidos prontos podem ser marcados como servidos'; end if;

  select coalesce(sum(valor),0) into v_total_pago from public.pagamentos where pedido_id = v_pedido.id;
  perform set_config('fsdelivery.origem', 'garcom', true);
  perform set_config('fsdelivery.responsavel_id', v_m.id::text, true);
  update public.pedidos set status = 'servido' where id = v_pedido.id;

  if v_total_pago >= v_pedido.total then
    update public.pedidos set status = 'finalizado' where id = v_pedido.id;
    v_status_final := 'finalizado';
  end if;

  return jsonb_build_object(
    'status', v_status_final,
    'quitado', v_total_pago >= v_pedido.total,
    'saldo', greatest(v_pedido.total - v_total_pago, 0)
  );
end
$function$;

create or replace function public.finalizar_pedido_equipe_garcom(
  p_telefone text,
  p_pin text,
  p_pedido_id bigint
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.marcar_pedido_servido_equipe_garcom(p_telefone, p_pin, p_pedido_id);
  return true;
end
$function$;

revoke all on function public.marcar_pedido_servido_equipe_garcom(text,text,bigint) from public;
grant execute on function public.marcar_pedido_servido_equipe_garcom(text,text,bigint) to anon, authenticated;
revoke all on function public.finalizar_pedido_equipe_garcom(text,text,bigint) from public;
grant execute on function public.finalizar_pedido_equipe_garcom(text,text,bigint) to anon, authenticated;

drop function if exists public.registrar_pagamento_caixa(jsonb);
create function public.registrar_pagamento_caixa(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedido public.pedidos%rowtype;
  v_pagamento_id uuid;
  v_total_pago numeric(10,2);
  v_total_apos numeric(10,2);
  v_saldo numeric(10,2);
  v_valor numeric(10,2);
  v_forma text;
  v_quitado boolean;
  v_finalizado boolean := false;
begin
  if auth.uid() is null then raise exception 'Acesso não autorizado.'; end if;

  select p.* into v_pedido
  from public.pedidos p
  join public.estabelecimentos e on e.id = p.estabelecimento_id
  where p.id = (payload->>'pedido_id')::bigint and e.usuario_id = auth.uid()
  for update of p;

  if v_pedido.id is null then raise exception 'Pedido não encontrado ou sem permissão.'; end if;
  if v_pedido.status in ('cancelado','finalizado','entregue') then raise exception 'Este pedido não aceita novos pagamentos.'; end if;

  v_valor := round(replace(coalesce(payload->>'valor','0'), ',', '.')::numeric, 2);
  if v_valor <= 0 then raise exception 'Valor de pagamento inválido.'; end if;

  v_forma := lower(trim(coalesce(payload->>'forma_pagamento','')));
  if v_forma not in ('pix','dinheiro','credito','debito','vale') then raise exception 'Forma de pagamento inválida.'; end if;

  select coalesce(sum(valor),0) into v_total_pago from public.pagamentos where pedido_id = v_pedido.id;
  if v_total_pago + v_valor > v_pedido.total then raise exception 'O valor informado ultrapassa o saldo do pedido.'; end if;

  insert into public.pagamentos(
    estabelecimento_id,pedido_id,valor,forma_pagamento,referencia,observacoes,recebido_por
  ) values (
    v_pedido.estabelecimento_id,
    v_pedido.id,
    v_valor,
    v_forma,
    nullif(trim(payload->>'referencia'),''),
    nullif(trim(payload->>'observacoes'),''),
    auth.uid()
  ) returning id into v_pagamento_id;

  v_total_apos := v_total_pago + v_valor;
  v_saldo := greatest(v_pedido.total - v_total_apos, 0);
  v_quitado := v_saldo = 0;
  update public.pedidos set forma_pagamento = v_forma where id = v_pedido.id;

  if v_quitado and v_pedido.tipo in ('mesa','local') and v_pedido.status = 'servido' then
    perform set_config('fsdelivery.origem', 'caixa', true);
    perform set_config('fsdelivery.responsavel_id', auth.uid()::text, true);
    update public.pedidos set status = 'finalizado' where id = v_pedido.id;
    v_finalizado := true;
  end if;

  return jsonb_build_object(
    'pagamento_id', v_pagamento_id,
    'quitado', v_quitado,
    'saldo', v_saldo,
    'finalizado', v_finalizado,
    'status', case when v_finalizado then 'finalizado' else v_pedido.status end
  );
end
$function$;

revoke all on function public.registrar_pagamento_caixa(jsonb) from public;
grant execute on function public.registrar_pagamento_caixa(jsonb) to authenticated;

create or replace function public.registrar_evento_operacional_pedido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_origem text := public.fsdelivery_origem_operacao();
  v_responsavel uuid := public.fsdelivery_responsavel_operacao();
  v_destino text;
  v_titulo text;
  v_mensagem text;
  v_codigo text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  v_codigo := coalesce(new.codigo,new.id::text);

  insert into public.pedido_eventos(
    pedido_id,estabelecimento_id,status_anterior,status_novo,origem,responsavel_id
  ) values (
    new.id,new.estabelecimento_id,
    case when tg_op='INSERT' then null else old.status end,
    new.status,v_origem,v_responsavel
  );

  if new.status = 'aguardando_aprovacao' then
    v_destino := 'caixa'; v_titulo := 'Pedido aguardando aprovação'; v_mensagem := 'Pedido #'||v_codigo||' precisa ser aprovado antes do preparo.';
  elsif new.status in ('confirmado','novo') then
    v_destino := 'cozinha'; v_titulo := 'Novo pedido na cozinha'; v_mensagem := 'Pedido #'||v_codigo||' foi liberado para produção.';
  elsif new.status = 'pronto' then
    if new.tipo in ('mesa','local') then
      v_destino := 'garcom'; v_titulo := 'Pedido pronto para servir'; v_mensagem := 'Pedido #'||v_codigo||' está pronto para levar à mesa.';
    elsif new.tipo = 'entrega' then
      v_destino := 'entregador'; v_titulo := 'Pedido pronto para entrega'; v_mensagem := 'Pedido #'||v_codigo||' está liberado para iniciar a entrega.';
    else
      v_destino := 'caixa'; v_titulo := 'Pedido pronto para retirada'; v_mensagem := 'Pedido #'||v_codigo||' está pronto para retirada.';
    end if;
  elsif new.status = 'servido' then
    v_destino := 'caixa'; v_titulo := 'Mesa aguardando pagamento'; v_mensagem := 'Pedido #'||v_codigo||' foi servido e permanece aberto até a quitação.';
  elsif new.status = 'saiu_entrega' then
    v_destino := 'admin'; v_titulo := 'Entrega iniciada'; v_mensagem := 'Pedido #'||v_codigo||' saiu para entrega.';
  elsif new.status in ('finalizado','entregue') then
    v_destino := 'admin'; v_titulo := 'Pedido finalizado'; v_mensagem := 'Pedido #'||v_codigo||' foi concluído.';
  elsif new.status = 'cancelado' then
    v_destino := 'admin'; v_titulo := 'Pedido cancelado'; v_mensagem := 'Pedido #'||v_codigo||' foi cancelado.';
  end if;

  if v_destino is not null then
    insert into public.notificacoes_operacionais(
      estabelecimento_id,pedido_id,destinatario,tipo,titulo,mensagem,chave_deduplicacao
    ) values (
      new.estabelecimento_id,new.id,v_destino,new.status,v_titulo,v_mensagem,
      concat(new.id,':',new.status,':',v_destino)
    ) on conflict do nothing;
  end if;

  return new;
end
$function$;
