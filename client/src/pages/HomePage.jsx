import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

/** Accepts a bare meeting code or a full invite link. */
function roomIdFrom(input) {
  const value = input.trim();
  const match = value.match(/\/room\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : value;
}

export default function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/rooms')
      .then((res) => setRooms(res.rooms))
      .catch((err) => {
        setRooms([]);
        setError(err.message);
      });
  }, []);

  async function createRoom(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = name.trim() ? { name: name.trim() } : {};
      const { room } = await api('/rooms', { method: 'POST', body });
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function joinRoom(e) {
    e.preventDefault();
    const id = roomIdFrom(code);
    if (id) navigate(`/room/${encodeURIComponent(id)}`);
  }

  return (
    <div className="home">
      <header className="home-header">
        <span className="wordmark">Roundtable</span>
        <div className="home-user">
          <span className="muted">{user.name}</span>
          <button className="btn ghost" onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="home-main">
        <h1>Start a meeting</h1>
        <div className="home-actions">
          <form className="home-card" onSubmit={createRoom}>
            <label htmlFor="meeting-name">New meeting</label>
            <input
              id="meeting-name"
              placeholder="Name (optional)"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create and open'}</button>
          </form>
          <form className="home-card" onSubmit={joinRoom}>
            <label htmlFor="meeting-code">Have an invite?</label>
            <input
              id="meeting-code"
              placeholder="Paste a link or meeting code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn" disabled={!code.trim()}>Join</button>
          </form>
        </div>
        {error && <p className="error" role="alert">{error}</p>}

        <section className="home-rooms">
          <h2>Your meetings</h2>
          {rooms === null && <p className="muted">Loading…</p>}
          {rooms?.length === 0 && <p className="muted">Meetings you create will be listed here.</p>}
          <ul>
            {rooms?.map((room) => (
              <li key={room.id}>
                <Link to={`/room/${room.id}`}>{room.name}</Link>
                <span className="muted">
                  {room.participants > 0
                    ? `${room.participants} in the call`
                    : new Date(room.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
