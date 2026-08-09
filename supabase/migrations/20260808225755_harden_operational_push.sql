alter table public.app_runtime_secrets
  add column if not exists operational_push_token text;

update public.app_runtime_secrets
set operational_push_token = coalesce(
  nullif(operational_push_token, ''),
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
),
updated_at = now()
where id = 1;

create or replace function public.fsdelivery_despachar_push_operacional()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_token text;
begin
  select operational_push_token
  into v_token
  from public.app_runtime_secrets
  where id = 1;

  if length(coalesce(v_token, '')) < 32 then
    raise warning 'Push operacional não enviado: token interno ausente';
    return new;
  end if;

  perform net.http_post(
    url := 'https://kvjvhoziqcevkzyszdke.supabase.co/functions/v1/operational-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2anZob3ppcWNldmt6eXN6ZGtlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODc4MTksImV4cCI6MjA5MDM2MzgxOX0.ptXSP5LeasQgLuIicmTrtw_on5MfijUk26hllMsegfI',
      'x-operational-push-token', v_token
    ),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
exception when others then
  raise warning 'Falha ao enfileirar push operacional: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.fsdelivery_despachar_push_operacional() from public, anon, authenticated;
