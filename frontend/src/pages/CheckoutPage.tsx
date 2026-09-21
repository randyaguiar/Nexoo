import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { isBusinessScoped, type Municipality, type Province, type ProvinceRef } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useCart } from '../cart/CartContext';
import { formatUsd } from '../components/Money';

interface FormState {
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  recipientName: string;
  recipientPhone: string;
  recipientProvince: Province;
  recipientMunicipality: string;
  recipientAddress: string;
  notes: string;
}

const initialForm: FormState = {
  buyerName: '',
  buyerEmail: '',
  buyerPhone: '',
  recipientName: '',
  recipientPhone: '',
  recipientProvince: '',
  recipientMunicipality: '',
  recipientAddress: '',
  notes: '',
};

export function CheckoutPage() {
  const cart = useCart();
  const { user, admin } = useAuth();
  const [form, setForm] = useState<FormState>(() => ({
    ...initialForm,
    // El perfil de la cuenta (Mi cuenta) rellena los datos del comprador.
    buyerName: typeof user?.user_metadata.full_name === 'string' ? user.user_metadata.full_name : '',
    buyerPhone: typeof user?.user_metadata.phone === 'string' ? user.user_metadata.phone : '',
    buyerEmail: user?.email ?? '',
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);

  useEffect(() => {
    api
      .listProvinces()
      .then((data) => {
        setProvinces(data);
        setForm((current) =>
          current.recipientProvince ? current : { ...current, recipientProvince: data[0]?.code ?? '' },
        );
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const selectedProvince = form.recipientProvince;

  useEffect(() => {
    if (!selectedProvince) {
      setMunicipalities([]);
      return;
    }

    let cancelled = false;
    api
      .listMunicipalities(selectedProvince)
      .then((data) => {
        if (cancelled) return;
        setMunicipalities(data);
        // El municipio elegido puede no existir en la provincia recién seleccionada.
        setForm((current) =>
          data.some((m) => m.name === current.recipientMunicipality)
            ? current
            : { ...current, recipientMunicipality: data[0]?.name ?? '' },
        );
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProvince]);

  // Comprador y negocio son cuentas separadas: el trigger de `orders` rechazaría
  // el pedido igual, pero aquí se dice antes de pedir los datos del destinatario.
  if (admin && isBusinessScoped(admin.role)) {
    return (
      <>
        <h1 className="page-title">Confirmar pedido</h1>
        <div className="empty-state">
          <h3>Esta cuenta gestiona un negocio</h3>
          <p>
            Las cuentas de negocio no hacen pedidos en Nexoo. Si quieres comprar, entra con una
            cuenta de comprador.
          </p>
          <Link className="button" to="/admin/pedidos">
            Ver los pedidos de tu negocio
          </Link>
        </div>
      </>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <>
        <h1 className="page-title">Confirmar pedido</h1>
        <div className="empty-state">
          <h3>No hay productos en el carrito</h3>
          <p>Agrega productos de un negocio antes de confirmar el pedido.</p>
          <Link className="button" to="/">
            Explorar el catálogo
          </Link>
        </div>
      </>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const order = await api.createOrder({
        ...form,
        notes: form.notes.trim() || undefined,
        items: cart.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        cartToken: cart.cartToken,
      });
      const checkoutUrl = await api.createCheckoutSession(order.id);
      cart.clear();
      // Fuera de la app: no es una ruta del router, es el dominio de Stripe.
      window.location.href = checkoutUrl;
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <ol className="steps">
        <li>Carrito</li>
        <li className="current">Datos de entrega</li>
        <li>Pago</li>
      </ol>

      <h1 className="page-title">Confirmar pedido</h1>
      <p className="page-subtitle">
        Pedido a <strong>{cart.businessName}</strong>
      </p>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <form className="checkout-layout" onSubmit={submit}>
        <div>
          <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
            <h3>Tus datos (comprador en EE.UU.)</h3>
            {!user && (
              <p className="field-hint" style={{ marginBottom: 'var(--space-4)' }}>
                <Link to="/entrar" state={{ from: '/checkout' }}>
                  Entra
                </Link>{' '}
                o <Link to="/registro">crea una cuenta</Link> para seguir este pedido desde «Mis
                pedidos». También puedes continuar sin cuenta.
              </p>
            )}
            <div className="field">
              <label htmlFor="buyerName">Nombre completo</label>
              <input
                id="buyerName"
                required
                maxLength={160}
                value={form.buyerName}
                onChange={(e) => set('buyerName', e.target.value)}
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="buyerEmail">Email</label>
                <input
                  id="buyerEmail"
                  type="email"
                  required
                  maxLength={200}
                  value={form.buyerEmail}
                  onChange={(e) => set('buyerEmail', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="buyerPhone">Teléfono en EE.UU.</label>
                <input
                  id="buyerPhone"
                  required
                  maxLength={40}
                  value={form.buyerPhone}
                  onChange={(e) => set('buyerPhone', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Destinatario en Cuba</h3>
            <div className="field-row">
              <div className="field">
                <label htmlFor="recipientName">Nombre completo</label>
                <input
                  id="recipientName"
                  required
                  maxLength={160}
                  value={form.recipientName}
                  onChange={(e) => set('recipientName', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="recipientPhone">Teléfono en Cuba</label>
                <input
                  id="recipientPhone"
                  required
                  maxLength={40}
                  value={form.recipientPhone}
                  onChange={(e) => set('recipientPhone', e.target.value)}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="recipientProvince">Provincia</label>
                <select
                  id="recipientProvince"
                  value={form.recipientProvince}
                  onChange={(e) => set('recipientProvince', e.target.value as Province)}
                >
                  {provinces.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="recipientMunicipality">Municipio</label>
                <select
                  id="recipientMunicipality"
                  required
                  value={form.recipientMunicipality}
                  onChange={(e) => set('recipientMunicipality', e.target.value)}
                >
                  {municipalities.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="recipientAddress">Dirección / zona de entrega</label>
              <textarea
                id="recipientAddress"
                required
                rows={3}
                maxLength={500}
                value={form.recipientAddress}
                onChange={(e) => set('recipientAddress', e.target.value)}
              />
              <p className="field-hint">
                Incluye calle, número, entre calles y una referencia para encontrar la casa.
              </p>
            </div>
            <div className="field">
              <label htmlFor="notes">Notas para el negocio (opcional)</label>
              <textarea
                id="notes"
                rows={2}
                maxLength={1000}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </div>
        </div>

        <aside className="card checkout-summary" aria-label="Resumen del pedido">
          <h3>Resumen</h3>
          {cart.lines.map(({ product, quantity }) => (
            <div key={product.id} className="cart-line">
              <div className="grow">
                <strong>{product.name}</strong>
                <p className="meta">
                  {quantity} × {formatUsd(product.priceUsd)}
                </p>
              </div>
              <strong>{formatUsd(product.priceUsd * quantity)}</strong>
            </div>
          ))}
          <div className="summary">
            <span>Total</span>
            <span>{formatUsd(cart.total)}</span>
          </div>
          <p className="meta" style={{ marginTop: 12 }}>
            Al confirmar te llevamos a la pasarela de pago para cobrar con tarjeta. El pedido no se
            procesa hasta que el pago se complete.
          </p>
          <button
            type="submit"
            className="full-width"
            disabled={submitting}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {submitting ? 'Enviando…' : 'Confirmar pedido'}
          </button>
        </aside>
      </form>
    </>
  );
}
