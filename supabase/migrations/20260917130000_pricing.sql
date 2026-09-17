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
