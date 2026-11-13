import * as DocumentPicker from 'expo-document-picker';
import { Download, Paperclip } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { downloadAndShare, uploadFile } from '../api';
import { colors } from '../theme';
import { Button, RoundButton } from '../ui';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function FilesPanel({ roomId, files }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  async function pickAndUpload() {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    setProgress(0);
    try {
      await uploadFile(roomId, result.assets[0], setProgress);
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  async function download(file) {
    setError('');
    try {
      await downloadAndShare(roomId, file);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <View style={styles.body}>
      <FlatList
        data={files}
        keyExtractor={(f) => f.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.muted}>Files shared here are available to everyone until the meeting ends.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.info}>
              <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>{formatSize(item.size)} · {item.uploadedBy.name}</Text>
            </View>
            <RoundButton
              size={38}
              label={`Download ${item.name}`}
              onPress={() => download(item)}
              icon={<Download size={16} color={colors.text} />}
            />
          </View>
        )}
      />
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <View style={styles.footer}>
        {progress !== null && (
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        )}
        <Button
          label={progress !== null ? 'Uploading…' : 'Share a file'}
          disabled={progress !== null}
          icon={<Paperclip size={16} color={colors.text} />}
          onPress={pickAndUpload}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  list: { gap: 12, padding: 14 },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'space-between' },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  detail: { color: colors.muted, fontSize: 13 },
  error: { color: colors.dangerSoft, paddingHorizontal: 14, paddingBottom: 6 },
  footer: { gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.line },
  track: { height: 6, overflow: 'hidden', borderRadius: 3, backgroundColor: colors.raised },
  bar: { height: 6, backgroundColor: colors.accent },
});
