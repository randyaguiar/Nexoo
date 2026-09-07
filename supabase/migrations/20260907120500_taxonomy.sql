-- Nexoo: provincias, municipios y categorías gestionables desde el panel,
-- más el logo del negocio.
-- Las provincias dejan de ser un CHECK sobre texto y pasan a ser una tabla:
-- el código sigue siendo el mismo valor ('PinarDelRio', 'LaHabana'), así que
-- las filas existentes no cambian.

create table if not exists public.provinces (
    code       text primary key check (length(code) between 1 and 60),
    name       text        not null check (length(name) between 1 and 120),
    active     boolean     not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.municipalities (
    id            uuid primary key default gen_random_uuid(),
    province_code text        not null references public.provinces (code) on update cascade on delete cascade,
    name          text        not null check (length(name) between 1 and 120),
    active        boolean     not null default true,
    created_at    timestamptz not null default now(),
    unique (province_code, name)
);

create index if not exists ix_municipalities_province on public.municipalities (province_code);

create table if not exists public.categories (
    id          uuid primary key default gen_random_uuid(),
    name        text        not null unique check (length(name) between 1 and 120),
    description text,
    active      boolean     not null default true,
    created_at  timestamptz not null default now()
);

-- Datos actuales -------------------------------------------------------------

insert into public.provinces (code, name) values
    ('PinarDelRio', 'Pinar del Río'),
    ('LaHabana', 'La Habana')
on conflict (code) do nothing;

-- Los municipios ya escritos a mano en los negocios se convierten en filas.
insert into public.municipalities (province_code, name)
select distinct b.province, b.municipality
from public.businesses b
where b.municipality is not null and length(trim(b.municipality)) > 0
on conflict (province_code, name) do nothing;

-- Negocios: logo, categoría y municipio por referencia ------------------------

alter table public.businesses
    add column if not exists logo_url        text,
    add column if not exists category_id     uuid references public.categories (id) on delete set null,
    add column if not exists municipality_id uuid references public.municipalities (id) on delete restrict;

update public.businesses b
set municipality_id = m.id
from public.municipalities m
where b.municipality_id is null
  and m.province_code = b.province
  and m.name = b.municipality;

alter table public.businesses drop constraint if exists businesses_province_check;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'businesses_province_fkey'
    ) then
        alter table public.businesses
            add constraint businesses_province_fkey
            foreign key (province) references public.provinces (code)
            on update cascade on delete restrict;
    end if;
end;
$$;

create index if not exists ix_businesses_category on public.businesses (category_id);

-- Los pedidos guardan la provincia como código; el municipio queda como texto
-- porque es parte de la dirección de entrega registrada en su momento.
alter table public.orders drop constraint if exists orders_recipient_province_check;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'orders_recipient_province_fkey'
    ) then
        alter table public.orders
            add constraint orders_recipient_province_fkey
            foreign key (recipient_province) references public.provinces (code)
            on update cascade on delete restrict;
    end if;
end;
$$;

-- Coherencia: el municipio del negocio debe pertenecer a su provincia ---------

create or replace function public.businesses_sync_municipality()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_name          text;
    v_province_code text;
begin
    if new.municipality_id is null then
        raise exception 'Selecciona un municipio para el negocio.' using errcode = '22023';
    end if;

    select m.name, m.province_code into v_name, v_province_code
    from public.municipalities m where m.id = new.municipality_id;

    if v_name is null then
        raise exception 'El municipio indicado no existe.' using errcode = '22023';
    end if;

    -- La provincia se deriva del municipio: no pueden quedar desalineados.
    new.province := v_province_code;
    new.municipality := v_name;
    return new;
end;
$$;

drop trigger if exists businesses_sync_municipality on public.businesses;
create trigger businesses_sync_municipality
    before insert or update of municipality_id on public.businesses
    for each row execute function public.businesses_sync_municipality();

-- Renombrar un municipio o una provincia se refleja en los negocios.
create or replace function public.municipalities_propagate_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.name is distinct from old.name or new.province_code is distinct from old.province_code then
        update public.businesses
        set municipality = new.name, province = new.province_code
        where municipality_id = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists municipalities_propagate_rename on public.municipalities;
create trigger municipalities_propagate_rename
    after update on public.municipalities
    for each row execute function public.municipalities_propagate_rename();

-- RLS ------------------------------------------------------------------------

alter table public.provinces      enable row level security;
alter table public.municipalities enable row level security;
alter table public.categories     enable row level security;

drop policy if exists provinces_public_read on public.provinces;
create policy provinces_public_read on public.provinces
    for select to anon, authenticated using (active);

drop policy if exists municipalities_public_read on public.municipalities;
create policy municipalities_public_read on public.municipalities
    for select to anon, authenticated using (active);

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
    for select to anon, authenticated using (active);

drop policy if exists provinces_admin_all on public.provinces;
create policy provinces_admin_all on public.provinces
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists municipalities_admin_all on public.municipalities;
create policy municipalities_admin_all on public.municipalities
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.provinces, public.municipalities, public.categories to anon, authenticated;
grant select, insert, update, delete
    on public.provinces, public.municipalities, public.categories to authenticated;

-- Catálogo -------------------------------------------------------------------

drop view if exists public.business_catalog;
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
           b.category_id,
           c.name as category_name,
           b.contact_phone,
           b.active,
           (select count(*) from public.products p where p.business_id = b.id and p.available) as product_count
    from public.businesses b
    left join public.provinces pr on pr.code = b.province
    left join public.categories c on c.id = b.category_id;

grant select on public.business_catalog to anon, authenticated;

-- get_order pasa a devolver también el nombre legible de la provincia.
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
        'recipientProvinceName', coalesce(pr.name, o.recipient_province),
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
    left join public.provinces pr on pr.code = o.recipient_province
    where o.id = p_order_id;
$$;

revoke all on function public.get_order(uuid) from public;
grant execute on function public.get_order(uuid) to anon, authenticated;
