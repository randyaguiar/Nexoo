import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CloseIcon, PlusIcon, TrashIcon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import {
  ADMIN_ROLES,
  adminRoleLabel,
  isBusinessScoped,
  type AdminRole,
  type AdminUser,
  type AdminUserInput,
  type Business,
} from '../../api/types';

const emptyForm = (role: AdminRole, businessId: string | null): AdminUserInput => ({
  email: '',
  password: '',
  role,
  businessId,
});

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [current, setCurrent] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<AdminUserInput>(emptyForm('worker', null));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, me, businessList] = await Promise.all([
        api.admin.listUsers(),
        api.admin.currentAdmin(),
        api.admin.listBusinesses(),
      ]);
      setUsers(list);
      setCurrent(me);
      setBusinesses(businessList);
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
  // El admin de negocio solo puede dar de alta trabajadores de su propio negocio.
  const canManage = isOwner || current?.role === 'business_admin';
  const roleOptions = isOwner ? ADMIN_ROLES : ADMIN_ROLES.filter((r) => r.value === 'worker');
  const businessName = (id: string | null) =>
    businesses.find((b) => b.id === id)?.name ?? (id ? '—' : 'Global');

  const resetForm = () =>
    setForm(
      isOwner ? emptyForm('staff', null) : emptyForm('worker', current?.businessId ?? null),
    );

  /** Cambiar a un rol de negocio exige elegir negocio; a uno global, limpiarlo. */
  const setRole = (role: AdminRole) =>
    setForm((f) => ({
      ...f,
      role,
      businessId: isBusinessScoped(role) ? (f.businessId ?? current?.businessId ?? null) : null,
    }));

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
      resetForm();
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
      await api.admin.setUserRole(
        user.userId,
        role,
        isBusinessScoped(role) ? user.businessId : null,
      );
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

      {!loading && !canManage && (
        <p className="empty">No tienes permiso para gestionar los usuarios del panel.</p>
      )}

      {canManage && (
        <div className="page-toolbar">
          <h3 className="form-title">Usuarios del panel</h3>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
          >
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
                <th>Negocio</th>
                <th>Alta</th>
                {canManage && <th />}
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
                        {roleOptions.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      adminRoleLabel(user.role)
                    )}
                  </td>
                  <td>{businessName(user.businessId)}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString('es')}</td>
                  {canManage && (
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
                  onChange={(e) => setRole(e.target.value as AdminRole)}
                  disabled={!isOwner}
                >
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {isBusinessScoped(form.role) && (
              <div className="field">
                <label htmlFor="userBusiness">Negocio</label>
                <select
                  id="userBusiness"
                  required
                  value={form.businessId ?? ''}
                  onChange={(e) => set('businessId', e.target.value || null)}
                  disabled={!isOwner}
                >
                  <option value="">Elige un negocio</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
