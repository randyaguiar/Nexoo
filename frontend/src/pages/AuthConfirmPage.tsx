import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import type { EmailOtpType } from '@supabase/supabase-js';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/**
 * Destino del enlace de confirmación del correo. Supabase puede volver de dos
 * formas según la plantilla del email:
 * - con la sesión en el hash (`#access_token=…`), que supabase-js consume solo
 *   al arrancar: aquí basta con esperar a que `useAuth` tenga usuario;
 * - con `?token_hash=…&type=…`, que hay que canjear con `confirmEmail`.
 * Los fallos del endpoint de verificación llegan en el hash, no en la query.
 */
export function AuthConfirmPage() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  useEffect(() => {
    if (!tokenHash) return;

    let cancelled = false;
    setVerifying(true);
    api.auth
      .confirmEmail(tokenHash, (type as EmailOtpType | null) ?? 'signup')
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tokenHash, type]);

  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const linkError =
    error ?? hashParams.get('error_description') ?? params.get('error_description');

  if (linkError) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
        <h1 className="page-title">No pudimos confirmar la cuenta</h1>
        <div className="alert error" role="alert">
          {linkError}
        </div>
        <p>
          Vuelve a <Link to="/registro">crear la cuenta</Link> para recibir un enlace nuevo, o{' '}
          <Link to="/entrar">entra</Link> si ya la confirmaste.
        </p>
      </div>
    );
  }

  if (verifying || loading) return <p className="empty">Confirmando tu cuenta…</p>;

  if (user) return <Navigate to="/mis-pedidos" replace />;

  return (
    <div className="card" style={{ maxWidth: 420, margin: '40px auto' }}>
      <h1 className="page-title">Enlace incompleto</h1>
      <p>
        Abre el enlace tal cual llegó al correo. Si ya confirmaste la cuenta,{' '}
        <Link to="/entrar">entra</Link>.
      </p>
    </div>
  );
}
