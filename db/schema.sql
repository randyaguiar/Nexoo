-- Nexoo MVP schema (PostgreSQL / Supabase).
-- Mirrors the EF Core model in backend/Nexoo.Api/Data/NexooDbContext.cs.

create table if not exists businesses (
    id             uuid primary key,
    name           varchar(160) not null,
    description    varchar(2000),
    province       varchar(40)  not null,
    municipality   varchar(120) not null,
    contact_phone  varchar(40),
    active         boolean      not null default true,
    created_at     timestamptz  not null default now()
);

create index if not exists ix_businesses_province on businesses (province);

create table if not exists products (
    id           uuid primary key,
    business_id  uuid          not null references businesses (id) on delete cascade,
    name         varchar(160)  not null,
    description  varchar(2000),
    price_usd    numeric(10,2) not null,
    photo_url    varchar(1000),
    available    boolean       not null default true,
    created_at   timestamptz   not null default now()
);

create index if not exists ix_products_business_id on products (business_id);

create table if not exists orders (
    id                     uuid          primary key,
    buyer_name             varchar(160)  not null,
    buyer_email            varchar(200)  not null,
    buyer_phone            varchar(40)   not null,
    recipient_name         varchar(160)  not null,
    recipient_phone        varchar(40)   not null,
    recipient_province     varchar(40)   not null,
    recipient_municipality varchar(120)  not null,
    recipient_address      varchar(500)  not null,
    business_id            uuid          not null references businesses (id) on delete restrict,
    status                 varchar(40)   not null default 'PendingPayment',
    total_usd              numeric(10,2) not null,
    notes                  varchar(1000),
    created_at             timestamptz   not null default now(),
    updated_at             timestamptz   not null default now()
);

create index if not exists ix_orders_status on orders (status);
create index if not exists ix_orders_created_at on orders (created_at);

create table if not exists order_items (
    id           uuid          primary key,
    order_id     uuid          not null references orders (id) on delete cascade,
    product_id   uuid          not null references products (id) on delete restrict,
    product_name varchar(160)  not null,
    quantity     integer       not null check (quantity > 0),
    unit_price   numeric(10,2) not null
);

create index if not exists ix_order_items_order_id on order_items (order_id);
