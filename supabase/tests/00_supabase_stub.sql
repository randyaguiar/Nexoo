-- Piezas que Supabase da hechas y las migraciones dan por existentes.
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
);

-- auth.uid() lee el claim del JWT; aquí lo simula un ajuste de sesión.
create or replace function auth.uid() returns uuid
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table storage.buckets (
    id                 text primary key,
    name               text,
    public             boolean,
    file_size_limit    bigint,
    allowed_mime_types text[]
);

create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
    select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)];
$$;

-- Supabase concede todo sobre public a estos roles por defecto.
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
