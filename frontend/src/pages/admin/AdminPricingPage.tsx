import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CheckIcon } from '../../components/Icon';
import { formatUsd } from '../../components/Money';
import {
  marginPct,
  suggestedPrice,
  type Business,
  type ProductPricing,
} from '../../api/types';

export function AdminPricingPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState<string>('');
  const [products, setProducts] = useState<ProductPricing[]>([]);
  /** Precio escrito y aún sin guardar, por producto. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [markup, setMarkup] = useState('30');
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [businessList, productList] = await Promise.all([
        api.admin.listBusinesses(),
        api.admin.listProducts(businessId || undefined),
      ]);
      setBusinesses(businessList);
      setProducts(productList);
      setDrafts({});
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrice = async (product: ProductPricing) => {
    const raw = drafts[product.id];
    if (raw === undefined) return;

    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await api.admin.setProductPrice(product.id, raw === '' ? null : Number(raw));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const applyMarkup = async (scope: 'business' | 'all') => {
    const pct = Number(markup);
    if (Number.isNaN(pct) || pct < 0) {
      setError('El margen debe ser un número de cero en adelante.');
      return;
    }

    const target =
      scope === 'all'
        ? 'todos los productos del marketplace'
        : `los productos de ${businesses.find((b) => b.id === businessId)?.name ?? 'este negocio'}`;

    if (!confirm(`¿Aplicar un margen del ${pct}% a ${target}?`)) return;

    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const changed = await api.admin.applyMarkup(
        pct,
        scope === 'all' ? null : businessId,
        overwriteManual,
      );
      setNotice(
        changed === 0
          ? 'No cambió ningún precio: revisa que los negocios hayan declarado el suyo.'
          : `${changed} ${changed === 1 ? 'precio actualizado' : 'precios actualizados'}.`,
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const withoutPrice = products.filter((p) => p.priceUsd === null).length;

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">Precios públicos</h3>
        <select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
          <option value="">Todos los negocios</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {withoutPrice > 0 && (
        <div className="alert info">
          {withoutPrice}{' '}
          {withoutPrice === 1
            ? 'producto no tiene precio y no se está vendiendo.'
            : 'productos no tienen precio y no se están vendiendo.'}
        </div>
      )}

      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h4 className="form-title">Recalcular precios con un margen</h4>
        <div className="field-row">
          <div className="field">
            <label htmlFor="markup">Margen (%)</label>
            <input
              id="markup"
              type="number"
              min={0}
              step={1}
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={overwriteManual}
                onChange={(e) => setOverwriteManual(e.target.checked)}
              />
              Pisar también los precios puestos a mano
            </label>
          </div>
        </div>
        <div className="row-actions">
          <button type="button" disabled={working || !businessId} onClick={() => void applyMarkup('business')}>
            Aplicar a este negocio
          </button>
          <button type="button" className="secondary" disabled={working} onClick={() => void applyMarkup('all')}>
            Aplicar a todo el marketplace
          </button>
        </div>
        <p className="field-hint">
          El precio público queda en lo que le pagas al negocio × (1 + margen). Solo alcanza a los
          productos cuyo negocio ya declaró su precio; el margen aplicado pasa a ser el nuevo por
          defecto de ese negocio.
        </p>
      </div>

      {loading && <p className="empty">Cargando productos…</p>}

      {!loading && products.length === 0 && <p className="empty">No hay productos todavía.</p>}

      {!loading && products.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                {!businessId && <th>Negocio</th>}
                <th>Pagas al negocio</th>
                <th>Sugerido</th>
                <th>Precio público</th>
                <th>Tu margen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const draft = drafts[product.id];
                const current = product.priceUsd === null ? '' : String(product.priceUsd);
                const dirty = draft !== undefined && draft !== current;
                const suggestion = suggestedPrice(product.costUsd, product.defaultMarkupPct);
                const margin = marginPct(product.costUsd, product.priceUsd);

                return (
                  <tr key={product.id}>
                    <td>
                      {product.name}
                      {product.priceIsManual && <div className="meta">Precio a mano</div>}
                    </td>
                    {!businessId && <td>{product.businessName}</td>}
                    <td>{product.costUsd === null ? '—' : formatUsd(product.costUsd)}</td>
                    <td>{suggestion === null ? '—' : formatUsd(suggestion)}</td>
                    <td>
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        style={{ maxWidth: 110 }}
                        placeholder="Sin precio"
                        value={draft ?? current}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [product.id]: e.target.value }))
                        }
                      />
                    </td>
                    <td>{margin === null ? '—' : `${margin.toFixed(0)}%`}</td>
                    <td>
                      {dirty && (
                        <button
                          type="button"
                          className="icon-button"
                          title="Guardar precio"
                          disabled={working}
                          onClick={() => void savePrice(product)}
                        >
                          <CheckIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
