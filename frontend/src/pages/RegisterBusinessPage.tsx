import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { MultiSelect } from '../components/MultiSelect';
import { useAuth } from '../auth/AuthContext';
import {
  businessApplicationStatusLabel,
  type BusinessApplication,
  type BusinessApplicationInput,
  type Category,
  type Municipality,
  type Province,
  type ProvinceRef,
} from '../api/types';

const emptyForm: BusinessApplicationInput = {
  name: '',
  description: '',
  municipalityId: '',
  contactPhone: '',
  categoryIds: [],
};

export function RegisterBusinessPage() {
  const { user, admin, loading } = useAuth();
  const [form, setForm] = useState<BusinessApplicationInput>(emptyForm);
  const [provinces, setProvinces] = useState<ProvinceRef[]>([]);
  const [province, setProvince] = useState<Province>('');
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [application, setApplication] = useState<BusinessApplication | null>(null);
  /** Comprador y negocio son cuentas separadas: con pedidos no se puede solicitar. */
  const [hasOrders, setHasOrders] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // La solicitud previa decide qué se enseña: el formulario o su estado.
  useEffect(() => {
    if (!user) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    Promise.all([api.businessApplications.mine(), api.auth.hasBuyerOrders()])
      .then(([row, bought]) => {
        if (cancelled) return;
        setApplication(row);
        setHasOrders(bought);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    Promise.all([api.listProvinces(), api.listCategories()])
      .then(([provinceList, categoryList]) => {
        setProvinces(provinceList);
        setCategories(categoryList.filter((c) => c.active));
        setProvince((current) => current || (provinceList[0]?.code ?? ''));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!province) {
      setMunicipalities([]);
      return;
    }

    let cancelled = false;
    api
      .listMunicipalities(province)
      .then((data) => {
        if (cancelled) return;
        setMunicipalities(data);
        // El municipio elegido puede no existir en la provincia recién seleccionada.
        setForm((current) =>
          data.some((m) => m.id === current.municipalityId)
            ? current
            : { ...current, municipalityId: data[0]?.id ?? '' },
        );
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [province]);

  const set = <K extends keyof BusinessApplicationInput>(
    key: K,
    value: BusinessApplicationInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await api.businessApplications.submit(form);
      setApplication(await api.businessApplications.mine());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || checking) return <p className="empty">Cargando…</p>;

  if (!user) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h1 className="page-title">Vende en Nexoo</h1>
        <p>
          Para solicitar el alta de tu negocio necesitas una cuenta.{' '}
          <Link to="/registro">Créala</Link> o <Link to="/entrar">entra</Link> y vuelve a esta
          página.
        </p>
      </div>
    );
  }

  // Quien ya gestiona un negocio no vuelve a solicitar: entra al panel.
  if (admin) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h1 className="page-title">Ya tienes acceso al panel</h1>
        <p>
          Tu cuenta ya gestiona un negocio en Nexoo.{' '}
          <Link to="/admin/productos">Ve a tus productos</Link>.
        </p>
      </div>
    );
  }

  if (application && application.status !== 'rejected') {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h1 className="page-title">Solicitud enviada</h1>
        <p>
          <strong>{application.name}</strong> —{' '}
          {businessApplicationStatusLabel(application.status)}
        </p>
        {application.status === 'pending' && (
          <p>
            La estamos revisando. Te avisaremos cuando esté lista; mientras tanto no hace falta que
            hagas nada.
          </p>
        )}
        {application.status === 'approved' && (
          <p>
            Tu negocio ya está activo. <Link to="/admin/productos">Sube tus productos</Link> para
            que aparezca en el catálogo.
          </p>
        )}
      </div>
    );
  }

  // La policy rechazaría el insert igual; esto lo explica antes de rellenar nada.
  if (hasOrders) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
        <h1 className="page-title">Esta cuenta es de comprador</h1>
        <p>
          Ya has hecho pedidos con ella, y en Nexoo una cuenta compra o vende, pero no las dos
          cosas: así tus pedidos y los de tu negocio no se mezclan.
        </p>
        <p>
          Para dar de alta tu negocio, <Link to="/registro">crea una cuenta nueva</Link> con otro
          correo y solicita el alta desde ahí.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 640, margin: '40px auto' }}>
      <h1 className="page-title">Vende en Nexoo</h1>
      <p className="page-subtitle">
        Cuéntanos de tu negocio. Si lo aprobamos, podrás subir tus productos y gestionar tus pedidos
        desde tu propio panel.
      </p>

      {application?.status === 'rejected' && (
        <div className="alert info" role="status">
          Tu solicitud anterior fue rechazada: {application.reviewNote}. Puedes enviar una nueva
          corrigiendo lo indicado.
        </div>
      )}

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="name">Nombre del negocio</label>
          <input
            id="name"
            required
            maxLength={160}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="description">Qué vendes</label>
          <textarea
            id="description"
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
          <p className="field-hint">Una o dos frases; es lo que verá el comprador.</p>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="province">Provincia</label>
            <select id="province" value={province} onChange={(e) => setProvince(e.target.value)}>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="municipality">Municipio</label>
            <select
              id="municipality"
              required
              value={form.municipalityId}
              onChange={(e) => set('municipalityId', e.target.value)}
            >
              {municipalities.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="contactPhone">Teléfono de contacto</label>
          <input
            id="contactPhone"
            required
            maxLength={40}
            value={form.contactPhone}
            onChange={(e) => set('contactPhone', e.target.value)}
          />
          <p className="field-hint">Para coordinar contigo los pedidos. No sale en el catálogo.</p>
        </div>

        {categories.length > 0 && (
          <div className="field">
            <span className="field-label">Categorías</span>
            <MultiSelect
              label="Categorías"
              placeholder="Selecciona una o varias categorías"
              options={categories}
              value={form.categoryIds}
              onChange={(categoryIds) => set('categoryIds', categoryIds)}
            />
            <p className="field-hint">Ayuda al comprador a encontrarte en el catálogo.</p>
          </div>
        )}

        <button type="submit" className="full-width" disabled={submitting || !form.municipalityId}>
          {submitting ? 'Enviando…' : 'Enviar solicitud'}
        </button>
      </form>
    </div>
  );
}
