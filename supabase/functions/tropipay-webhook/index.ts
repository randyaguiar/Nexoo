// TropiPay avisa aquí cuando un cobro cambia de estado, y el pedido pasa a Paid.
//
// El aviso viene firmado con nuestro client secret, y esa firma es lo único que
// decide si se le hace caso: sha256(bankOrderCode + clientId + clientSecret +
// importe), en hexadecimal. Sin el secret no se puede fabricar, así que un
// aviso inventado —por ejemplo el del propio comprador, que conoce el id de su
// pedido porque está en su URL— no puede dar nada por pagado. Si la firma no
// cuadra, el pedido se queda como está y queda el aviso entero en el log.
//
// Secrets: TROPIPAY_CLIENT_ID, TROPIPAY_CLIENT_SECRET, TROPIPAY_PAID_STATES
// (y los SUPABASE_* que Supabase inyecta).
// verify_jwt = false: TropiPay no manda un JWT.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

/**
 * Los estados en los que se da el cobro por hecho.
 *
 * El 5 es el que manda TropiPay cuando la tarjeta ya se ha cobrado: el aviso
 * trae el cargo con los datos de la tarjeta y sin error, y el importe aparece
 * en el panel con su comisión descontada. Que el panel lo siga enseñando como
 * "Pendiente" es la liquidación al saldo, no el cobro —lo mismo que con Stripe,
 * donde el pedido se da por pagado aunque el dinero tarde días en llegar—.
 *
 * Se puede cambiar sin tocar código con TROPIPAY_PAID_STATES (varios separados
 * por comas) si algún día usan otro número.
 */
const PAID_STATES = (Deno.env.get('TROPIPAY_PAID_STATES') ?? '5')
  .split(',')
  .map((value: string) => value.trim())
  .filter(Boolean);

/** Los estados legibles, por si algún aviso trae `stateStr` en vez del número. */
const PAID_STATE_NAMES = ['completed', 'complete', 'paid', 'success'];

/**
 * El aviso. Todo cuelga de `data`: `reference` es el id del pedido que le dimos
 * al abrir el cobro, `amount` el importe en céntimos que cobramos, y las tres
 * `signature*` son la misma firma en distintas versiones de su esquema.
 */
interface Callback {
  status?: string;
  data?: {
    id?: number | string | null;
    reference?: string | null;
    state?: number | null;
    stateStr?: string | null;
    bankOrderCode?: string | null;
    amount?: number | null;
    currency?: string | null;
    originalCurrencyAmount?: number | string | null;
    destinationAmount?: number | string | null;
    signature?: string | null;
    signaturev2?: string | null;
    signaturev3?: string | null;
  };
}

/** sha256 en hexadecimal, que es como firma TropiPay. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Si el aviso lo firmó TropiPay. Manda tres firmas y no dice cuál corresponde a
 * qué importe, así que se prueban todas las combinaciones: basta con que una
 * cuadre, porque para fabricar cualquiera de ellas hace falta el client secret.
 */
async function signedByTropipay(
  signatures: (string | null | undefined)[],
  bankOrderCode: string | null | undefined,
  amounts: (number | string | null | undefined)[],
): Promise<boolean> {
  const clientId = Deno.env.get('TROPIPAY_CLIENT_ID');
  const clientSecret = Deno.env.get('TROPIPAY_CLIENT_SECRET');
  if (!bankOrderCode || !clientId || !clientSecret) return false;

  const theirs = signatures.filter(Boolean) as string[];
  if (theirs.length === 0) return false;

  for (const amount of amounts) {
    if (amount === null || amount === undefined) continue;
    const mine = await sha256(`${bankOrderCode}${clientId}${clientSecret}${amount}`);
    if (theirs.includes(mine)) return true;
  }

  return false;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const payload = (await request.json().catch(() => ({}))) as Callback;
  const notice = payload.data ?? {};

  // El aviso entero al log: es el único sitio donde se ve qué manda TropiPay.
  console.log('Aviso de TropiPay:', JSON.stringify(payload));

  const orderId = notice.reference ?? null;
  if (!orderId) {
    console.error('Aviso de TropiPay sin referencia de pedido');
    return new Response('missing reference', { status: 200 });
  }

  const { data: order } = await admin
    .from('orders')
    .select('charged_amount, charged_currency, fx_rate')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    console.error('Aviso de un pedido que no existe:', orderId);
    return new Response('unknown order', { status: 200 });
  }

  const expected = Math.round(Number(order.charged_amount) * 100);

  const signed = await signedByTropipay(
    [notice.signature, notice.signaturev2, notice.signaturev3],
    notice.bankOrderCode,
    [notice.originalCurrencyAmount, notice.amount, notice.destinationAmount, expected],
  );

  if (!signed) {
    // Sin firma válida no se toca el pedido: el id del pedido lo conoce
    // cualquiera que haya comprado, así que el aviso por sí solo no prueba nada.
    console.error(`Firma no válida en el aviso del pedido ${orderId}; el pedido no se toca`);
    return new Response('bad signature', { status: 200 });
  }

  const paid = notice.stateStr
    ? PAID_STATE_NAMES.includes(notice.stateStr.toLowerCase())
    : PAID_STATES.includes(String(notice.state));

  if (!paid) {
    console.log(`Pedido ${orderId} todavía no pagado: state=${notice.state}`);
    return new Response(JSON.stringify({ orderId, state: notice.state, updated: false }), {
      status: 200,
    });
  }

  // El importe lo fijamos nosotros al abrir el cobro; si no coincide, algo no
  // cuadra y es mejor mirarlo a mano que dar por bueno un pedido. `amount` es
  // lo cobrado; `destinationAmount` es lo que queda después de su comisión.
  if (notice.amount !== null && notice.amount !== undefined && Number(notice.amount) !== expected) {
    console.error(
      `Importe distinto en el pedido ${orderId}: esperábamos ${expected} y TropiPay dice ${notice.amount}`,
    );
    return new Response('amount mismatch', { status: 200 });
  }

  const { data, error } = await admin.rpc('mark_order_paid', {
    p_order_id: orderId,
    p_provider: 'tropipay',
    p_charge_id: notice.bankOrderCode ?? String(notice.id ?? ''),
    p_currency: notice.currency ?? order.charged_currency ?? 'EUR',
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
