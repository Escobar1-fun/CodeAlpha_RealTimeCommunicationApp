import { Redirect, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api, loadToken, setSessionExpiredHandler, setToken } from './api';
import { colors } from './theme';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    await setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(logout);
    (async () => {
      try {
        if (await loadToken()) setUser((await api('/auth/me')).user);
      } catch (err) {
        // Keep the token through a network blip; drop it only if it was rejected.
        if (err.status === 401) await setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [logout]);

  const authenticate = useCallback(async (mode, fields) => {
    const res = await api(`/auth/${mode}`, { method: 'POST', body: fields });
    await setToken(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({ user, loading, authenticate, logout }), [user, loading, authenticate, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function Protected({ children }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!user) return <Redirect href={{ pathname: '/login', params: { next: pathname } }} />;
  return children;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
});
