import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { Protected } from '../../src/auth';
import Meeting from '../../src/components/Meeting';
import PreJoin from '../../src/components/PreJoin';
import { colors } from '../../src/theme';
import { Button } from '../../src/ui';

function Room() {
  const { roomId } = useLocalSearchParams();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(null);

  useEffect(() => {
    api(`/rooms/${encodeURIComponent(roomId)}`)
      .then((res) => setRoom(res.room))
      .catch((err) => setError(err.message));
  }, [roomId]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{error}</Text>
        <Button label="Back to home" onPress={() => router.replace('/')} />
      </View>
    );
  }
  if (!room) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!joined) return <PreJoin room={room} onJoin={setJoined} />;
  return <Meeting room={room} initialStream={joined.stream} />;
}

export default function RoomScreen() {
  return (
    <Protected>
      <Room />
    </Protected>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, gap: 16, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.ink },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
});
