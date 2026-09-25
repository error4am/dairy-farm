import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface SetupPayload {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
  farm_name?: string;
  setup_secret?: string;
}

interface AuthContextValue {
  authEnabled: boolean;
  loading: boolean;
  authenticated: boolean;
  setupRequired: boolean;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  setup: (payload: SetupPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  authEnabled: false,
  loading: true,
  authenticated: false,
  setupRequired: false,
  user: null,
  login: async () => {},
  setup: async () => {},
  logout: async () => {}
});

interface StatusResponse {
  auth_enabled: boolean;
  setup_required: boolean;
}

interface MeResponse {
  authenticated: boolean;
  user?: AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authEnabled, setAuthEnabled] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await api.get<StatusResponse>('/auth/status');
        if (!alive) return;
        setAuthEnabled(status.auth_enabled);
        setSetupRequired(status.setup_required);
        if (!status.auth_enabled) {
          setLoading(false);
          return;
        }
        const me = await api.get<MeResponse>('/auth/me');
        if (!alive) return;
        setAuthenticated(me.authenticated);
        setUser(me.user ?? null);
      } catch {
        if (alive) setAuthEnabled(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setUser(null);
    };
    window.addEventListener('dairy:unauthorized', onUnauthorized);
    return () => window.removeEventListener('dairy:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: AuthUser }>('/auth/login', { email, password });
    setUser(res.user);
    setAuthenticated(true);
  }, []);

  const setup = useCallback(async (payload: SetupPayload) => {
    const res = await api.post<{ user: AuthUser }>('/auth/setup', payload);
    setUser(res.user);
    setAuthenticated(true);
    setSetupRequired(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // even if the request fails, drop local auth state
    } finally {
      setAuthenticated(false);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ authEnabled, loading, authenticated, setupRequired, user, login, setup, logout }),
    [authEnabled, loading, authenticated, setupRequired, user, login, setup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
