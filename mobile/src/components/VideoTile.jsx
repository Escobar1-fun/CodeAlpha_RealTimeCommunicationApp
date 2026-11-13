import { MicOff, MonitorUp } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { rtc } from '../rtc/native';
import { colors } from '../theme';

export default function VideoTile({ stream, name, videoOn, audioOn, status, screen, self, style }) {
  const showVideo = Boolean(rtc && stream && videoOn);
  return (
    <View style={[styles.tile, style]} testID={screen ? 'screen-tile' : 'video-tile'}>
      {showVideo ? (
        <rtc.RTCView
          streamURL={stream.toURL()}
          objectFit={screen ? 'contain' : 'cover'}
          mirror={Boolean(self)}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.caption}>
        {screen && <MonitorUp size={13} color={colors.text} />}
        {audioOn === false && <MicOff size={13} color={colors.dangerSoft} accessibilityLabel="Muted" />}
        <Text numberOfLines={1} style={styles.captionText}>
          {screen ? `${name} ${name === 'You' ? 'are' : 'is'} presenting` : name}
        </Text>
        {status && status !== 'connected' ? (
          <Text style={styles.status}>{status === 'failed' ? 'connection lost' : 'connecting…'}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.panel,
  },
  avatar: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    backgroundColor: colors.raised,
  },
  avatarText: { color: colors.text, fontSize: 26, fontWeight: '700' },
  caption: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    maxWidth: '90%',
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(10, 11, 13, 0.72)',
  },
  captionText: { flexShrink: 1, color: colors.text, fontSize: 13 },
  status: { color: colors.muted, fontSize: 12 },
});
