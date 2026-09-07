// Gestión de los usuarios del panel desde la propia UI.
// Un owner gestiona cualquier rol; un admin de negocio, solo los trabajadores del suyo.
// Vive en una Edge Function porque crear o borrar usuarios exige la service role,
// que nunca puede viajar al navegador.
// Secrets: los SUPABASE_* que Supabase inyecta automáticamente.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Role = 'owner' | 'staff' | 'business_admin' | 'worker';

/** Roles atados a un negocio: exigen business_id y solo ven lo suyo. */
const BUSINESS_ROLES: Role[] = ['business_admin', 'worker'];
const ROLES: Role[] = ['owner', 'staff', ...BUSINESS_ROLES];

interface InviteAction {
  action: 'invite';
  email: string;
  password?: string;
  role: Role;
  businessId?: string | null;
}

interface SetRoleAction {
  action: 'setRole';
  userId: string;
  role: Role;
  businessId?: string | null;
}

interface RemoveAction {
  action: 'remove';
  userId: string;
}

type Payload = InviteAction | SetRoleAction | RemoveAction;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  // supabase-js manda también apikey y x-client-info: si el preflight no las
  // permite, el navegador corta la llamada antes de que la función responda y
  // el panel solo ve "Failed to send a request to the Edge Function".
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

/** Cliente con la service role: se salta RLS y puede tocar auth.users. */
const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

interface Caller {
  id: string;
  role: Role;
  businessId: string | null;
}

/** Quién llama, o null si el token no es de un usuario del panel. */
async function resolveCaller(authorization: string | null): Promise<Caller | null> {
  if (!authorization) return null;

  const { data, error } = await admin.auth.getUser(authorization.replace(/^Bearer /i, ''));
  if (error || !data.user) return null;

  const { data: row } = await admin
    .from('admins')
    .select('role, business_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (!row) return null;
  return { id: data.user.id, role: row.role as Role, businessId: row.business_id ?? null };
}

/**
 * Valida rol + negocio según quién llama y devuelve el business_id a guardar.
 * El owner puede crear cualquier rol; el admin de negocio, solo trabajadores del suyo.
 */
function resolveScope(
  caller: Caller,
  role: Role,
  businessId: string | null | undefined,
): { businessId: string | null } | { error: string } {
  if (!ROLES.includes(role)) return { error: 'Rol inválido.' };

  if (caller.role === 'business_admin') {
    if (role !== 'worker') {
      return { error: 'Un admin de negocio solo puede gestionar trabajadores.' };
    }
    return { businessId: caller.businessId };
  }

  if (caller.role !== 'owner') return { error: 'No tienes permiso para gestionar usuarios.' };

  if (BUSINESS_ROLES.includes(role)) {
    if (!businessId) return { error: 'Elige el negocio al que pertenece el usuario.' };
    return { businessId };
  }

  return { businessId: null };
}

/** El admin de negocio solo puede tocar a los trabajadores de su propio negocio. */
async function canManageTarget(caller: Caller, userId: string): Promise<boolean> {
  if (caller.role === 'owner') return true;
  if (caller.role !== 'business_admin') return false;

  const { data } = await admin
    .from('admins')
    .select('role, business_id')
    .eq('user_id', userId)
    .maybeSingle();

  return data?.role === 'worker' && data.business_id === caller.businessId;
}

/** Reutiliza el usuario de auth si el email ya existe (p. ej. un admin eliminado antes). */
async function findAuthUserId(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === normalized)?.id ?? null;
}

async function ownerCount(): Promise<number> {
  const { count } = await admin
    .from('admins')
    .select('user_id', { count: 'exact', head: true })
    .eq('role', 'owner');
  return count ?? 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  const caller = await resolveCaller(request.headers.get('Authorization'));
  if (!caller || (caller.role !== 'owner' && caller.role !== 'business_admin')) {
    return json({ error: 'No tienes permiso para gestionar usuarios.' }, 403);
  }
  const callerId = caller.id;

  const payload = (await request.json()) as Payload;

  if (payload.action === 'invite') {
    const email = payload.email?.trim().toLowerCase();
    if (!email) return json({ error: 'El email es obligatorio.' }, 400);
    const scope = resolveScope(caller, payload.role, payload.businessId);
    if ('error' in scope) return json({ error: scope.error }, 400);
    if (payload.password && payload.password.length < 8) {
      return json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    }

    let userId = await findAuthUserId(email);

    if (!userId) {
      // Con contraseña el usuario queda listo para entrar; sin ella se le envía
      // una invitación, que necesita el proveedor de email configurado en Supabase.
      const { data, error } = payload.password
        ? await admin.auth.admin.createUser({
            email,
            password: payload.password,
            email_confirm: true,
          })
        : await admin.auth.admin.inviteUserByEmail(email);

      if (error || !data.user) {
        return json({ error: error?.message ?? 'No se pudo crear el usuario.' }, 400);
      }
      userId = data.user.id;
    }

    const { error: insertError } = await admin
      .from('admins')
      .insert({ user_id: userId, email, role: payload.role, business_id: scope.businessId });

    if (insertError) {
      return json(
        {
          error:
            insertError.code === '23505'
              ? 'Ese usuario ya tiene acceso al panel.'
              : insertError.message,
        },
        400,
      );
    }

    return json({ userId });
  }

  if (payload.action === 'setRole') {
    const scope = resolveScope(caller, payload.role, payload.businessId);
    if ('error' in scope) return json({ error: scope.error }, 400);
    if (!(await canManageTarget(caller, payload.userId))) {
      return json({ error: 'No puedes cambiar el rol de ese usuario.' }, 403);
    }
    if (payload.userId === callerId && payload.role !== 'owner') {
      return json({ error: 'No puedes quitarte tu propio rol de owner.' }, 400);
    }

    // Degradar al último owner dejaría el panel sin quien gestione usuarios.
    const { data: current } = await admin
      .from('admins')
      .select('role')
      .eq('user_id', payload.userId)
      .maybeSingle();

    if (current?.role === 'owner' && payload.role !== 'owner' && (await ownerCount()) <= 1) {
      return json({ error: 'Debe quedar al menos un owner.' }, 400);
    }

    const { error } = await admin
      .from('admins')
      .update({ role: payload.role, business_id: scope.businessId })
      .eq('user_id', payload.userId);

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (payload.action === 'remove') {
    if (payload.userId === callerId) {
      return json({ error: 'No puedes eliminar tu propio acceso.' }, 400);
    }
    if (!(await canManageTarget(caller, payload.userId))) {
      return json({ error: 'No puedes quitar el acceso de ese usuario.' }, 403);
    }

    const { data: target } = await admin
      .from('admins')
      .select('role')
      .eq('user_id', payload.userId)
      .maybeSingle();

    if (!target) return json({ error: 'Ese usuario no tiene acceso al panel.' }, 404);
    if (target.role === 'owner' && (await ownerCount()) <= 1) {
      return json({ error: 'Debe quedar al menos un owner.' }, 400);
    }

    // Solo se revoca el acceso al panel: el usuario de auth se conserva para no
    // romper referencias ni perder su historial de sesiones.
    const { error } = await admin.from('admins').delete().eq('user_id', payload.userId);
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida.' }, 400);
});
