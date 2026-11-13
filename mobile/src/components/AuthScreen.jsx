import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth';
import { colors } from '../theme';
import { Button, Screen, Wordmark } from '../ui';

const COPY = {
  login: { title: 'Welcome back', action: 'Log in', busy: 'Logging in…' },
  register: { title: 'Create your account', action: 'Sign up', busy: 'Creating account…' },
};

// Only same-app paths: `next` must never become a redirect to somewhere else.
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function Field({ label, ...input }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={styles.input} {...input} />
    </View>
  );
}

export default function AuthScreen({ mode }) {
  const { user, loading, authenticate } = useAuth();
  const { next } = useLocalSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Redirect href={safeNext(next)} />;

  const isRegister = mode === 'register';
  const copy = COPY[mode];

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await authenticate(mode, isRegister ? { name, email, password } : { email, password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.page}>
      <KeyboardAvoidingView style={styles.page} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Wordmark />
          <Text style={styles.headline}>Meet, sketch and share in one room.</Text>
          <View style={styles.card}>
            <Text style={styles.title}>{copy.title}</Text>
            {isRegister && <Field label="Name" value={name} onChangeText={setName} autoComplete="name" maxLength={60} />}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              secureTextEntry
            />
            {isRegister && <Text style={styles.hint}>At least 8 characters</Text>}
            {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button variant="primary" label={busy ? copy.busy : copy.action} disabled={busy} onPress={submit} />
            <Text style={styles.switch}>
              {isRegister ? 'Already have an account? ' : 'New here? '}
              <Link replace style={styles.link} href={{ pathname: isRegister ? '/login' : '/register', params: { next: safeNext(next) } }}>
                {isRegister ? 'Log in' : 'Create an account'}
              </Link>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { flexGrow: 1, justifyContent: 'center', gap: 20, padding: 22 },
  headline: { color: colors.text, fontSize: 32, fontWeight: '700', lineHeight: 38 },
  card: { gap: 14, padding: 20, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.panel },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  field: { gap: 6 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  input: {
    height: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.ink,
    color: colors.text,
    fontSize: 15,
  },
  hint: { color: colors.muted, fontSize: 13 },
  error: { color: colors.dangerSoft, fontSize: 14 },
  switch: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});
