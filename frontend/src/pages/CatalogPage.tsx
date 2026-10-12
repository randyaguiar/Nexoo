import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { SkeletonGrid } from '../components/Skeleton';
import type { Business, Category, CountryRef, ProvinceRef } from '../api/types';

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const country = searchParams.get('pais');
  const province = searchParams.get('provincia');
  const categoryId = searchParams.get('categoria');

  const [countries, setCountries] = useState<CountryRef[]>([]);
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listCountries(), api.listProvinces(), api.listCategories()])
      .then(([countryList, provinceList, categoryList]) => {
        setCountries(countryList);
        setProvinces(provinceList);
        setCategories(categoryList);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .listBusinesses(province, categoryId, country)
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
  }, [province, categoryId, country]);

  const setFilter = (key: 'pais' | 'provincia' | 'categoria', value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }

    // Una provincia de Cuba no significa nada con Jamaica elegida.
    if (key === 'pais') {
      next.delete('provincia');
    }
    setSearchParams(next);
  };

  return (
    <>
      <section className="hero">
        <h1>Cerca de los tuyos, aunque estés lejos.</h1>
        <p>
          Elige un negocio local, arma el pedido y lo entregamos a tu familia. Sin envíos ni
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
            <span>3</span> Paga con tarjeta
          </li>
          <li>
            <span>4</span> Entregamos allá
          </li>
        </ol>
      </section>

      <h2 className="page-title">Negocios disponibles</h2>
      <p className="page-subtitle">
        Elige el país y la provincia para ver quién entrega cerca de tu familia.
      </p>

      {countries.length > 1 && (
        <div className="filters" role="group" aria-label="Filtrar por país">
          <button
            type="button"
            className={`chip ${country === null ? 'active' : ''}`}
            onClick={() => setFilter('pais', null)}
          >
            Todos los países
          </button>
          {countries.map((c) => (
            <button
              key={c.code}
              type="button"
              className={`chip ${country === c.code ? 'active' : ''}`}
              onClick={() => setFilter('pais', c.code)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="filters" role="group" aria-label="Filtrar por provincia">
        <button
          type="button"
          className={`chip ${province === null ? 'active' : ''}`}
          onClick={() => setFilter('provincia', null)}
        >
          Todas las provincias
        </button>
        {provinces
          .filter((p) => !country || p.countryCode === country)
          .map((p) => (
            <button
              key={p.code}
              type="button"
              className={`chip ${province === p.code ? 'active' : ''}`}
              onClick={() => setFilter('provincia', p.code)}
            >
              {p.name}
            </button>
          ))}
      </div>

      {categories.length > 0 && (
        <div className="filters" role="group" aria-label="Filtrar por categoría">
          <button
            type="button"
            className={`chip ${categoryId === null ? 'active' : ''}`}
            onClick={() => setFilter('categoria', null)}
          >
            Todas las categorías
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip ${categoryId === c.id ? 'active' : ''}`}
              onClick={() => setFilter('categoria', c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div aria-busy={loading} aria-live="polite">
        {loading && <SkeletonGrid />}

        {!loading && !error && businesses.length === 0 && (
          <div className="empty-state">
            <h3>Todavía no hay negocios con estos filtros</h3>
            <p>Estamos sumando nuevos negocios cada semana. Prueba con otra provincia o categoría.</p>
            <button type="button" className="secondary" onClick={() => setSearchParams({})}>
              Ver todos los negocios
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
                <div className="business-card-head">
                  {business.logoUrl && (
                    <img
                      className="business-logo"
                      src={business.logoUrl}
                      alt={`Logo de ${business.name}`}
                    />
                  )}
                  <div>
                    <span className="tag">{business.countryName}</span>
                    <span className="tag">{business.provinceName}</span>
                    {business.categories.map((c) => (
                      <span key={c.id} className="tag">
                        {c.name}
                      </span>
                    ))}
                  </div>
                </div>
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
