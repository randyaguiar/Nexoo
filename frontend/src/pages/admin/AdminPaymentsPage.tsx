import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { formatUsd } from '../../components/Money';
import { PAYMENT_PROVIDERS, type PaymentProvider } from '../../api/types';

/** Un pedido de ejemplo para que se vea el efecto del cambio antes de guardar. */
const SAMPLE_USD = 100;

export function AdminPaymentsPage() {
  const [provider, setProvider] = useState<PaymentProvider>('stripe');
  const [rate, setRate] = useState('0.92');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api.payments
      .get()
      .then((settings) => {
        if (cancelled) return;
        setProvider(settings.provider);
        setRate(String(settings.eurPerUsd));
        setUpdatedAt(settings.updatedAt);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const parsedRate = Number(rate);
  const rateIsValid = !Number.isNaN(parsedRate) && parsedRate > 0;

  const save = async () => {
    if (!rateIsValid) {
      setError('El cambio tiene que ser un número mayor que cero.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      await api.payments.save(provider, parsedRate);
      const settings = await api.payments.get();
      setUpdatedAt(settings.updatedAt);
      setNotice(
        `Los pedidos nuevos se cobrarán con ${
          PAYMENT_PROVIDERS.find((p) => p.value === provider)?.label
        }.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="empty">Cargando…</p>;

  return (
    <>
      <h3 className="form-title">Pasarela de cobro</h3>
      <p className="page-subtitle">
        Decide con qué se cobra a partir de ahora. Los pedidos que ya estén abiertos siguen con la
        pasarela con la que nacieron.
      </p>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}

      <div className="card payment-providers">
        {PAYMENT_PROVIDERS.map((option) => (
          <label
            key={option.value}
            className={`payment-provider${provider === option.value ? ' is-active' : ''}`}
          >
            <input
              type="radio"
              name="provider"
              value={option.value}
              checked={provider === option.value}
              onChange={() => setProvider(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <span className="meta">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="rate">Euros por dólar</label>
          <input
            id="rate"
            type="number"
            min={0.01}
            step={0.0001}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={provider !== 'tropipay'}
          />
        </div>
        <p className="field-hint">
          {provider === 'tropipay' ? (
            <>
              Un pedido de {formatUsd(SAMPLE_USD)} se le cobrará al comprador como{' '}
              <strong>
                {rateIsValid ? (SAMPLE_USD * parsedRate).toFixed(2) : '—'} €
              </strong>
              . Lo que le pagas al negocio se sigue calculando en dólares y no cambia. Ponlo acorde
              a lo que te liquide tu banco, no al cambio del día: si se queda corto, el margen lo
              pagas tú.
            </>
          ) : (
            'Stripe cobra en dólares, así que este cambio no se usa.'
          )}
        </p>
      </div>

      <div className="row-actions" style={{ marginTop: 'var(--space-4)' }}>
        <button type="button" disabled={saving} onClick={() => void save()}>
          Guardar
        </button>
        {updatedAt && (
          <span className="meta">
            Última vez: {new Date(updatedAt).toLocaleString('es')}
          </span>
        )}
      </div>
    </>
  );
}
