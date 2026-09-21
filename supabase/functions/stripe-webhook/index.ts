// Stripe avisa aquí cuando un cobro se completa, y el pedido pasa a Paid.
//
// Es el único camino por el que un pedido se da por pagado: volver del checkout
// a la web no prueba nada (el comprador puede escribir esa URL a mano), y por
// eso la página de confirmación solo muestra lo que diga la base de datos.
//
// Secrets: STRIPE_WEBHOOK_SECRET (y los SUPABASE_* que Supabase inyecta).
// verify_jwt = false: Stripe no manda un JWT, manda su propia firma.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

/**
 * Comprueba la firma de Stripe: `t=<momento>,v1=<hmac>` sobre `<t>.<cuerpo>`.
 * Sin esto, cualquiera que conozca la URL podría declarar pagados los pedidos.
 */
async function signatureIsValid(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...rest] = p.split('=');
      return [k.trim(), rest.join('=')];
    }),
  );

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Una firma vieja es una repetición: Stripe recomienda no aceptarla.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Comparación de tiempo constante: una comparación normal filtra por dónde
  // deja de coincidir y permite reconstruir la firma byte a byte.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

interface StripeEvent {
  type: string;
  data: {
    object: {
      id: string;
      payment_intent?: string;
      metadata?: { order_id?: string };
    };
  };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    console.error('Falta STRIPE_WEBHOOK_SECRET');
    return new Response('not configured', { status: 500 });
  }

  const payload = await request.text();

  if (!(await signatureIsValid(payload, request.headers.get('Stripe-Signature'), secret))) {
    console.error('Firma de Stripe inválida');
    return new Response('invalid signature', { status: 400 });
  }

  const event = JSON.parse(payload) as StripeEvent;

  // Los demás eventos se aceptan sin hacer nada: devolver un error haría que
  // Stripe reintentara indefinidamente algo que no nos interesa.
  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ ignored: event.type }), { status: 200 });
  }

  const session = event.data.object;
  const orderId = session.metadata?.order_id;

  if (!orderId) {
    console.error('Sesión sin order_id en metadata:', session.id);
    return new Response('missing order', { status: 200 });
  }

  // mark_order_paid solo actúa sobre un pedido pendiente, así que el reintento
  // de Stripe sobre un evento ya procesado no vuelve a cambiar nada.
  const { data, error } = await admin.rpc('mark_order_paid', {
    p_order_id: orderId,
    p_payment_intent: session.payment_intent ?? null,
  });

  if (error) {
    console.error('No se pudo marcar el pedido como pagado:', error.message);
    // 500 para que Stripe lo reintente: el cobro ya se hizo y el pedido tiene
    // que acabar en Paid.
    return new Response('retry', { status: 500 });
  }

  // Los correos solo cuando el pedido acaba de pasar a Paid: en un reintento de
  // Stripe `mark_order_paid` devuelve false y no se repiten. Un fallo aquí no
  // puede tumbar el webhook —el cobro ya está hecho—, así que solo se registra.
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
