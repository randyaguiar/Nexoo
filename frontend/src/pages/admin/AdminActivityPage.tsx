import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  activityActionLabel,
  activityEntityLabel,
  adminRoleLabel,
  type ActivityEntry,
  type Business,
} from '../../api/types';

const ENTITIES = ['businesses', 'products', 'orders', 'admins', 'categories'];

/** Resume los cambios de una línea sin volcar el JSON crudo en pantalla. */
const describe = (entry: ActivityEntry): string => {
  const keys = Object.keys(entry.changes);
  if (keys.length === 0) return '—';

  if (entry.action !== 'update') {
    const name = entry.changes.name ?? entry.changes.email;
    return typeof name === 'string' ? name : keys.join(', ');
  }

  return keys
    .map((key) => {
      const change = entry.changes[key] as { from?: unknown; to?: unknown };
      return `${key}: ${JSON.stringify(change?.from ?? null)} → ${JSON.stringify(change?.to ?? null)}`;
    })
    .join('\n');
};

export function AdminActivityPage() {
  const { admin } = useAuth();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [entity, setEntity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const isOwner = admin?.role === 'owner';

  useEffect(() => {
    if (!isOwner) return;
    api.admin
      .listBusinesses()
      .then(setBusinesses)
      .catch((e: Error) => setError(e.message));
  }, [isOwner]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.admin.listActivity({ businessId, entity }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [businessId, entity]);

  useEffect(() => {
    if (isOwner) void load();
  }, [isOwner, load]);

  if (!isOwner) {
    return <p className="empty">El historial de cambios solo lo ve el admin general.</p>;
  }

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="page-toolbar">
        <h3 className="form-title">Historial de cambios</h3>
        <span className="row-actions">
          <select value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
            <option value="">Todos los negocios</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todo</option>
            {ENTITIES.map((name) => (
              <option key={name} value={name}>
                {activityEntityLabel(name)}
              </option>
            ))}
          </select>
        </span>
      </div>

      {loading && <p className="empty">Cargando historial…</p>}

      {!loading && entries.length === 0 && <p className="empty">Todavía no hay cambios registrados.</p>}

      {!loading && entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Quién</th>
                <th>Qué</th>
                <th>Cambios</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.at).toLocaleString('es')}</td>
                  <td>
                    {entry.actorEmail ?? 'Sistema'}
                    {entry.actorRole && <> · {adminRoleLabel(entry.actorRole)}</>}
                  </td>
                  <td>
                    {activityActionLabel(entry.action)} · {activityEntityLabel(entry.entity)}
                  </td>
                  <td>
                    <pre className="activity-changes">{describe(entry)}</pre>
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
