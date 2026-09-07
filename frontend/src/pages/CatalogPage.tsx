import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { PROVINCES, provinceLabel, type Business, type Province } from '../api/types';

function isProvince(value: string | null): value is Province {
  return PROVINCES.some((p) => p.value === value);
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const provinceParam = searchParams.get('provincia');
  const province = isProvince(provinceParam) ? provinceParam : null;

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .listBusinesses(province)
      .then((data) => {
        if (!cancelled) setBusinesses(data);
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
  }, [province]);

  const selectProvince = (value: Province | null) => {
    setSearchParams(value ? { provincia: value } : {});
  };

  return (
    <>
      <h1 className="page-title">Negocios en Cuba</h1>
      <p className="page-subtitle">
        Elige un negocio, arma el pedido y nosotros lo entregamos a tu familiar en Cuba.
      </p>

      <div className="filters">
        <button
          type="button"
          className={`chip ${province === null ? 'active' : ''}`}
          onClick={() => selectProvince(null)}
        >
          Todas las provincias
        </button>
        {PROVINCES.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`chip ${province === p.value ? 'active' : ''}`}
            onClick={() => selectProvince(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <p className="empty">Cargando negocios…</p>}

      {!loading && !error && businesses.length === 0 && (
        <p className="empty">No hay negocios disponibles en esta provincia todavía.</p>
      )}

      <div className="grid">
        {businesses.map((business) => (
          <Link key={business.id} to={`/negocios/${business.id}`} className="card business-card">
            <h3>{business.name}</h3>
            <p className="meta">
              {provinceLabel(business.province)} · {business.municipality}
            </p>
            {business.description && <p>{business.description}</p>}
            <p className="meta">{business.productCount} productos disponibles</p>
          </Link>
        ))}
      </div>
    </>
  );
}
