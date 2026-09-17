-- Comprobación de rol a prueba de nulos.
--
-- `admin_role()` devuelve null para quien no es usuario del panel, y
-- `null not in ('owner','staff')` no es cierto: es null. Con el guard escrito
-- como `if <rol> not in (...) then raise`, la excepción no saltaba y la función
-- seguía adelante. En `approve_business_application()` eso significaba que
-- cualquier usuario con sesión podía aprobar su propia solicitud y darse de
-- alta como negocio.
--
-- Las policies de RLS no tenían este problema: ahí un null se trata como falso
-- y niega el acceso. Solo fallaba la lógica invertida de plpgsql.

create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(public.admin_role() in ('owner', 'staff'), false);
$$;

grant execute on function public.is_global_admin() to authenticated;

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

create or replace function public.reject_business_application(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
begin
    if not public.is_global_admin() then
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

create or replace function public.apply_markup(
    p_markup_pct       numeric,
    p_business_id      uuid    default null,
    p_overwrite_manual boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_count integer;
begin
    if not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if p_markup_pct is null or p_markup_pct < 0 then
        raise exception 'El margen debe ser cero o mayor.' using errcode = '22023';
    end if;

    -- Le dice al trigger que esto es un recálculo, no un ajuste a mano.
    perform set_config('nexoo.bulk_pricing', 'on', true);

    update public.products p
       set price_usd = round(p.cost_usd * (1 + p_markup_pct / 100), 2)
     where p.cost_usd is not null
       and (p_business_id is null or p.business_id = p_business_id)
       and (p_overwrite_manual or not p.price_is_manual)
       and p.price_usd is distinct from round(p.cost_usd * (1 + p_markup_pct / 100), 2);

    get diagnostics v_count = row_count;

    perform set_config('nexoo.bulk_pricing', 'off', true);

    -- El margen aplicado queda como el nuevo por defecto del negocio, para que
    -- el precio sugerido de sus productos nuevos coincida con lo ya aplicado.
    if p_business_id is null then
        update public.businesses set default_markup_pct = p_markup_pct;
    else
        update public.businesses set default_markup_pct = p_markup_pct where id = p_business_id;
    end if;

    return v_count;
end;
$$;

create or replace function public.set_product_price(p_product_id uuid, p_price_usd numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if p_price_usd is not null and p_price_usd <= 0 then
        raise exception 'El precio debe ser mayor que cero.' using errcode = '22023';
    end if;

    update public.products
       set price_usd = p_price_usd
     where id = p_product_id;

    if not found then
        raise exception 'El producto no existe.';
    end if;
end;
$$;

create or replace function public.products_guard_pricing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_bulk boolean := coalesce(current_setting('nexoo.bulk_pricing', true), '') = 'on';
begin
    if tg_op = 'UPDATE' and new.price_usd is distinct from old.price_usd
       and not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if tg_op = 'INSERT' and new.price_usd is not null
       and not public.is_global_admin() then
        raise exception 'El precio de venta lo fija la plataforma.' using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.price_usd is distinct from old.price_usd then
        new.price_is_manual := not v_bulk;
    end if;

    return new;
end;
$$;

create or replace function public.create_settlement(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_id          uuid;
    v_count       integer;
    v_gross       numeric(12,2);
    v_cost        numeric(12,2);
    v_start       date;
    v_end         date;
begin
    if not public.is_global_admin() then
        raise exception 'Solo un rol global puede liquidar.' using errcode = '42501';
    end if;

    -- Se bloquean los pedidos antes de sumarlos: sin el lock, dos liquidaciones
    -- simultáneas del mismo negocio se repartirían las mismas filas.
    perform 1
      from public.orders
     where business_id = p_business_id
       and settlement_id is null
       and status in ('Paid', 'Delivered')
     order by id
       for update;

    select count(*),
           coalesce(sum(o.total_usd), 0),
           coalesce(sum((select sum(oi.unit_cost * oi.quantity)
                           from public.order_items oi
                          where oi.order_id = o.id)), 0),
           min(o.created_at::date),
           max(o.created_at::date)
      into v_count, v_gross, v_cost, v_start, v_end
      from public.orders o
     where o.business_id = p_business_id
       and o.settlement_id is null
       and o.status in ('Paid', 'Delivered');

    if v_count = 0 then
        raise exception 'Ese negocio no tiene pedidos pendientes de liquidar.';
    end if;

    insert into public.settlements (
        business_id, period_start, period_end, order_count,
        gross_usd, cost_usd, fee_usd, created_by
    )
    values (
        p_business_id, v_start, v_end, v_count,
        v_gross, v_cost, v_gross - v_cost, auth.uid()
    )
    returning id into v_id;

    update public.orders
       set settlement_id = v_id
     where business_id = p_business_id
       and settlement_id is null
       and status in ('Paid', 'Delivered');

    return v_id;
end;
$$;

create or replace function public.mark_settlement_paid(
    p_id              uuid,
    p_method          text,
    p_reference       text    default null,
    p_payout_currency text    default 'USD',
    p_fx_rate         numeric default null,
    p_payout_amount   numeric default null,
    p_notes           text    default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_status text;
begin
    if not public.is_global_admin() then
        raise exception 'Solo un rol global puede liquidar.' using errcode = '42501';
    end if;

    if nullif(trim(coalesce(p_method, '')), '') is null then
        raise exception 'Indica cómo se pagó.' using errcode = '22023';
    end if;

    -- Pagar en otra moneda sin dejar el cambio aplicado hace la liquidación
    -- imposible de cuadrar después.
    if p_payout_currency <> 'USD' and (p_fx_rate is null or p_payout_amount is null) then
        raise exception 'Al pagar en otra moneda hace falta el tipo de cambio y el importe.'
            using errcode = '22023';
    end if;

    select status into v_status from public.settlements where id = p_id for update;

    if not found then
        raise exception 'La liquidación no existe.';
    end if;

    if v_status = 'paid' then
        raise exception 'Esa liquidación ya está pagada.';
    end if;

    update public.settlements
       set status          = 'paid',
           payout_method   = trim(p_method),
           payout_currency = p_payout_currency,
           fx_rate         = p_fx_rate,
           payout_amount   = p_payout_amount,
           reference       = nullif(trim(coalesce(p_reference, '')), ''),
           notes           = nullif(trim(coalesce(p_notes, '')), ''),
           paid_at         = now()
     where id = p_id;

    update public.orders
       set status = 'PaidToBusiness'
     where settlement_id = p_id
       and status = 'Paid';
end;
$$;
