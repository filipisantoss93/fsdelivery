-- FS Delivery — consolidação dos fluxos de pedidos
-- Aplicar após as migrations de mesas, garçom e operação de pedidos.

create or replace function public.normalizar_fluxo_pedido()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.tipo := lower(trim(coalesce(new.tipo, 'retirada')));
  new.origem := lower(trim(coalesce(new.origem, 'publico')));

  if new.tipo not in ('mesa', 'local', 'retirada', 'entrega') then
    raise exception 'Tipo de pedido inválido: %', new.tipo;
  end if;

  -- Mesa é exclusiva do salão/QR. Nunca mantém endereço ou taxa de entrega.
  if new.tipo = 'mesa' then
    if new.mesa_id is null then
      raise exception 'Pedido de mesa exige uma mesa válida.';
    end if;
    new.endereco_entrega := null;
    new.taxa_entrega := 0;
  else
    new.mesa_id := null;
  end if;

  -- Endereço e taxa existem somente em entrega.
  if new.tipo <> 'entrega' then
    new.endereco_entrega := null;
    new.taxa_entrega := 0;
  elsif new.endereco_entrega is null then
    raise exception 'Pedido de entrega exige endereço.';
  end if;

  -- Pedido remoto precisa de aprovação do restaurante.
  -- Pedido de QR da mesa ou criado pela equipe entra confirmado.
  if new.origem = 'publico' and new.tipo in ('retirada', 'entrega') then
    new.status := 'aguardando_aprovacao';
  elsif new.origem in ('qr_mesa', 'painel', 'garcom', 'balcao') then
    new.status := 'confirmado';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalizar_fluxo_pedido on public.pedidos;
create trigger trg_normalizar_fluxo_pedido
before insert or update of tipo, origem, mesa_id, endereco_entrega, taxa_entrega
on public.pedidos
for each row execute function public.normalizar_fluxo_pedido();

-- Compatibilidade com origens operacionais mais específicas.
alter table public.pedidos drop constraint if exists pedidos_origem_check;
alter table public.pedidos add constraint pedidos_origem_check
check (origem in ('publico', 'qr_mesa', 'painel', 'garcom', 'balcao'));

-- Corrige somente pedidos antigos que ainda não avançaram na operação.
update public.pedidos
set status = case
  when origem = 'publico' and tipo in ('retirada', 'entrega') then 'aguardando_aprovacao'
  else 'confirmado'
end,
mesa_id = case when tipo = 'mesa' then mesa_id else null end,
endereco_entrega = case when tipo = 'entrega' then endereco_entrega else null end,
taxa_entrega = case when tipo = 'entrega' then coalesce(taxa_entrega, 0) else 0 end
where status in ('novo', 'aguardando', 'recebido');

create index if not exists idx_pedidos_origem_tipo_status
on public.pedidos(estabelecimento_id, origem, tipo, status, created_at desc);
