import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Category, CategoryInput } from '../../api/types';

const emptyForm: CategoryInput = { name: '', description: '', active: true };

export function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<CategoryInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.listCategories());
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

  const set = <K extends keyof CategoryInput>(key: K, value: CategoryInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: CategoryInput = {
      ...form,
      name: form.name.trim(),
      description: form.description?.trim() ? form.description.trim() : null,
    };
    try {
      if (editingId) {
        await api.admin.updateCategory(editingId, payload);
      } else {
        await api.admin.createCategory(payload);
      }
      setError(null);
      reset();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (category: Category) => {
    if (
      !confirm(
        `¿Eliminar "${category.name}"? Los negocios de esta categoría quedarán sin categoría.`,
      )
    ) {
      return;
    }
    try {
      await api.admin.deleteCategory(category.id);
      if (editingId === category.id) reset();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <form className="card" style={{ marginBottom: 24 }} onSubmit={submit}>
        <h3>{editingId ? 'Editar categoría' : 'Nueva categoría'}</h3>
        <div className="field">
          <label htmlFor="categoryName">Nombre</label>
          <input
            id="categoryName"
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <p className="field-hint">Tipo de servicio que ofrece el negocio (ej. Cafetería).</p>
        </div>
        <div className="field">
          <label htmlFor="categoryDescription">Descripción</label>
          <textarea
            id="categoryDescription"
            rows={2}
            maxLength={2000}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="categoryActive">
            <input
              id="categoryActive"
              type="checkbox"
              style={{ width: 'auto', marginRight: 8 }}
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Visible en el catálogo
          </label>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <button type="submit">{editingId ? 'Guardar cambios' : 'Crear categoría'}</button>
          {editingId && (
            <button type="button" className="secondary" onClick={reset}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {loading && <p className="empty">Cargando categorías…</p>}
      {!loading && categories.length === 0 && <p className="empty">Aún no hay categorías.</p>}

      {categories.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Visible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td>{category.name}</td>
                  <td>{category.description ?? '—'}</td>
                  <td>{category.active ? 'Sí' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setEditingId(category.id);
                        setForm({
                          name: category.name,
                          description: category.description ?? '',
                          active: category.active,
                        });
                      }}
                    >
                      Editar
                    </button>{' '}
                    <button type="button" className="link" onClick={() => void remove(category)}>
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
