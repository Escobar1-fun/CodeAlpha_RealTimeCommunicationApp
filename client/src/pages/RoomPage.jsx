import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Meeting from '../components/Meeting.jsx';
import PreJoin from '../components/PreJoin.jsx';

export default function RoomPage() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [stream, setStream] = useState(null);

  useEffect(() => {
    api(`/rooms/${encodeURIComponent(roomId)}`)
      .then((res) => setRoom(res.room))
      .catch((err) => setError(err.message));
  }, [roomId]);

  if (error) {
    return (
      <div className="centered">
        <h1>{error}</h1>
        <Link className="btn" to="/">Back to home</Link>
      </div>
    );
  }
  if (!room) return <div className="centered muted">Loading…</div>;
  if (!stream) return <PreJoin room={room} onJoin={setStream} />;
  return <Meeting room={room} initialStream={stream} />;
}
