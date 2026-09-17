-- Alta pública de negocios: el dueño se registra como usuario, manda su
-- solicitud y un rol global la aprueba.
--
-- La aprobación crea el negocio y le da a quien solicitó el rol business_admin,
-- así que todo el aislamiento por negocio que ya existe (RLS, panel, productos)
-- funciona desde el primer minuto sin tocar nada.

create table if not exists public.business_applications (
    id              uuid primary key default gen_random_uuid(),
    -- Quien solicita ya tiene cuenta: al aprobar hace falta su uuid para
    -- crearle la fila de `admins` sin pasar por una invitación por email.
    user_id         uuid        not null references auth.users (id) on delete cascade,
    contact_email   text        not null,
    name            text        not null check (length(name) between 1 and 160),
    description     text,
    municipality_id uuid        not null references public.municipalities (id) on delete restrict,
    contact_phone   text        not null check (length(contact_phone) between 1 and 40),
    category_ids    uuid[]      not null default '{}',
    status          text        not null default 'pending'
                                check (status in ('pending', 'approved', 'rejected')),
    -- Por qué se rechazó, o la nota que deje quien aprueba.
    review_note     text,
    reviewed_at     timestamptz,
    reviewed_by     uuid        references auth.users (id) on delete set null,
    -- El negocio creado al aprobar; null mientras siga pendiente o rechazada.
    business_id     uuid        references public.businesses (id) on delete set null,
    created_at      timestamptz not null default now()
);

create index if not exists ix_business_applications_status
    on public.business_applications (status, created_at desc);

-- Una solicitud viva por persona: rechazada la anterior, puede volver a probar.
create unique index if not exists ux_business_applications_pending
    on public.business_applications (user_id)
    where status = 'pending';

alter table public.business_applications enable row level security;

-- Policies -------------------------------------------------------------------

-- Solicita quien tiene sesión y todavía no gestiona ningún negocio. admin_role()
-- es security definer: devuelve null para un comprador normal sin recursar RLS.
drop policy if exists business_applications_insert_own on public.business_applications;
create policy business_applications_insert_own on public.business_applications
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and status = 'pending'
        and public.admin_role() is null
    );

drop policy if exists business_applications_read on public.business_applications;
create policy business_applications_read on public.business_applications
    for select to authenticated
    using (user_id = auth.uid() or public.admin_role() in ('owner', 'staff'));

-- Las resoluciones pasan por las funciones de abajo, que validan la transición;
-- esta policy deja al rol global corregir una nota sin darle a nadie más acceso.
drop policy if exists business_applications_review on public.business_applications;
create policy business_applications_review on public.business_applications
    for update to authenticated
    using (public.admin_role() in ('owner', 'staff'))
    with check (public.admin_role() in ('owner', 'staff'));

-- Resolución ------------------------------------------------------------------

/**
 * Aprueba la solicitud: crea el negocio con sus categorías y convierte a quien
 * solicitó en business_admin de ese negocio. Todo en una transacción para que
 * no quede un negocio sin dueño ni un dueño sin negocio.
 */
create or replace function public.approve_business_application(p_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_app         public.business_applications;
    v_business_id uuid;
begin
    if public.admin_role() not in ('owner', 'staff') then
        raise exception 'Solo un rol global puede resolver solicitudes.' using errcode = '42501';
    end if;

    select * into v_app from public.business_applications where id = p_id for update;

    if not found then
        raise exception 'La solicitud no existe.';
    end if;

    if v_app.status <> 'pending' then
        raise exception 'Esa solicitud ya está resuelta.';
    end if;

    -- `admins.user_id` es la clave primaria: una persona pertenece a un solo
    -- negocio. Sin esta comprobación el insert fallaría con un error de Postgres
    -- que no le dice nada a quien está aprobando.
    if exists (select 1 from public.admins a where a.user_id = v_app.user_id) then
        raise exception 'Ese usuario ya tiene acceso al panel; quítaselo antes de aprobar.';
    end if;

    -- province y municipality (texto) los rellena el trigger a partir del municipio.
    insert into public.businesses (name, description, municipality_id, contact_phone, active)
    values (v_app.name, v_app.description, v_app.municipality_id, v_app.contact_phone, true)
    returning id into v_business_id;

    insert into public.business_categories (business_id, category_id)
    select v_business_id, unnest(v_app.category_ids)
    on conflict do nothing;

    insert into public.admins (user_id, email, role, business_id)
    values (v_app.user_id, v_app.contact_email, 'business_admin', v_business_id);

    update public.business_applications
       set status      = 'approved',
           review_note = p_note,
           reviewed_at = now(),
           reviewed_by = auth.uid(),
           business_id = v_business_id
     where id = p_id;

    return v_business_id;
end;
$$;

/** Rechaza la solicitud. El motivo es obligatorio: lo lee quien solicitó. */
create or replace function public.reject_business_application(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
begin
    if public.admin_role() not in ('owner', 'staff') then
        raise exception 'Solo un rol global puede resolver solicitudes.' using errcode = '42501';
    end if;

    if nullif(trim(coalesce(p_note, '')), '') is null then
        raise exception 'Indica el motivo del rechazo.';
    end if;

    select status into v_status from public.business_applications where id = p_id for update;

    if not found then
        raise exception 'La solicitud no existe.';
    end if;

    if v_status <> 'pending' then
        raise exception 'Esa solicitud ya está resuelta.';
    end if;

    update public.business_applications
       set status      = 'rejected',
           review_note = trim(p_note),
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where id = p_id;
end;
$$;

revoke all on function public.approve_business_application(uuid, text) from public;
revoke all on function public.reject_business_application(uuid, text) from public;
grant execute on function public.approve_business_application(uuid, text) to authenticated;
grant execute on function public.reject_business_application(uuid, text) to authenticated;

grant select, insert on public.business_applications to authenticated;
grant update on public.business_applications to authenticated;

-- El historial ya registra negocios, productos y usuarios; las altas son
-- justamente lo que interesa poder auditar después.
drop trigger if exists business_applications_log_activity on public.business_applications;
create trigger business_applications_log_activity
    after insert or update or delete on public.business_applications
    for each row execute function public.log_activity();
