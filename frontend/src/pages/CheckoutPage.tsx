import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { PROVINCES, type Province } from '../api/types';
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
  recipientProvince: 'PinarDelRio',
  recipientMunicipality: '',
  recipientAddress: '',
  notes: '',
};

export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      });
      cart.clear();
      navigate(`/pedido/${order.id}`);
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
                  {PROVINCES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="recipientMunicipality">Municipio</label>
                <input
                  id="recipientMunicipality"
                  required
                  maxLength={120}
                  value={form.recipientMunicipality}
                  onChange={(e) => set('recipientMunicipality', e.target.value)}
                />
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
            El pago se coordina por Zelle después de confirmar. Te mostraremos las instrucciones en
            la página siguiente.
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
