// TropiPay avisa aquí cuando un cobro se completa, y el pedido pasa a Paid.
//
// A diferencia de Stripe, aquí **no se confía en el cuerpo del aviso**. Stripe
// firma los suyos con un HMAC que se puede comprobar; del esquema de firma de
// TropiPay no hay documentación suficiente, así que el aviso se trata solo como
// un empujón: lo único que hace es decirnos qué cobro mirar. Después se vuelve
// a leer ese cobro contra la API de TropiPay con nuestras credenciales, y solo
// lo que diga esa lectura cuenta. Un aviso falsificado no puede dar por pagado
// nada, porque el que responde es TropiPay.
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

interface Paymentcard {
  id: string;
  reference: string | null;
  state: number | null;
  amount: number | null;
  currency: string | null;
  bankOrderCode: string | null;
}

async function token(): Promise<string | null> {
  const clientId = Deno.env.get('TROPIPAY_CLIENT_ID');
  const clientSecret = Deno.env.get('TROPIPAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  const response = await fetch(`${base}/api/v3/access/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      scopes: ['ALLOW_GET_PROFILE_DATA', 'ALLOW_PAYMENT_IN'],
    }),
  });

  if (!response.ok) {
    console.error('TropiPay rechazó las credenciales:', response.status, await response.text());
    return null;
  }

  const { access_token } = (await response.json()) as { access_token?: string };
  return access_token ?? null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Del aviso solo se usa el identificador: el resto no se mira.
  const cardId = String(payload.id ?? payload.paymentcardId ?? payload.reference ?? '');
  if (!cardId) {
    console.error('Aviso de TropiPay sin identificador:', JSON.stringify(payload));
    return new Response('missing id', { status: 200 });
  }

  const auth = await token();
  if (!auth) return new Response('not configured', { status: 500 });

  const response = await fetch(`${base}/api/v3/paymentcards/${cardId}`, {
    headers: { Authorization: `Bearer ${auth}`, Accept: 'application/json' },
  });

  if (!response.ok) {
    console.error('No se pudo leer el cobro', cardId, response.status, await response.text());
    // 500 para que TropiPay lo reintente: puede ser un fallo pasajero suyo.
    return new Response('retry', { status: 500 });
  }

  const card = (await response.json()) as Paymentcard;
  const orderId = card.reference;

  if (!orderId) {
    console.error('El cobro', cardId, 'no trae referencia de pedido');
    return new Response('missing order', { status: 200 });
  }

  // Qué valor de `state` significa "pagado" no está documentado, así que no se
  // adivina: sin TROPIPAY_PAID_STATES la función no marca nada y deja el valor
  // en el log. Se mira una vez en sandbox, se guarda el secret y ya queda.
  const paidStates = (Deno.env.get('TROPIPAY_PAID_STATES') ?? '')
    .split(',')
    .map((state: string) => state.trim())
    .filter(Boolean);

  if (paidStates.length === 0) {
    console.error(
      `TROPIPAY_PAID_STATES no está configurada. El cobro ${cardId} del pedido ${orderId} ` +
        `vino con state=${card.state}. Si ese es el estado de un cobro pagado, guarda ` +
        `TROPIPAY_PAID_STATES=${card.state} y el pedido se marcará solo la próxima vez.`,
    );
    return new Response('not calibrated', { status: 200 });
  }

  if (!paidStates.includes(String(card.state))) {
    console.log('Cobro', cardId, 'todavía no pagado: state =', card.state);
    return new Response(JSON.stringify({ orderId, state: card.state, updated: false }), {
      status: 200,
    });
  }

  // El importe lo fijamos nosotros al abrir el cobro; si no coincide, algo no
  // cuadra y es mejor mirarlo a mano que dar por bueno un pedido.
  const { data: order } = await admin
    .from('orders')
    .select('charged_amount, charged_currency, fx_rate')
    .eq('id', orderId)
    .maybeSingle();

  const expected = order ? Math.round(Number(order.charged_amount) * 100) : null;
  if (expected !== null && card.amount !== null && Number(card.amount) !== expected) {
    console.error(
      `Importe distinto en el pedido ${orderId}: esperábamos ${expected} y TropiPay dice ${card.amount}`,
    );
    return new Response('amount mismatch', { status: 200 });
  }

  const { data, error } = await admin.rpc('mark_order_paid', {
    p_order_id: orderId,
    p_provider: 'tropipay',
    p_charge_id: card.bankOrderCode ?? card.id,
    p_currency: card.currency ?? order?.charged_currency ?? 'EUR',
    p_amount: card.amount !== null ? Number(card.amount) / 100 : (order?.charged_amount ?? null),
    p_fx_rate: order?.fx_rate ?? null,
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
