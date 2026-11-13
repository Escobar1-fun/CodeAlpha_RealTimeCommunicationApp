import { MicOff, MonitorUp } from 'lucide-react';
import { useEffect, useRef } from 'react';

export default function VideoTile({ stream, name, muted, videoOn, audioOn, status, screen, self }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream ?? null;
  }, [stream]);

  return (
    <figure className={`tile ${screen ? 'tile-screen' : ''} ${self ? 'tile-self' : ''}`} data-testid={screen ? 'screen-tile' : 'video-tile'}>
      {/* Stays mounted with the camera off: this element also plays the person's audio. */}
      <video ref={ref} autoPlay playsInline muted={muted} className={videoOn ? '' : 'hidden'} />
      {!videoOn && (
        <div className="tile-avatar" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase()}
        </div>
      )}
      <figcaption>
        {screen && <MonitorUp size={14} aria-hidden="true" />}
        {audioOn === false && <MicOff size={14} aria-label="Muted" className="tile-muted" />}
        <span>{screen ? `${name} ${name === 'You' ? 'are' : 'is'} presenting` : name}</span>
        {status && status !== 'connected' && <em>{status === 'failed' ? 'connection lost' : 'connecting…'}</em>}
      </figcaption>
    </figure>
  );
}
