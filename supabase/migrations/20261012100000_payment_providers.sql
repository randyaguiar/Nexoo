-- Dos pasarelas de cobro, una activa a la vez, elegida desde el panel.
--
-- Stripe cobra en dólares; TropiPay cobra en euros. El pedido sigue siendo en
-- dólares —los precios, los costes y las liquidaciones no cambian— y lo que se
-- guarda es en qué moneda y con qué cambio se cobró realmente, igual que ya se
-- hace al pagarle a un negocio en CUP (`settlements.fx_rate`).
--
-- Las columnas de Stripe pasan a nombres neutros: lo que antes era
-- `stripe_session_id` ahora es `payment_reference` con su `payment_provider`
-- al lado. Así no hay que migrar otra vez si mañana entra una tercera.

create table if not exists public.payment_settings (
    -- Una sola fila: la clave primaria solo admite `true`.
    id          boolean primary key default true check (id),
    provider    text not null default 'stripe' check (provider in ('stripe', 'tropipay')),
    -- Euros por dólar. Con TropiPay activo, el total del pedido se convierte
    -- con este cambio; lo mantiene a mano quien gestiona el marketplace, porque
    -- lo que importa es que coincida con lo que le cobra su banco, no con el
    -- cambio del día.
    eur_per_usd numeric(10,4) not null default 0.92 check (eur_per_usd > 0),
    updated_at  timestamptz not null default now(),
    updated_by  uuid references auth.users (id) on delete set null
);

insert into public.payment_settings (id) values (true) on conflict (id) do nothing;

alter table public.payment_settings enable row level security;

-- Solo el owner: esto decide a qué cuenta entra el dinero del marketplace, y
-- no es algo que deba poder cambiar alguien de staff. La función de cobro lo lee
-- con la service role, que se salta RLS.
drop policy if exists payment_settings_global on public.payment_settings;
drop policy if exists payment_settings_owner on public.payment_settings;
create policy payment_settings_owner on public.payment_settings
    for all to authenticated
    using (public.is_owner())
    with check (public.is_owner());

grant select, update on public.payment_settings to authenticated;

create or replace function public.payment_settings_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    new.id         := true;
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
end;
$$;

drop trigger if exists payment_settings_touch on public.payment_settings;
create trigger payment_settings_touch
    before update on public.payment_settings
    for each row execute function public.payment_settings_touch();

-- Cambiar de pasarela mueve dinero: queda en el historial como todo lo demás.
drop trigger if exists payment_settings_log_activity on public.payment_settings;
create trigger payment_settings_log_activity
    after insert or update or delete on public.payment_settings
    for each row execute function public.log_activity();

-- Pedidos ---------------------------------------------------------------------

alter table public.orders
    add column if not exists payment_provider text
        check (payment_provider in ('stripe', 'tropipay')),
    -- El cobro abierto (sesión de Stripe o paymentcard de TropiPay).
    add column if not exists payment_reference text,
    -- El cobro ya hecho (payment intent o bank order code).
    add column if not exists payment_charge_id text,
    add column if not exists charged_currency text,
    add column if not exists charged_amount numeric(10,2),
    add column if not exists fx_rate numeric(10,4);

-- Todo lo que había era de Stripe, en dólares y sin conversión.
update public.orders
   set payment_provider  = coalesce(payment_provider, 'stripe'),
       payment_reference = coalesce(payment_reference, stripe_session_id),
       payment_charge_id = coalesce(payment_charge_id, stripe_payment_intent),
       charged_currency  = coalesce(charged_currency, 'USD'),
       charged_amount    = coalesce(charged_amount, total_usd),
       fx_rate           = coalesce(fx_rate, 1)
 where stripe_session_id is not null
    or stripe_payment_intent is not null;

drop index if exists ux_orders_stripe_session;
drop index if exists ux_orders_stripe_payment_intent;

alter table public.orders drop column if exists stripe_session_id;
alter table public.orders drop column if exists stripe_payment_intent;

-- Un cobro no puede quedar asociado a dos pedidos. Incluye la pasarela porque
-- dos proveedores distintos podrían emitir el mismo identificador.
create unique index if not exists ux_orders_payment_reference
    on public.orders (payment_provider, payment_reference)
    where payment_reference is not null;

create unique index if not exists ux_orders_payment_charge
    on public.orders (payment_provider, payment_charge_id)
    where payment_charge_id is not null;

/**
 * Marca el pedido como pagado y deja constancia de con qué se cobró. La llaman
 * los webhooks con la service role; el filtro por estado la hace idempotente,
 * porque las dos pasarelas reintentan sus avisos.
 */
create or replace function public.mark_order_paid(
    p_order_id  uuid,
    p_provider  text,
    p_charge_id text,
    p_currency  text,
    p_amount    numeric,
    p_fx_rate   numeric
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
       set status            = 'Paid',
           payment_provider  = p_provider,
           payment_charge_id = p_charge_id,
           charged_currency  = coalesce(p_currency, charged_currency),
           charged_amount    = coalesce(p_amount, charged_amount),
           fx_rate           = coalesce(p_fx_rate, fx_rate),
           paid_at           = now()
     where id = p_order_id
       and status = 'PendingPayment';

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on function public.mark_order_paid(uuid, text, text, text, numeric, numeric)
    from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, text, text, numeric, numeric)
    to service_role;

/**
 * La firma vieja, de cuando solo había Stripe. Existe para que un webhook
 * desplegado antes de esta migración siga marcando pedidos mientras se
 * redespliega: sin esto habría una ventana en la que los cobros se hacen pero
 * los pedidos se quedan en PendingPayment. Se puede borrar una vez las dos
 * funciones estén desplegadas.
 */
create or replace function public.mark_order_paid(p_order_id uuid, p_payment_intent text)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
    select public.mark_order_paid(p_order_id, 'stripe', p_payment_intent, 'USD', null, 1);
$$;

revoke all on function public.mark_order_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text) to service_role;
