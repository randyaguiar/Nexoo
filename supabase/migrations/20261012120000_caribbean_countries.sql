-- De "un marketplace para Cuba" a "un marketplace para el Caribe".
--
-- La geografía ya era datos y no código: las provincias y los municipios se
-- gestionan desde el panel desde la migración de taxonomía. Lo que faltaba era
-- el nivel de arriba. Sin países, las provincias de dos islas distintas caen en
-- la misma lista y el comprador no puede elegir a dónde manda el pedido.
--
-- El país **no se guarda** en pedidos ni en negocios: se deduce de la provincia,
-- que ya está en los dos. Así no hay dos sitios que puedan desalinearse y no hay
-- que reescribir `create_order` otra vez.

create table if not exists public.countries (
    -- ISO 3166-1 alfa-2 en mayúsculas: CU, DO, JM…
    code         text primary key check (code ~ '^[A-Z]{2}$'),
    name         text        not null check (length(name) between 1 and 120),
    -- Para el marcador de los teléfonos en los formularios.
    phone_prefix text,
    active       boolean     not null default true,
    created_at   timestamptz not null default now()
);

-- Cuba es lo que ya había funcionando; el resto queda apagado para que se
-- active desde el panel cuando haya negocios de verdad en esa isla. Si alguno
-- no interesa, se borra: no tiene nada colgando.
insert into public.countries (code, name, phone_prefix, active) values
    ('CU', 'Cuba',                  '+53',   true),
    ('DO', 'República Dominicana',  '+1809', false),
    ('PR', 'Puerto Rico',           '+1787', false),
    ('HT', 'Haití',                 '+509',  false),
    ('JM', 'Jamaica',               '+1876', false),
    ('TT', 'Trinidad y Tobago',     '+1868', false),
    ('BS', 'Bahamas',               '+1242', false),
    ('BB', 'Barbados',              '+1246', false),
    ('AG', 'Antigua y Barbuda',     '+1268', false),
    ('DM', 'Dominica',              '+1767', false),
    ('GD', 'Granada',               '+1473', false),
    ('KN', 'San Cristóbal y Nieves','+1869', false),
    ('LC', 'Santa Lucía',           '+1758', false),
    ('VC', 'San Vicente y las Granadinas', '+1784', false)
on conflict (code) do nothing;

-- Provincias ------------------------------------------------------------------
-- Todo lo que existía es de Cuba, que es donde arrancó el sitio.

alter table public.provinces
    add column if not exists country_code text references public.countries (code)
        on update cascade on delete restrict;

update public.provinces set country_code = 'CU' where country_code is null;

alter table public.provinces alter column country_code set not null;

create index if not exists ix_provinces_country on public.provinces (country_code);

-- El código de la provincia sigue siendo la clave primaria, así que tiene que
-- ser único en todo el marketplace: 'Santiago' existe en Cuba y en República
-- Dominicana. Quien las da de alta usa códigos con prefijo ('CU-Santiago',
-- 'DO-Santiago'); el panel lo propone solo.

-- Apagar un país esconde sus provincias, igual que apagar una provincia esconde
-- sus municipios.
drop policy if exists provinces_public_read on public.provinces;
create policy provinces_public_read on public.provinces
    for select to anon, authenticated
    using (
        active
        and exists (
            select 1 from public.countries c
            where c.code = country_code and c.active
        )
    );

alter table public.countries enable row level security;

drop policy if exists countries_public_read on public.countries;
create policy countries_public_read on public.countries
    for select to anon, authenticated using (active);

drop policy if exists countries_admin_all on public.countries;
create policy countries_admin_all on public.countries
    for all to authenticated
    using (public.is_global_admin())
    with check (public.is_global_admin());

grant select on public.countries to anon, authenticated;
grant insert, update, delete on public.countries to authenticated;

-- Formas de pago al negocio ----------------------------------------------------
-- `cash_cuba`, `mlc_cuba` y `transfer_cuba` eran los nombres de lo mismo visto
-- desde una sola isla: efectivo, tarjeta local y transferencia local. Lo que
-- cambia es el nombre, no lo que significan, así que las cuentas ya guardadas
-- se traducen y siguen funcionando.

alter table public.business_payout_accounts drop constraint if exists business_payout_accounts_method_check;

update public.business_payout_accounts
   set method = case method
       when 'cash_cuba'     then 'cash_local'
       when 'mlc_cuba'      then 'card_local'
       when 'transfer_cuba' then 'transfer_local'
       else method
   end;

alter table public.business_payout_accounts
    add constraint business_payout_accounts_method_check
    check (method in ('zelle_us', 'cash_local', 'card_local', 'transfer_local', 'other'));

-- Vistas y lecturas ------------------------------------------------------------

-- Se recrea desde cero y no con `create or replace`: esa forma no admite
-- columnas nuevas en medio (42P16), y el país va al lado de la provincia.
drop view if exists public.business_catalog;

create view public.business_catalog
with (security_invoker = on) as
    select b.id,
           b.name,
           b.description,
           b.logo_url,
           pr.country_code,
           co.name as country_name,
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
               and p.price_usd is not null
               and public.available_stock(p.id) > 0) as product_count
    from public.businesses b
    left join public.provinces pr on pr.code = b.province
    left join public.countries co on co.code = pr.country_code
    left join lateral (
        select array_agg(c.id order by c.name)   as category_ids,
               array_agg(c.name order by c.name) as category_names
        from public.business_categories bc
        join public.categories c on c.id = bc.category_id
        where bc.business_id = b.id
    ) cat on true;

grant select on public.business_catalog to anon, authenticated;

/** El pedido tal como lo ve quien lo hizo: el id hace de token. */
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
        'recipientCountry', pr.country_code,
        'recipientCountryName', co.name,
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
    left join public.countries co on co.code = pr.country_code
    where o.id = p_order_id;
$$;

revoke all on function public.get_order(uuid) from public;
grant execute on function public.get_order(uuid) to anon, authenticated;

-- El alta de países también queda en el historial.
drop trigger if exists countries_log_activity on public.countries;
create trigger countries_log_activity
    after insert or update or delete on public.countries
    for each row execute function public.log_activity();
