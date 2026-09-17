-- Cobro con Stripe en lugar de Zelle.
--
-- Zelle era una transferencia entre personas: el comprador pagaba por su cuenta
-- y alguien marcaba el pedido a mano. Con Stripe el pedido se crea igual —para
-- reservar el stock— y pasa a `Paid` solo cuando Stripe confirma el cobro por
-- webhook. El estado del pedido deja de depender de que alguien mire el banco.
--
-- Zelle sigue existiendo como forma de pagarle al negocio
-- (`business_payout_accounts.method = 'zelle_us'`): eso es dinero saliendo, no
-- entrando, y no lo toca Stripe.

alter table public.orders
    -- La sesión de pago abierta para este pedido; sirve para reanudar el pago
    -- si el comprador cerró la pestaña.
    add column if not exists stripe_session_id text,
    add column if not exists stripe_payment_intent text,
    add column if not exists paid_at timestamptz;

-- Un cobro no puede quedar asociado a dos pedidos.
create unique index if not exists ux_orders_stripe_session
    on public.orders (stripe_session_id)
    where stripe_session_id is not null;

create unique index if not exists ux_orders_stripe_payment_intent
    on public.orders (stripe_payment_intent)
    where stripe_payment_intent is not null;

/**
 * Marca el pedido como pagado. La llama el webhook de Stripe con la service
 * role, así que no depende de ninguna sesión; el filtro por estado la hace
 * idempotente, porque Stripe reintenta los webhooks y puede repetir el evento.
 */
create or replace function public.mark_order_paid(
    p_order_id       uuid,
    p_payment_intent text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_updated integer;
begin
    update public.orders
       set status                = 'Paid',
           stripe_payment_intent = p_payment_intent,
           paid_at               = now()
     where id = p_order_id
       and status = 'PendingPayment';

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

-- Solo la service role: el navegador no puede declarar pagado un pedido.
revoke all on function public.mark_order_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text) to service_role;
