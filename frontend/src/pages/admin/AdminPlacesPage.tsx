import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Business, Municipality, ProvinceRef } from '../../api/types';
import {
  CheckIcon,
  CloseIcon,
  MapIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../../components/Icon';
import { Modal } from '../../components/Modal';

const emptyProvince = { code: '', name: '', active: true };

export function AdminPlacesPage() {
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // El aviso del municipio se muestra junto a su tabla, no al principio de la página.
  const [municipalityError, setMunicipalityError] = useState<string | null>(null);

  const [provinceForm, setProvinceForm] = useState(emptyProvince);
  const [editingProvince, setEditingProvince] = useState<string | null>(null);
  const [provinceFormOpen, setProvinceFormOpen] = useState(false);

  const [selectedProvince, setSelectedProvince] = useState('');
  const [municipalityName, setMunicipalityName] = useState('');
  const [municipalityActive, setMunicipalityActive] = useState(true);
  const [editingMunicipality, setEditingMunicipality] = useState<string | null>(null);
  const [municipalityFormOpen, setMunicipalityFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [provinceList, municipalityList, businessList] = await Promise.all([
        api.listProvinces(),
        api.listMunicipalities(),
        api.admin.listBusinesses(),
      ]);
      setProvinces(provinceList);
      setMunicipalities(municipalityList);
      setBusinesses(businessList);
      setSelectedProvince((current) => current || provinceList[0]?.code || '');
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

  const closeProvinceForm = () => {
    setProvinceForm(emptyProvince);
    setEditingProvince(null);
    setProvinceFormOpen(false);
  };

  const openCreateProvince = () => {
    setProvinceForm(emptyProvince);
    setEditingProvince(null);
    setProvinceFormOpen(true);
  };

  const editProvince = (province: ProvinceRef) => {
    setEditingProvince(province.code);
    setProvinceForm({
      code: province.code,
      name: province.name,
      active: province.active,
    });
    setProvinceFormOpen(true);
  };

  const submitProvince = async (event: React.FormEvent) => {
    event.preventDefault();
    // El código identifica la provincia en negocios y pedidos: sin espacios ni acentos.
    const input = {
      code: provinceForm.code.trim(),
      name: provinceForm.name.trim(),
      active: provinceForm.active,
    };
    try {
      if (editingProvince) {
        await api.admin.updateProvince(editingProvince, input);
      } else {
        await api.admin.createProvince(input);
      }
      setError(null);
      closeProvinceForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeProvince = async (province: ProvinceRef) => {
    if (!confirm(`¿Eliminar la provincia "${province.name}" y sus municipios?`)) return;
    try {
      await api.admin.deleteProvince(province.code);
      if (editingProvince === province.code) closeProvinceForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const closeMunicipalityForm = () => {
    setMunicipalityName('');
    setMunicipalityActive(true);
    setEditingMunicipality(null);
    setMunicipalityFormOpen(false);
  };

  const openCreateMunicipality = () => {
    setMunicipalityName('');
    setMunicipalityActive(true);
    setEditingMunicipality(null);
    setMunicipalityFormOpen(true);
  };

  const editMunicipality = (municipality: Municipality) => {
    setEditingMunicipality(municipality.id);
    setMunicipalityName(municipality.name);
    setMunicipalityActive(municipality.active);
    setMunicipalityFormOpen(true);
  };

  const submitMunicipality = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      provinceCode: selectedProvince,
      name: municipalityName.trim(),
      active: municipalityActive,
    };
    try {
      if (editingMunicipality) {
        await api.admin.updateMunicipality(editingMunicipality, input);
      } else {
        await api.admin.createMunicipality(input);
      }
      setMunicipalityError(null);
      closeMunicipalityForm();
      await load();
    } catch (e) {
      setMunicipalityError((e as Error).message);
    }
  };

  const removeMunicipality = async (municipality: Municipality) => {
    if (!confirm(`¿Eliminar el municipio "${municipality.name}"?`)) return;
    try {
      await api.admin.deleteMunicipality(municipality.id);
      setMunicipalityError(null);
      if (editingMunicipality === municipality.id) closeMunicipalityForm();
      await load();
    } catch (e) {
      setMunicipalityError((e as Error).message);
    }
  };

  const businessesIn = (municipalityId: string) =>
    businesses.filter((b) => b.municipalityId === municipalityId).length;

  const visibleMunicipalities = municipalities.filter((m) => m.provinceCode === selectedProvince);

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">
          <MapIcon size={18} /> Provincias
        </h3>
        <button type="button" onClick={openCreateProvince}>
          <PlusIcon /> Nueva provincia
        </button>
      </div>

      {loading && <p className="empty">Cargando provincias…</p>}

      {provinces.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 32 }}>
          <table>
            <thead>
              <tr>
                <th>Provincia</th>
                <th>Código</th>
                <th>Municipios</th>
                <th>Visible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {provinces.map((province) => {
                const hasBusinesses = businesses.some((b) => b.province === province.code);
                return (
                  <tr key={province.code}>
                    <td>{province.name}</td>
                    <td>{province.code}</td>
                    <td>{municipalities.filter((m) => m.provinceCode === province.code).length}</td>
                    <td>{province.active ? 'Sí' : 'No'}</td>
                    <td>
                      <span className="row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          title="Editar provincia"
                          aria-label={`Editar ${province.name}`}
                          onClick={() => editProvince(province)}
                        >
                          <PencilIcon size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          disabled={hasBusinesses}
                          title={
                            hasBusinesses
                              ? 'Tiene negocios: desmarca "Visible" en lugar de borrarla.'
                              : 'Eliminar provincia'
                          }
                          aria-label={`Eliminar ${province.name}`}
                          onClick={() => void removeProvince(province)}
                        >
                          <TrashIcon size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="page-toolbar">
        <h3 className="form-title">
          <MapPinIcon size={18} /> Municipios
        </h3>
        <button type="button" onClick={openCreateMunicipality} disabled={!selectedProvince}>
          <PlusIcon /> Nuevo municipio
        </button>
      </div>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="municipalityProvince">Provincia</label>
        <select
          id="municipalityProvince"
          value={selectedProvince}
          onChange={(e) => {
            setSelectedProvince(e.target.value);
            closeMunicipalityForm();
          }}
        >
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {municipalityError && <div className="alert error">{municipalityError}</div>}

      {!loading && visibleMunicipalities.length === 0 && (
        <p className="empty">Esta provincia todavía no tiene municipios.</p>
      )}

      {visibleMunicipalities.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Municipio</th>
                <th>Negocios</th>
                <th>Visible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleMunicipalities.map((municipality) => (
                <tr key={municipality.id}>
                  <td>{municipality.name}</td>
                  <td>{businessesIn(municipality.id)}</td>
                  <td>{municipality.active ? 'Sí' : 'No'}</td>
                  <td>
                    <span className="row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title="Editar municipio"
                        aria-label={`Editar ${municipality.name}`}
                        onClick={() => editMunicipality(municipality)}
                      >
                        <PencilIcon size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        disabled={businessesIn(municipality.id) > 0}
                        title={
                          businessesIn(municipality.id) > 0
                            ? 'Tiene negocios: muévelos de municipio o desmarca "Visible" al editarlo.'
                            : 'Eliminar municipio'
                        }
                        aria-label={`Eliminar ${municipality.name}`}
                        onClick={() => void removeMunicipality(municipality)}
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

      {provinceFormOpen && (
        <Modal
          title={
            <>
              {editingProvince ? <PencilIcon size={18} /> : <PlusIcon size={18} />}
              {editingProvince ? 'Editar provincia' : 'Nueva provincia'}
            </>
          }
          onClose={closeProvinceForm}
        >
          <form onSubmit={submitProvince}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="provinceCode">Código</label>
                <input
                  id="provinceCode"
                  required
                  maxLength={60}
                  pattern="[A-Za-z0-9]+"
                  title="Solo letras y números, sin espacios (ej. Matanzas)"
                  value={provinceForm.code}
                  onChange={(e) => setProvinceForm((f) => ({ ...f, code: e.target.value }))}
                />
                <p className="field-hint">Identificador interno, sin espacios ni acentos.</p>
              </div>
              <div className="field">
                <label htmlFor="provinceName">Nombre</label>
                <input
                  id="provinceName"
                  required
                  maxLength={120}
                  value={provinceForm.name}
                  onChange={(e) => setProvinceForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="provinceActive" className="checkbox">
                <input
                  id="provinceActive"
                  type="checkbox"
                  checked={provinceForm.active}
                  onChange={(e) => setProvinceForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Visible en el catálogo
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={closeProvinceForm}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit">
                {editingProvince ? <CheckIcon /> : <PlusIcon />}
                {editingProvince ? 'Guardar cambios' : 'Crear provincia'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {municipalityFormOpen && (
        <Modal
          title={
            <>
              {editingMunicipality ? <PencilIcon size={18} /> : <PlusIcon size={18} />}
              {editingMunicipality ? 'Editar municipio' : 'Nuevo municipio'}
            </>
          }
          onClose={closeMunicipalityForm}
        >
          <form onSubmit={submitMunicipality}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="municipalityFormProvince">Provincia</label>
                <select
                  id="municipalityFormProvince"
                  value={selectedProvince}
                  onChange={(e) => setSelectedProvince(e.target.value)}
                >
                  {provinces.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="municipalityName">Municipio</label>
                <input
                  id="municipalityName"
                  required
                  maxLength={120}
                  value={municipalityName}
                  onChange={(e) => setMunicipalityName(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="municipalityActive" className="checkbox">
                <input
                  id="municipalityActive"
                  type="checkbox"
                  checked={municipalityActive}
                  onChange={(e) => setMunicipalityActive(e.target.checked)}
                />
                Visible en el catálogo
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={closeMunicipalityForm}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit" disabled={!selectedProvince}>
                {editingMunicipality ? <CheckIcon /> : <PlusIcon />}
                {editingMunicipality ? 'Guardar cambios' : 'Añadir municipio'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
