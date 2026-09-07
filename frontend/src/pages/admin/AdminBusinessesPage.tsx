import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { PROVINCES, provinceLabel, type Business, type BusinessInput } from '../../api/types';

const emptyForm: BusinessInput = {
  name: '',
  description: '',
  province: 'PinarDelRio',
  municipality: '',
  contactPhone: '',
  active: true,
};

export function AdminBusinessesPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [form, setForm] = useState<BusinessInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBusinesses(await api.admin.listBusinesses());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof BusinessInput>(key: K, value: BusinessInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (editingId) {
        await api.admin.updateBusiness(editingId, form);
      } else {
        await api.admin.createBusiness(form);
      }
      reset();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const edit = (business: Business) => {
    setEditingId(business.id);
    setForm({
      name: business.name,
      description: business.description ?? '',
      province: business.province,
      municipality: business.municipality,
      contactPhone: business.contactPhone ?? '',
      active: business.active,
    });
  };

  const remove = async (business: Business) => {
    if (!confirm(`¿Eliminar "${business.name}"? Si tiene pedidos, solo se desactivará.`)) {
      return;
    }
    try {
      await api.admin.deleteBusiness(business.id);
      if (editingId === business.id) reset();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <form className="card" style={{ marginBottom: 24 }} onSubmit={submit}>
        <h3>{editingId ? 'Editar negocio' : 'Nuevo negocio'}</h3>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name">Nombre</label>
            <input
              id="name"
              required
              maxLength={160}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="contactPhone">Teléfono de contacto</label>
            <input
              id="contactPhone"
              maxLength={40}
              value={form.contactPhone ?? ''}
              onChange={(e) => set('contactPhone', e.target.value)}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="province">Provincia</label>
            <select
              id="province"
              value={form.province}
              onChange={(e) => set('province', e.target.value as BusinessInput['province'])}
            >
              {PROVINCES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="municipality">Municipio</label>
            <input
              id="municipality"
              required
              maxLength={120}
              value={form.municipality}
              onChange={(e) => set('municipality', e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="description">Descripción</label>
          <textarea
            id="description"
            rows={2}
            maxLength={2000}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="active">
            <input
              id="active"
              type="checkbox"
              style={{ width: 'auto', marginRight: 8 }}
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Visible en el catálogo
          </label>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <button type="submit">{editingId ? 'Guardar cambios' : 'Crear negocio'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={reset}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {loading && <p className="empty">Cargando negocios…</p>}
      {!loading && businesses.length === 0 && <p className="empty">Aún no hay negocios.</p>}

      {businesses.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Ubicación</th>
                <th>Teléfono</th>
                <th>Productos</th>
                <th>Visible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {businesses.map((business) => (
                <tr key={business.id}>
                  <td>{business.name}</td>
                  <td>
                    {provinceLabel(business.province)}, {business.municipality}
                  </td>
                  <td>{business.contactPhone ?? '—'}</td>
                  <td>{business.productCount}</td>
                  <td>{business.active ? 'Sí' : 'No'}</td>
                  <td>
                    <button type="button" className="link" onClick={() => edit(business)}>
                      Editar
                    </button>{' '}
                    <button type="button" className="link" onClick={() => void remove(business)}>
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
