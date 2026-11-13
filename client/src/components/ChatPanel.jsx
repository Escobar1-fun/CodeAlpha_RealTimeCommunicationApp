import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatPanel({ messages, selfId, onSend }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  async function submit(e) {
    e.preventDefault();
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
    <div className="panel-body">
      <ol className="chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && <li className="muted panel-empty">No messages yet.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.user.id === selfId ? 'mine' : ''}>
            <header>
              <strong>{m.user.id === selfId ? 'You' : m.user.name}</strong>
              <time dateTime={m.sentAt}>{formatTime(m.sentAt)}</time>
            </header>
            <p>{m.text}</p>
          </li>
        ))}
      </ol>
      {error && <p className="error panel-error" role="alert">{error}</p>}
      <form className="chat-form" onSubmit={submit}>
        <input
          aria-label="Message"
          placeholder="Message everyone"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="round small" aria-label="Send" disabled={!text.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
