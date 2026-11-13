import { Send } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';
import { RoundButton } from '../ui';

const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatPanel({ messages, selfId, onSend }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const list = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages]);

  async function submit() {
    const value = text.trim();
    if (!value) return;
    setText('');
    setError('');
    const failure = await onSend(value);
    if (failure) {
      setError(failure);
      setText(value);
    }
  }

  return (
    <View style={styles.body}>
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.muted}>No messages yet.</Text>}
        renderItem={({ item }) => {
          const mine = item.user.id === selfId;
          return (
            <View>
              <View style={styles.meta}>
                <Text style={[styles.name, mine && styles.mine]}>{mine ? 'You' : item.user.name}</Text>
                <Text style={styles.time}>{formatTime(item.sentAt)}</Text>
              </View>
              <Text selectable style={styles.message}>{item.text}</Text>
            </View>
          );
        }}
      />
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <View style={styles.form}>
        <TextInput
          accessibilityLabel="Message"
          placeholder="Message everyone"
          placeholderTextColor={colors.muted}
          value={text}
          maxLength={2000}
          onChangeText={setText}
          onSubmitEditing={submit}
          submitBehavior="submit"
          returnKeyType="send"
          style={styles.input}
        />
        <RoundButton size={40} label="Send" disabled={!text.trim()} onPress={submit} icon={<Send size={16} color={colors.text} />} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  list: { gap: 12, padding: 14 },
  muted: { color: colors.muted },
  meta: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  name: { color: colors.text, fontSize: 13, fontWeight: '700' },
  mine: { color: colors.accent },
  time: { color: colors.muted, fontSize: 12 },
  message: { color: colors.text, fontSize: 15, lineHeight: 21 },
  error: { color: colors.dangerSoft, paddingHorizontal: 14, paddingBottom: 6 },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, borderTopWidth: 1, borderTopColor: colors.line },
  input: {
    flex: 1,
    height: 42,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.ink,
    color: colors.text,
  },
});
