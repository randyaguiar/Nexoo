import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { SkeletonGrid } from '../components/Skeleton';
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
      <section className="hero">
        <h1>Cerca de los tuyos, aunque estés lejos.</h1>
        <p>
          Elige un negocio local, arma el pedido y lo entregamos a tu familia en Cuba. Sin envíos ni
          esperas: el negocio prepara todo allá mismo.
        </p>
        <ol className="hero-steps">
          <li>
            <span>1</span> Elige el negocio
          </li>
          <li>
            <span>2</span> Arma tu pedido
          </li>
          <li>
            <span>3</span> Paga por Zelle
          </li>
          <li>
            <span>4</span> Entregamos en Cuba
          </li>
        </ol>
      </section>

      <h2 className="page-title">Negocios disponibles</h2>
      <p className="page-subtitle">Filtra por provincia para ver quién entrega cerca de tu familia.</p>

      <div className="filters" role="group" aria-label="Filtrar por provincia">
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

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div aria-busy={loading} aria-live="polite">
        {loading && <SkeletonGrid />}

        {!loading && !error && businesses.length === 0 && (
          <div className="empty-state">
            <h3>Todavía no hay negocios en esta provincia</h3>
            <p>Estamos sumando nuevos negocios cada semana. Prueba con otra provincia.</p>
            <button type="button" className="secondary" onClick={() => selectProvince(null)}>
              Ver todas las provincias
            </button>
          </div>
        )}

        {!loading && businesses.length > 0 && (
          <div className="grid">
            {businesses.map((business) => (
              <Link
                key={business.id}
                to={`/negocios/${business.id}`}
                className="card business-card"
              >
                <span className="tag">{provinceLabel(business.province)}</span>
                <h3>{business.name}</h3>
                <p className="meta">{business.municipality}</p>
                {business.description && <p>{business.description}</p>}
                <div className="card-footer">
                  <span className="meta">
                    {business.productCount}{' '}
                    {business.productCount === 1 ? 'producto' : 'productos'}
                  </span>
                  <span aria-hidden="true">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
