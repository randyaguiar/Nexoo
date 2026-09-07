-- Nexoo MVP: esquema base.
-- province y status se guardan como texto con CHECK para que añadir valores
-- (nuevas provincias, nuevos estados) no requiera migrar datos.

create table if not exists public.businesses (
    id            uuid primary key default gen_random_uuid(),
    name          text        not null check (length(name) between 1 and 160),
    description   text,
    province      text        not null check (province in ('PinarDelRio', 'LaHabana')),
    municipality  text        not null check (length(municipality) between 1 and 120),
    contact_phone text,
    active        boolean     not null default true,
    created_at    timestamptz not null default now()
);

create index if not exists ix_businesses_province on public.businesses (province);

create table if not exists public.products (
    id          uuid primary key default gen_random_uuid(),
    business_id uuid          not null references public.businesses (id) on delete cascade,
    name        text          not null check (length(name) between 1 and 160),
    description text,
    price_usd   numeric(10,2) not null check (price_usd > 0),
    photo_url   text,
    available   boolean       not null default true,
    created_at  timestamptz   not null default now()
);

create index if not exists ix_products_business_id on public.products (business_id);

create table if not exists public.orders (
    id                     uuid primary key default gen_random_uuid(),
    buyer_name             text not null,
    buyer_email            text not null,
    buyer_phone            text not null,
    recipient_name         text not null,
    recipient_phone        text not null,
    recipient_province     text not null check (recipient_province in ('PinarDelRio', 'LaHabana')),
    recipient_municipality text not null,
    recipient_address      text not null,
    business_id            uuid not null references public.businesses (id) on delete restrict,
    status                 text not null default 'PendingPayment'
                                check (status in ('PendingPayment', 'Paid', 'PaidToBusiness', 'Delivered', 'Cancelled')),
    total_usd              numeric(10,2) not null check (total_usd >= 0),
    notes                  text,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

create index if not exists ix_orders_status on public.orders (status);
create index if not exists ix_orders_created_at on public.orders (created_at desc);

create table if not exists public.order_items (
    id           uuid primary key default gen_random_uuid(),
    order_id     uuid          not null references public.orders (id) on delete cascade,
    product_id   uuid          not null references public.products (id) on delete restrict,
    -- Nombre capturado al crear el pedido: el historial sobrevive a ediciones del producto.
    product_name text          not null,
    quantity     integer       not null check (quantity between 1 and 100),
    unit_price   numeric(10,2) not null check (unit_price > 0)
);

create index if not exists ix_order_items_order_id on public.order_items (order_id);

-- Quién puede entrar al panel. Se llena con el uuid del usuario creado en Supabase Auth.
create table if not exists public.admins (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    email      text not null,
    created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
    before update on public.orders
    for each row execute function public.touch_updated_at();
