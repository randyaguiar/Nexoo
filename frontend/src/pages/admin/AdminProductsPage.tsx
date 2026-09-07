import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { LOW_STOCK_THRESHOLD, type Business, type Product, type ProductInput } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import {
  BoxIcon,
  CheckIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { formatUsd } from '../../components/Money';

const emptyForm = (businessId: string): ProductInput => ({
  businessId,
  name: '',
  description: '',
  priceUsd: 0,
  photoUrl: '',
  available: true,
  stock: 0,
});

export function AdminProductsPage() {
  const { admin } = useAuth();
  // El trabajador solo mantiene el inventario: no crea, no borra y no cambia
  // el nombre ni el precio de un producto.
  const canManageCatalog = admin?.role !== 'worker';

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductInput>(emptyForm(''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
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
    setFormOpen(false);
  }, [loadProducts, selectedBusinessId]);

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const closeForm = () => {
    setForm(emptyForm(selectedBusinessId));
    setEditingId(null);
    setFormOpen(false);
  };

  const openCreate = () => {
    setForm(emptyForm(selectedBusinessId));
    setEditingId(null);
    setFormOpen(true);
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
      closeForm();
      await loadProducts(selectedBusinessId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const edit = (product: Product) => {
    setEditingId(product.id);
    setFormOpen(true);
    setForm({
      businessId: product.businessId,
      name: product.name,
      description: product.description ?? '',
      priceUsd: product.priceUsd,
      photoUrl: product.photoUrl ?? '',
      available: product.available,
      stock: product.stock,
    });
  };

  const remove = async (product: Product) => {
    if (!confirm(`¿Eliminar "${product.name}"? Si tiene pedidos, solo se marcará no disponible.`)) {
      return;
    }
    try {
      await api.admin.deleteProduct(product.id);
      if (editingId === product.id) closeForm();
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

      <div className="page-toolbar">
        <div className="field" style={{ maxWidth: 360, marginBottom: 0 }}>
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
        {canManageCatalog && (
          <button type="button" onClick={openCreate}>
            <PlusIcon /> Nuevo producto
          </button>
        )}
      </div>

      {products.length === 0 ? (
        <p className="empty">Este negocio aún no tiene productos.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Disponible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <span className="cell-icon">
                      <BoxIcon size={14} />
                      {product.name}
                    </span>
                    {product.description && <div className="meta">{product.description}</div>}
                  </td>
                  <td>{formatUsd(product.priceUsd)}</td>
                  <td className={product.stock <= LOW_STOCK_THRESHOLD ? 'low-stock' : undefined}>
                    {product.stock}
                  </td>
                  <td>{product.available ? 'Sí' : 'No'}</td>
                  <td>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title={canManageCatalog ? 'Editar producto' : 'Actualizar inventario'}
                        aria-label={`Editar ${product.name}`}
                        onClick={() => edit(product)}
                      >
                        <PencilIcon size={15} />
                      </button>
                      {canManageCatalog && (
                        <button
                          type="button"
                          className="icon-button danger"
                          title="Eliminar producto"
                          aria-label={`Eliminar ${product.name}`}
                          onClick={() => void remove(product)}
                        >
                          <TrashIcon size={15} />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <Modal
          title={
            <>
              {editingId ? <PencilIcon size={18} /> : <PlusIcon size={18} />}
              {!canManageCatalog
                ? 'Actualizar inventario'
                : editingId
                  ? 'Editar producto'
                  : 'Nuevo producto'}
            </>
          }
          onClose={closeForm}
        >
          <form onSubmit={submit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="productName">Nombre</label>
                <input
                  id="productName"
                  required
                  disabled={!canManageCatalog}
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
                  disabled={!canManageCatalog}
                  min={0.01}
                  step={0.01}
                  value={form.priceUsd}
                  onChange={(e) => set('priceUsd', Number(e.target.value))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="stock">Unidades en inventario</label>
              <input
                id="stock"
                type="number"
                required
                min={0}
                step={1}
                value={form.stock}
                onChange={(e) => set('stock', Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="photoUrl">URL de la foto</label>
              <input
                id="photoUrl"
                type="url"
                disabled={!canManageCatalog}
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
                disabled={!canManageCatalog}
                maxLength={2000}
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="available" className="checkbox">
                <input
                  id="available"
                  type="checkbox"
                  checked={form.available}
                  onChange={(e) => set('available', e.target.checked)}
                />
                Disponible para la venta
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={closeForm}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit">
                {editingId ? <CheckIcon /> : <PlusIcon />}
                {editingId ? 'Guardar cambios' : 'Crear producto'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
