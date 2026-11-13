import { z } from 'zod';

export const BOARD_WIDTH = 1920;
export const BOARD_HEIGHT = 1080;

// C0/C1 controls (keeping \t and \n), zero-width characters and bidi overrides.
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;
const HTML_TAG = /<\/?[a-zA-Z!][^<>]*>/g;

/** Reduces untrusted input to plain text: no markup, no invisible characters. */
export function sanitizeText(value) {
  let text = value.normalize('NFC').replace(UNSAFE_CHARS, '');
  // Repeat so that removing one tag can't assemble another (<scr<b>ipt>).
  let previous;
  do {
    previous = text;
    text = text.replace(HTML_TAG, '');
  } while (text !== previous);
  return text.trim();
}

export function sanitizeFilename(value) {
  const name = sanitizeText(value)
    .replace(/[\\/:*?"<>|\t\n]/g, '_')
    .replace(/^\.+/, '');
  return name.slice(-180) || 'file';
}

const cleanText = (max) =>
  z
    .string()
    .max(max * 4)
    .transform(sanitizeText)
    .pipe(z.string().min(1).max(max));

// --- REST ---------------------------------------------------------------

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const registerSchema = z.strictObject({
  name: cleanText(60),
  email,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    // bcrypt silently ignores everything past 72 bytes.
    .refine((p) => Buffer.byteLength(p) <= 72, 'Password must be at most 72 bytes'),
});

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1).max(1024),
});

export const createRoomSchema = z.strictObject({
  name: cleanText(80).optional(),
});

export const roomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);

// --- Socket payloads ----------------------------------------------------

const media = z.strictObject({
  audio: z.boolean(),
  video: z.boolean(),
  screen: z.boolean(),
});

export const joinSchema = z.strictObject({ roomId: roomIdSchema, media });
export const mediaSchema = media;
export const emptySchema = z.strictObject({});

const sessionDescription = z.strictObject({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1).max(64 * 1024),
});

const iceCandidate = z.strictObject({
  candidate: z.string().max(2048),
  sdpMid: z.string().max(32).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const signalSchema = z
  .strictObject({
    to: z.string().min(1).max(64),
    description: sessionDescription.optional(),
    candidate: iceCandidate.optional(),
  })
  .refine((s) => Boolean(s.description) !== Boolean(s.candidate), {
    message: 'Exactly one of description or candidate is required',
  });

export const chatSchema = z.strictObject({ text: cleanText(2000) });

const clientOpId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const x = z.number().finite().min(0).max(BOARD_WIDTH);
const y = z.number().finite().min(0).max(BOARD_HEIGHT);

export const strokeSchema = z.strictObject({
  id: clientOpId,
  tool: z.enum(['pen', 'eraser']),
  color,
  size: z.number().finite().min(1).max(120),
  points: z.array(z.tuple([x, y])).max(512),
  done: z.boolean(),
});

export const textSchema = z.strictObject({
  id: clientOpId,
  x,
  y,
  text: cleanText(500),
  color,
  size: z.number().finite().min(8).max(200),
});
