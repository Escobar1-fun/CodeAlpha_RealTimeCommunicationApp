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
} from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getToken } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { MeshCall } from '../rtc/MeshCall.js';
import { canShareScreen } from '../rtc/media.js';
import ChatPanel from './ChatPanel.jsx';
import FilesPanel from './FilesPanel.jsx';
import Stage from './Stage.jsx';
import Whiteboard from './Whiteboard.jsx';

const NOTICE_MS = 5000;

export default function Meeting({ room, initialStream }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [, rerender] = useReducer((n) => n + 1, 0);

  const [session, setSession] = useState(null); // { socket, call }
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
    const socket = io({ auth: { token: getToken() }, transports: ['websocket'] });
    const call = new MeshCall(socket, initialStream);
    const unsubscribe = call.subscribe(rerender);

    // Ends the call for good, releasing the camera and microphone.
    const endWith = (message) => {
      setFatal(message);
      call.destroy();
      socket.disconnect();
    };
    const SESSION_EXPIRED = 'Your session has expired. Log in again to rejoin.';

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
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (fatal) {
    return (
      <div className="centered">
        <h1>{fatal}</h1>
        <button className="btn" onClick={() => navigate('/')}>Back to home</button>
      </div>
    );
  }
  if (!session) return null;

  const { call, socket } = session;
  const { media } = call;
  const participantCount = call.peerList.length + 1;

  return (
    <div className="meeting">
      <header className="meeting-header">
        <h1>{room.name}</h1>
        <span className="meeting-count" title="Participants">
          <Users size={15} aria-hidden="true" /> <span data-testid="participant-count">{participantCount}</span>
        </span>
        <button className="btn small ghost" onClick={copyInvite}>
          {copied ? <Check size={15} /> : <Link2 size={15} />}
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
      </header>

      {connection !== 'connected' && (
        <p className="banner" role="status">
          {connection === 'connecting' ? 'Connecting…' : 'Connection lost. Reconnecting…'}
        </p>
      )}
      {notice && <p className="toast" role="status">{notice}</p>}

      <div className="meeting-body">
        <main className="meeting-stage">
          <div className={view === 'stage' ? 'view' : 'view view-hidden'}>
            <Stage call={call} selfName={user.name} />
          </div>
          {/* Kept mounted so that it keeps drawing live events while out of view. */}
          <div className={view === 'board' ? 'view' : 'view view-hidden'}>
            <Whiteboard socket={socket} board={board} onNotice={showNotice} />
          </div>
        </main>

        {panel && (
          <aside className="meeting-panel">
            <header>
              <h2>{panel === 'chat' ? 'Chat' : 'Files'}</h2>
              <button className="round small ghost" onClick={() => setPanel(null)} aria-label="Close panel">
                <X size={16} />
              </button>
            </header>
            {panel === 'chat' ? (
              <ChatPanel messages={messages} selfId={user.id} onSend={sendChat} />
            ) : (
              <FilesPanel roomId={room.id} files={files} />
            )}
          </aside>
        )}
      </div>

      <footer className="controls">
        <div className="controls-group">
          <button
            className={`round ${media.audio ? '' : 'off'}`}
            onClick={() => runMediaAction(() => call.toggleMic())}
            aria-label={media.audio ? 'Mute microphone' : 'Unmute microphone'}
            title={media.audio ? 'Mute' : 'Unmute'}
          >
            {media.audio ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            className={`round ${media.video ? '' : 'off'}`}
            onClick={() => runMediaAction(() => call.toggleCamera())}
            aria-label={media.video ? 'Turn camera off' : 'Turn camera on'}
            title={media.video ? 'Camera off' : 'Camera on'}
          >
            {media.video ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          {canShareScreen() && (
            <button
              className={`round ${media.screen ? 'on' : ''}`}
              onClick={() =>
                media.screen ? call.stopScreenShare() : runMediaAction(() => call.startScreenShare())
              }
              aria-label={media.screen ? 'Stop sharing screen' : 'Share screen'}
              title={media.screen ? 'Stop sharing' : 'Share screen'}
            >
              {media.screen ? <MonitorX size={20} /> : <MonitorUp size={20} />}
            </button>
          )}
        </div>

        <div className="controls-group">
          <button
            className={`round ${view === 'board' ? 'on' : ''}`}
            onClick={() => setView((v) => (v === 'board' ? 'stage' : 'board'))}
            aria-label="Whiteboard"
            aria-pressed={view === 'board'}
            title="Whiteboard"
          >
            <PenLine size={20} />
          </button>
          <button
            className={`round ${panel === 'chat' ? 'on' : ''}`}
            onClick={() => togglePanel('chat')}
            aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
            aria-pressed={panel === 'chat'}
            title="Chat"
          >
            <MessageSquare size={20} />
            {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <button
            className={`round ${panel === 'files' ? 'on' : ''}`}
            onClick={() => togglePanel('files')}
            aria-label="Files"
            aria-pressed={panel === 'files'}
            title="Files"
          >
            <Paperclip size={20} />
          </button>
        </div>

        <button className="btn danger leave" onClick={() => navigate('/')} aria-label="Leave">
          <PhoneOff size={18} /> <span>Leave</span>
        </button>
      </footer>
    </div>
  );
}
