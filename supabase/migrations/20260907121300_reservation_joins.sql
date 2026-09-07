-- Las vistas del catálogo dejan de llamar a available_stock() por fila.
--
-- Con una llamada por producto (y, en business_catalog, por producto de cada
-- negocio), listar el catálogo hacía N consultas a stock_reservations. Estas dos
-- funciones agregan las reservas de una pasada y las vistas se unen a ellas.
-- Siguen siendo security definer por lo mismo que antes: stock_reservations no
-- se abre a nadie, porque el token de un carrito es la llave de su reserva.

/** Unidades reservadas y aún vigentes de cada producto. */
create or replace function public.active_reservations()
returns table (product_id uuid, reserved integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select r.product_id, sum(r.quantity)::integer
      from public.stock_reservations r
     where r.expires_at > now()
     group by r.product_id;
$$;

/** Productos que se pueden comprar ahora mismo en cada negocio. */
create or replace function public.purchasable_product_counts()
returns table (business_id uuid, product_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.business_id, count(*)
      from public.products p
      left join public.active_reservations() r on r.product_id = p.id
     where p.available
       and p.stock - coalesce(r.reserved, 0) > 0
     group by p.business_id;
$$;

grant execute on function public.active_reservations() to anon, authenticated;
grant execute on function public.purchasable_product_counts() to anon, authenticated;

create or replace view public.product_catalog
with (security_invoker = on) as
    select p.id,
           p.business_id,
           p.name,
           p.description,
           p.price_usd,
           p.photo_url,
           p.available,
           greatest(p.stock - coalesce(r.reserved, 0), 0)::integer as stock
    from public.products p
    left join public.active_reservations() r on r.product_id = p.id;

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
           coalesce(pc.product_count, 0) as product_count
    from public.businesses b
    left join public.provinces pr on pr.code = b.province
    left join public.purchasable_product_counts() pc on pc.business_id = b.id
    left join lateral (
        select array_agg(c.id order by c.name)   as category_ids,
               array_agg(c.name order by c.name) as category_names
        from public.business_categories bc
        join public.categories c on c.id = bc.category_id
        where bc.business_id = b.id
    ) cat on true;

grant select on public.business_catalog to anon, authenticated;
