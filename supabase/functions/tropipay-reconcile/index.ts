// Repasa los pedidos que siguen esperando cobro y le pregunta a TropiPay qué
// pasó con cada uno.
//
// El aviso de pago puede perderse: un despliegue a destiempo, un fallo de red,
// un error nuestro. Cuando eso ocurre el pedido se queda en pendiente aunque la
// tarjeta se haya cobrado, y no hay forma de enterarse hasta que el comprador
// reclama. Esto es la red de seguridad: se consulta el movimiento por nuestra
// propia referencia —el id del pedido— y, si TropiPay dice que está cobrado, se
// marca igual que lo habría marcado el aviso, correos incluidos.
//
// La llama el owner desde Admin → Pagos. También sirve para un cron.
//
// Secrets: TROPIPAY_CLIENT_ID, TROPIPAY_CLIENT_SECRET, TROPIPAY_API_URL
// (y los SUPABASE_* que Supabase inyecta).
// La API key necesita además el permiso de lectura de movimientos.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const base = (Deno.env.get('TROPIPAY_API_URL') ?? 'https://sandbox.tropipay.me').replace(/\/+$/, '');

/** Los estados de un movimiento que significan que el dinero entró. */
const PAID_MOVEMENT_STATES = ['completed'];

interface PendingOrder {
  id: string;
  reference: string | null;
  charged_amount: number | null;
  created_at: string;
}

interface Movement {
  id?: number;
  amount?: number | null;
  currency?: string | null;
  state?: string | null;
  reference?: string | null;
}

/** Solo el owner repasa cobros: aquí se marcan pedidos como pagados. */
async function callerIsOwner(authorization: string | null): Promise<boolean> {
  if (!authorization) return false;

  const { data, error } = await admin.auth.getUser(authorization.replace(/^Bearer /i, ''));
  if (error || !data.user) return false;

  const { data: row } = await admin
    .from('admins')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle();

  return row?.role === 'owner';
}

/**
 * Autenticación contra TropiPay: la v3 documentada y, si falla, la v2. Igual
 * que en `create-checkout-session`, y por el mismo motivo: en el sandbox no
 * siempre contestan las dos.
 */
async function token(): Promise<{ token: string; version: 'v2' | 'v3' } | null> {
  const clientId = Deno.env.get('TROPIPAY_CLIENT_ID');
  const clientSecret = Deno.env.get('TROPIPAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  if (clientSecret.startsWith('sk_') || clientSecret.startsWith('pk_')) {
    return { token: clientSecret, version: 'v3' };
  }

  const attempts = [
    {
      version: 'v3' as const,
      path: '/api/v3/access/token',
      body: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
    },
    {
      version: 'v2' as const,
      path: '/api/v2/access/token',
      body: {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'ALLOW_PAYMENT_IN ALLOW_EXTERNAL_CHARGE ALLOW_GET_MOVEMENT_LIST',
      },
    },
  ];

  for (const attempt of attempts) {
    const response = await fetch(`${base}${attempt.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(attempt.body),
    });

    if (!response.ok) {
      console.error('TropiPay rechazó las credenciales en', attempt.path, response.status, await response.text());
      continue;
    }

    const body = (await response.json()) as { access_token?: string; token?: string };
    const bearer = body.access_token ?? body.token;
    if (bearer) return { token: bearer, version: attempt.version };
  }

  return null;
}

/**
 * Los movimientos recientes de la cuenta.
 *
 * Sin filtro: su parámetro `query` rechaza la clave `reference` —"Filter key
 * 'undefined' is not allowed"— y la sintaxis que sí acepta no está
 * documentada. Se piden las últimas páginas y se cruzan aquí las referencias,
 * que además ahorra una llamada por pedido.
 */
async function recentMovements(
  auth: { token: string; version: 'v2' | 'v3' },
  pages = 3,
): Promise<Movement[] | null> {
  const all: Movement[] = [];

  for (let page = 0; page < pages; page++) {
    const response = await fetch(
      `${base}/api/${auth.version}/movements/?limit=50&offset=${page * 50}`,
      { headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' } },
    );

    if (!response.ok) {
      console.error('No se pudieron leer los movimientos', response.status, await response.text());
      return all.length > 0 ? all : null;
    }

    const body = (await response.json()) as { items?: Movement[] } | Movement[];
    const items = Array.isArray(body) ? body : (body.items ?? []);

    if (page === 0) {
      // Qué trae cada movimiento no está claro en su documentación, y hace
      // falta para cruzarlos. Solo los nombres de los campos: dentro van datos
      // de clientes.
      console.log(
        'Movimientos:', items.length,
        'campos =', items[0] ? Object.keys(items[0]).join(',') : 'ninguno',
      );
    }

    all.push(...items);
    if (items.length < 50) break;
  }

  return all;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!(await callerIsOwner(request.headers.get('Authorization')))) {
    return json({ error: 'Solo el administrador general puede repasar los cobros.' }, 403);
  }

  const { data: pending, error } = await admin.rpc('orders_awaiting_payment', {
    p_provider: 'tropipay',
    p_max: 50,
  });

  if (error) {
    console.error('No se pudieron leer los pedidos pendientes:', error.message);
    return json({ error: 'No se pudieron leer los pedidos pendientes.' }, 500);
  }

  const orders = (pending ?? []) as PendingOrder[];
  if (orders.length === 0) return json({ checked: 0, paid: 0, orders: [] });

  const auth = await token();
  if (!auth) return json({ error: 'No se pudo autenticar contra TropiPay.' }, 502);

  const movements = await recentMovements(auth);
  if (!movements) return json({ error: 'No se pudieron leer los movimientos de TropiPay.' }, 502);

  const updated: string[] = [];

  for (const order of orders) {
    // Lo que ata el movimiento a este pedido es la referencia, que es su id.
    const movement = movements.find((item) => item.reference === order.id);
    if (!movement) continue;

    const state = (movement.state ?? '').toLowerCase();
    if (!PAID_MOVEMENT_STATES.includes(state)) {
      console.log(`Pedido ${order.id}: TropiPay lo da como "${state}", se deja pendiente`);
      continue;
    }

    // El importe tiene que ser el que abrimos nosotros; si no, es mejor que lo
    // mire una persona que dar por bueno un cobro que no cuadra.
    const expected = Math.round(Number(order.charged_amount) * 100);
    if (movement.amount !== null && movement.amount !== undefined && Number(movement.amount) !== expected) {
      console.error(
        `Importe distinto en el pedido ${order.id}: esperábamos ${expected} y TropiPay dice ${movement.amount}`,
      );
      continue;
    }

    const { data: marked, error: markError } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'tropipay',
      p_charge_id: String(movement.id ?? ''),
      p_currency: movement.currency ?? 'EUR',
      p_amount: Number(order.charged_amount),
      p_fx_rate: null,
      p_order_code: null,
    });

    if (markError) {
      console.error('No se pudo marcar el pedido', order.id, markError.message);
      continue;
    }

    if (marked === true) {
      updated.push(order.id);
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-order-paid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId: order.id }),
      });
      if (!response.ok) {
        console.error('No se pudieron mandar los correos:', response.status, await response.text());
      }
    }
  }

  console.log(`Repaso de cobros: ${orders.length} pendientes, ${updated.length} marcados como pagados`);
  return json({ checked: orders.length, paid: updated.length, orders: updated });
});
