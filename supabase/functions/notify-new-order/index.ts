// Aviso al admin cuando entra un pedido nuevo.
// Se dispara con un Database Webhook de Supabase: Database → Webhooks → INSERT en public.orders.
// Secrets necesarios: RESEND_API_KEY, ADMIN_EMAIL, FROM_EMAIL (y los SUPABASE_* que Supabase inyecta).

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface OrderRecord {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_province: string;
  recipient_municipality: string;
  recipient_address: string;
  business_id: string;
  total_usd: number;
  notes: string | null;
}

interface WebhookPayload {
  type: string;
  table: string;
  record: OrderRecord;
}

const PROVINCE_LABELS: Record<string, string> = {
  PinarDelRio: 'Pinar del Río',
  LaHabana: 'La Habana',
};

const shortRef = (id: string): string => id.replaceAll('-', '').slice(0, 8).toUpperCase();

Deno.serve(async (request: Request): Promise<Response> => {
  const payload = (await request.json()) as WebhookPayload;

  if (payload.type !== 'INSERT' || payload.table !== 'orders') {
    return new Response(JSON.stringify({ skipped: true }), { status: 200 });
  }

  const order = payload.record;

  // Service role: la función necesita leer los items y el negocio saltándose las policies.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const [{ data: items }, { data: business }] = await Promise.all([
    supabase
      .from('order_items')
      .select('product_name, quantity, unit_price')
      .eq('order_id', order.id),
    supabase.from('businesses').select('name').eq('id', order.business_id).single(),
  ]);

  const lines = (items ?? [])
    .map((i) => `  ${i.quantity} x ${i.product_name} @ ${i.unit_price} USD`)
    .join('\n');

  const province = PROVINCE_LABELS[order.recipient_province] ?? order.recipient_province;

  const body = [
    `Pedido: ${shortRef(order.id)} (${order.id})`,
    `Negocio: ${business?.name ?? order.business_id}`,
    `Total: ${order.total_usd} USD`,
    '',
    'Comprador (EE.UU.):',
    `  ${order.buyer_name} / ${order.buyer_email} / ${order.buyer_phone}`,
    '',
    'Destinatario (Cuba):',
    `  ${order.recipient_name} / ${order.recipient_phone}`,
    `  ${province}, ${order.recipient_municipality}`,
    `  ${order.recipient_address}`,
    '',
    'Productos:',
    lines,
    order.notes ? `\nNotas: ${order.notes}` : '',
  ].join('\n');

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    // Sin proveedor de email configurado el pedido ya está guardado: solo se registra.
    console.log('RESEND_API_KEY no configurada; aviso omitido:\n' + body);
    return new Response(JSON.stringify({ emailed: false }), { status: 200 });
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('FROM_EMAIL') ?? 'Nexoo <onboarding@resend.dev>',
      to: [Deno.env.get('ADMIN_EMAIL')!],
      subject: `Nexoo - nuevo pedido ${shortRef(order.id)} (${order.total_usd} USD)`,
      text: body,
    }),
  });

  if (!response.ok) {
    console.error('Resend falló:', response.status, await response.text());
    return new Response(JSON.stringify({ emailed: false }), { status: 200 });
  }

  return new Response(JSON.stringify({ emailed: true }), { status: 200 });
});
