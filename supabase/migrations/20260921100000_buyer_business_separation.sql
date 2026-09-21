-- Comprador y negocio son cuentas separadas.
--
-- Hasta ahora la misma cuenta podía hacer las dos cosas: el dueño de un negocio
-- podía comprarse a sí mismo —un pedido que se cobra y se paga a la misma
-- persona, que luego hay que deshacer a mano en la liquidación— y quien ya
-- había comprado podía pedir el alta y acabar con historial de comprador y de
-- vendedor mezclado en el mismo usuario.
--
-- La regla se aplica en los tres momentos en que una cuenta cambiaría de lado:
-- al crear un pedido, al solicitar el alta y al aprobarla. Las cuentas que ya
-- tengan las dos cosas se quedan como están: esto solo mira hacia delante.
--
-- Lo que no cubre: el checkout anónimo. `create_order` está concedido a `anon`
-- a propósito —se compra sin cuenta—, así que un dueño de negocio que cierre
-- sesión puede pedir igual. No hay a quién comprobar, y obligar a entrar para
-- comprar costaría ventas.

/**
 * ¿La sesión ha comprado alguna vez? La usa la policy de solicitudes: dentro de
 * un `with check` una subconsulta a `orders` arrastraría las policies de esa
 * tabla, y esto tiene que responder igual se mire desde donde se mire.
 *
 * Sin argumento a propósito: con uno, cualquiera con sesión podría preguntar
 * por el historial de compras de otra persona.
 */
create or replace function public.session_has_orders()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
        from public.orders o
        where o.user_id is not null
          and o.user_id = auth.uid()
    );
$$;

revoke all on function public.session_has_orders() from public;
grant execute on function public.session_has_orders() to authenticated;

-- 1) Quien gestiona un negocio no compra con esa cuenta ------------------------
--
-- Va en un trigger y no dentro de `create_order` para no tener que volver a
-- copiar entera esa función (ya se ha reescrito tres veces por cambios así), y
-- porque de paso cubre cualquier otro camino que inserte un pedido.

create or replace function public.orders_reject_business_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    -- coalesce porque `admin_role()` devuelve null para un comprador normal, y
    -- `null in (...)` es null: sin esto la comprobación no negaría nunca nada.
    if coalesce(public.admin_role() in ('business_admin', 'worker'), false) then
        raise exception 'Esta cuenta gestiona un negocio en Nexoo y no puede hacer pedidos. Usa una cuenta de comprador.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

drop trigger if exists orders_buyer_separation on public.orders;
create trigger orders_buyer_separation
    before insert on public.orders
    for each row execute function public.orders_reject_business_accounts();

-- 2) Quien ya compró no solicita el alta de un negocio -------------------------

drop policy if exists business_applications_insert_own on public.business_applications;
create policy business_applications_insert_own on public.business_applications
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and status = 'pending'
        and public.admin_role() is null
        and not public.session_has_orders()
    );

-- 3) Y tampoco se aprueba si compró mientras la solicitud estaba pendiente -----
--
-- Sin esto la regla anterior tendría una ventana: solicitar primero, comprar
-- después y quedar aprobado con las dos cosas. La solicitud se queda sin poder
-- aprobarse y quien revisa la rechaza indicando el motivo.

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
    if not public.is_global_admin() then
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

    if exists (select 1 from public.orders o where o.user_id = v_app.user_id) then
        raise exception 'Esa cuenta tiene pedidos como compradora: no puede convertirse en negocio. Recházala y pídele que solicite el alta con otra cuenta.'
            using errcode = '22023';
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
