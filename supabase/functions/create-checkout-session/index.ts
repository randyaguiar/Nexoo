// Abre la sesión de pago de Stripe para un pedido ya creado.
//
// El pedido se crea antes (create_order reserva el stock) y nace como
// PendingPayment; esta función solo abre el cobro. El importe y las líneas se
// leen de la base de datos, nunca del navegador: si vinieran del cliente se
// podría pagar un pedido de 300 USD por 1.
//
// Secrets: STRIPE_SECRET_KEY, SITE_URL (y los SUPABASE_* que Supabase inyecta).

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
  stripe_session_id: string | null;
  order_items: OrderItemRow[];
}

// Service role: la función lee el pedido de un comprador sin sesión.
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const siteUrl = Deno.env.get('SITE_URL');
  if (!stripeKey || !siteUrl) {
    console.error('Faltan STRIPE_SECRET_KEY o SITE_URL');
    return json({ error: 'El cobro no está configurado.' }, 500);
  }

  const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId) return json({ error: 'Falta el pedido.' }, 400);

  const { data, error } = await admin
    .from('orders')
    .select('id, status, total_usd, buyer_email, stripe_session_id, order_items(product_name, quantity, unit_price)')
    .eq('id', orderId)
    .maybeSingle();

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

  // Stripe trabaja en centavos: los decimales redondean hacia el céntimo exacto.
  const params = new URLSearchParams({
    mode: 'payment',
    'payment_intent_data[metadata][order_id]': order.id,
    'metadata[order_id]': order.id,
    customer_email: order.buyer_email,
    success_url: `${siteUrl}/pedido/${order.id}?pago=ok`,
    cancel_url: `${siteUrl}/pedido/${order.id}?pago=cancelado`,
  });

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
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Si el comprador pulsa dos veces, Stripe devuelve la misma sesión en
      // lugar de abrir dos cobros para el mismo pedido.
      'Idempotency-Key': `order-${order.id}`,
    },
    body: params,
  });

  if (!response.ok) {
    console.error('Stripe falló:', response.status, await response.text());
    return json({ error: 'No se pudo abrir la pasarela de pago.' }, 502);
  }

  const session = (await response.json()) as { id: string; url: string };

  const { error: saveError } = await admin
    .from('orders')
    .update({ stripe_session_id: session.id })
    .eq('id', order.id);

  // Guardar la sesión es para poder reanudar el pago; si falla, el cobro puede
  // seguir su curso igual, así que solo se registra.
  if (saveError) console.error('No se pudo guardar la sesión:', saveError.message);

  return json({ url: session.url });
});
