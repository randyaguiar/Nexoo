// Abre la pasarela de pago de un pedido ya creado, con la que esté activa.
//
// El pedido se crea antes (create_order reserva el stock) y nace como
// PendingPayment; esta función solo abre el cobro. El importe y las líneas se
// leen de la base de datos, nunca del navegador: si vinieran del cliente se
// podría pagar un pedido de 300 USD por 1.
//
// Cuál de las dos pasarelas se usa lo decide `payment_settings.provider`, que
// se cambia desde el panel. El pedido siempre está en dólares; TropiPay cobra
// en euros, así que se convierte aquí y se guarda con qué cambio.
//
// Secrets: SITE_URL; STRIPE_SECRET_KEY para Stripe; TROPIPAY_CLIENT_ID,
// TROPIPAY_CLIENT_SECRET, TROPIPAY_API_URL y TROPIPAY_REASON_ID para TropiPay
// (y los SUPABASE_* que Supabase inyecta).

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

interface OrderItemRow {
  product_name: string;
  quantity: number;
  unit_price: number;
}

interface OrderRow {
  id: string;
  status: string;
  total_usd: number;
  buyer_email: string;
  order_items: OrderItemRow[];
}

/** Lo que las dos ramas tienen que devolver para poder guardar el cobro igual. */
interface Opened {
  url: string;
  reference: string;
  currency: string;
  amount: number;
  fxRate: number;
}

// Service role: la función lee el pedido de un comprador sin sesión.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const shortRef = (id: string): string => id.replaceAll('-', '').slice(0, 8).toUpperCase();

/** Stripe: una Checkout Session con una línea por producto, en dólares. */
async function openStripe(order: OrderRow, siteUrl: string): Promise<Opened> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Falta STRIPE_SECRET_KEY');

  const params = new URLSearchParams({
    mode: 'payment',
    'payment_intent_data[metadata][order_id]': order.id,
    'metadata[order_id]': order.id,
    customer_email: order.buyer_email,
    success_url: `${siteUrl}/pedido/${order.id}?pago=ok`,
    cancel_url: `${siteUrl}/pedido/${order.id}?pago=cancelado`,
  });

  // Stripe trabaja en centavos: los decimales redondean hacia el céntimo exacto.
  order.order_items.forEach((item, i) => {
    params.set(`line_items[${i}][quantity]`, String(item.quantity));
    params.set(`line_items[${i}][price_data][currency]`, 'usd');
    params.set(`line_items[${i}][price_data][product_data][name]`, item.product_name);
    params.set(
      `line_items[${i}][price_data][unit_amount]`,
      String(Math.round(Number(item.unit_price) * 100)),
    );
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Si el comprador pulsa dos veces, Stripe devuelve la misma sesión en
      // lugar de abrir dos cobros para el mismo pedido.
      'Idempotency-Key': `order-${order.id}`,
    },
    body: params,
  });

  if (!response.ok) {
    console.error('Stripe falló:', response.status, await response.text());
    throw new Error('No se pudo abrir la pasarela de pago.');
  }

  const session = (await response.json()) as { id: string; url: string };
  return {
    url: session.url,
    reference: session.id,
    currency: 'USD',
    amount: Number(order.total_usd),
    fxRate: 1,
  };
}

/**
 * Los permisos que se marcan al crear la API key en TropiPay ("Inbound
 * Transfers" y "Allow external charge"), que es el mínimo para crear un enlace
 * de cobro y recibir el dinero. Si el login los rechaza se reintenta sin pedir
 * ninguno: los nombres exactos no están documentados y la clave ya los lleva.
 */
const TROPIPAY_SCOPES = ['ALLOW_PAYMENT_IN', 'ALLOW_EXTERNAL_CHARGE'];

/**
 * El bearer con el que se llama a TropiPay.
 *
 * Su documentación pública no explica la autenticación: en un ejemplo usa una
 * clave fija al estilo Stripe (`Bearer sk_test_…`) y en otros sitios habla de un
 * token que caduca. Se admiten las dos formas, así que basta con guardar en
 * TROPIPAY_CLIENT_SECRET lo que den: si ya es una clave de API se manda tal
 * cual, y si no se canjea por un token.
 */
async function tropipayToken(
  base: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (clientSecret.startsWith('sk_') || clientSecret.startsWith('pk_')) return clientSecret;

  const login = (scopes: string[] | null) =>
    fetch(`${base}/api/v3/access/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        scopes
          ? { client_id: clientId, client_secret: clientSecret, scopes }
          : { client_id: clientId, client_secret: clientSecret },
      ),
    });

  let auth = await login(TROPIPAY_SCOPES);
  if (!auth.ok) {
    await auth.body?.cancel();
    auth = await login(null);
  }

  if (!auth.ok) {
    console.error('TropiPay rechazó las credenciales:', auth.status, await auth.text());
    return null;
  }

  const body = (await auth.json()) as { access_token?: string; token?: string };
  return body.access_token ?? body.token ?? null;
}

/**
 * TropiPay: un "paymentcard", que es su nombre para un enlace de cobro. Cobra
 * en euros, así que el total del pedido se convierte con el cambio guardado en
 * `payment_settings` y ese mismo cambio se anota en el pedido: lo que se le
 * paga al negocio se sigue calculando en dólares.
 */
async function openTropipay(order: OrderRow, siteUrl: string, eurPerUsd: number): Promise<Opened> {
  const base = (Deno.env.get('TROPIPAY_API_URL') ?? 'https://sandbox.tropipay.me').replace(/\/+$/, '');
  const clientId = Deno.env.get('TROPIPAY_CLIENT_ID');
  const clientSecret = Deno.env.get('TROPIPAY_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Faltan las credenciales de TropiPay');

  const token = await tropipayToken(base, clientId, clientSecret);
  if (!token) throw new Error('No se pudo autenticar contra TropiPay');

  const eur = Number((Number(order.total_usd) * eurPerUsd).toFixed(2));
  const reasonId = Number(Deno.env.get('TROPIPAY_REASON_ID') ?? '4');
  const accountId = Deno.env.get('TROPIPAY_ACCOUNT_ID');

  const body: Record<string, unknown> = {
    // La referencia es el id del pedido: es con lo que el webhook sabe a qué
    // pedido corresponde el cobro.
    reference: order.id,
    concept: `Nexoo ${shortRef(order.id)}`,
    description: `Pedido ${shortRef(order.id)} en Nexoo`,
    // TropiPay trabaja en céntimos, igual que Stripe.
    amount: Math.round(eur * 100),
    currency: 'EUR',
    // Un enlace, un cobro: evita que el mismo pedido se pague dos veces.
    singleUse: true,
    reasonId,
    lang: 'es',
    urlSuccess: `${siteUrl}/pedido/${order.id}?pago=ok`,
    urlFailed: `${siteUrl}/pedido/${order.id}?pago=cancelado`,
    urlNotification: `${Deno.env.get('SUPABASE_URL')}/functions/v1/tropipay-webhook`,
    // No se manda `client`: TropiPay exige el objeto entero si se manda —con
    // fecha de nacimiento incluida— y esos datos no se piden en el checkout.
    // Los recoge su propia página.
    paymentMethods: ['EXT'],
  };

  if (accountId) body.accountId = Number(accountId);

  const response = await fetch(`${base}/api/v3/paymentcards`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    console.error('TropiPay falló:', response.status, await response.text());
    throw new Error('No se pudo abrir la pasarela de pago.');
  }

  const card = (await response.json()) as {
    id?: string;
    shortUrl?: string;
    paymentUrl?: string;
    rawUrlPayment?: string;
  };

  const url = card.shortUrl ?? card.paymentUrl ?? card.rawUrlPayment;
  if (!url || !card.id) {
    console.error('TropiPay no devolvió enlace de pago:', JSON.stringify(card));
    throw new Error('No se pudo abrir la pasarela de pago.');
  }

  return { url, reference: card.id, currency: 'EUR', amount: eur, fxRate: eurPerUsd };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const siteUrl = Deno.env.get('SITE_URL');
  if (!siteUrl) {
    console.error('Falta SITE_URL');
    return json({ error: 'El cobro no está configurado.' }, 500);
  }

  const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId) return json({ error: 'Falta el pedido.' }, 400);

  const [{ data, error }, { data: settings }] = await Promise.all([
    admin
      .from('orders')
      .select('id, status, total_usd, buyer_email, order_items(product_name, quantity, unit_price)')
      .eq('id', orderId)
      .maybeSingle(),
    admin.from('payment_settings').select('provider, eur_per_usd').eq('id', true).maybeSingle(),
  ]);

  if (error) {
    console.error('No se pudo leer el pedido:', error.message);
    return json({ error: 'No se pudo preparar el pago.' }, 500);
  }

  const order = data as OrderRow | null;
  if (!order) return json({ error: 'El pedido no existe.' }, 404);

  // Un pedido ya pagado no se vuelve a cobrar.
  if (order.status !== 'PendingPayment') {
    return json({ error: 'Ese pedido ya no está pendiente de pago.' }, 409);
  }

  // Sin fila de ajustes se cobra con Stripe, que es como estaba antes.
  const provider = settings?.provider === 'tropipay' ? 'tropipay' : 'stripe';
  const eurPerUsd = Number(settings?.eur_per_usd ?? 0.92);

  let opened: Opened;
  try {
    opened =
      provider === 'tropipay'
        ? await openTropipay(order, siteUrl, eurPerUsd)
        : await openStripe(order, siteUrl);
  } catch (e) {
    console.error('No se pudo abrir el cobro con', provider, (e as Error).message);
    return json({ error: 'No se pudo abrir la pasarela de pago.' }, 502);
  }

  const { error: saveError } = await admin
    .from('orders')
    .update({
      payment_provider: provider,
      payment_reference: opened.reference,
      charged_currency: opened.currency,
      charged_amount: opened.amount,
      fx_rate: opened.fxRate,
    })
    .eq('id', order.id);

  // Guardar el cobro abierto es para poder reanudarlo y para que el webhook
  // sepa con qué pasarela se abrió; si falla, el cobro puede seguir su curso
  // igual, así que solo se registra.
  if (saveError) console.error('No se pudo guardar el cobro abierto:', saveError.message);

  return json({ url: opened.url });
});
