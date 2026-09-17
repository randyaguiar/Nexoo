-- Liquidaciones: cuánto se le debe a cada negocio y qué se le ha pagado ya.
--
-- Hasta ahora el único rastro era el estado `PaidToBusiness` del pedido, que
-- dice "pagado" pero no cuánto, ni cuándo, ni por qué vía. Una liquidación
-- agrupa los pedidos cobrados al comprador y todavía no pagados al negocio, y
-- congela las tres cifras que importan: lo que entró, lo que se debe y el
-- margen. `orders.settlement_id` es la marca de que un pedido ya está incluido,
-- así que ningún pedido puede liquidarse dos veces.

-- Cómo se le paga a cada negocio ----------------------------------------------
-- Tabla aparte y no columnas en `businesses`: esa tabla la lee `anon` entera
-- (policy businesses_public_read), y aquí hay datos de contacto personales.

create table if not exists public.business_payout_accounts (
    business_id uuid primary key references public.businesses (id) on delete cascade,
    method      text not null check (method in ('zelle_us', 'cash_cuba', 'mlc_cuba', 'transfer_cuba')),
    -- Quien cobra puede no ser el dueño: muchas veces es un familiar en EE.UU.
    holder_name text not null check (length(holder_name) between 1 and 160),
    contact     text not null check (length(contact) between 1 and 160),
    notes       text,
    updated_at  timestamptz not null default now()
);

alter table public.business_payout_accounts enable row level security;

drop policy if exists payout_accounts_access on public.business_payout_accounts;
create policy payout_accounts_access on public.business_payout_accounts
    for all to authenticated
    using (
        public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    )
    with check (
        public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    );

drop trigger if exists business_payout_accounts_touch on public.business_payout_accounts;
create trigger business_payout_accounts_touch before update on public.business_payout_accounts
    for each row execute function public.touch_updated_at();

-- Liquidaciones ---------------------------------------------------------------

create table if not exists public.settlements (
    id              uuid primary key default gen_random_uuid(),
    business_id     uuid not null references public.businesses (id) on delete restrict,
    -- Rango de fechas de los pedidos incluidos; informativo, el vínculo real
    -- es orders.settlement_id.
    period_start    date not null,
    period_end      date not null,
    order_count     integer not null check (order_count > 0),
    -- Lo que pagó el comprador.
    gross_usd       numeric(12,2) not null check (gross_usd >= 0),
    -- Lo que se le debe al negocio, con el coste del momento de cada venta.
    cost_usd        numeric(12,2) not null check (cost_usd >= 0),
    -- El margen de Nexoo. Se guarda en vez de calcularse para que un cambio de
    -- precios no reescriba una liquidación ya cerrada.
    fee_usd         numeric(12,2) not null,
    status          text not null default 'pending' check (status in ('pending', 'paid')),
    -- Cómo salió el dinero. La moneda puede no ser USD: si se paga en Cuba,
    -- fx_rate y payout_amount dejan constancia del cambio aplicado.
    payout_method   text,
    payout_currency text not null default 'USD',
    fx_rate         numeric(12,4) check (fx_rate is null or fx_rate > 0),
    payout_amount   numeric(14,2),
    reference       text,
    notes           text,
    paid_at         timestamptz,
    created_at      timestamptz not null default now(),
    created_by      uuid references auth.users (id) on delete set null
);

create index if not exists ix_settlements_business on public.settlements (business_id, created_at desc);
create index if not exists ix_settlements_status on public.settlements (status);

alter table public.settlements enable row level security;

-- El negocio ve lo suyo (es su dinero); solo un rol global las crea y las cierra.
drop policy if exists settlements_read on public.settlements;
create policy settlements_read on public.settlements
    for select to authenticated
    using (public.can_access_business(business_id));

drop policy if exists settlements_global_write on public.settlements;
create policy settlements_global_write on public.settlements
    for all to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

alter table public.orders
    add column if not exists settlement_id uuid references public.settlements (id) on delete set null;

create index if not exists ix_orders_settlement on public.orders (settlement_id);

-- Lo pendiente ----------------------------------------------------------------

/**
 * Lo que se le debe a cada negocio ahora mismo: pedidos ya cobrados al
 * comprador y todavía sin liquidar. `PaidToBusiness` queda fuera a propósito:
 * ese estado significa que ya se le pagó a mano, y recogerlo aquí sería pagarlo
 * dos veces. Con security_invoker, cada quien ve lo que las policies de
 * `orders` le dejan ver.
 */
create or replace view public.pending_settlements
with (security_invoker = on) as
    select o.business_id,
           count(*)                       as order_count,
           min(o.created_at::date)        as period_start,
           max(o.created_at::date)        as period_end,
           sum(o.total_usd)               as gross_usd,
           coalesce(sum(items.cost_usd), 0) as cost_usd
      from public.orders o
      left join lateral (
          select sum(oi.unit_cost * oi.quantity) as cost_usd
            from public.order_items oi
           where oi.order_id = o.id
      ) items on true
     where o.settlement_id is null
       and o.status in ('Paid', 'Delivered')
     group by o.business_id;

grant select on public.pending_settlements to authenticated;

-- Cerrar y pagar --------------------------------------------------------------

/**
 * Agrupa en una liquidación todos los pedidos pendientes de un negocio y los
 * marca, para que no entren en otra. Falla si no hay nada que liquidar.
 */
create or replace function public.create_settlement(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id          uuid;
    v_count       integer;
    v_gross       numeric(12,2);
    v_cost        numeric(12,2);
    v_start       date;
    v_end         date;
begin
    if public.admin_role() not in ('owner', 'staff') then
        raise exception 'Solo un rol global puede liquidar.' using errcode = '42501';
    end if;

    -- Se bloquean los pedidos antes de sumarlos: sin el lock, dos liquidaciones
    -- simultáneas del mismo negocio se repartirían las mismas filas.
    perform 1
      from public.orders
     where business_id = p_business_id
       and settlement_id is null
       and status in ('Paid', 'Delivered')
     order by id
       for update;

    select count(*),
           coalesce(sum(o.total_usd), 0),
           coalesce(sum((select sum(oi.unit_cost * oi.quantity)
                           from public.order_items oi
                          where oi.order_id = o.id)), 0),
           min(o.created_at::date),
           max(o.created_at::date)
      into v_count, v_gross, v_cost, v_start, v_end
      from public.orders o
     where o.business_id = p_business_id
       and o.settlement_id is null
       and o.status in ('Paid', 'Delivered');

    if v_count = 0 then
        raise exception 'Ese negocio no tiene pedidos pendientes de liquidar.';
    end if;

    insert into public.settlements (
        business_id, period_start, period_end, order_count,
        gross_usd, cost_usd, fee_usd, created_by
    )
    values (
        p_business_id, v_start, v_end, v_count,
        v_gross, v_cost, v_gross - v_cost, auth.uid()
    )
    returning id into v_id;

    update public.orders
       set settlement_id = v_id
     where business_id = p_business_id
       and settlement_id is null
       and status in ('Paid', 'Delivered');

    return v_id;
end;
$$;

/**
 * Cierra la liquidación dejando constancia de cómo se pagó. Los pedidos pasan a
 * `PaidToBusiness` salvo los que ya estén entregados, que van por delante.
 */
create or replace function public.mark_settlement_paid(
    p_id              uuid,
    p_method          text,
    p_reference       text    default null,
    p_payout_currency text    default 'USD',
    p_fx_rate         numeric default null,
    p_payout_amount   numeric default null,
    p_notes           text    default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
begin
    if public.admin_role() not in ('owner', 'staff') then
        raise exception 'Solo un rol global puede liquidar.' using errcode = '42501';
    end if;

    if nullif(trim(coalesce(p_method, '')), '') is null then
        raise exception 'Indica cómo se pagó.' using errcode = '22023';
    end if;

    -- Pagar en otra moneda sin dejar el cambio aplicado hace la liquidación
    -- imposible de cuadrar después.
    if p_payout_currency <> 'USD' and (p_fx_rate is null or p_payout_amount is null) then
        raise exception 'Al pagar en otra moneda hace falta el tipo de cambio y el importe.'
            using errcode = '22023';
    end if;

    select status into v_status from public.settlements where id = p_id for update;

    if not found then
        raise exception 'La liquidación no existe.';
    end if;

    if v_status = 'paid' then
        raise exception 'Esa liquidación ya está pagada.';
    end if;

    update public.settlements
       set status          = 'paid',
           payout_method   = trim(p_method),
           payout_currency = p_payout_currency,
           fx_rate         = p_fx_rate,
           payout_amount   = p_payout_amount,
           reference       = nullif(trim(coalesce(p_reference, '')), ''),
           notes           = nullif(trim(coalesce(p_notes, '')), ''),
           paid_at         = now()
     where id = p_id;

    update public.orders
       set status = 'PaidToBusiness'
     where settlement_id = p_id
       and status = 'Paid';
end;
$$;

revoke all on function public.create_settlement(uuid) from public;
revoke all on function public.mark_settlement_paid(uuid, text, text, text, numeric, numeric, text) from public;
grant execute on function public.create_settlement(uuid) to authenticated;
grant execute on function public.mark_settlement_paid(uuid, text, text, text, numeric, numeric, text) to authenticated;

grant select, insert, update on public.settlements to authenticated;
grant select, insert, update, delete on public.business_payout_accounts to authenticated;
