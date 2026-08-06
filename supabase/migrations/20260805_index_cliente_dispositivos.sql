begin;
create index if not exists cliente_dispositivos_cliente_id_idx
  on public.cliente_dispositivos(cliente_id);
commit;
