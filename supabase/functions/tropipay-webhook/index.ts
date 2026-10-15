// TropiPay avisa aquí cuando un cobro cambia de estado, y el pedido pasa a Paid.
//
// El aviso no se cree por venir: trae una firma HMAC-SHA256 hecha con nuestro
// client secret —sha256(bankOrderCode + clientId + clientSecret + importe)—,
// que es lo que demuestra que viene de TropiPay. Si la firma cuadra, el estado
// del aviso vale. Si no, se vuelve a leer el cobro contra su API con nuestras
// credenciales y solo cuenta lo que diga esa lectura. Si ninguna de las dos
// cosas confirma el cobro, el pedido se queda como está: aquí se falla cerrado.
//
// Secrets: TROPIPAY_CLIENT_ID, TROPIPAY_CLIENT_SECRET, TROPIPAY_API_URL,
// TROPIPAY_PAID_STATES (y los SUPABASE_* que Supabase inyecta).
// verify_jwt = false: TropiPay no manda un JWT.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const base = (Deno.env.get('TROPIPAY_API_URL') ?? 'https://sandbox.tropipay.me').replace(/\/+$/, '');

/** El cobro tal y como lo devuelve su API al volver a leerlo. */
interface Paymentcard {
  id: string;
  reference: string | null;
  state: number | null;
  stateStr: string | null;
  amount: number | null;
  currency: string | null;
  bankOrderCode: string | null;
}

/**
 * El aviso. Lo que importa viene dentro de `data`: `reference` es el id del
 * pedido que le dimos al abrir el cobro y `stateStr` el estado legible
 * ("processing", "completed", "failed"...).
 */
interface Callback {
  signature?: string;
  event_name?: string;
  data?: {
    id?: number | string | null;
    reference?: string | null;
    state?: number | null;
    stateStr?: string | null;
    bankOrderCode?: string | null;
    destinationAmount?: number | string | null;
    originalCurrencyAmount?: number | string | null;
  };
}

/**
 * Los permisos que se marcan al crear la API key en TropiPay ("Transferencias
 * Entrada" y "Recarga externa").
 */
const TROPIPAY_SCOPES = ['ALLOW_PAYMENT_IN', 'ALLOW_EXTERNAL_CHARGE'];

/** El bearer y la versión de la API que lo aceptó: las rutas van emparejadas. */
interface TropipayAuth {
  token: string;
  version: 'v2' | 'v3';
}

/**
 * Autenticación contra TropiPay. Igual que en `create-checkout-session`: la
 * documentación pública no cuadra con lo que responde el servidor, así que se
 * prueban la forma documentada (v3) y la del SDK de la comunidad (v2, OAuth
 * `client_credentials`), y la que conteste manda en el resto de llamadas.
 */
async function token(): Promise<TropipayAuth | null> {
  const clientId = Deno.env.get('TROPIPAY_CLIENT_ID');
  const clientSecret = Deno.env.get('TROPIPAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  if (clientSecret.startsWith('sk_') || clientSecret.startsWith('pk_')) {
    return { token: clientSecret, version: 'v3' };
  }

  const attempts = [
    {
      version: 'v3' as const,
      path: '/api/v3/access/login',
      body: { client_id: clientId, client_secret: clientSecret, scopes: TROPIPAY_SCOPES },
    },
    {
      version: 'v2' as const,
      path: '/api/v2/access/token',
      body: {
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: TROPIPAY_SCOPES.join(' '),
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
      console.error(
        'TropiPay rechazó las credenciales en',
        attempt.path,
        response.status,
        await response.text(),
      );
      continue;
    }

    const body = (await response.json()) as { access_token?: string; token?: string };
    const bearer = body.access_token ?? body.token;
    if (bearer) return { token: bearer, version: attempt.version };

    console.error('TropiPay no devolvió token en', attempt.path);
  }

  return null;
}

/** sha256 en hexadecimal, que es como firma TropiPay. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * La firma del aviso: sha256(bankOrderCode + clientId + clientSecret + importe).
 * Cuál de los importes del aviso entra en la cuenta no está claro, así que se
 * prueban los candidatos; con que uno cuadre, el aviso es auténtico, porque sin
 * el client secret no se puede fabricar.
 */
async function signatureIsOurs(
  signature: string | undefined,
  bankOrderCode: string | null | undefined,
  amounts: (number | string | null | undefined)[],
): Promise<boolean> {
  const clientId = Deno.env.get('TROPIPAY_CLIENT_ID');
  const clientSecret = Deno.env.get('TROPIPAY_CLIENT_SECRET');
  if (!signature || !bankOrderCode || !clientId || !clientSecret) return false;

  for (const amount of amounts) {
    if (amount === null || amount === undefined) continue;
    const mine = await sha256(`${bankOrderCode}${clientId}${clientSecret}${amount}`);
    if (mine === signature) return true;
  }

  return false;
}

/**
 * Si el estado dice "cobrado". `stateStr` es el estado legible y es lo que se
 * mira; el número solo se usa cuando no viene, y entonces hace falta
 * TROPIPAY_PAID_STATES, porque qué número significa pagado no está documentado.
 */
function isPaid(state: number | null | undefined, stateStr: string | null | undefined): boolean {
  if (stateStr) return ['completed', 'complete', 'paid', 'success'].includes(stateStr.toLowerCase());

  const paidStates = (Deno.env.get('TROPIPAY_PAID_STATES') ?? '')
    .split(',')
    .map((value: string) => value.trim())
    .filter(Boolean);

  return paidStates.length > 0 && paidStates.includes(String(state));
}

/** Vuelve a leer el cobro contra la API de TropiPay. */
async function readPaymentcard(cardId: string): Promise<Paymentcard | null> {
  const auth = await token();
  if (!auth) return null;

  const response = await fetch(`${base}/api/${auth.version}/paymentcards/${cardId}`, {
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
  });

  if (!response.ok) {
    console.error('No se pudo leer el cobro', cardId, response.status, await response.text());
    return null;
  }

  return (await response.json()) as Paymentcard;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const payload = (await request.json().catch(() => ({}))) as Callback;
  const notice = payload.data ?? {};

  // `reference` es lo que mandamos al abrir el cobro: el id del pedido.
  const orderId = notice.reference ?? null;
  if (!orderId) {
    console.error('Aviso de TropiPay sin referencia de pedido:', JSON.stringify(payload));
    return new Response('missing reference', { status: 200 });
  }

  const { data: order } = await admin
    .from('orders')
    .select('payment_reference, charged_amount, charged_currency, fx_rate')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    console.error('Aviso de un pedido que no existe:', orderId);
    return new Response('unknown order', { status: 200 });
  }

  const expected = Math.round(Number(order.charged_amount) * 100);

  // Primero la firma, que es barata y demuestra el origen del aviso.
  const signed = await signatureIsOurs(payload.signature, notice.bankOrderCode, [
    notice.destinationAmount,
    notice.originalCurrencyAmount,
    expected,
  ]);

  // Si no cuadra, lo que vale es lo que diga TropiPay cuando se le pregunta.
  const card = signed ? null : await readPaymentcard(order.payment_reference ?? String(notice.id));
  if (!signed && !card) {
    // 500 para que TropiPay lo reintente: puede ser un fallo pasajero suyo.
    console.error('Ni la firma cuadra ni se pudo releer el cobro del pedido', orderId);
    return new Response('retry', { status: 500 });
  }

  const state = card ? card.state : (notice.state ?? null);
  const stateStr = card ? card.stateStr : (notice.stateStr ?? null);

  if (!isPaid(state, stateStr)) {
    console.log(
      `Pedido ${orderId} todavía no pagado (firma ${signed ? 'ok' : 'no'}): ` +
        `state=${state} stateStr=${stateStr}. Si ese estado es el de un cobro completado, ` +
        'guarda TROPIPAY_PAID_STATES con ese número.',
    );
    return new Response(JSON.stringify({ orderId, state, stateStr, updated: false }), {
      status: 200,
    });
  }

  // El importe lo fijamos nosotros al abrir el cobro; si no coincide, algo no
  // cuadra y es mejor mirarlo a mano que dar por bueno un pedido.
  const charged = card?.amount ?? Number(notice.destinationAmount ?? expected);
  if (Number.isFinite(charged) && Number(charged) !== expected) {
    console.error(
      `Importe distinto en el pedido ${orderId}: esperábamos ${expected} y TropiPay dice ${charged}`,
    );
    return new Response('amount mismatch', { status: 200 });
  }

  const { data, error } = await admin.rpc('mark_order_paid', {
    p_order_id: orderId,
    p_provider: 'tropipay',
    p_charge_id: notice.bankOrderCode ?? card?.bankOrderCode ?? String(notice.id ?? ''),
    p_currency: card?.currency ?? order.charged_currency ?? 'EUR',
    p_amount: Number(order.charged_amount),
    p_fx_rate: order.fx_rate ?? null,
  });

  if (error) {
    console.error('No se pudo marcar el pedido como pagado:', error.message);
    // 500 para que TropiPay lo reintente: el cobro ya se hizo y el pedido tiene
    // que acabar en Paid.
    return new Response('retry', { status: 500 });
  }

  // Los correos solo cuando el pedido acaba de pasar a Paid: en un reintento
  // `mark_order_paid` devuelve false y no se repiten.
  if (data === true) {
    try {
      const { error: mailError } = await admin.functions.invoke('notify-order-paid', {
        body: { orderId },
      });
      if (mailError) console.error('No se pudieron mandar los correos:', mailError.message);
    } catch (e) {
      console.error('No se pudieron mandar los correos:', (e as Error).message);
    }
  }

  return new Response(JSON.stringify({ orderId, updated: data }), { status: 200 });
});
