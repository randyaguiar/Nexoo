import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { CheckIcon, PencilIcon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { formatUsd } from '../../components/Money';
import {
  PAYOUT_METHODS,
  isGlobalRole,
  payoutMethodLabel,
  type Business,
  type PayoutAccount,
  type PendingSettlement,
  type Settlement,
  type SettlementPayment,
} from '../../api/types';

const emptyPayment = (method: PayoutAccount['method']): SettlementPayment => ({
  method,
  reference: '',
  payoutCurrency: 'USD',
  fxRate: null,
  payoutAmount: null,
  notes: '',
});

export function AdminSettlementsPage() {
  const { admin } = useAuth();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [pending, setPending] = useState<PendingSettlement[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [accounts, setAccounts] = useState<PayoutAccount[]>([]);
  const [paying, setPaying] = useState<Settlement | null>(null);
  const [payment, setPayment] = useState<SettlementPayment>(emptyPayment('zelle_us'));
  const [editingAccount, setEditingAccount] = useState<PayoutAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const isGlobal = admin ? isGlobalRole(admin.role) : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [businessList, pendingList, settlementList, accountList] = await Promise.all([
        api.admin.listBusinesses(),
        api.settlements.pending(),
        api.settlements.list(),
        api.settlements.payoutAccounts(),
      ]);
      setBusinesses(businessList);
      setPending(pendingList);
      setSettlements(settlementList);
      setAccounts(accountList);
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

  const businessName = (id: string) => businesses.find((b) => b.id === id)?.name ?? id;
  const accountOf = (id: string) => accounts.find((a) => a.businessId === id) ?? null;

  const createSettlement = async (row: PendingSettlement) => {
    const owed = row.costUsd;
    if (
      !confirm(
        `¿Cerrar una liquidación de ${businessName(row.businessId)} con ${row.orderCount} ` +
          `pedidos? Se le deberán ${formatUsd(owed)}.`,
      )
    ) {
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await api.settlements.create(row.businessId);
      setNotice('Liquidación creada. Queda pendiente de pago.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const openPayment = (settlement: Settlement) => {
    setPaying(settlement);
    setPayment(emptyPayment(accountOf(settlement.businessId)?.method ?? 'zelle_us'));
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paying) return;

    setWorking(true);
    setError(null);
    try {
      await api.settlements.markPaid(paying.id, payment);
      setPaying(null);
      setNotice('Liquidación marcada como pagada.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingAccount) return;

    setWorking(true);
    setError(null);
    try {
      await api.settlements.savePayoutAccount(editingAccount);
      setEditingAccount(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const inUsd = payment.payoutCurrency.trim().toUpperCase() === 'USD';

  return (
    <>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      {loading && <p className="empty">Cargando liquidaciones…</p>}

      {!loading && (
        <>
          <div className="page-toolbar">
            <h3 className="form-title">Pendiente de liquidar</h3>
          </div>

          {pending.length === 0 ? (
            <p className="empty">No hay pedidos cobrados pendientes de pagar a los negocios.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Negocio</th>
                    <th>Pedidos</th>
                    <th>Cobrado</th>
                    <th>Se le debe</th>
                    <th>Tu margen</th>
                    <th>Cómo se le paga</th>
                    {isGlobal && <th />}
                  </tr>
                </thead>
                <tbody>
                  {pending.map((row) => {
                    const account = accountOf(row.businessId);
                    return (
                      <tr key={row.businessId}>
                        <td>{businessName(row.businessId)}</td>
                        <td>{row.orderCount}</td>
                        <td>{formatUsd(row.grossUsd)}</td>
                        <td>
                          <strong>{formatUsd(row.costUsd)}</strong>
                        </td>
                        <td>{formatUsd(row.grossUsd - row.costUsd)}</td>
                        <td>
                          {account ? (
                            <>
                              {payoutMethodLabel(account.method)}
                              <div className="meta">
                                {account.holderName} · {account.contact}
                              </div>
                            </>
                          ) : (
                            <span className="field-hint">Sin datos de pago</span>
                          )}
                          {isGlobal && (
                            <button
                              type="button"
                              className="icon-button"
                              title="Editar datos de pago"
                              onClick={() =>
                                setEditingAccount(
                                  account ?? {
                                    businessId: row.businessId,
                                    method: 'zelle_us',
                                    holderName: '',
                                    contact: '',
                                    notes: null,
                                  },
                                )
                              }
                            >
                              <PencilIcon />
                            </button>
                          )}
                        </td>
                        {isGlobal && (
                          <td>
                            <button
                              type="button"
                              disabled={working}
                              onClick={() => void createSettlement(row)}
                            >
                              Cerrar liquidación
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="page-toolbar" style={{ marginTop: 'var(--space-5)' }}>
            <h3 className="form-title">Liquidaciones</h3>
          </div>

          {settlements.length === 0 ? (
            <p className="empty">Todavía no has cerrado ninguna liquidación.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Negocio</th>
                    <th>Periodo</th>
                    <th>Pedidos</th>
                    <th>Cobrado</th>
                    <th>Pagado al negocio</th>
                    <th>Tu margen</th>
                    <th>Estado</th>
                    {isGlobal && <th />}
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((settlement) => (
                    <tr key={settlement.id}>
                      <td>{businessName(settlement.businessId)}</td>
                      <td>
                        {settlement.periodStart} → {settlement.periodEnd}
                      </td>
                      <td>{settlement.orderCount}</td>
                      <td>{formatUsd(settlement.grossUsd)}</td>
                      <td>
                        {formatUsd(settlement.costUsd)}
                        {settlement.payoutCurrency !== 'USD' && settlement.payoutAmount !== null && (
                          <div className="meta">
                            {settlement.payoutAmount} {settlement.payoutCurrency}
                            {settlement.fxRate !== null && ` · ${settlement.fxRate}/USD`}
                          </div>
                        )}
                      </td>
                      <td>{formatUsd(settlement.feeUsd)}</td>
                      <td>
                        {settlement.status === 'paid' ? 'Pagada' : 'Pendiente'}
                        {settlement.payoutMethod && (
                          <div className="meta">{payoutMethodLabel(settlement.payoutMethod)}</div>
                        )}
                      </td>
                      {isGlobal && (
                        <td>
                          {settlement.status === 'pending' && (
                            <button
                              type="button"
                              className="icon-button"
                              title="Marcar como pagada"
                              disabled={working}
                              onClick={() => openPayment(settlement)}
                            >
                              <CheckIcon />
                            </button>
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
      )}

      {paying && (
        <Modal title="Registrar el pago al negocio" onClose={() => setPaying(null)}>
          <form onSubmit={submitPayment}>
            <p className="field-hint">
              {businessName(paying.businessId)} · se le deben {formatUsd(paying.costUsd)}
            </p>
            <div className="field">
              <label htmlFor="method">Cómo se pagó</label>
              <select
                id="method"
                value={payment.method}
                onChange={(e) =>
                  setPayment((p) => ({ ...p, method: e.target.value as PayoutAccount['method'] }))
                }
              >
                {PAYOUT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reference">Referencia</label>
              <input
                id="reference"
                value={payment.reference}
                onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
              />
              <p className="field-hint">Confirmación de Zelle, número de recibo…</p>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="currency">Moneda</label>
                <input
                  id="currency"
                  maxLength={4}
                  value={payment.payoutCurrency}
                  onChange={(e) => setPayment((p) => ({ ...p, payoutCurrency: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="fxRate">Tipo de cambio</label>
                <input
                  id="fxRate"
                  type="number"
                  step={0.0001}
                  disabled={inUsd}
                  value={payment.fxRate ?? ''}
                  onChange={(e) =>
                    setPayment((p) => ({
                      ...p,
                      fxRate: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="payoutAmount">Importe entregado</label>
                <input
                  id="payoutAmount"
                  type="number"
                  step={0.01}
                  disabled={inUsd}
                  value={payment.payoutAmount ?? ''}
                  onChange={(e) =>
                    setPayment((p) => ({
                      ...p,
                      payoutAmount: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
            {!inUsd && (
              <p className="field-hint">
                Pagando en otra moneda hacen falta el cambio y el importe: sin ellos la
                liquidación no se puede cuadrar después.
              </p>
            )}
            <div className="field">
              <label htmlFor="paymentNotes">Notas</label>
              <input
                id="paymentNotes"
                value={payment.notes}
                onChange={(e) => setPayment((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
            <button type="submit" className="full-width" disabled={working}>
              {working ? 'Guardando…' : 'Marcar como pagada'}
            </button>
          </form>
        </Modal>
      )}

      {editingAccount && (
        <Modal title="Datos de pago del negocio" onClose={() => setEditingAccount(null)}>
          <form onSubmit={submitAccount}>
            <div className="field">
              <label htmlFor="accountMethod">Método</label>
              <select
                id="accountMethod"
                value={editingAccount.method}
                onChange={(e) =>
                  setEditingAccount((a) =>
                    a ? { ...a, method: e.target.value as PayoutAccount['method'] } : a,
                  )
                }
              >
                {PAYOUT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="holderName">Quién cobra</label>
              <input
                id="holderName"
                required
                value={editingAccount.holderName}
                onChange={(e) =>
                  setEditingAccount((a) => (a ? { ...a, holderName: e.target.value } : a))
                }
              />
              <p className="field-hint">Puede no ser el dueño: a menudo es un familiar.</p>
            </div>
            <div className="field">
              <label htmlFor="contact">Email, teléfono o tarjeta</label>
              <input
                id="contact"
                required
                value={editingAccount.contact}
                onChange={(e) =>
                  setEditingAccount((a) => (a ? { ...a, contact: e.target.value } : a))
                }
              />
            </div>
            <button type="submit" className="full-width" disabled={working}>
              {working ? 'Guardando…' : 'Guardar'}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
