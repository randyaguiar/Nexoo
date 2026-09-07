import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type {
  Business,
  BusinessInput,
  Category,
  Municipality,
  ProvinceRef,
} from '../../api/types';

const emptyForm: BusinessInput = {
  name: '',
  description: '',
  logoUrl: '',
  municipalityId: '',
  categoryIds: [],
  contactPhone: '',
  active: true,
};

export function AdminBusinessesPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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

  useEffect(() => {
    Promise.all([api.listProvinces(), api.listMunicipalities(), api.listCategories()])
      .then(([provinceList, municipalityList, categoryList]) => {
        setProvinces(provinceList);
        setMunicipalities(municipalityList);
        setCategories(categoryList);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const selectedMunicipality = municipalities.find((m) => m.id === form.municipalityId);
  // Sin municipio elegido se muestran los de la primera provincia disponible.
  const provinceCode = selectedMunicipality?.provinceCode ?? provinces[0]?.code ?? '';
  const provinceMunicipalities = municipalities.filter((m) => m.provinceCode === provinceCode);

  const set = <K extends keyof BusinessInput>(key: K, value: BusinessInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.municipalityId) {
      setError('Selecciona un municipio para el negocio.');
      return;
    }
    const payload: BusinessInput = {
      ...form,
      logoUrl: form.logoUrl?.trim() ? form.logoUrl.trim() : null,
      description: form.description?.trim() ? form.description.trim() : null,
      contactPhone: form.contactPhone?.trim() ? form.contactPhone.trim() : null,
    };
    try {
      if (editingId) {
        await api.admin.updateBusiness(editingId, payload);
      } else {
        await api.admin.createBusiness(payload);
      }
      setError(null);
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
      logoUrl: business.logoUrl ?? '',
      municipalityId: business.municipalityId ?? '',
      categoryIds: business.categories.map((c) => c.id),
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
              value={provinceCode}
              onChange={(e) => {
                const first = municipalities.find((m) => m.provinceCode === e.target.value);
                set('municipalityId', first?.id ?? '');
              }}
            >
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="municipalityId">Municipio</label>
            <select
              id="municipalityId"
              required
              value={form.municipalityId}
              onChange={(e) => set('municipalityId', e.target.value)}
            >
              <option value="">Selecciona un municipio</option>
              {provinceMunicipalities.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Categorías</span>
          <div className="checkbox-grid">
            {categories.map((c) => (
              <label key={c.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={form.categoryIds.includes(c.id)}
                  onChange={(e) =>
                    set(
                      'categoryIds',
                      e.target.checked
                        ? [...form.categoryIds, c.id]
                        : form.categoryIds.filter((id) => id !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
          <p className="field-hint">
            Un negocio puede ofrecer varios servicios (dulcería, panadería, cafetería…).
          </p>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="logoUrl">URL del logo</label>
            <input
              id="logoUrl"
              type="url"
              maxLength={1000}
              placeholder="https://…"
              value={form.logoUrl ?? ''}
              onChange={(e) => set('logoUrl', e.target.value)}
            />
          </div>
        </div>
        {form.logoUrl?.trim() && (
          <img
            className="business-logo"
            src={form.logoUrl}
            alt="Vista previa del logo"
            style={{ marginBottom: 12 }}
          />
        )}
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
                <th>Logo</th>
                <th>Nombre</th>
                <th>Categoría</th>
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
                  <td>
                    {business.logoUrl ? (
                      <img
                        className="business-logo small"
                        src={business.logoUrl}
                        alt={`Logo de ${business.name}`}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{business.name}</td>
                  <td>
                    {business.categories.length > 0
                      ? business.categories.map((c) => c.name).join(', ')
                      : '—'}
                  </td>
                  <td>
                    {business.provinceName}, {business.municipality}
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
