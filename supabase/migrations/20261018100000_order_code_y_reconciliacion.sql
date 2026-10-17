-- El código de operación de la pasarela, y los pedidos que se quedan colgados.
--
-- TropiPay pide `orderCode` para reembolsar, y ese dato no es el que
-- guardábamos: `payment_charge_id` lleva el `bankOrderCode`, que sirve para
-- rastrear el cobro pero no para devolverlo. Sin esta columna, ningún pedido
-- cobrado hasta hoy se podría reembolsar desde Nexoo.

alter table public.orders
    add column if not exists payment_order_code text;

comment on column public.orders.payment_order_code is
    'Código de la operación en la pasarela (orderCode en TropiPay): es lo que hace falta para pedir un reembolso.';

-- `mark_order_paid` gana el código de operación. La versión de seis argumentos
-- se queda delegando en esta, porque `stripe-webhook` la sigue llamando y no
-- tiene sentido dejar los cobros rotos entre el SQL y el despliegue.
create or replace function public.mark_order_paid(
    p_order_id   uuid,
    p_provider   text,
    p_charge_id  text,
    p_currency   text,
    p_amount     numeric,
    p_fx_rate    numeric,
    p_order_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_updated integer;
begin
    if p_provider not in ('stripe', 'tropipay') then
        raise exception 'Pasarela desconocida: %', p_provider using errcode = '22023';
    end if;

    update public.orders
       set status              = 'Paid',
           payment_provider    = p_provider,
           payment_charge_id   = p_charge_id,
           payment_order_code  = coalesce(p_order_code, payment_order_code),
           charged_currency    = coalesce(p_currency, charged_currency),
           charged_amount      = coalesce(p_amount, charged_amount),
           fx_rate             = coalesce(p_fx_rate, fx_rate),
           paid_at             = now()
     where id = p_order_id
       and status = 'PendingPayment';

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on function public.mark_order_paid(uuid, text, text, text, numeric, numeric, text)
    from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, text, text, numeric, numeric, text)
    to service_role;

create or replace function public.mark_order_paid(
    p_order_id  uuid,
    p_provider  text,
    p_charge_id text,
    p_currency  text,
    p_amount    numeric,
    p_fx_rate   numeric
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
    select public.mark_order_paid(
        p_order_id, p_provider, p_charge_id, p_currency, p_amount, p_fx_rate, null
    );
$$;

-- Los pedidos que siguen esperando cobro, para ir a preguntarle a la pasarela
-- qué pasó con ellos. Si un aviso se pierde —y se pierden—, el pedido se queda
-- en pendiente para siempre y nadie se entera hasta que el comprador reclama.
--
-- Solo los que ya abrieron un cobro (`payment_reference`), porque los demás no
-- tienen nada que consultar, y con un par de minutos de margen para no pisar un
-- aviso que viene de camino.
create or replace function public.orders_awaiting_payment(p_provider text, p_max integer default 50)
returns table (id uuid, reference text, charged_amount numeric, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select o.id, o.payment_reference, o.charged_amount, o.created_at
      from public.orders o
     where o.status = 'PendingPayment'
       and o.payment_provider = p_provider
       and o.payment_reference is not null
       and o.created_at < now() - interval '2 minutes'
       and o.created_at > now() - interval '30 days'
     order by o.created_at desc
     limit greatest(p_max, 1);
$$;

revoke all on function public.orders_awaiting_payment(text, integer) from public, anon, authenticated;
grant execute on function public.orders_awaiting_payment(text, integer) to service_role;
