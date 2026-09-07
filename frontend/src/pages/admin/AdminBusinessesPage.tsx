import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import {
  BoxIcon,
  CheckIcon,
  CloseIcon,
  EyeIcon,
  ImageIcon,
  MapIcon,
  MapPinIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  StoreIcon,
  TagIcon,
  TextIcon,
  TrashIcon,
  UploadIcon,
} from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { MultiSelect } from '../../components/MultiSelect';
import type { Business, BusinessInput, Category, Municipality, ProvinceRef } from '../../api/types';

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
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

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

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      set('logoUrl', await api.admin.uploadBusinessLogo(file));
      setError(null);
    } catch (e) {
      setError(`No se pudo subir el logo: ${(e as Error).message}`);
    } finally {
      setUploadingLogo(false);
      // Permite volver a elegir el mismo archivo tras un fallo.
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

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
      closeForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const edit = (business: Business) => {
    setEditingId(business.id);
    setFormOpen(true);
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
      if (editingId === business.id) closeForm();
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
          <StoreIcon size={18} /> Negocios
        </h3>
        <button type="button" onClick={openCreate}>
          <PlusIcon /> Nuevo negocio
        </button>
      </div>

      {loading && <p className="empty">Cargando negocios…</p>}
      {!loading && businesses.length === 0 && <p className="empty">Aún no hay negocios.</p>}

      {businesses.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Logo</th>
                <th>Nombre</th>
                <th>Categorías</th>
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
                    {business.categories.length > 0 ? (
                      <span className="tag-list">
                        {business.categories.map((c) => (
                          <span key={c.id} className="tag">
                            {c.name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className="cell-icon">
                      <MapPinIcon size={14} />
                      {business.provinceName}, {business.municipality}
                    </span>
                  </td>
                  <td>
                    {business.contactPhone ? (
                      <span className="cell-icon">
                        <PhoneIcon size={14} />
                        {business.contactPhone}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className="cell-icon">
                      <BoxIcon size={14} />
                      {business.productCount}
                    </span>
                  </td>
                  <td>
                    <span className="cell-icon" title={business.active ? 'Visible' : 'Oculto'}>
                      {business.active ? <CheckIcon size={16} /> : <CloseIcon size={16} />}
                      {business.active ? 'Sí' : 'No'}
                    </span>
                  </td>
                  <td>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title="Editar negocio"
                        aria-label={`Editar ${business.name}`}
                        onClick={() => edit(business)}
                      >
                        <PencilIcon size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        title="Eliminar negocio"
                        aria-label={`Eliminar ${business.name}`}
                        onClick={() => void remove(business)}
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
              {editingId ? 'Editar negocio' : 'Nuevo negocio'}
            </>
          }
          onClose={closeForm}
        >
          <form onSubmit={submit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="name" className="label-icon">
                  <StoreIcon /> Nombre
                </label>
                <input
                  id="name"
                  required
                  maxLength={160}
                  placeholder="Nombre del negocio"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="contactPhone" className="label-icon">
                  <PhoneIcon /> Teléfono de contacto
                </label>
                <input
                  id="contactPhone"
                  type="tel"
                  maxLength={40}
                  placeholder="+53 5 000 0000"
                  value={form.contactPhone ?? ''}
                  onChange={(e) => set('contactPhone', e.target.value)}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="province" className="label-icon">
                  <MapIcon /> Provincia
                </label>
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
                <label htmlFor="municipalityId" className="label-icon">
                  <MapPinIcon /> Municipio
                </label>
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
              <span className="field-label label-icon">
                <TagIcon /> Categorías
              </span>
              <MultiSelect
                label="Categorías"
                placeholder="Selecciona una o varias categorías"
                options={categories}
                value={form.categoryIds}
                onChange={(categoryIds) => set('categoryIds', categoryIds)}
              />
              <p className="field-hint">
                Un negocio puede ofrecer varios servicios (dulcería, panadería, cafetería…).
              </p>
            </div>
            <div className="field">
              <span className="field-label label-icon">
                <ImageIcon /> Logo
              </span>
              <div className="logo-upload">
                <input
                  id="logoFile"
                  ref={logoInputRef}
                  type="file"
                  className="visually-hidden"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => void uploadLogo(e.target.files?.[0])}
                />
                <label htmlFor="logoFile" className="logo-dropzone">
                  {form.logoUrl?.trim() ? (
                    <img className="business-logo" src={form.logoUrl} alt="Vista previa del logo" />
                  ) : (
                    <span className="logo-upload-placeholder" aria-hidden="true">
                      <ImageIcon size={22} />
                    </span>
                  )}
                  <span className="logo-dropzone-text">
                    <span className="logo-dropzone-action">
                      <UploadIcon size={15} />
                      {uploadingLogo
                        ? 'Subiendo…'
                        : form.logoUrl?.trim()
                          ? 'Cambiar imagen'
                          : 'Subir imagen'}
                    </span>
                    <span className="field-hint">PNG, JPG, WEBP o SVG. Máximo 2 MB.</span>
                  </span>
                </label>
                {form.logoUrl?.trim() && (
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Quitar logo"
                    aria-label="Quitar logo"
                    onClick={() => set('logoUrl', '')}
                  >
                    <TrashIcon size={15} />
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="description" className="label-icon">
                <TextIcon /> Descripción
              </label>
              <textarea
                id="description"
                rows={2}
                maxLength={2000}
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="active" className="checkbox">
                <input
                  id="active"
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                <EyeIcon /> Visible en el catálogo
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={closeForm}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit">
                {editingId ? <CheckIcon /> : <PlusIcon />}
                {editingId ? 'Guardar cambios' : 'Crear negocio'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
