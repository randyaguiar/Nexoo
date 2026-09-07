-- Un negocio puede ofrecer varios tipos de servicio (dulcería, panadería,
-- cafetería…), así que la categoría pasa de columna a tabla de enlace.

create table if not exists public.business_categories (
    business_id uuid not null references public.businesses (id) on delete cascade,
    category_id uuid not null references public.categories (id) on delete cascade,
    primary key (business_id, category_id)
);

create index if not exists ix_business_categories_category on public.business_categories (category_id);

-- Se salta si la migración ya corrió y la columna no está.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'businesses' and column_name = 'category_id'
    ) then
        insert into public.business_categories (business_id, category_id)
        select b.id, b.category_id from public.businesses b where b.category_id is not null
        on conflict do nothing;
    end if;
end;
$$;

-- La vista depende de la columna, así que se recrea más abajo.
drop view if exists public.business_catalog;
alter table public.businesses drop column if exists category_id;

alter table public.business_categories enable row level security;

drop policy if exists business_categories_public_read on public.business_categories;
create policy business_categories_public_read on public.business_categories
    for select to anon, authenticated using (true);

drop policy if exists business_categories_admin_all on public.business_categories;
create policy business_categories_admin_all on public.business_categories
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.business_categories to anon, authenticated;
grant select, insert, update, delete on public.business_categories to authenticated;

-- Catálogo: las categorías viajan como arrays paralelos (ids y nombres).
create view public.business_catalog
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
           (select count(*) from public.products p where p.business_id = b.id and p.available) as product_count
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

-- Guardar el negocio y sus categorías en una sola transacción. Sin
-- security definer: las policies de admin siguen decidiendo quién puede.
create or replace function public.save_business(
    p_id          uuid,
    p_payload     jsonb,
    p_category_ids uuid[] default '{}'
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
    v_id uuid;
begin
    if p_id is null then
        insert into public.businesses (name, description, logo_url, municipality_id, contact_phone, active)
        values (
            trim(p_payload ->> 'name'),
            nullif(trim(coalesce(p_payload ->> 'description', '')), ''),
            nullif(trim(coalesce(p_payload ->> 'logoUrl', '')), ''),
            (p_payload ->> 'municipalityId')::uuid,
            nullif(trim(coalesce(p_payload ->> 'contactPhone', '')), ''),
            coalesce((p_payload ->> 'active')::boolean, true)
        )
        returning id into v_id;
    else
        update public.businesses set
            name            = trim(p_payload ->> 'name'),
            description     = nullif(trim(coalesce(p_payload ->> 'description', '')), ''),
            logo_url        = nullif(trim(coalesce(p_payload ->> 'logoUrl', '')), ''),
            municipality_id = (p_payload ->> 'municipalityId')::uuid,
            contact_phone   = nullif(trim(coalesce(p_payload ->> 'contactPhone', '')), ''),
            active          = coalesce((p_payload ->> 'active')::boolean, true)
        where id = p_id
        returning id into v_id;

        if v_id is null then
            raise exception 'El negocio no existe o no tienes permiso para editarlo.'
                using errcode = '42501';
        end if;

        delete from public.business_categories
        where business_id = v_id and category_id <> all (coalesce(p_category_ids, '{}'));
    end if;

    insert into public.business_categories (business_id, category_id)
    select v_id, unnest(coalesce(p_category_ids, '{}'))
    on conflict do nothing;

    return v_id;
end;
$$;

revoke all on function public.save_business(uuid, jsonb, uuid[]) from public;
grant execute on function public.save_business(uuid, jsonb, uuid[]) to authenticated;
