-- Nexoo: migraciones pendientes (precios, liquidaciones, fotos y permisos).
-- Se aplican en orden y en una sola transacción: si algo falla, no queda nada a medias.
begin;

-- ============================================================
-- 20260917130000_pricing.sql
-- ============================================================

-- Modelo de precios del marketplace.
--
-- El negocio pone su precio mayorista (`products.cost_usd`); la plataforma pone
-- el de venta (`products.price_usd`). La diferencia es el margen de Nexoo.
--
-- Dos reglas que sostienen el resto:
--   1. `cost_usd` no lo ve ni el público ni un comprador con sesión: `products`
--      se lee `to anon, authenticated`, así que se cierra por columna.
--   2. Un producto sin precio de venta no se vende: no aparece en el catálogo
--      ni se puede pedir. Así el alta de un producto nuevo pasa por ti.

alter table public.products
    add column if not exists cost_usd numeric(10,2) check (cost_usd > 0),
    -- Marca el precio ajustado a mano para que un recálculo masivo no lo pise.
    add column if not exists price_is_manual boolean not null default false;

-- Los productos ya existentes conservan su precio; los nuevos nacen sin él.
alter table public.products alter column price_usd drop not null;

alter table public.businesses
    add column if not exists default_markup_pct numeric(5,2) not null default 30.00
        check (default_markup_pct >= 0);

-- Aislamiento de `cost_usd` ---------------------------------------------------
-- Todos los usuarios de la app son el mismo rol de Postgres (`authenticated`):
-- los roles de Nexoo viven en `admins`. Por eso el coste no se puede proteger
-- con un grant por rol, y se cierra a nivel de columna para todo el mundo.
-- Quien tiene que verlo lo lee por `product_pricing`, más abajo.
--
-- Hay que quitar primero el SELECT de tabla: revocar una columna no anula un
-- permiso concedido sobre la tabla entera.

revoke select on public.products from anon, authenticated;
grant select (id, business_id, name, description, price_usd, photo_url, available, created_at, stock)
    on public.products to anon, authenticated;

-- `select *` sobre products deja de funcionar para la app (incluye cost_usd);
-- las vistas de abajo son el camino de lectura.

/**
 * Lo que el panel necesita de un producto, coste incluido. Sin
 * `security_invoker`, así que se ejecuta con los permisos de su dueño y puede
 * leer la columna cerrada; el filtro de acceso es explícito y reutiliza el
 * mismo helper que las policies.
 */
create or replace view public.product_pricing as
    select p.id,
           p.business_id,
           b.name as business_name,
           p.name,
           p.description,
           p.price_usd,
           p.cost_usd,
           p.price_is_manual,
           p.photo_url,
           p.available,
           p.stock,
           p.created_at,
           b.default_markup_pct
    from public.products p
    join public.businesses b on b.id = p.business_id
    where public.can_access_business(p.business_id);

grant select on public.product_pricing to authenticated;

-- Quién puede tocar cada precio ----------------------------------------------

/**
 * `price_usd` solo lo mueve un rol global; `cost_usd`, el negocio o un rol
 * global. `price_is_manual` lo mantiene esta misma función: cualquier cambio de
 * precio lo marca como manual salvo que venga de apply_markup(), que avisa con
 * un ajuste local a la transacción.
 */
create or replace function public.products_guard_pricing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_role text := public.admin_role();
    v_bulk boolean := coalesce(current_setting('nexoo.bulk_pricing', true), '') = 'on';
begin
    if tg_op = 'UPDATE' and new.price_usd is distinct from old.price_usd
       and v_role not in ('owner', 'staff') then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' and new.price_usd is not null
       and v_role not in ('owner', 'staff') then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.price_usd is distinct from old.price_usd then
        new.price_is_manual := not v_bulk;
    end if;

    return new;
end;
$$;

drop trigger if exists products_guard_pricing on public.products;
create trigger products_guard_pricing before insert or update on public.products
    for each row execute function public.products_guard_pricing();

-- Catálogo: sin precio no se vende -------------------------------------------

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
    for select to anon, authenticated
    using (
        available
        and price_usd is not null
        and exists (select 1 from public.businesses b where b.id = business_id and b.active)
    );

create or replace view public.product_catalog
with (security_invoker = on) as
    select p.id,
           p.business_id,
           p.name,
           p.description,
           p.price_usd,
           p.photo_url,
           p.available,
           public.available_stock(p.id) as stock
    from public.products p
    where p.price_usd is not null;

grant select on public.product_catalog to anon, authenticated;

create or replace view public.business_catalog
with (security_invoker = on) as
    select b.id,
           b.name,
           b.description,
           b.logo_url,
           b.province,
           pr.name as province_name,
           b.municipality_id,
           b.municipality,
           coalesce(cat.category_ids, '{}')   as category_ids,
           coalesce(cat.category_names, '{}') as category_names,
           b.contact_phone,
           b.active,
           (select count(*)
              from public.products p
             where p.business_id = b.id
               and p.available
               and p.price_usd is not null
               and public.available_stock(p.id) > 0) as product_count
    from public.businesses b
    left join public.provinces pr on pr.code = b.province
    left join lateral (
        select array_agg(c.id order by c.name)   as category_ids,
               array_agg(c.name order by c.name) as category_names
        from public.business_categories bc
        join public.categories c on c.id = bc.category_id
        where bc.business_id = b.id
    ) cat on true;

grant select on public.business_catalog to anon, authenticated;

-- Precios en bloque -----------------------------------------------------------

/**
 * Recalcula el precio de venta a partir del coste. Sin negocio recorre todo el
 * marketplace; con negocio, solo el suyo. Los precios ajustados a mano se
 * respetan salvo que se pida lo contrario. Devuelve cuántos productos cambió.
 */
create or replace function public.apply_markup(
    p_markup_pct       numeric,
    p_business_id      uuid    default null,
    p_overwrite_manual boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_count integer;
begin
    if public.admin_role() not in ('owner', 'staff') then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if p_markup_pct is null or p_markup_pct < 0 then
        raise exception 'El margen debe ser cero o mayor.' using errcode = '22023';
    end if;

    -- Le dice al trigger que esto es un recálculo, no un ajuste a mano.
    perform set_config('nexoo.bulk_pricing', 'on', true);

    update public.products p
       set price_usd = round(p.cost_usd * (1 + p_markup_pct / 100), 2)
     where p.cost_usd is not null
       and (p_business_id is null or p.business_id = p_business_id)
       and (p_overwrite_manual or not p.price_is_manual)
       and p.price_usd is distinct from round(p.cost_usd * (1 + p_markup_pct / 100), 2);

    get diagnostics v_count = row_count;

    perform set_config('nexoo.bulk_pricing', 'off', true);

    -- El margen aplicado queda como el nuevo por defecto del negocio, para que
    -- el precio sugerido de sus productos nuevos coincida con lo ya aplicado.
    if p_business_id is null then
        update public.businesses set default_markup_pct = p_markup_pct;
    else
        update public.businesses set default_markup_pct = p_markup_pct where id = p_business_id;
    end if;

    return v_count;
end;
$$;

/** Precio de un producto suelto. Queda marcado como manual. */
create or replace function public.set_product_price(p_product_id uuid, p_price_usd numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if public.admin_role() not in ('owner', 'staff') then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if p_price_usd is not null and p_price_usd <= 0 then
        raise exception 'El precio debe ser mayor que cero.' using errcode = '22023';
    end if;

    update public.products
       set price_usd = p_price_usd
     where id = p_product_id;

    if not found then
        raise exception 'El producto no existe.';
    end if;
end;
$$;

revoke all on function public.apply_markup(numeric, uuid, boolean) from public;
revoke all on function public.set_product_price(uuid, numeric) from public;
grant execute on function public.apply_markup(numeric, uuid, boolean) to authenticated;
grant execute on function public.set_product_price(uuid, numeric) to authenticated;

-- El coste, congelado en el pedido -------------------------------------------
-- Lo que se le debe al negocio se calcula con el coste del momento de la venta,
-- igual que `product_name` conserva el nombre de entonces.

alter table public.order_items
    add column if not exists unit_cost numeric(10,2) not null default 0;

create or replace function public.create_order(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_order_id    uuid;
    v_business_id uuid;
    v_total       numeric(10,2);
    v_lines       jsonb;
    v_business_count integer;
    v_bad_quantity   boolean;
    v_out_of_stock   text;
    v_cart_token     uuid;
begin
    if payload is null or jsonb_typeof(payload -> 'items') <> 'array'
       or jsonb_array_length(payload -> 'items') = 0 then
        raise exception 'El pedido no tiene productos.' using errcode = '22023';
    end if;

    -- Si el carrito traía reserva, sus propias unidades no le hacen de tope.
    v_cart_token := nullif(payload ->> 'cartToken', '')::uuid;

    -- Líneas repetidas del mismo producto se suman en una sola, y el precio y el
    -- nombre se resuelven contra la tabla: nunca se confía en lo que manda el cliente.
    with requested as (
        select (item ->> 'productId')::uuid as product_id,
               sum((item ->> 'quantity')::integer) as quantity
        from jsonb_array_elements(payload -> 'items') as item
        group by 1
    )
    select jsonb_agg(jsonb_build_object(
               'product_id', r.product_id,
               'quantity', r.quantity,
               'business_id', p.business_id,
               'product_name', p.name,
               'unit_price', p.price_usd,
               -- Sin coste declarado se liquida a cero y queda a la vista en el
               -- panel: mejor eso que bloquear una venta ya pagada.
               'unit_cost', coalesce(p.cost_usd, 0)
           ))
    into v_lines
    from requested r
    join public.products p on p.id = r.product_id
    join public.businesses b on b.id = p.business_id
    -- Un producto sin precio de venta todavía no está publicado.
    where p.available and b.active and p.price_usd is not null;

    if v_lines is null or jsonb_array_length(v_lines) <> (
        select count(distinct (item ->> 'productId')::uuid)
        from jsonb_array_elements(payload -> 'items') as item
    ) then
        raise exception 'Uno o más productos no existen o ya no están disponibles.'
            using errcode = '22023';
    end if;

    select sum((l ->> 'quantity')::integer * (l ->> 'unit_price')::numeric),
           min(l ->> 'business_id')::uuid,
           count(distinct l ->> 'business_id'),
           bool_or((l ->> 'quantity')::integer not between 1 and 100)
    into v_total, v_business_id, v_business_count, v_bad_quantity
    from jsonb_array_elements(v_lines) as l;

    if v_bad_quantity then
        raise exception 'Cantidad inválida: debe estar entre 1 y 100.' using errcode = '22023';
    end if;

    -- Cada negocio se paga por separado, así que un pedido no puede mezclar negocios.
    if v_business_count > 1 then
        raise exception 'Un pedido solo puede contener productos de un mismo negocio.'
            using errcode = '22023';
    end if;

    -- Se bloquean las filas antes de comprobar el stock: sin el lock, dos pedidos
    -- simultáneos podrían pasar los dos la comprobación y dejar el stock negativo.
    -- El orden por id evita que dos pedidos con productos comunes se bloqueen entre sí.
    perform 1
      from public.products
     where id in (select (l ->> 'product_id')::uuid from jsonb_array_elements(v_lines) as l)
     order by id
       for update;

    delete from public.stock_reservations where expires_at <= now();

    select string_agg(p.name, ', ' order by p.name)
      into v_out_of_stock
      from jsonb_array_elements(v_lines) as l
      join public.products p on p.id = (l ->> 'product_id')::uuid
     where public.available_stock(p.id, v_cart_token) < (l ->> 'quantity')::integer;

    if v_out_of_stock is not null then
        raise exception 'No hay stock suficiente de: %.', v_out_of_stock
            using errcode = '22023';
    end if;

    insert into public.orders (
        buyer_name, buyer_email, buyer_phone,
        recipient_name, recipient_phone, recipient_province,
        recipient_municipality, recipient_address,
        business_id, status, total_usd, notes, user_id
    )
    values (
        trim(payload ->> 'buyerName'),
        lower(trim(payload ->> 'buyerEmail')),
        trim(payload ->> 'buyerPhone'),
        trim(payload ->> 'recipientName'),
        trim(payload ->> 'recipientPhone'),
        payload ->> 'recipientProvince',
        trim(payload ->> 'recipientMunicipality'),
        trim(payload ->> 'recipientAddress'),
        v_business_id,
        'PendingPayment',
        v_total,
        nullif(trim(coalesce(payload ->> 'notes', '')), ''),
        -- Null si el comprador compró sin cuenta: el pedido sigue siendo anónimo
        -- y solo se consulta con su id.
        auth.uid()
    )
    returning id into v_order_id;

    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, unit_cost)
    select v_order_id,
           (l ->> 'product_id')::uuid,
           l ->> 'product_name',
           (l ->> 'quantity')::integer,
           (l ->> 'unit_price')::numeric,
           (l ->> 'unit_cost')::numeric
    from jsonb_array_elements(v_lines) as l;

    update public.products p
       set stock = p.stock - line.quantity
      from (
        select (l ->> 'product_id')::uuid as product_id,
               (l ->> 'quantity')::integer as quantity
        from jsonb_array_elements(v_lines) as l
      ) line
     where p.id = line.product_id;

    -- La reserva ya está cobrada en el stock: el carrito deja de necesitarla.
    if v_cart_token is not null then
        delete from public.stock_reservations where cart_token = v_cart_token;
    end if;

    return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon, authenticated;

-- ============================================================
-- 20260917140000_settlements.sql
-- ============================================================

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

-- ============================================================
-- 20260917150000_product_photos.sql
-- ============================================================

-- Fotos de producto: hasta tres, subidas desde el panel.
--
-- Hasta ahora `photo_url` era una URL que se pegaba a mano. Para un admin que
-- gestiona el catálogo desde un ordenador era razonable; para el dueño de un
-- negocio subiendo sus productos desde el móvil, no: no tiene una URL, tiene
-- una foto en la galería. Y una URL externa se rompe cuando el dueño borra la
-- imagen de donde estuviera.

alter table public.products
    add column if not exists photo_urls text[] not null default '{}';

-- La foto que ya hubiera pasa a ser la primera del array.
update public.products
   set photo_urls = array[photo_url]
 where photo_url is not null
   and coalesce(array_length(photo_urls, 1), 0) = 0;

alter table public.products drop constraint if exists products_photo_urls_check;
alter table public.products
    add constraint products_photo_urls_check
    check (coalesce(array_length(photo_urls, 1), 0) <= 3);

-- Las vistas se recrean desde cero en lugar de con `create or replace`: esa
-- forma no puede renombrar una columna existente (42P16), y aquí `photo_url`
-- pasa a ser `photo_urls`.

drop view if exists public.product_catalog;
drop view if exists public.product_pricing;

revoke select on public.products from anon, authenticated;
grant select (id, business_id, name, description, price_usd, photo_urls, available, created_at, stock)
    on public.products to anon, authenticated;

create view public.product_catalog
with (security_invoker = on) as
    select p.id,
           p.business_id,
           p.name,
           p.description,
           p.price_usd,
           p.photo_urls,
           p.available,
           public.available_stock(p.id) as stock
    from public.products p
    where p.price_usd is not null;

grant select on public.product_catalog to anon, authenticated;

create view public.product_pricing as
    select p.id,
           p.business_id,
           b.name as business_name,
           p.name,
           p.description,
           p.price_usd,
           p.cost_usd,
           p.price_is_manual,
           p.photo_urls,
           p.available,
           p.stock,
           p.created_at,
           b.default_markup_pct
    from public.products p
    join public.businesses b on b.id = p.business_id
    where public.can_access_business(p.business_id);

grant select on public.product_pricing to authenticated;

alter table public.products drop column if exists photo_url;

-- Almacenamiento --------------------------------------------------------------
-- Bucket público: las fotos se ven en el catálogo sin sesión. Lo que se controla
-- es quién escribe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'product-photos',
    'product-photos',
    true,
    3145728,
    array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_photos_public_read on storage.objects;
create policy product_photos_public_read on storage.objects
    for select to anon, authenticated using (bucket_id = 'product-photos');

/**
 * Cada negocio escribe en su propia carpeta: el primer tramo de la ruta es su
 * uuid, y la policy lo compara con el negocio de la sesión. A diferencia del
 * bucket de logos —que solo comprueba `is_admin()` y deja a cualquier admin
 * tocar los de todos—, aquí un negocio no puede escribir sobre otro.
 */
drop policy if exists product_photos_business_write on storage.objects;
create policy product_photos_business_write on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'product-photos'
        and public.can_access_business(nullif((storage.foldername(name))[1], '')::uuid)
    );

drop policy if exists product_photos_business_update on storage.objects;
create policy product_photos_business_update on storage.objects
    for update to authenticated
    using (
        bucket_id = 'product-photos'
        and public.can_access_business(nullif((storage.foldername(name))[1], '')::uuid)
    )
    with check (
        bucket_id = 'product-photos'
        and public.can_access_business(nullif((storage.foldername(name))[1], '')::uuid)
    );

drop policy if exists product_photos_business_delete on storage.objects;
create policy product_photos_business_delete on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'product-photos'
        and public.can_access_business(nullif((storage.foldername(name))[1], '')::uuid)
    );

-- ============================================================
-- 20260917160000_role_check_null_safety.sql
-- ============================================================

-- Comprobación de rol a prueba de nulos.
--
-- `admin_role()` devuelve null para quien no es usuario del panel, y
-- `null not in ('owner','staff')` no es cierto: es null. Con el guard escrito
-- como `if <rol> not in (...) then raise`, la excepción no saltaba y la función
-- seguía adelante. En `approve_business_application()` eso significaba que
-- cualquier usuario con sesión podía aprobar su propia solicitud y darse de
-- alta como negocio.
--
-- Las policies de RLS no tenían este problema: ahí un null se trata como falso
-- y niega el acceso. Solo fallaba la lógica invertida de plpgsql.

create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(public.admin_role() in ('owner', 'staff'), false);
$$;

grant execute on function public.is_global_admin() to authenticated;

create or replace function public.approve_business_application(p_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_app         public.business_applications;
    v_business_id uuid;
begin
    if not public.is_global_admin() then
        raise exception 'Solo un rol global puede resolver solicitudes.' using errcode = '42501';
    end if;

    select * into v_app from public.business_applications where id = p_id for update;

    if not found then
        raise exception 'La solicitud no existe.';
    end if;

    if v_app.status <> 'pending' then
        raise exception 'Esa solicitud ya está resuelta.';
    end if;

    -- `admins.user_id` es la clave primaria: una persona pertenece a un solo
    -- negocio. Sin esta comprobación el insert fallaría con un error de Postgres
    -- que no le dice nada a quien está aprobando.
    if exists (select 1 from public.admins a where a.user_id = v_app.user_id) then
        raise exception 'Ese usuario ya tiene acceso al panel; quítaselo antes de aprobar.';
    end if;

    -- province y municipality (texto) los rellena el trigger a partir del municipio.
    insert into public.businesses (name, description, municipality_id, contact_phone, active)
    values (v_app.name, v_app.description, v_app.municipality_id, v_app.contact_phone, true)
    returning id into v_business_id;

    insert into public.business_categories (business_id, category_id)
    select v_business_id, unnest(v_app.category_ids)
    on conflict do nothing;

    insert into public.admins (user_id, email, role, business_id)
    values (v_app.user_id, v_app.contact_email, 'business_admin', v_business_id);

    update public.business_applications
       set status      = 'approved',
           review_note = p_note,
           reviewed_at = now(),
           reviewed_by = auth.uid(),
           business_id = v_business_id
     where id = p_id;

    return v_business_id;
end;
$$;

create or replace function public.reject_business_application(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
begin
    if not public.is_global_admin() then
        raise exception 'Solo un rol global puede resolver solicitudes.' using errcode = '42501';
    end if;

    if nullif(trim(coalesce(p_note, '')), '') is null then
        raise exception 'Indica el motivo del rechazo.';
    end if;

    select status into v_status from public.business_applications where id = p_id for update;

    if not found then
        raise exception 'La solicitud no existe.';
    end if;

    if v_status <> 'pending' then
        raise exception 'Esa solicitud ya está resuelta.';
    end if;

    update public.business_applications
       set status      = 'rejected',
           review_note = trim(p_note),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where id = p_id;
end;
$$;

create or replace function public.apply_markup(
    p_markup_pct       numeric,
    p_business_id      uuid    default null,
    p_overwrite_manual boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_count integer;
begin
    if not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if p_markup_pct is null or p_markup_pct < 0 then
        raise exception 'El margen debe ser cero o mayor.' using errcode = '22023';
    end if;

    -- Le dice al trigger que esto es un recálculo, no un ajuste a mano.
    perform set_config('nexoo.bulk_pricing', 'on', true);

    update public.products p
       set price_usd = round(p.cost_usd * (1 + p_markup_pct / 100), 2)
     where p.cost_usd is not null
       and (p_business_id is null or p.business_id = p_business_id)
       and (p_overwrite_manual or not p.price_is_manual)
       and p.price_usd is distinct from round(p.cost_usd * (1 + p_markup_pct / 100), 2);

    get diagnostics v_count = row_count;

    perform set_config('nexoo.bulk_pricing', 'off', true);

    -- El margen aplicado queda como el nuevo por defecto del negocio, para que
    -- el precio sugerido de sus productos nuevos coincida con lo ya aplicado.
    if p_business_id is null then
        update public.businesses set default_markup_pct = p_markup_pct;
    else
        update public.businesses set default_markup_pct = p_markup_pct where id = p_business_id;
    end if;

    return v_count;
end;
$$;

create or replace function public.set_product_price(p_product_id uuid, p_price_usd numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if p_price_usd is not null and p_price_usd <= 0 then
        raise exception 'El precio debe ser mayor que cero.' using errcode = '22023';
    end if;

    update public.products
       set price_usd = p_price_usd
     where id = p_product_id;

    if not found then
        raise exception 'El producto no existe.';
    end if;
end;
$$;

create or replace function public.products_guard_pricing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_bulk boolean := coalesce(current_setting('nexoo.bulk_pricing', true), '') = 'on';
begin
    if tg_op = 'UPDATE' and new.price_usd is distinct from old.price_usd
       and not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' and new.price_usd is not null
       and not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.price_usd is distinct from old.price_usd then
        new.price_is_manual := not v_bulk;
    end if;

    return new;
end;
$$;

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
    if not public.is_global_admin() then
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
    if not public.is_global_admin() then
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

commit;
