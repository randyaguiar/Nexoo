-- Nexoo MVP: Row Level Security.
-- El catálogo es público de solo lectura; pedidos y escrituras son exclusivos del admin.

alter table public.businesses  enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.admins      enable row level security;

-- SECURITY DEFINER: consulta admins sin pasar por RLS, evitando recursión en las policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- Catálogo público -----------------------------------------------------------

drop policy if exists businesses_public_read on public.businesses;
create policy businesses_public_read on public.businesses
    for select to anon, authenticated
    using (active);

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
    for select to anon, authenticated
    using (
        available
        and exists (select 1 from public.businesses b where b.id = business_id and b.active)
    );

-- Panel admin ----------------------------------------------------------------

drop policy if exists businesses_admin_all on public.businesses;
create policy businesses_admin_all on public.businesses
    for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_admin_all on public.products;
create policy products_admin_all on public.products
    for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists orders_admin_all on public.orders;
create policy orders_admin_all on public.orders
    for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists order_items_admin_read on public.order_items;
create policy order_items_admin_read on public.order_items
    for select to authenticated
    using (public.is_admin());

drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
    for select to authenticated
    using (user_id = auth.uid());

-- Los pedidos anónimos entran solo por public.create_order(); no hay policy de
-- insert para anon, así que nadie puede fijar su propio total_usd.

-- Vista del catálogo con el número de productos disponibles.
-- security_invoker: la vista respeta las policies de quien consulta, no las del creador.
create or replace view public.business_catalog
with (security_invoker = on) as
    select b.id,
           b.name,
           b.description,
           b.province,
           b.municipality,
           b.contact_phone,
           b.active,
           (select count(*) from public.products p where p.business_id = b.id and p.available) as product_count
    from public.businesses b;

grant select on public.business_catalog to anon, authenticated;
grant select on public.businesses, public.products to anon, authenticated;
grant select, insert, update, delete on public.businesses, public.products to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.admins to authenticated;
