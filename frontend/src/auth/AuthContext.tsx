import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { api } from '../api/client';
import { supabase } from '../api/supabase';
import type { AdminUser } from '../api/types';

interface AuthContextValue {
  user: User | null;
  /** La fila de `admins` de la sesión, o null si es una cuenta de comprador. */
  admin: AdminUser | null;
  /** Motivo por el que no se pudo comprobar si la sesión es admin. */
  adminError: string | null;
  /** true hasta que se resuelven la sesión y la comprobación de admin. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    // getSession lee el token persistido; onAuthStateChange cubre login, logout y
    // la expiración mientras la app está abierta.
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setSessionLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setSessionLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setAdmin(null);
      setAdminError(null);
      return;
    }

    let cancelled = false;
    setAdminLoading(true);
    setAdminError(null);

    // Sin catch, un fallo aquí (migración sin aplicar, policy que bloquea la
    // lectura) dejaría el panel cargando para siempre y sin explicación.
    api.admin
      .currentAdmin()
      .then((row) => {
        if (!cancelled) setAdmin(row);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setAdmin(null);
          setAdminError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setAdminLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const value: AuthContextValue = {
    user,
    admin,
    adminError,
    loading: sessionLoading || adminLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
