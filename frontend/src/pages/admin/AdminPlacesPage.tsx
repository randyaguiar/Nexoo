import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Business, Municipality, ProvinceRef } from '../../api/types';

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

  const [selectedProvince, setSelectedProvince] = useState('');
  const [municipalityName, setMunicipalityName] = useState('');
  const [municipalityActive, setMunicipalityActive] = useState(true);
  const [editingMunicipality, setEditingMunicipality] = useState<string | null>(null);

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

  const resetProvince = () => {
    setProvinceForm(emptyProvince);
    setEditingProvince(null);
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
      resetProvince();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeProvince = async (province: ProvinceRef) => {
    if (!confirm(`¿Eliminar la provincia "${province.name}" y sus municipios?`)) return;
    try {
      await api.admin.deleteProvince(province.code);
      if (editingProvince === province.code) resetProvince();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resetMunicipality = () => {
    setMunicipalityName('');
    setMunicipalityActive(true);
    setEditingMunicipality(null);
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
      resetMunicipality();
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
      if (editingMunicipality === municipality.id) resetMunicipality();
      await load();
    } catch (e) {
      setMunicipalityError((e as Error).message);
    }
  };

  const businessesIn = (municipalityId: string) =>
    businesses.filter((b) => b.municipalityId === municipalityId).length;

  const visibleMunicipalities = municipalities.filter(
    (m) => m.provinceCode === selectedProvince,
  );

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <form className="card" style={{ marginBottom: 24 }} onSubmit={submitProvince}>
        <h3>{editingProvince ? 'Editar provincia' : 'Nueva provincia'}</h3>
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
          <label htmlFor="provinceActive">
            <input
              id="provinceActive"
              type="checkbox"
              style={{ width: 'auto', marginRight: 8 }}
              checked={provinceForm.active}
              onChange={(e) => setProvinceForm((f) => ({ ...f, active: e.target.checked }))}
            />
            Visible en el catálogo
          </label>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <button type="submit">{editingProvince ? 'Guardar cambios' : 'Crear provincia'}</button>
          {editingProvince && (
            <button type="button" className="secondary" onClick={resetProvince}>
              Cancelar
            </button>
          )}
        </div>
      </form>

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
              {provinces.map((province) => (
                <tr key={province.code}>
                  <td>{province.name}</td>
                  <td>{province.code}</td>
                  <td>{municipalities.filter((m) => m.provinceCode === province.code).length}</td>
                  <td>{province.active ? 'Sí' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setEditingProvince(province.code);
                        setProvinceForm({
                          code: province.code,
                          name: province.name,
                          active: province.active,
                        });
                      }}
                    >
                      Editar
                    </button>{' '}
                    <button
                      type="button"
                      className="link"
                      disabled={businesses.some((b) => b.province === province.code)}
                      title={
                        businesses.some((b) => b.province === province.code)
                          ? 'Tiene negocios: desmarca "Visible" en lugar de borrarla.'
                          : undefined
                      }
                      onClick={() => void removeProvince(province)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>Municipios</h3>
      {municipalityError && <div className="alert error">{municipalityError}</div>}
      <form className="card" style={{ marginBottom: 24 }} onSubmit={submitMunicipality}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="municipalityProvince">Provincia</label>
            <select
              id="municipalityProvince"
              value={selectedProvince}
              onChange={(e) => {
                setSelectedProvince(e.target.value);
                resetMunicipality();
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
          <label htmlFor="municipalityActive">
            <input
              id="municipalityActive"
              type="checkbox"
              style={{ width: 'auto', marginRight: 8 }}
              checked={municipalityActive}
              onChange={(e) => setMunicipalityActive(e.target.checked)}
            />
            Visible en el catálogo
          </label>
        </div>
        <div className="filters" style={{ margin: 0 }}>
          <button type="submit" disabled={!selectedProvince}>
            {editingMunicipality ? 'Guardar cambios' : 'Añadir municipio'}
          </button>
          {editingMunicipality && (
            <button type="button" className="secondary" onClick={resetMunicipality}>
              Cancelar
            </button>
          )}
        </div>
      </form>

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
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setEditingMunicipality(municipality.id);
                        setMunicipalityName(municipality.name);
                        setMunicipalityActive(municipality.active);
                      }}
                    >
                      Editar
                    </button>{' '}
                    <button
                      type="button"
                      className="link"
                      disabled={businessesIn(municipality.id) > 0}
                      title={
                        businessesIn(municipality.id) > 0
                          ? 'Tiene negocios: muévelos de municipio o desmarca "Visible" al editarlo.'
                          : undefined
                      }
                      onClick={() => void removeMunicipality(municipality)}
                    >
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
