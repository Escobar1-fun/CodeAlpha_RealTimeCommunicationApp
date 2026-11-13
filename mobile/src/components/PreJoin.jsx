import { Mic, MicOff, Video, VideoOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { VIDEO_CONSTRAINTS, acquireLocalMedia, describeMediaError } from '../rtc/media';
import { noWebRTC, rtc } from '../rtc/native';
import { colors } from '../theme';
import { Button, RoundButton, Screen, iconColor } from '../ui';

export default function PreJoin({ room, onJoin }) {
  const [stream, setStream] = useState(null);
  const [ready, setReady] = useState(noWebRTC);
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const streamRef = useRef(null);
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const handedOver = useRef(false);

  useEffect(() => {
    if (noWebRTC) return undefined;
    let cancelled = false;
    acquireLocalMedia().then(({ stream: acquired, error: mediaError }) => {
      if (cancelled) {
        acquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = acquired;
      setStream(acquired);
      setCamOn(acquired.getVideoTracks().length > 0);
      setMicOn(acquired.getAudioTracks().length > 0);
      setError(mediaError ?? '');
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (!handedOver.current) streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function toggleMic() {
    const [track] = stream?.getAudioTracks() ?? [];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  async function toggleCamera() {
    const [track] = stream.getVideoTracks();
    if (track) {
      track.stop();
      stream.removeTrack(track);
      setCamOn(false);
      return;
    }
    try {
      const fresh = await rtc.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      stream.addTrack(fresh.getVideoTracks()[0]);
      setCamOn(true);
      setPreviewKey((k) => k + 1);
      setError('');
    } catch (err) {
      setError(describeMediaError(err));
    }
  }

  // Joining before permission is answered goes in with no devices. Access granted
  // afterwards is released by the cleanup above, so handedOver stays false then.
  function join() {
    handedOver.current = Boolean(stream);
    onJoin({ stream });
  }

  const hasMic = Boolean(stream?.getAudioTracks().length);
  const others = room.participants;
  const camState = !ready || camOn ? undefined : 'off';
  const micState = micOn ? undefined : 'off';

  return (
    <Screen style={[styles.page, landscape && styles.pageSide]}>
      <View style={[styles.preview, landscape && styles.previewSide]}>
        {rtc && camOn && stream ? (
          <rtc.RTCView key={previewKey} streamURL={stream.toURL()} objectFit="cover" mirror style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.muted}>
            {noWebRTC ? 'Video needs the Roundtable app' : ready ? 'Camera is off' : 'Waiting for permission…'}
          </Text>
        )}
        {!noWebRTC && (
          <View style={styles.toggles}>
            <RoundButton
              label={micOn ? 'Mute microphone' : 'Unmute microphone'}
              state={micState}
              disabled={!hasMic}
              onPress={toggleMic}
              icon={micOn ? <Mic size={20} color={iconColor(micState)} /> : <MicOff size={20} color={iconColor(micState)} />}
            />
            <RoundButton
              label={camOn || !ready ? 'Turn camera off' : 'Turn camera on'}
              state={camState}
              disabled={!stream}
              onPress={toggleCamera}
              icon={camOn || !ready ? <Video size={20} color={iconColor(camState)} /> : <VideoOff size={20} color={iconColor(camState)} />}
            />
          </View>
        )}
      </View>

      <ScrollView style={landscape ? styles.side : undefined} contentContainerStyle={styles.details}>
      <Text style={styles.title}>{room.name}</Text>
      <Text style={styles.muted}>
        {others === 0 ? 'Nobody else is here yet.' : `${others} ${others === 1 ? 'person is' : 'people are'} in the call.`}
      </Text>
      {noWebRTC && (
        <Text style={styles.muted}>
          Expo Go can't run video calls. Chat, whiteboard and files will work. Install the development build for audio and video.
        </Text>
      )}
      {!ready && <Text style={styles.muted}>Allow your camera and microphone, or join without them.</Text>}
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error} You can still join.</Text> : null}
      <Button
        variant={stream ? 'primary' : 'default'}
        label={stream ? 'Join meeting' : 'Join without camera or mic'}
        onPress={join}
      />
      <Button variant="ghost" label="Back" onPress={() => router.replace('/')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, gap: 12, padding: 20, backgroundColor: colors.ink },
  preview: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: colors.panel,
  },
  pageSide: { flexDirection: 'row' },
  previewSide: { flex: 1, aspectRatio: undefined },
  side: { flex: 1 },
  details: { gap: 12 },
  toggles: { position: 'absolute', bottom: 14, flexDirection: 'row', gap: 12 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  error: { color: colors.dangerSoft, fontSize: 15, lineHeight: 21 },
});
