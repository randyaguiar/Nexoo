-- Roles por negocio e historial de cambios.
--
--   owner          admin general: acceso total al panel y al historial.
--   staff          rol heredado: acceso global al panel, sin gestión de usuarios.
--   business_admin admin de un negocio: sus productos, sus pedidos, su dashboard
--                  y el alta de trabajadores de ese negocio.
--   worker         trabajador de un negocio: actualiza inventario y gestiona pedidos.
--
-- business_admin y worker quedan atados a un negocio; owner y staff no.

alter table public.admins
    add column if not exists business_id uuid references public.businesses (id) on delete cascade;

create index if not exists ix_admins_business_id on public.admins (business_id);

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins
    add constraint admins_role_check check (role in ('owner', 'staff', 'business_admin', 'worker'));

alter table public.admins drop constraint if exists admins_business_scope_check;
alter table public.admins
    add constraint admins_business_scope_check check (
        (role in ('business_admin', 'worker') and business_id is not null)
        or (role in ('owner', 'staff') and business_id is null)
    );

-- Inventario: hasta ahora la disponibilidad era un booleano; el trabajador
-- necesita una cantidad que actualizar y el dashboard, algo que medir.
alter table public.products
    add column if not exists stock integer not null default 0;

alter table public.products drop constraint if exists products_stock_check;
alter table public.products add constraint products_stock_check check (stock >= 0);

-- Helpers --------------------------------------------------------------------
-- Todos security definer: leen `admins` sin pasar por RLS para no recursar.

create or replace function public.admin_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select a.role from public.admins a where a.user_id = auth.uid();
$$;

create or replace function public.admin_business_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select a.business_id from public.admins a where a.user_id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select public.admin_role() = 'owner';
$$;

/** true si la sesión es global (owner/staff) o pertenece a ese negocio. */
create or replace function public.can_access_business(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
        when public.admin_role() in ('owner', 'staff') then true
        when public.admin_role() in ('business_admin', 'worker')
            then p_business_id is not null and p_business_id = public.admin_business_id()
        else false
    end;
$$;

grant execute on function public.admin_role(), public.admin_business_id(),
    public.is_owner(), public.can_access_business(uuid) to authenticated;

-- Policies -------------------------------------------------------------------

-- Negocios: los globales gestionan todos; el admin de negocio solo edita el suyo
-- y el trabajador solo puede leerlo (lo necesita el panel para mostrarlo).
drop policy if exists businesses_admin_all on public.businesses;

drop policy if exists businesses_global_all on public.businesses;
create policy businesses_global_all on public.businesses
    for all to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

drop policy if exists businesses_member_read on public.businesses;
create policy businesses_member_read on public.businesses
    for select to authenticated
    using (id = public.admin_business_id());

drop policy if exists businesses_member_update on public.businesses;
create policy businesses_member_update on public.businesses
    for update to authenticated
    using (public.admin_role() = 'business_admin' and id = public.admin_business_id())
    with check (public.admin_role() = 'business_admin' and id = public.admin_business_id());

-- Productos: el admin de negocio da de alta y baja los suyos; el trabajador solo
-- actualiza los existentes (inventario y disponibilidad).
drop policy if exists products_admin_all on public.products;

drop policy if exists products_manage on public.products;
create policy products_manage on public.products
    for all to authenticated
    using (
        public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    )
    with check (
        public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    );

drop policy if exists products_worker_read on public.products;
create policy products_worker_read on public.products
    for select to authenticated
    using (public.admin_role() = 'worker' and business_id = public.admin_business_id());

drop policy if exists products_worker_update on public.products;
create policy products_worker_update on public.products
    for update to authenticated
    using (public.admin_role() = 'worker' and business_id = public.admin_business_id())
    with check (public.admin_role() = 'worker' and business_id = public.admin_business_id());

-- Pedidos: los del propio negocio para admin de negocio y trabajador.
drop policy if exists orders_admin_all on public.orders;

drop policy if exists orders_panel_read on public.orders;
create policy orders_panel_read on public.orders
    for select to authenticated
    using (public.can_access_business(business_id));

drop policy if exists orders_panel_update on public.orders;
create policy orders_panel_update on public.orders
    for update to authenticated
    using (public.can_access_business(business_id))
    with check (public.can_access_business(business_id));

drop policy if exists orders_global_write on public.orders;
create policy orders_global_write on public.orders
    for all to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

drop policy if exists order_items_admin_read on public.order_items;
create policy order_items_admin_read on public.order_items
    for select to authenticated
    using (
        exists (
            select 1 from public.orders o
            where o.id = order_id and public.can_access_business(o.business_id)
        )
    );

-- Taxonomía: solo los roles globales la tocan; el resto la lee (ya es pública).
drop policy if exists provinces_admin_all on public.provinces;
create policy provinces_admin_all on public.provinces
    for all to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

drop policy if exists municipalities_admin_all on public.municipalities;
create policy municipalities_admin_all on public.municipalities
    for all to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories
    for all to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

drop policy if exists business_categories_admin_all on public.business_categories;
create policy business_categories_admin_all on public.business_categories
    for all to authenticated
    using (
        public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    )
    with check (
        public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    );

-- Usuarios del panel: el owner ve todos; el resto, su propia fila y la de sus
-- compañeros de negocio (el admin de negocio gestiona a sus trabajadores).
drop policy if exists admins_read_all on public.admins;
create policy admins_read_all on public.admins
    for select to authenticated
    using (
        user_id = auth.uid()
        or public.admin_role() in ('owner', 'staff')
        or (public.admin_role() = 'business_admin' and business_id = public.admin_business_id())
    );

-- Historial de cambios -------------------------------------------------------
-- Se escribe desde triggers security definer y solo lo lee el admin general.

create table if not exists public.activity_log (
    id          bigserial primary key,
    at          timestamptz not null default now(),
    actor_id    uuid references auth.users (id) on delete set null,
    actor_email text,
    actor_role  text,
    business_id uuid references public.businesses (id) on delete set null,
    entity      text not null,
    entity_id   text,
    action      text not null check (action in ('insert', 'update', 'delete')),
    -- Solo las columnas que cambiaron (en update) o la fila entera (insert/delete).
    changes     jsonb not null default '{}'::jsonb
);

create index if not exists ix_activity_log_at on public.activity_log (at desc);
create index if not exists ix_activity_log_business on public.activity_log (business_id);
create index if not exists ix_activity_log_entity on public.activity_log (entity, entity_id);

alter table public.activity_log enable row level security;

drop policy if exists activity_log_owner_read on public.activity_log;
create policy activity_log_owner_read on public.activity_log
    for select to authenticated
    using (public.is_owner());

-- Sin policy de insert/update/delete: nadie escribe el historial a mano, solo el
-- trigger (security definer) y la service role.
grant select on public.activity_log to authenticated;

/**
 * Registra la fila afectada. El negocio se deduce de la propia fila para poder
 * filtrar el historial por negocio.
 */
create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row         jsonb;
    v_old         jsonb;
    v_changes     jsonb;
    v_business_id uuid;
    v_entity_id   text;
begin
    v_row := to_jsonb(coalesce(new, old));
    v_old := case when old is null then '{}'::jsonb else to_jsonb(old) end;

    if tg_op = 'UPDATE' then
        select coalesce(jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value)), '{}'::jsonb)
          into v_changes
          from jsonb_each(v_row)
         where value is distinct from v_old -> key
           -- updated_at lo mueve el trigger, no la persona: por sí solo no es un cambio.
           and key <> 'updated_at';

        -- Un update que no cambia nada no merece una línea en el historial.
        if v_changes = '{}'::jsonb then
            return null;
        end if;
    else
        v_changes := v_row;
    end if;

    v_business_id := nullif(
        case tg_table_name
            when 'businesses' then v_row ->> 'id'
            else v_row ->> 'business_id'
        end, '')::uuid;

    v_entity_id := coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'code');

    insert into public.activity_log
        (actor_id, actor_email, actor_role, business_id, entity, entity_id, action, changes)
    values (
        auth.uid(),
        (select a.email from public.admins a where a.user_id = auth.uid()),
        public.admin_role(),
        v_business_id,
        tg_table_name,
        v_entity_id,
        lower(tg_op),
        v_changes
    );

    return null;
end;
$$;

do $$
declare
    t text;
begin
    foreach t in array array['businesses', 'products', 'orders', 'admins', 'categories'] loop
        execute format('drop trigger if exists %I on public.%I', t || '_log_activity', t);
        execute format(
            'create trigger %I after insert or update or delete on public.%I
                 for each row execute function public.log_activity()',
            t || '_log_activity', t);
    end loop;
end;
$$;
