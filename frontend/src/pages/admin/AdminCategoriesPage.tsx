import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import {
  CheckIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  TagIcon,
  TrashIcon,
} from '../../components/Icon';
import { Modal } from '../../components/Modal';
import type { Category, CategoryInput } from '../../api/types';

const emptyForm: CategoryInput = { name: '', description: '', active: true };

export function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<CategoryInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
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

  const closeForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormOpen(false);
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormOpen(true);
  };

  const edit = (category: Category) => {
    setEditingId(category.id);
    setFormOpen(true);
    setForm({
      name: category.name,
      description: category.description ?? '',
      active: category.active,
    });
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
      closeForm();
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
      if (editingId === category.id) closeForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">
          <TagIcon size={18} /> Categorías
        </h3>
        <button type="button" onClick={openCreate}>
          <PlusIcon /> Nueva categoría
        </button>
      </div>

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
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title="Editar categoría"
                        aria-label={`Editar ${category.name}`}
                        onClick={() => edit(category)}
                      >
                        <PencilIcon size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Eliminar categoría"
                        aria-label={`Eliminar ${category.name}`}
                        onClick={() => void remove(category)}
                      >
                        <TrashIcon size={15} />
                      </button>
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
              {editingId ? 'Editar categoría' : 'Nueva categoría'}
            </>
          }
          onClose={closeForm}
        >
          <form onSubmit={submit}>
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
              <label htmlFor="categoryActive" className="checkbox">
                <input
                  id="categoryActive"
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                Visible en el catálogo
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={closeForm}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit">
                {editingId ? <CheckIcon /> : <PlusIcon />}
                {editingId ? 'Guardar cambios' : 'Crear categoría'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
