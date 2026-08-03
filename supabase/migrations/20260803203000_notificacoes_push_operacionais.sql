-- Normaliza estados antigos e ativa notificações persistentes/push da equipe.
update public.pedidos set status='confirmado' where status='novo';
update public.pedidos set status='finalizado' where status='entregue';
insert into public.pedido_eventos(pedido_id,estabelecimento_id,status_anterior,status_novo,origem,created_at)
select p.id,p.estabelecimento_id,null,p.status,'migracao',p.created_at
from public.pedidos p
where not exists(select 1 from public.pedido_eventos e where e.pedido_id=p.id);


create table if not exists public.notificacoes_operacionais_leituras(
 notificacao_id uuid not null references public.notificacoes_operacionais(id) on delete cascade,
 destinatario_id uuid not null references public.equipe_operacional(id) on delete cascade,
 lida_em timestamptz not null default now(),
 primary key(notificacao_id,destinatario_id)
);
alter table public.notificacoes_operacionais_leituras enable row level security;

create table if not exists public.push_subscriptions_operacionais(
 id uuid primary key default gen_random_uuid(),
 estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
 destinatario text not null check(destinatario in('admin','caixa','cozinha','garcom','entregador')),
 destinatario_id uuid references public.equipe_operacional(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null,
 auth text not null,
 user_agent text,
 ativo boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_destino_idx on public.push_subscriptions_operacionals(estabelecimento_id,destinatario,ativo);
alter table public.push_subscriptions_operacionais enable row level security;
drop policy if exists push_subscriptions_owner_select on public.push_subscriptions_operacionais;
create policy push_subscriptions_owner_select on public.push_subscriptions_operacionais for select to authenticated using(exists(select 1 from public.estabelecimentos e where e.id=push_subscriptions_operacionais.estabelecimento_id and e.usuario_id=auth.uid()));

create or replace function public.fsdelivery_membro_operacional(p_telefone text,p_pin text,p_funcao text)
returns public.equipe_operacional language plpgsql security definer set search_path='public' as $$
declare v public.equipe_operacional%rowtype; v_count integer;
begin
 if p_funcao not in('garcom','entregador') then raise exception 'Função inválida'; end if;
 select count(*) into v_count from public.equipe_operacional m where regexp_replace(m.telefone,'\D','','g')=regexp_replace(p_telefone,'\D','','g') and m.pin=p_pin and m.funcao=p_funcao and m.ativo=true;
 if v_count<>1 then raise exception 'Acesso operacional inválido ou ambíguo'; end if;
 select * into v from public.equipe_operacional m where regexp_replace(m.telefone,'\D','','g')=regexp_replace(p_telefone,'\D','','g') and m.pin=p_pin and m.funcao=p_funcao and m.ativo=true limit 1;
 return v;
end;$$;

create or replace function public.listar_notificacoes_equipe(p_telefone text,p_pin text,p_funcao text,p_limite integer default 40)
returns table(id uuid,pedido_id bigint,titulo text,mensagem text,lida boolean,lida_em timestamptz,created_at timestamptz,tipo text)
language plpgsql security definer set search_path='public' as $$
declare v public.equipe_operacional%rowtype;
begin
 v:=public.fsdelivery_membro_operacional(p_telefone,p_pin,p_funcao);
 return query select n.id,n.pedido_id,n.titulo,n.mensagem,(r.notificacao_id is not null) as lida,r.lida_em,n.created_at,n.tipo from public.notificacoes_operacionais n left join public.notificacoes_operacionais_leituras r on r.notificacao_id=n.id and r.destinatario_id=v.id where n.estabelecimento_id=v.estabelecimento_id and n.destinatario=p_funcao and(n.destinatario_id is null or n.destinatario_id=v.id) order by n.created_at desc limit greatest(1,least(coalesce(p_limite,40),100));
end;$$;

create or replace function public.marcar_notificacao_equipe_lida(p_telefone text,p_pin text,p_funcao text,p_notificacao_id uuid)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v public.equipe_operacional%rowtype;
begin
 v:=public.fsdelivery_membro_operacional(p_telefone,p_pin,p_funcao);
 insert into public.notificacoes_operacionais_leituras(notificacao_id,destinatario_id,lida_em) select n.id,v.id,now() from public.notificacoes_operacionais n where n.id=p_notificacao_id and n.estabelecimento_id=v.estabelecimento_id and n.destinatario=p_funcao and(n.destinatario_id is null or n.destinatario_id=v.id) on conflict(notificacao_id,destinatario_id) do update set lida_em=excluded.lida_em;
 return found;
end;$$;

create or replace function public.registrar_push_equipe(p_telefone text,p_pin text,p_funcao text,p_endpoint text,p_p256dh text,p_auth text,p_user_agent text default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v public.equipe_operacional%rowtype; v_id uuid;
begin
 v:=public.fsdelivery_membro_operacional(p_telefone,p_pin,p_funcao);
 insert into public.push_subscriptions_operacionais(estabelecimento_id,destinatario,destinatario_id,endpoint,p256dh,auth,user_agent,ativo,updated_at) values(v.estabelecimento_id,p_funcao,v.id,p_endpoint,p_p256dh,p_auth,left(p_user_agent,500),true,now()) on conflict(endpoint) do update set estabelecimento_id=excluded.estabelecimento_id,destinatario=excluded.destinatario,destinatario_id=excluded.destinatario_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,ativo=true,updated_at=now() returning id into v_id;
 return v_id;
end;$$;

create or replace function public.registrar_push_admin(p_destinatario text,p_endpoint text,p_p256dh text,p_auth text,p_user_agent text default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_est uuid; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Usuário não autenticado'; end if;
 if p_destinatario not in('admin','caixa','cozinha') then raise exception 'Destino inválido'; end if;
 select id into v_est from public.estabelecimentos where usuario_id=auth.uid() limit 1;
 if v_est is null then raise exception 'Estabelecimento não encontrado'; end if;
 insert into public.push_subscriptions_operacionais(estabelecimento_id,destinatario,destinatario_id,endpoint,p256dh,auth,user_agent,ativo,updated_at) values(v_est,p_destinatario,null,p_endpoint,p_p256dh,p_auth,left(p_user_agent,500),true,now()) on conflict(endpoint) do update set estabelecimento_id=excluded.estabelecimento_id,destinatario=excluded.destinatario,destinatario_id=null,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,ativo=true,updated_at=now() returning id into v_id;
 return v_id;
end;$$;

grant execute on function public.listar_notificacoes_equipe(text,text,text,integer) to anon,authenticated;
grant execute on function public.marcar_notificacao_equipe_lida(text,text,text,uuid) to anon,authenticated;
grant execute on function public.registrar_push_equipe(text,text,text,text,text,text,text) to anon,authenticated;
grant execute on function public.registrar_push_admin(text,text,text,text,text) to authenticated;

-- Garante notificações úteis para pedidos ativos já existentes.
insert into public.notificacoes_operacionais(estabelecimento_id,pedido_id,destinatario,tipo,titulo,mensagem,chave_deduplicacao)
select p.estabelecimento_id,p.id,
 case when p.status='confirmado' then 'cozinha' when p.status='pronto' and p.tipo in('mesa','local') then 'garcom' when p.status='pronto' and p.tipo='entrega' then 'entregador' when p.status='pronto' then 'caixa' else null end,
 p.status,
 case when p.status='confirmado' then 'Novo pedido na cozinha' when p.status='pronto' and p.tipo in('mesa','local') then 'Pedido pronto para servir' when p.status='pronto' and p.tipo='entrega' then 'Pedido pronto para entrega' else 'Pedido pronto para retirada' end,
 'Pedido #'||coalesce(p.codigo,p.id::text)||case when p.status='confirmado' then ' foi liberado para produção.' when p.tipo in('mesa','local') then ' está pronto para levar à mesa.' when p.tipo='entrega' then ' está liberado para iniciar a entrega.' else ' está pronto para retirada.' end,
 concat(p.id,':',p.status,':',case when p.status='confirmado' then 'cozinha' when p.status='pronto' and p.tipo in('mesa','local') then 'garcom' when p.status='pronto' and p.tipo='entrega' then 'entregador' else 'caixa' end)
from public.pedidos p where p.status in('confirmado','pronto')
on conflict do nothing;

create extension if not exists pg_net with schema extensions;
create or replace function public.fsdelivery_despachar_push_operacional()
returns trigger language plpgsql security definer set search_path='public','extensions' as $$
begin
 perform net.http_post(
  url:='https://kvjvhoziqcevkzyszdke.supabase.co/functions/v1/operational-push',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2anZob3ppcWNldmt6eXN6ZGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODc4MTksImV4cCI6MjA5MDM2MzgxOX0.ptXSP5LeasQgLuIicmTrtw_on5MfijUk26hllMsegfI'),
  body:=jsonb_build_object('notification_id',new.id)
 );
 return new;
exception when others then
 raise warning 'Falha ao enfileirar push operacional: %',sqlerrm;
 return new;
end;$$;
drop trigger if exists trg_despachar_push_operacional on public.notificacoes_operacionais;
create trigger trg_despachar_push_operacional after insert on public.notificacoes_operacionais for each row execute function public.fsdelivery_despachar_push_operacional();

-- Restringe acesso direto e RPCs internas; os portais operacionais usam apenas funções autenticadas por sessão/PIN.
revoke all on table public.push_subscriptions_operacionais from anon, authenticated;
revoke all on table public.notificacoes_operacionais_leituras from anon, authenticated;
revoke execute on function public.fsdelivery_membro_operacional(text,text,text) from public, anon, authenticated;
revoke execute on function public.fsdelivery_despachar_push_operacional() from public, anon, authenticated;
revoke execute on function public.registrar_evento_operacional_pedido() from public, anon, authenticated;
revoke execute on function public.definir_status_inicial_pedido() from public, anon, authenticated;
revoke execute on function public.atualizar_timestamp_pedido() from public, anon, authenticated;
revoke execute on function public.registrar_push_admin(text,text,text,text,text) from public, anon;
grant execute on function public.registrar_push_admin(text,text,text,text,text) to authenticated;
revoke execute on function public.aprovar_pedido_caixa(bigint) from public, anon;
grant execute on function public.aprovar_pedido_caixa(bigint) to authenticated;
revoke execute on function public.atualizar_status_pedido_operacional(text,bigint,text) from public, anon;
grant execute on function public.atualizar_status_pedido_operacional(text,bigint,text) to authenticated;
