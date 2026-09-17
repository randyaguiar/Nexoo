import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CheckIcon, CloseIcon } from '../../components/Icon';
import { useAuth } from '../../auth/AuthContext';
import {
  BUSINESS_APPLICATION_STATUSES,
  businessApplicationStatusLabel,
  isGlobalRole,
  type BusinessApplication,
  type BusinessApplicationStatus,
} from '../../api/types';

export function AdminApplicationsPage() {
  const { admin } = useAuth();
  const [applications, setApplications] = useState<BusinessApplication[]>([]);
  const [status, setStatus] = useState<BusinessApplicationStatus | ''>('pending');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setApplications(await api.businessApplications.list(status || null));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const canReview = admin ? isGlobalRole(admin.role) : false;

  const approve = async (application: BusinessApplication) => {
    if (!confirm(`¿Aprobar "${application.name}"? Se creará el negocio y su admin.`)) return;

    setWorking(application.id);
    setError(null);
    setNotice(null);
    try {
      await api.businessApplications.approve(application.id);
      setNotice(`"${application.name}" ya puede subir sus productos.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  const reject = async (application: BusinessApplication) => {
    const note = prompt(`Motivo del rechazo de "${application.name}":`);
    // Cancelar el prompt devuelve null; una cadena vacía la rechaza la función.
    if (note === null) return;

    setWorking(application.id);
    setError(null);
    setNotice(null);
    try {
      await api.businessApplications.reject(application.id, note);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">Solicitudes de alta</h3>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Todas</option>
          {BUSINESS_APPLICATION_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="empty">Cargando solicitudes…</p>}

      {!loading && applications.length === 0 && (
        <p className="empty">No hay solicitudes con ese estado.</p>
      )}

      {!loading && applications.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Negocio</th>
                <th>Dónde</th>
                <th>Contacto</th>
                <th>Estado</th>
                <th>Enviada</th>
                {canReview && <th />}
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <strong>{application.name}</strong>
                    {application.description && (
                      <>
                        <br />
                        <span className="field-hint">{application.description}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {application.municipalityName ?? '—'}
                    {application.provinceName && (
                      <>
                        <br />
                        <span className="field-hint">{application.provinceName}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {application.contactEmail}
                    <br />
                    <span className="field-hint">{application.contactPhone}</span>
                  </td>
                  <td>
                    {businessApplicationStatusLabel(application.status)}
                    {application.reviewNote && (
                      <>
                        <br />
                        <span className="field-hint">{application.reviewNote}</span>
                      </>
                    )}
                  </td>
                  <td>{new Date(application.createdAt).toLocaleDateString('es')}</td>
                  {canReview && (
                    <td>
                      {application.status === 'pending' && (
                        <span className="row-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title="Aprobar"
                            disabled={working === application.id}
                            onClick={() => void approve(application)}
                          >
                            <CheckIcon />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Rechazar"
                            disabled={working === application.id}
                            onClick={() => void reject(application)}
                          >
                            <CloseIcon />
                          </button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
