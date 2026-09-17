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
