-- Bucket público para los logos de negocios: los administradores suben la
-- imagen desde el panel en lugar de pegar una URL externa.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'business-logos',
    'business-logos',
    true,
    2097152,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_logos_public_read on storage.objects;
create policy business_logos_public_read on storage.objects
    for select to anon, authenticated using (bucket_id = 'business-logos');

drop policy if exists business_logos_admin_write on storage.objects;
create policy business_logos_admin_write on storage.objects
    for insert to authenticated with check (bucket_id = 'business-logos' and public.is_admin());

drop policy if exists business_logos_admin_update on storage.objects;
create policy business_logos_admin_update on storage.objects
    for update to authenticated
    using (bucket_id = 'business-logos' and public.is_admin())
    with check (bucket_id = 'business-logos' and public.is_admin());

drop policy if exists business_logos_admin_delete on storage.objects;
create policy business_logos_admin_delete on storage.objects
    for delete to authenticated using (bucket_id = 'business-logos' and public.is_admin());
