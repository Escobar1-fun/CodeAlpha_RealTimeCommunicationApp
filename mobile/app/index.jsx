import { Link, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { Protected, useAuth } from '../src/auth';
import { colors } from '../src/theme';
import { Button, Screen, Wordmark } from '../src/ui';

/** Accepts a bare meeting code or a full invite link. */
function roomIdFrom(input) {
  const value = input.trim();
  const match = value.match(/\/room\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : value;
}

function Home() {
  const { user, logout } = useAuth();
  const [rooms, setRooms] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setBusy(false);
      api('/rooms')
        .then((res) => setRooms(res.rooms))
        .catch((err) => {
          setRooms([]);
          setError(err.message);
        });
    }, []),
  );

  async function createRoom() {
    setBusy(true);
    setError('');
    try {
      const body = name.trim() ? { name: name.trim() } : {};
      const { room } = await api('/rooms', { method: 'POST', body });
      setName('');
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function joinRoom() {
    const id = roomIdFrom(code);
    if (id) router.push(`/room/${encodeURIComponent(id)}`);
  }

  const header = (
    <View style={styles.main}>
      <View style={styles.top}>
        <Wordmark />
        <View style={styles.user}>
          <Text numberOfLines={1} style={styles.userName}>{user.name}</Text>
          <Button small variant="ghost" label="Log out" onPress={logout} />
        </View>
      </View>
      <Text style={styles.heading}>Start a meeting</Text>
      <View style={styles.card}>
        <Text style={styles.label}>New meeting</Text>
        <TextInput
          accessibilityLabel="Meeting name"
          placeholder="Name (optional)"
          placeholderTextColor={colors.muted}
          value={name}
          maxLength={80}
          onChangeText={setName}
          style={styles.input}
        />
        <Button variant="primary" label={busy ? 'Creating…' : 'Create and open'} disabled={busy} onPress={createRoom} />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Have an invite?</Text>
        <TextInput
          accessibilityLabel="Invite link or meeting code"
          placeholder="Paste a link or meeting code"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          value={code}
          onChangeText={setCode}
          style={styles.input}
        />
        <Button label="Join" disabled={!code.trim()} onPress={joinRoom} />
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Text style={styles.section}>Your meetings</Text>
      {rooms === null && <Text style={styles.muted}>Loading…</Text>}
      {rooms?.length === 0 && <Text style={styles.muted}>Meetings you create will be listed here.</Text>}
    </View>
  );

  return (
    <Screen style={styles.page}>
      <FlatList
        data={rooms ?? []}
        keyExtractor={(room) => room.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Link numberOfLines={1} style={styles.roomName} href={`/room/${item.id}`}>{item.name}</Link>
            <Text style={styles.muted}>
              {item.participants > 0 ? `${item.participants} in the call` : new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

export default function HomeScreen() {
  return (
    <Protected>
      <Home />
    </Protected>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  list: { padding: 18 },
  main: { gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  user: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  userName: { flexShrink: 1, color: colors.muted },
  heading: { marginTop: 12, color: colors.text, fontSize: 30, fontWeight: '700' },
  card: { gap: 12, padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.panel },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
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
  error: { color: colors.dangerSoft },
  section: { marginTop: 14, color: colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  roomName: { flexShrink: 1, color: colors.text, fontWeight: '600' },
});
