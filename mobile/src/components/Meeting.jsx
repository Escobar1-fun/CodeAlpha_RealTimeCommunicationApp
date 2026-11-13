import * as Clipboard from 'expo-clipboard';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import {
  Check,
  Link2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Paperclip,
  PenLine,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { io } from 'socket.io-client';
import { API_URL, getToken } from '../api';
import { useAuth } from '../auth';
import { MeshCall } from '../rtc/MeshCall';
import { InCallManager, canShareScreen, noWebRTC } from '../rtc/native';
import { colors } from '../theme';
import { Button, RoundButton, Screen, iconColor } from '../ui';
import ChatPanel from './ChatPanel';
import FilesPanel from './FilesPanel';
import Stage from './Stage';
import Whiteboard from './Whiteboard';

const NOTICE_MS = 5000;
const SESSION_EXPIRED = 'Your session has expired. Log in again to rejoin.';

export default function Meeting({ room, initialStream }) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const controlSize = landscape ? 38 : 44;
  const { user } = useAuth();
  const [, rerender] = useReducer((n) => n + 1, 0);

  const [session, setSession] = useState(null);
  const [connection, setConnection] = useState('connecting');
  const [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [board, setBoard] = useState([]);
  const [view, setView] = useState('stage');
  const [panel, setPanel] = useState(null);
  const [unread, setUnread] = useState(0);
  const [copied, setCopied] = useState(false);

  const panelRef = useRef(panel);
  panelRef.current = panel;
  const noticeTimer = useRef();
  const showNotice = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), NOTICE_MS);
  }, []);

  useEffect(() => {
    const socket = io(API_URL, { auth: { token: getToken() }, transports: ['websocket'] });
    const call = new MeshCall(socket, initialStream);
    const unsubscribe = call.subscribe(rerender);
    // Without this, Android plays the call through the earpiece.
    InCallManager?.start({ media: 'video' });

    const endWith = (message) => {
      setFatal(message);
      call.destroy();
      socket.disconnect();
    };

    socket.on('connect', async () => {
      const res = await socket.emitWithAck('room:join', { roomId: room.id, media: call.media });
      if (!res.ok) {
        endWith(res.error);
        return;
      }
      setConnection('connected');
      setMessages(res.chat);
      setFiles(res.files);
      setBoard(res.board);
      call.start(res);
    });
    socket.on('disconnect', (reason) => {
      // The server only hangs up when the token expires, and that isn't retried.
      if (reason === 'io server disconnect') endWith(SESSION_EXPIRED);
      else if (reason !== 'io client disconnect') setConnection('reconnecting');
    });
    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') endWith(SESSION_EXPIRED);
      else setConnection('reconnecting');
    });
    socket.on('chat:message', (message) => {
      setMessages((list) => [...list, message]);
      if (panelRef.current !== 'chat') setUnread((n) => n + 1);
    });
    socket.on('file:shared', (file) => {
      setFiles((list) => [...list, file]);
      if (file.uploadedBy.id !== user.id) showNotice(`${file.uploadedBy.name} shared ${file.name}`);
    });

    setSession({ socket, call });
    return () => {
      unsubscribe();
      call.destroy();
      socket.disconnect();
      InCallManager?.stop();
      clearTimeout(noticeTimer.current);
    };
  }, [room.id, initialStream, user.id, showNotice]);

  const sendChat = useCallback(
    async (text) => {
      const res = await session.socket.timeout(5000).emitWithAck('chat:send', { text }).catch(() => null);
      if (!res) return 'Message not sent. Check your connection.';
      if (!res.ok) return res.error === 'Invalid payload' ? 'That message has no sendable text.' : res.error;
      setMessages((list) => [...list, res.message]);
      return null;
    },
    [session],
  );

  function togglePanel(name) {
    setPanel((current) => (current === name ? null : name));
    if (name === 'chat') setUnread(0);
  }

  async function runMediaAction(action) {
    const error = await action();
    if (error) showNotice(error);
  }

  async function copyInvite() {
    await Clipboard.setStringAsync(`${API_URL}/room/${room.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (fatal) {
    return (
      <Screen style={styles.fatal}>
        <Text style={styles.fatalText}>{fatal}</Text>
        <Button label="Back to home" onPress={() => router.replace('/')} />
      </Screen>
    );
  }
  if (!session) return <View style={styles.page} />;

  const { call, socket } = session;
  const { media } = call;
  const micState = media.audio ? undefined : 'off';
  const camState = media.video ? undefined : 'off';
  const boardState = view === 'board' ? 'on' : undefined;
  const chatState = panel === 'chat' ? 'on' : undefined;
  const filesState = panel === 'files' ? 'on' : undefined;

  return (
    <Screen style={styles.page}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>{room.name}</Text>
          <Users size={15} color={colors.muted} />
          <Text style={styles.count} testID="participant-count">{call.peerList.length + 1}</Text>
          <View style={styles.push} />
          <Button
            small
            variant="ghost"
            label={copied ? 'Copied' : 'Invite'}
            icon={copied ? <Check size={15} color={colors.text} /> : <Link2 size={15} color={colors.text} />}
            onPress={copyInvite}
          />
        </View>

        {connection !== 'connected' && (
          <Text style={styles.banner}>{connection === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…'}</Text>
        )}
        {noWebRTC && <Text style={styles.goBanner}>Expo Go: no audio or video. Chat, whiteboard and files work.</Text>}

        <View style={landscape ? styles.sideBySide : styles.fill}>
        <View style={styles.body}>
          {panel ? (
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>{panel === 'chat' ? 'Chat' : 'Files'}</Text>
                <RoundButton size={34} label="Close panel" onPress={() => setPanel(null)} icon={<X size={16} color={colors.text} />} />
              </View>
              {panel === 'chat' ? (
                <ChatPanel messages={messages} selfId={user.id} onSend={sendChat} />
              ) : (
                <FilesPanel roomId={room.id} files={files} />
              )}
            </View>
          ) : null}

          {/* Video views are native surfaces that would draw through overlays, so they
              unmount when covered; audio doesn't depend on them. */}
          {!panel && view === 'stage' ? <Stage call={call} selfName={user.name} /> : null}

          {/* Stays mounted so that it keeps applying live drawing while out of view. */}
          <View style={!panel && view === 'board' ? styles.fill : styles.hidden}>
            <Whiteboard socket={socket} board={board} onNotice={showNotice} />
          </View>
        </View>

        <View style={[styles.controls, landscape && styles.controlsSide]}>
          <RoundButton
            size={controlSize}
            label={media.audio ? 'Mute microphone' : 'Unmute microphone'}
            state={micState}
            disabled={noWebRTC}
            onPress={() => runMediaAction(() => call.toggleMic())}
            icon={media.audio ? <Mic size={20} color={iconColor(micState)} /> : <MicOff size={20} color={iconColor(micState)} />}
          />
          <RoundButton
            size={controlSize}
            label={media.video ? 'Turn camera off' : 'Turn camera on'}
            state={camState}
            disabled={noWebRTC}
            onPress={() => runMediaAction(() => call.toggleCamera())}
            icon={media.video ? <Video size={20} color={iconColor(camState)} /> : <VideoOff size={20} color={iconColor(camState)} />}
          />
          {canShareScreen && (
            <RoundButton
              size={controlSize}
              label={media.screen ? 'Stop sharing screen' : 'Share screen'}
              state={media.screen ? 'on' : undefined}
              onPress={() => (media.screen ? call.stopScreenShare() : runMediaAction(() => call.startScreenShare()))}
              icon={media.screen ? <MonitorX size={20} color={iconColor('on')} /> : <MonitorUp size={20} color={colors.text} />}
            />
          )}
          <RoundButton
            size={controlSize}
            label="Whiteboard"
            state={boardState}
            onPress={() => {
              setPanel(null);
              setView((v) => (v === 'board' ? 'stage' : 'board'));
            }}
            icon={<PenLine size={20} color={iconColor(boardState)} />}
          />
          <RoundButton
            size={controlSize}
            label={unread ? `Chat, ${unread} unread` : 'Chat'}
            state={chatState}
            badge={unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null}
            onPress={() => togglePanel('chat')}
            icon={<MessageSquare size={20} color={iconColor(chatState)} />}
          />
          <RoundButton
            size={controlSize}
            label="Files"
            state={filesState}
            onPress={() => togglePanel('files')}
            icon={<Paperclip size={20} color={iconColor(filesState)} />}
          />
          <RoundButton size={controlSize} label="Leave" state="off" onPress={() => router.replace('/')} icon={<PhoneOff size={20} color="#fff" />} />
        </View>
        </View>
        {notice ? <Text style={styles.toast}>{notice}</Text> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  sideBySide: { flex: 1, flexDirection: 'row' },
  controlsSide: { flexDirection: 'column', paddingHorizontal: 8, paddingVertical: 4 },
  hidden: { display: 'none' },
  push: { flex: 1 },
  header: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  title: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: '700' },
  count: { color: colors.muted, fontSize: 14 },
  banner: { paddingVertical: 6, textAlign: 'center', backgroundColor: '#4a3b10', color: '#ffe08a', fontSize: 14 },
  goBanner: { paddingVertical: 6, paddingHorizontal: 12, textAlign: 'center', backgroundColor: colors.raised, color: colors.muted, fontSize: 13 },
  body: { flex: 1, paddingHorizontal: 10 },
  panel: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.panel },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  panelTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  toast: {
    position: 'absolute',
    bottom: 76,
    alignSelf: 'center',
    maxWidth: '90%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.raised,
    color: colors.text,
    fontSize: 14,
  },
  controls: { flexDirection: 'row', justifyContent: 'space-evenly', paddingHorizontal: 6, paddingVertical: 10 },
  fatal: { flex: 1, gap: 16, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.ink },
  fatalText: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
});
