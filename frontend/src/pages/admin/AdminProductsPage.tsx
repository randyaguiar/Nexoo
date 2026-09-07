import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Business, Product, ProductInput } from '../../api/types';
import { formatUsd } from '../../components/Money';

const emptyForm = (businessId: string): ProductInput => ({
  businessId,
  name: '',
  description: '',
  priceUsd: 0,
  photoUrl: '',
  available: true,
});

export function AdminProductsPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductInput>(emptyForm(''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin
      .listBusinesses()
      .then((data) => {
        setBusinesses(data);
        if (data.length > 0) {
          setSelectedBusinessId((current) => current || data[0].id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadProducts = useCallback(async (businessId: string) => {
    if (!businessId) {
      setProducts([]);
      return;
    }
    try {
      setProducts(await api.admin.listProducts(businessId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadProducts(selectedBusinessId);
    setForm(emptyForm(selectedBusinessId));
    setEditingId(null);
  }, [loadProducts, selectedBusinessId]);

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setForm(emptyForm(selectedBusinessId));
    setEditingId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: ProductInput = {
      ...form,
      photoUrl: form.photoUrl?.trim() ? form.photoUrl.trim() : null,
      description: form.description?.trim() ? form.description.trim() : null,
    };

    try {
      if (editingId) {
        await api.admin.updateProduct(editingId, payload);
      } else {
        await api.admin.createProduct(payload);
      }
      reset();
      await loadProducts(selectedBusinessId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const edit = (product: Product) => {
    setEditingId(product.id);
    setForm({
      businessId: product.businessId,
      name: product.name,
      description: product.description ?? '',
      priceUsd: product.priceUsd,
      photoUrl: product.photoUrl ?? '',
      available: product.available,
    });
  };

  const remove = async (product: Product) => {
    if (!confirm(`¿Eliminar "${product.name}"? Si tiene pedidos, solo se marcará no disponible.`)) {
      return;
    }
    try {
      await api.admin.deleteProduct(product.id);
      if (editingId === product.id) reset();
      await loadProducts(selectedBusinessId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (businesses.length === 0) {
    return (
      <>
        {error && <div className="alert error">{error}</div>}
        <p className="empty">Crea primero un negocio para poder añadir productos.</p>
      </>
    );
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="businessFilter">Negocio</label>
        <select
          id="businessFilter"
          value={selectedBusinessId}
          onChange={(e) => setSelectedBusinessId(e.target.value)}
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <form className="card" style={{ marginBottom: 24 }} onSubmit={submit}>
        <h3>{editingId ? 'Editar producto' : 'Nuevo producto'}</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="productName">Nombre</label>
            <input
              id="productName"
              required
              maxLength={160}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="priceUsd">Precio (USD)</label>
            <input
              id="priceUsd"
              type="number"
              required
              min={0.01}
              step={0.01}
              value={form.priceUsd}
              onChange={(e) => set('priceUsd', Number(e.target.value))}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="photoUrl">URL de la foto</label>
          <input
            id="photoUrl"
            type="url"
            maxLength={1000}
            value={form.photoUrl ?? ''}
            onChange={(e) => set('photoUrl', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="productDescription">Descripción</label>
          <textarea
            id="productDescription"
            rows={2}
            maxLength={2000}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="available">
            <input
              id="available"
              type="checkbox"
              style={{ width: 'auto', marginRight: 8 }}
              checked={form.available}
              onChange={(e) => set('available', e.target.checked)}
            />
            Disponible para la venta
          </label>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <button type="submit">{editingId ? 'Guardar cambios' : 'Crear producto'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={reset}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {products.length === 0 ? (
        <p className="empty">Este negocio aún no tiene productos.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio</th>
                <th>Disponible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    {product.name}
                    {product.description && <div className="meta">{product.description}</div>}
                  </td>
                  <td>{formatUsd(product.priceUsd)}</td>
                  <td>{product.available ? 'Sí' : 'No'}</td>
                  <td>
                    <button type="button" className="link" onClick={() => edit(product)}>
                      Editar
                    </button>{' '}
                    <button type="button" className="link" onClick={() => void remove(product)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
