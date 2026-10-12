import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Business, CountryRef, Municipality, ProvinceRef } from '../../api/types';
import {
  CheckIcon,
  CloseIcon,
  GridIcon,
  MapIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '../../components/Icon';
import { Modal } from '../../components/Modal';

const emptyCountry = { code: '', name: '', phonePrefix: '', active: true };
const emptyProvince = { code: '', countryCode: '', name: '', active: true };

export function AdminPlacesPage() {
  const [countries, setCountries] = useState<CountryRef[]>([]);
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // El aviso del municipio se muestra junto a su tabla, no al principio de la página.
  const [municipalityError, setMunicipalityError] = useState<string | null>(null);

  const [countryForm, setCountryForm] = useState(emptyCountry);
  const [editingCountry, setEditingCountry] = useState<string | null>(null);
  const [countryFormOpen, setCountryFormOpen] = useState(false);
  /** El país que se está mirando: filtra las provincias de abajo. */
  const [selectedCountry, setSelectedCountry] = useState('');

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
      const [countryList, provinceList, municipalityList, businessList] = await Promise.all([
        api.admin.listCountries(),
        api.listProvinces(),
        api.listMunicipalities(),
        api.admin.listBusinesses(),
      ]);
      setCountries(countryList);
      setProvinces(provinceList);
      setMunicipalities(municipalityList);
      setBusinesses(businessList);
      setSelectedCountry((current) => current || countryList[0]?.code || '');
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

  const closeCountryForm = () => {
    setCountryForm(emptyCountry);
    setEditingCountry(null);
    setCountryFormOpen(false);
  };

  const openCreateCountry = () => {
    setCountryForm(emptyCountry);
    setEditingCountry(null);
    setCountryFormOpen(true);
  };

  const editCountry = (country: CountryRef) => {
    setEditingCountry(country.code);
    setCountryForm({
      code: country.code,
      name: country.name,
      phonePrefix: country.phonePrefix ?? '',
      active: country.active,
    });
    setCountryFormOpen(true);
  };

  const submitCountry = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (editingCountry) {
        await api.admin.updateCountry(editingCountry, countryForm);
      } else {
        await api.admin.createCountry(countryForm);
      }
      setError(null);
      closeCountryForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeCountry = async (country: CountryRef) => {
    if (!confirm(`¿Eliminar "${country.name}"? Solo se puede si no tiene provincias.`)) return;
    try {
      await api.admin.deleteCountry(country.code);
      if (editingCountry === country.code) closeCountryForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const closeProvinceForm = () => {
    setProvinceForm(emptyProvince);
    setEditingProvince(null);
    setProvinceFormOpen(false);
  };

  const openCreateProvince = () => {
    setProvinceForm({ ...emptyProvince, countryCode: selectedCountry });
    setEditingProvince(null);
    setProvinceFormOpen(true);
  };

  const editProvince = (province: ProvinceRef) => {
    setEditingProvince(province.code);
    setProvinceForm({
      code: province.code,
      countryCode: province.countryCode,
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
      countryCode: provinceForm.countryCode,
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
  const visibleProvinces = provinces.filter((p) => p.countryCode === selectedCountry);

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">
          <GridIcon size={18} /> Países
        </h3>
        <button type="button" onClick={openCreateCountry}>
          <PlusIcon /> Nuevo país
        </button>
      </div>

      <p className="field-hint" style={{ marginBottom: 'var(--space-3)' }}>
        Un país apagado no sale en el catálogo, y con él se esconden sus provincias y sus negocios.
      </p>

      {loading && <p className="empty">Cargando…</p>}

      {countries.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 32 }}>
          <table>
            <thead>
              <tr>
                <th>País</th>
                <th>Código</th>
                <th>Teléfono</th>
                <th>Provincias</th>
                <th>Visible</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {countries.map((country) => {
                const provinceCount = provinces.filter(
                  (p) => p.countryCode === country.code,
                ).length;
                return (
                  <tr key={country.code}>
                    <td>{country.name}</td>
                    <td>{country.code}</td>
                    <td>{country.phonePrefix ?? '—'}</td>
                    <td>{provinceCount}</td>
                    <td>{country.active ? 'Sí' : 'No'}</td>
                    <td>
                      <span className="row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          title="Editar país"
                          aria-label={`Editar ${country.name}`}
                          onClick={() => editCountry(country)}
                        >
                          <PencilIcon size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          disabled={provinceCount > 0}
                          title={
                            provinceCount > 0
                              ? 'Tiene provincias: desmarca "Visible" en lugar de borrarlo.'
                              : 'Eliminar país'
                          }
                          aria-label={`Eliminar ${country.name}`}
                          onClick={() => void removeCountry(country)}
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
          <MapIcon size={18} /> Provincias
        </h3>
        <button type="button" onClick={openCreateProvince} disabled={!selectedCountry}>
          <PlusIcon /> Nueva provincia
        </button>
      </div>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="provinceCountry">País</label>
        <select
          id="provinceCountry"
          value={selectedCountry}
          onChange={(e) => setSelectedCountry(e.target.value)}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {!loading && visibleProvinces.length === 0 && (
        <p className="empty">Este país todavía no tiene provincias.</p>
      )}

      {visibleProvinces.length > 0 && (
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
              {visibleProvinces.map((province) => {
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
          {visibleProvinces.map((p) => (
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
            <div className="field">
              <label htmlFor="provinceFormCountry">País</label>
              <select
                id="provinceFormCountry"
                required
                value={provinceForm.countryCode}
                onChange={(e) =>
                  setProvinceForm((f) => ({ ...f, countryCode: e.target.value }))
                }
              >
                <option value="">Elige un país…</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
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
                <p className="field-hint">
                  Identificador interno, sin espacios ni acentos. Es único en todo el marketplace,
                  no dentro del país: usa prefijo (
                  {provinceForm.countryCode ? `${provinceForm.countryCode}Santiago` : 'CUSantiago'})
                  para que no choque con una provincia del mismo nombre en otra isla.
                </p>
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
              <button type="submit" disabled={!provinceForm.countryCode}>
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
                  {visibleProvinces.map((p) => (
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

      {countryFormOpen && (
        <Modal
          title={
            <>
              {editingCountry ? <PencilIcon size={18} /> : <PlusIcon size={18} />}
              {editingCountry ? 'Editar país' : 'Nuevo país'}
            </>
          }
          onClose={closeCountryForm}
        >
          <form onSubmit={submitCountry}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="countryCode">Código</label>
                <input
                  id="countryCode"
                  required
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  title="Dos letras, como en el estándar ISO (CU, DO, JM)"
                  value={countryForm.code}
                  onChange={(e) => setCountryForm((f) => ({ ...f, code: e.target.value }))}
                />
                <p className="field-hint">Dos letras, ISO 3166 (CU, DO, JM…).</p>
              </div>
              <div className="field">
                <label htmlFor="countryName">Nombre</label>
                <input
                  id="countryName"
                  required
                  maxLength={120}
                  value={countryForm.name}
                  onChange={(e) => setCountryForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="countryPhone">Prefijo telefónico</label>
              <input
                id="countryPhone"
                maxLength={10}
                placeholder="+53"
                value={countryForm.phonePrefix}
                onChange={(e) => setCountryForm((f) => ({ ...f, phonePrefix: e.target.value }))}
              />
              <p className="field-hint">Solo se usa como ejemplo en los formularios.</p>
            </div>
            <div className="field">
              <label htmlFor="countryActive" className="checkbox">
                <input
                  id="countryActive"
                  type="checkbox"
                  checked={countryForm.active}
                  onChange={(e) => setCountryForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Visible en el catálogo
              </label>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={closeCountryForm}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit">
                {editingCountry ? <CheckIcon /> : <PlusIcon />}
                {editingCountry ? 'Guardar cambios' : 'Crear país'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
