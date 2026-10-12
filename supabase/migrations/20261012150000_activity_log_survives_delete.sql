-- El historial tiene que sobrevivir al borrado de un negocio.
--
-- `log_activity()` apunta cada línea al negocio al que pertenece, y
-- `activity_log.business_id` es `on delete set null` justamente para que el log
-- siga ahí cuando el negocio ya no esté. Pero el trigger de borrado se dispara
-- *después* de que la fila desaparezca y escribe el id que acaba de dejar de
-- existir, así que la clave foránea rechazaba el insert y el borrado entero
-- fallaba. Resultado: no se podía borrar ningún negocio.
--
-- Ahora, si el negocio ya no está, la línea se guarda sin referencia. Qué
-- negocio era sigue constando: `entity_id` lleva su id y `changes` la fila
-- entera que se borró.

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

    -- El negocio puede acabar de desaparecer: este trigger corre después del
    -- borrado, y también después del de sus productos en cascada.
    if v_business_id is not null
       and not exists (select 1 from public.businesses where id = v_business_id) then
        v_business_id := null;
    end if;

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
