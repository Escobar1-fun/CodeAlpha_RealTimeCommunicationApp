import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then((res) => setUser(res.user))
      .catch((err) => {
        // Keep the token through a network blip; drop it only if it was rejected.
        if (err.status === 401) setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const authenticate = useCallback(async (mode, fields) => {
    const res = await api(`/auth/${mode}`, { method: 'POST', body: fields });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, authenticate, logout }),
    [user, loading, authenticate, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
