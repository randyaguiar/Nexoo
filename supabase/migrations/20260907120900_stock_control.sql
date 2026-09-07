-- El pedido descuenta inventario.
--
-- create_order() reserva las unidades al crear el pedido y falla si no hay
-- suficientes; cancelar un pedido las devuelve. Así el stock que ve el panel
-- refleja lo que queda de verdad, no lo que se cargó la última vez a mano.

-- Los productos del catálogo son anteriores a la columna `stock` y están todos a
-- cero: sin esto, al desplegar dejarían de poder venderse. Se les da una cantidad
-- de partida para que cada negocio la ajuste desde el panel.
update public.products
   set stock = 100
 where available and stock = 0;

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

    -- Se bloquean las filas antes de comprobar el stock: sin el lock, dos pedidos
    -- simultáneos podrían pasar los dos la comprobación y dejar el stock negativo.
    -- El orden por id evita que dos pedidos con productos comunes se bloqueen entre sí.
    perform 1
      from public.products
     where id in (select (l ->> 'product_id')::uuid from jsonb_array_elements(v_lines) as l)
     order by id
       for update;

    select string_agg(p.name, ', ' order by p.name)
      into v_out_of_stock
      from jsonb_array_elements(v_lines) as l
      join public.products p on p.id = (l ->> 'product_id')::uuid
     where p.stock < (l ->> 'quantity')::integer;

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

    return v_order_id;
end;
$$;

grant execute on function public.create_order(jsonb) to anon, authenticated;

/**
 * Devuelve al inventario lo reservado por un pedido que se cancela, y lo vuelve a
 * reservar si el pedido se reactiva. Solo actúa al entrar o salir de 'Cancelled'.
 */
create or replace function public.orders_sync_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_sign         integer;
    v_out_of_stock text;
begin
    if new.status = old.status then
        return null;
    end if;

    if new.status = 'Cancelled' then
        v_sign := 1;
    elsif old.status = 'Cancelled' then
        v_sign := -1;
    else
        return null;
    end if;

    if v_sign = -1 then
        select string_agg(p.name, ', ' order by p.name)
          into v_out_of_stock
          from public.order_items i
          join public.products p on p.id = i.product_id
         where i.order_id = new.id and p.stock < i.quantity;

        if v_out_of_stock is not null then
            raise exception 'No hay stock suficiente para reactivar el pedido: %.', v_out_of_stock
                using errcode = '22023';
        end if;
    end if;

    update public.products p
       set stock = p.stock + v_sign * i.quantity
      from public.order_items i
     where i.order_id = new.id and p.id = i.product_id;

    return null;
end;
$$;

drop trigger if exists orders_sync_stock on public.orders;
create trigger orders_sync_stock
    after update of status on public.orders
    for each row execute function public.orders_sync_stock();
