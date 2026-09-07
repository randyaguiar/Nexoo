-- Cuentas de compradores: un pedido hecho con sesión iniciada queda ligado al usuario,
-- que puede consultarlo desde "Mis pedidos". El checkout anónimo sigue funcionando igual.

alter table public.orders
    add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists ix_orders_user_id on public.orders (user_id);

-- El comprador ve sus propios pedidos; sigue sin poder escribir en la tabla.
drop policy if exists orders_owner_read on public.orders;
create policy orders_owner_read on public.orders
    for select to authenticated
    using (user_id is not null and user_id = auth.uid());

drop policy if exists order_items_owner_read on public.order_items;
create policy order_items_owner_read on public.order_items
    for select to authenticated
    using (
        exists (
            select 1 from public.orders o
            where o.id = order_id and o.user_id is not null and o.user_id = auth.uid()
        )
    );

-- create_order() se redefine entera (Postgres no permite parchear el cuerpo) solo
-- para guardar auth.uid(); el resto es idéntico a la migración 20260907120200.
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
begin
    if payload is null or jsonb_typeof(payload -> 'items') <> 'array'
       or jsonb_array_length(payload -> 'items') = 0 then
        raise exception 'El pedido no tiene productos.' using errcode = '22023';
    end if;

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

    return v_order_id;
end;
$$;
