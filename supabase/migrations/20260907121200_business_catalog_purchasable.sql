-- El contador del catálogo cuenta lo que se puede comprar.
--
-- Contar los productos `available` prometía en la tarjeta más de lo que el
-- comprador encuentra dentro: un producto sin stock, o con todas sus unidades
-- reservadas por otro carrito, no se puede comprar ahora mismo.

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
