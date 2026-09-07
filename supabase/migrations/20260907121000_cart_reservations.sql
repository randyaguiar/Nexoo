-- Reserva temporal del carrito.
--
-- Descontar solo al confirmar el pedido deja una carrera larga: entre que el
-- comprador llena el carrito y paga, otro puede llevarse las últimas unidades y
-- el checkout falla al final del proceso. El carrito reserva lo que contiene
-- durante un rato; al caducar, las unidades vuelven a estar libres solas.
--
-- El carrito vive en el navegador y el comprador puede no tener cuenta, así que
-- la reserva se identifica con un token propio del carrito, no con el usuario.

create table if not exists public.stock_reservations (
    cart_token uuid        not null,
    product_id uuid        not null references public.products (id) on delete cascade,
    quantity   integer     not null check (quantity between 1 and 100),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    primary key (cart_token, product_id)
);

create index if not exists ix_stock_reservations_product on public.stock_reservations (product_id);
create index if not exists ix_stock_reservations_expires on public.stock_reservations (expires_at);

-- Sin policies: solo se toca desde las funciones security definer de abajo, que
-- son las que garantizan que un carrito no puede leer ni pisar el de otro.
alter table public.stock_reservations enable row level security;

/** Unidades libres de un producto: su stock menos lo reservado por otros carritos. */
create or replace function public.available_stock(p_product_id uuid, p_cart_token uuid default null)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select greatest(
        coalesce((select p.stock from public.products p where p.id = p_product_id), 0)
        - coalesce((
            select sum(r.quantity)
              from public.stock_reservations r
             where r.product_id = p_product_id
               and r.expires_at > now()
               and (p_cart_token is null or r.cart_token <> p_cart_token)
          ), 0),
        0)::integer;
$$;

/**
 * Deja las reservas del carrito igual a lo que contiene: reserva lo que hay
 * libre, suelta lo que ya no está y renueva la caducidad. Devuelve lo pedido y
 * lo reservado de cada producto para que la tienda avise si no cabe todo.
 */
create or replace function public.reserve_cart(p_cart_token uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    -- Suficiente para llegar al pago sin agobiar, y corto para no bloquear el
    -- inventario de un carrito abandonado.
    v_ttl     constant interval := interval '20 minutes';
    v_expires timestamptz := now() + v_ttl;
    v_items   jsonb;
begin
    if p_cart_token is null then
        raise exception 'Falta el identificador del carrito.' using errcode = '22023';
    end if;

    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'El carrito no es válido.' using errcode = '22023';
    end if;

    -- Las reservas caducadas no las limpia ningún cron: se barren aquí, que es
    -- por donde pasa toda la tienda.
    delete from public.stock_reservations where expires_at <= now();

    if jsonb_array_length(p_items) = 0 then
        delete from public.stock_reservations where cart_token = p_cart_token;
        return jsonb_build_object('expiresAt', null, 'items', '[]'::jsonb);
    end if;

    -- Mismo bloqueo ordenado que create_order: dos carritos que reservan a la vez
    -- se ponen en fila en lugar de repartirse dos veces las mismas unidades.
    perform 1
      from public.products
     where id in (select (i ->> 'productId')::uuid from jsonb_array_elements(p_items) as i)
     order by id
       for update;

    with requested as (
        select (i ->> 'productId')::uuid as product_id,
               sum((i ->> 'quantity')::integer) as quantity
          from jsonb_array_elements(p_items) as i
         group by 1
    ),
    granted as (
        select r.product_id,
               r.quantity as requested,
               least(r.quantity, public.available_stock(r.product_id, p_cart_token)) as reserved
          from requested r
          join public.products p on p.id = r.product_id
          join public.businesses b on b.id = p.business_id
         where r.quantity between 1 and 100
           and p.available
           and b.active
    ),
    saved as (
        insert into public.stock_reservations (cart_token, product_id, quantity, expires_at)
        select p_cart_token, g.product_id, g.reserved, v_expires
          from granted g
         where g.reserved > 0
        on conflict (cart_token, product_id)
            do update set quantity = excluded.quantity, expires_at = excluded.expires_at
        returning product_id
    ),
    -- Lo que ya no está en el carrito, o de lo que no quedaba nada, se suelta.
    released as (
        delete from public.stock_reservations s
         where s.cart_token = p_cart_token
           and s.product_id not in (select g.product_id from granted g where g.reserved > 0)
    )
    select jsonb_agg(jsonb_build_object(
               'productId', g.product_id,
               'requested', g.requested,
               'reserved', g.reserved
           ))
      into v_items
      from granted g;

    return jsonb_build_object('expiresAt', v_expires, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

grant execute on function public.reserve_cart(uuid, jsonb) to anon, authenticated;
grant execute on function public.available_stock(uuid, uuid) to anon, authenticated;

-- create_order() se redefine entera (Postgres no permite parchear el cuerpo) para
-- que el stock que comprueba descuente lo reservado por OTROS carritos y para
-- soltar la reserva propia al confirmar el pedido.
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
               'unit_price', p.price_usd
           ))
    into v_lines
    from requested r
    join public.products p on p.id = r.product_id
    join public.businesses b on b.id = p.business_id
    where p.available and b.active;

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

    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price)
    select v_order_id,
           (l ->> 'product_id')::uuid,
           l ->> 'product_name',
           (l ->> 'quantity')::integer,
           (l ->> 'unit_price')::numeric
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
