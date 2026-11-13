import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { VIDEO_CONSTRAINTS, acquireLocalMedia, describeMediaError } from '../rtc/media.js';

/**
 * Device preview before entering. Besides letting people check how they look, the
 * click on "Join" is the user gesture browsers require before playing remote audio.
 */
export default function PreJoin({ room, onJoin }) {
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const handedOver = useRef(false);

  useEffect(() => {
    let cancelled = false;
    acquireLocalMedia().then(({ stream: acquired, error: mediaError }) => {
      if (cancelled) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = acquired;
      setStream(acquired);
      setCamOn(acquired.getVideoTracks().length > 0);
      setMicOn(acquired.getAudioTracks().length > 0);
      setError(mediaError ?? '');
    });
    return () => {
      cancelled = true;
      if (!handedOver.current) streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = camOn ? stream : null;
  }, [stream, camOn]);

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
      const fresh = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      stream.addTrack(fresh.getVideoTracks()[0]);
      setCamOn(true);
      setError('');
    } catch (err) {
      setError(describeMediaError(err));
    }
  }

  // Joining before the prompt is answered goes in with no devices. If access is granted
  // afterwards, the cleanup above releases it, so handedOver stays false in that case.
  function join() {
    handedOver.current = Boolean(stream);
    onJoin(stream ?? new MediaStream());
  }

  const hasMic = Boolean(stream?.getAudioTracks().length);
  const others = room.participants;
  // Until the browser answers, the camera is undecided rather than off.
  const showCamOn = camOn || !stream;

  return (
    <main className="prejoin">
      <div className="prejoin-preview">
        <video ref={videoRef} autoPlay playsInline muted />
        {!camOn && <p className="muted">{stream ? 'Camera is off' : 'Waiting for permission…'}</p>}
        <div className="prejoin-toggles">
          <button
            className={`round ${micOn ? '' : 'off'}`}
            onClick={toggleMic}
            disabled={!hasMic}
            aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={!micOn}
          >
            {micOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            className={`round ${showCamOn ? '' : 'off'}`}
            onClick={toggleCamera}
            disabled={!stream}
            aria-label={showCamOn ? 'Turn camera off' : 'Turn camera on'}
            aria-pressed={!showCamOn}
          >
            {showCamOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        </div>
      </div>

      <div className="prejoin-side">
        <h1>{room.name}</h1>
        <p className="muted">
          {others === 0 ? 'Nobody else is here yet.' : `${others} ${others === 1 ? 'person is' : 'people are'} in the call.`}
        </p>
        {!stream && (
          <p className="muted" role="status">
            Allow your camera and microphone in the browser prompt, or join without them.
          </p>
        )}
        {error && <p className="error" role="alert">{error} You can still join.</p>}
        <button className={`btn ${stream ? 'primary' : ''}`} onClick={join}>
          {stream ? 'Join meeting' : 'Join without camera or mic'}
        </button>
        <Link className="btn ghost" to="/">Back</Link>
      </div>
    </main>
  );
}
