// Gestión de los usuarios del panel desde la propia UI.
// Vive en una Edge Function porque crear o borrar usuarios exige la service role,
// que nunca puede viajar al navegador.
// Secrets: los SUPABASE_* que Supabase inyecta automáticamente.

import { createClient } from 'jsr:@supabase/supabase-js@2';

type Role = 'owner' | 'staff';

interface InviteAction {
  action: 'invite';
  email: string;
  password?: string;
  role: Role;
}

interface SetRoleAction {
  action: 'setRole';
  userId: string;
  role: Role;
}

interface RemoveAction {
  action: 'remove';
  userId: string;
}

type Payload = InviteAction | SetRoleAction | RemoveAction;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

/** Cliente con la service role: se salta RLS y puede tocar auth.users. */
const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

/** El uuid del owner que llama, o null si el token no es de un owner. */
async function callerOwnerId(authorization: string | null): Promise<string | null> {
  if (!authorization) return null;

  const { data, error } = await admin.auth.getUser(authorization.replace(/^Bearer /i, ''));
  if (error || !data.user) return null;

  const { data: row } = await admin
    .from('admins')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle();

  return row?.role === 'owner' ? data.user.id : null;
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

  const callerId = await callerOwnerId(request.headers.get('Authorization'));
  if (!callerId) {
    return json({ error: 'Solo un owner puede gestionar usuarios.' }, 403);
  }

  const payload = (await request.json()) as Payload;

  if (payload.action === 'invite') {
    const email = payload.email?.trim().toLowerCase();
    if (!email) return json({ error: 'El email es obligatorio.' }, 400);
    if (payload.role !== 'owner' && payload.role !== 'staff') {
      return json({ error: 'Rol inválido.' }, 400);
    }
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
      .insert({ user_id: userId, email, role: payload.role });

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
    if (payload.role !== 'owner' && payload.role !== 'staff') {
      return json({ error: 'Rol inválido.' }, 400);
    }
    if (payload.userId === callerId && payload.role !== 'owner') {
      return json({ error: 'No puedes quitarte tu propio rol de owner.' }, 400);
    }
    if (payload.role === 'staff' && (await ownerCount()) <= 1) {
      return json({ error: 'Debe quedar al menos un owner.' }, 400);
    }

    const { error } = await admin
      .from('admins')
      .update({ role: payload.role })
      .eq('user_id', payload.userId);

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (payload.action === 'remove') {
    if (payload.userId === callerId) {
      return json({ error: 'No puedes eliminar tu propio acceso.' }, 400);
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
