import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CloseIcon, PlusIcon, TrashIcon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import {
  ADMIN_ROLES,
  adminRoleLabel,
  type AdminRole,
  type AdminUser,
  type AdminUserInput,
} from '../../api/types';

const emptyForm: AdminUserInput = { email: '', password: '', role: 'staff' };

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [current, setCurrent] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<AdminUserInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, me] = await Promise.all([api.admin.listUsers(), api.admin.currentAdmin()]);
      setUsers(list);
      setCurrent(me);
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

  const set = <K extends keyof AdminUserInput>(key: K, value: AdminUserInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isOwner = current?.role === 'owner';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      await api.admin.inviteUser(form);
      setNotice(
        form.password
          ? `${form.email} ya puede entrar con la contraseña indicada.`
          : `Invitación enviada a ${form.email}.`,
      );
      setForm(emptyForm);
      setFormOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const changeRole = async (user: AdminUser, role: AdminRole) => {
    setError(null);
    setNotice(null);
    try {
      await api.admin.setUserRole(user.userId, role);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (user: AdminUser) => {
    if (!confirm(`¿Quitar el acceso al panel de ${user.email}?`)) return;

    setError(null);
    setNotice(null);
    try {
      await api.admin.removeUser(user.userId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      {!loading && !isOwner && (
        <p className="empty">Solo un owner puede gestionar los usuarios del panel.</p>
      )}

      {isOwner && (
        <div className="page-toolbar">
          <h3 className="form-title">Usuarios del panel</h3>
          <button type="button" onClick={() => setFormOpen(true)}>
            <PlusIcon /> Nuevo usuario
          </button>
        </div>
      )}

      {loading && <p className="empty">Cargando usuarios…</p>}

      {!loading && users.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Rol</th>
                <th>Alta</th>
                {isOwner && <th />}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>
                    {user.email}
                    {user.userId === current?.userId && ' (tú)'}
                  </td>
                  <td>
                    {isOwner && user.userId !== current?.userId ? (
                      <select
                        value={user.role}
                        onChange={(e) => void changeRole(user, e.target.value as AdminRole)}
                      >
                        {ADMIN_ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      adminRoleLabel(user.role)
                    )}
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString('es')}</td>
                  {isOwner && (
                    <td>
                      {user.userId !== current?.userId && (
                        <span className="row-actions">
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Quitar acceso"
                            aria-label={`Quitar acceso a ${user.email}`}
                            onClick={() => void remove(user)}
                          >
                            <TrashIcon size={15} />
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

      {formOpen && (
        <Modal
          title={
            <>
              <PlusIcon size={18} /> Nuevo usuario del panel
            </>
          }
          onClose={() => setFormOpen(false)}
        >
          <form onSubmit={submit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="role">Rol</label>
                <select
                  id="role"
                  value={form.role}
                  onChange={(e) => set('role', e.target.value as AdminRole)}
                >
                  {ADMIN_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="password">Contraseña (opcional)</label>
              <input
                id="password"
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
              />
              <p className="field-hint">Si la dejas vacía se envía una invitación por email.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={() => setFormOpen(false)}>
                <CloseIcon /> Cancelar
              </button>
              <button type="submit" disabled={submitting}>
                <PlusIcon />
                {submitting ? 'Creando…' : 'Dar acceso'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
