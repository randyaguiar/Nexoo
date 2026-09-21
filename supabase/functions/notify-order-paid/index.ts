// Los tres correos de un pedido pagado: el aviso interno, la confirmación al
// comprador y la orden de preparación a la tienda.
//
// Se manda cuando Stripe confirma el cobro, no cuando se crea el pedido: un
// pedido nace como PendingPayment y puede no llegar a pagarse nunca. La llama
// `stripe-webhook` justo después de que `mark_order_paid` devuelva true, o sea
// una sola vez por pedido aunque Stripe reintente el evento.
//
// Cada destinatario ve lo suyo y nada más: el comprador no ve lo que cobra la
// tienda, la tienda no ve lo que pagó el comprador. El margen solo va en el
// correo interno.
//
// Secrets: RESEND_API_KEY, ADMIN_EMAIL, FROM_EMAIL, SITE_URL (y los SUPABASE_*
// que Supabase inyecta).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

interface OrderItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
}

interface Order {
  id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_province: string;
  recipient_municipality: string;
  recipient_address: string;
  notes: string | null;
  total_usd: number;
  business_id: string;
  businesses: { name: string } | null;
  order_items: OrderItem[];
}

const money = (n: number): string => `${Number(n).toFixed(2)} USD`;

const shortRef = (id: string): string => id.replaceAll('-', '').slice(0, 8).toUpperCase();

/** El nombre y la dirección los escribe el comprador: van a un HTML, se escapan. */
const esc = (value: string): string =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Maquetación de correo: tablas y estilos en línea. Gmail y Outlook ignoran las
// hojas de estilo y buena parte del CSS moderno.
const layout = (title: string, content: string): string => `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <tr><td>
      <p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:-0.02em">Nexoo</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${esc(title)}</h1>
      ${content}
    </td></tr>
  </table>
</body></html>`;

const block = (title: string, lines: string[]): string => `
  <p style="margin:24px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#71717a">${esc(title)}</p>
  <p style="margin:0;line-height:1.6">${lines.map(esc).join('<br>')}</p>`;

/** La tabla de productos, con el precio que le toca ver a cada destinatario. */
const itemsTable = (items: OrderItem[], priceOf: (i: OrderItem) => number, label: string): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border-collapse:collapse">
    <tr>
      <th align="left" style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a">Producto</th>
      <th align="right" style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a">Cant.</th>
      <th align="right" style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-size:13px;color:#71717a">${esc(label)}</th>
    </tr>
    ${items
      .map(
        (i) => `<tr>
      <td style="padding:12px 0;border-bottom:1px solid #f4f4f5">${esc(i.product_name)}</td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #f4f4f5">${i.quantity}</td>
      <td align="right" style="padding:12px 0;border-bottom:1px solid #f4f4f5">${money(priceOf(i) * i.quantity)}</td>
    </tr>`,
      )
      .join('')}
  </table>`;

const itemsText = (items: OrderItem[], priceOf: (i: OrderItem) => number): string =>
  items.map((i) => `  ${i.quantity} x ${i.product_name} — ${money(priceOf(i) * i.quantity)}`).join('\n');

const total = (items: OrderItem[], priceOf: (i: OrderItem) => number): number =>
  items.reduce((sum, i) => sum + priceOf(i) * i.quantity, 0);

const publicPrice = (i: OrderItem) => Number(i.unit_price);
const businessPrice = (i: OrderItem) => Number(i.unit_cost);

interface Mail {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

async function send(mail: Mail, apiKey: string, from: string): Promise<boolean> {
  const recipients = mail.to.filter(Boolean);
  if (recipients.length === 0) return false;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    // Siempre las dos versiones: hay clientes que no renderizan HTML, y un
    // correo solo-HTML puntúa peor en los filtros de spam.
    body: JSON.stringify({ from, to: recipients, subject: mail.subject, text: mail.text, html: mail.html }),
  });

  if (!response.ok) {
    console.error('Resend falló para', recipients.join(', '), response.status, await response.text());
    return false;
  }

  return true;
}

Deno.serve(async (request: Request): Promise<Response> => {
  // Solo la service role: si no, cualquiera con una sesión podría disparar
  // correos de un pedido ajeno con solo acertar su id.
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (request.headers.get('Authorization') !== expected) {
    return new Response('forbidden', { status: 403 });
  }

  const { orderId } = (await request.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId) return new Response('missing order', { status: 400 });

  const { data, error } = await admin
    .from('orders')
    .select(
      'id, buyer_name, buyer_email, buyer_phone, recipient_name, recipient_phone, ' +
        'recipient_province, recipient_municipality, recipient_address, notes, total_usd, ' +
        'business_id, businesses(name), order_items(product_name, quantity, unit_price, unit_cost)',
    )
    .eq('id', orderId)
    .maybeSingle();

  if (error || !data) {
    console.error('No se pudo leer el pedido:', orderId, error?.message);
    return new Response('order not found', { status: 404 });
  }

  const order = data as unknown as Order;
  const items = order.order_items ?? [];
  const ref = shortRef(order.id);
  const businessName = order.businesses?.name ?? order.business_id;

  // El correo de la tienda no está en `businesses`: esa tabla la lee cualquiera
  // sin sesión, así que la dirección vive en `admins`, con el resto del panel.
  const [{ data: staff }, { data: provinceRow }] = await Promise.all([
    admin.from('admins').select('email').eq('business_id', order.business_id),
    admin.from('provinces').select('name').eq('code', order.recipient_province).maybeSingle(),
  ]);

  const province = provinceRow?.name ?? order.recipient_province;
  const businessEmails = ((staff ?? []) as { email: string }[]).map((s) => s.email).filter(Boolean);

  const recipient = [
    order.recipient_name,
    order.recipient_phone,
    `${order.recipient_address}, ${order.recipient_municipality}, ${province}`,
  ];

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('FROM_EMAIL') ?? 'Nexoo <onboarding@resend.dev>';
  const adminEmail = Deno.env.get('ADMIN_EMAIL');
  const siteUrl = Deno.env.get('SITE_URL') ?? '';

  // Lo cobrado es lo que quedó guardado en el pedido, que es lo que se le pasó
  // a Stripe; el coste se suma de las líneas, congelado a la venta.
  const cobrado = Number(order.total_usd);
  const coste = total(items, businessPrice);

  // 1) Aviso interno: texto plano y todo a la vista, incluido el margen.
  const ownerMail: Mail = {
    to: adminEmail ? [adminEmail] : [],
    subject: `Nexoo — pedido pagado ${ref} (${money(cobrado)})`,
    text: [
      `Pedido ${ref} (${order.id})`,
      `Negocio: ${businessName}`,
      `Cobrado: ${money(cobrado)} | Se le debe al negocio: ${money(coste)} | Margen: ${money(cobrado - coste)}`,
      '',
      'Comprador (EE.UU.):',
      `  ${order.buyer_name} / ${order.buyer_email} / ${order.buyer_phone}`,
      '',
      'Destinatario (Cuba):',
      ...recipient.map((l) => `  ${l}`),
      '',
      'Productos:',
      itemsText(items, publicPrice),
      order.notes ? `\nNotas: ${order.notes}` : '',
    ].join('\n'),
  };

  // 2) Comprador: lo que compró y a dónde va. Sin coste ni margen.
  const buyerMail: Mail = {
    to: [order.buyer_email],
    subject: `Tu pedido ${ref} está confirmado`,
    text: [
      `Hola ${order.buyer_name},`,
      '',
      `Recibimos tu pago y ${businessName} ya está preparando tu pedido ${ref}.`,
      '',
      'Productos:',
      itemsText(items, publicPrice),
      `Total pagado: ${money(cobrado)}`,
      '',
      'Se entrega a:',
      ...recipient.map((l) => `  ${l}`),
      '',
      siteUrl ? `Sigue el pedido en ${siteUrl}/pedido/${order.id}` : '',
      '',
      'Gracias por comprar en Nexoo.',
    ].join('\n'),
    html: layout(
      `Tu pedido ${ref} está confirmado`,
      `<p style="margin:0;line-height:1.6">Hola ${esc(order.buyer_name)}, recibimos tu pago y <strong>${esc(businessName)}</strong> ya está preparando tu pedido.</p>
       ${itemsTable(items, publicPrice, 'Precio')}
       <p style="margin:0;font-size:18px"><strong>Total pagado: ${money(cobrado)}</strong></p>
       ${block('Se entrega a', recipient)}
       ${
         siteUrl
           ? `<p style="margin:32px 0 0"><a href="${siteUrl}/pedido/${order.id}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px">Ver mi pedido</a></p>`
           : ''
       }
       <p style="margin:32px 0 0;font-size:13px;color:#71717a">Gracias por comprar en Nexoo. Responde a este correo si necesitas algo.</p>`,
    ),
  };

  // 3) Tienda: qué preparar y a quién entregarlo, con lo que se le va a pagar.
  // El precio público no aparece: no es su número y solo confunde.
  const businessMail: Mail = {
    to: businessEmails,
    subject: `Nexoo — nuevo pedido ${ref} para preparar`,
    text: [
      `Pedido ${ref} pagado. Prepáralo para entrega.`,
      '',
      'Productos:',
      itemsText(items, businessPrice),
      `Total a pagarte: ${money(coste)}`,
      '',
      'Entregar a:',
      ...recipient.map((l) => `  ${l}`),
      order.notes ? `\nNotas del comprador: ${order.notes}` : '',
      '',
      'Te lo liquidamos según lo acordado.',
    ].join('\n'),
    html: layout(
      `Nuevo pedido ${ref}`,
      `<p style="margin:0;line-height:1.6">El pedido está pagado. Prepáralo para entrega.</p>
       ${itemsTable(items, businessPrice, 'Te pagamos')}
       <p style="margin:0;font-size:18px"><strong>Total a pagarte: ${money(coste)}</strong></p>
       ${block('Entregar a', recipient)}
       ${order.notes ? block('Notas del comprador', [order.notes]) : ''}
       <p style="margin:32px 0 0;font-size:13px;color:#71717a">Te lo liquidamos según lo acordado.</p>`,
    ),
  };

  if (!apiKey) {
    // Sin proveedor configurado el pedido ya está pagado: solo se registra, y
    // así el log sirve para ver qué se habría mandado.
    console.log('RESEND_API_KEY no configurada; correos omitidos para', ref);
    return new Response(JSON.stringify({ sent: false, reason: 'no api key' }), { status: 200 });
  }

  const [owner, buyer, business] = await Promise.all([
    send(ownerMail, apiKey, from),
    send(buyerMail, apiKey, from),
    send(businessMail, apiKey, from),
  ]);

  if (!adminEmail) console.error('ADMIN_EMAIL no configurada: sin aviso interno del pedido', ref);
  if (businessEmails.length === 0) console.error('El negocio', businessName, 'no tiene correo en admins');

  return new Response(JSON.stringify({ ref, owner, buyer, business }), { status: 200 });
});
