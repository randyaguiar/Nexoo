-- Nexoo MVP: creación y consulta de pedidos.
-- Los compradores no escriben en `orders` directamente: pasan por create_order(),
-- que calcula el total desde la tabla de productos y aplica la regla de un solo negocio.

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
        business_id, status, total_usd, notes
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
        nullif(trim(coalesce(payload ->> 'notes', '')), '')
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

-- La página de confirmación se consulta con el id del pedido, que actúa como token
-- de acceso (uuid aleatorio). No expone el listado de pedidos.
create or replace function public.get_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'id', o.id,
        'buyerName', o.buyer_name,
        'buyerEmail', o.buyer_email,
        'buyerPhone', o.buyer_phone,
        'recipientName', o.recipient_name,
        'recipientPhone', o.recipient_phone,
        'recipientProvince', o.recipient_province,
        'recipientMunicipality', o.recipient_municipality,
        'recipientAddress', o.recipient_address,
        'businessId', o.business_id,
        'businessName', b.name,
        'status', o.status,
        'totalUsd', o.total_usd,
        'notes', o.notes,
        'createdAt', o.created_at,
        'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', i.id,
                'productId', i.product_id,
                'productName', i.product_name,
                'quantity', i.quantity,
                'unitPrice', i.unit_price
            ) order by i.product_name)
            from public.order_items i where i.order_id = o.id
        ), '[]'::jsonb)
    )
    from public.orders o
    join public.businesses b on b.id = o.business_id
    where o.id = p_order_id;
$$;

revoke all on function public.create_order(jsonb) from public;
revoke all on function public.get_order(uuid) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;
grant execute on function public.get_order(uuid) to anon, authenticated;
