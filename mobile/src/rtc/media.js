import { rtc } from './native';

export const AUDIO_CONSTRAINTS = true;
export const VIDEO_CONSTRAINTS = {
  facingMode: 'user',
  width: { ideal: 960 },
  height: { ideal: 540 },
  frameRate: { ideal: 24, max: 30 },
};

export function describeMediaError(err) {
  const text = `${err?.name ?? ''} ${err?.message ?? ''}`.toLowerCase();
  if (text.includes('permission') || text.includes('notallowed')) {
    return 'Camera or microphone permission was denied. You can allow it in your phone settings.';
  }
  return 'Could not access your camera or microphone.';
}

/** Asks for both devices, then falls back to each so a missing or refused one isn't fatal. */
export async function acquireLocalMedia() {
  if (!rtc) return { stream: null, error: null };
  const { mediaDevices, MediaStream } = rtc;
  try {
    const stream = await mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: VIDEO_CONSTRAINTS });
    return { stream, error: null };
  } catch (firstError) {
    const results = await Promise.allSettled([
      mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS }),
      mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS }),
    ]);
    const tracks = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.getTracks() : []));
    return { stream: new MediaStream(tracks), error: describeMediaError(firstError) };
  }
}
