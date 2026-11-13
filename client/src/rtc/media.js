export const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
export const VIDEO_CONSTRAINTS = {
  width: { ideal: 960 },
  height: { ideal: 540 },
  frameRate: { ideal: 24, max: 30 },
};

export const canShareScreen = () => Boolean(navigator.mediaDevices?.getDisplayMedia);

export function describeMediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Permission was denied. Allow camera and microphone access in your browser.';
    case 'NotFoundError':
      return 'No matching camera or microphone was found.';
    case 'NotReadableError':
      return 'Your camera or microphone is being used by another application.';
    default:
      return 'Could not access your camera or microphone.';
  }
}

/**
 * Asks for both devices together (one prompt), then falls back to each on its own
 * so that a machine with no webcam can still join with just a microphone.
 */
export async function acquireLocalMedia() {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) {
    return {
      stream: new MediaStream(),
      error: 'Media devices need a secure (HTTPS) page in a supported browser.',
    };
  }
  try {
    const stream = await devices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: VIDEO_CONSTRAINTS });
    return { stream, error: null };
  } catch (firstError) {
    const results = await Promise.allSettled([
      devices.getUserMedia({ audio: AUDIO_CONSTRAINTS }),
      devices.getUserMedia({ video: VIDEO_CONSTRAINTS }),
    ]);
    const tracks = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.getTracks() : []));
    return { stream: new MediaStream(tracks), error: describeMediaError(firstError) };
  }
}
