-- Gestión de usuarios del panel: roles y lectura del listado de admins.
-- 'owner' administra usuarios; 'staff' solo trabaja con pedidos, negocios y productos.

alter table public.admins
    add column if not exists role text not null default 'staff';

-- Backfill idempotente: si aún no hay ningún owner, los admins existentes
-- (creados a mano) pasan a serlo para no quedarse sin quien gestione usuarios.
update public.admins
   set role = 'owner'
 where not exists (select 1 from public.admins a where a.role = 'owner');

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins
    add constraint admins_role_check check (role in ('owner', 'staff'));

-- El panel necesita listar los usuarios; las escrituras pasan por la Edge Function
-- manage-admins, que es la única con permisos para tocar auth.users.
drop policy if exists admins_read_self on public.admins;

drop policy if exists admins_read_all on public.admins;
create policy admins_read_all on public.admins
    for select to authenticated
    using (public.is_admin());
