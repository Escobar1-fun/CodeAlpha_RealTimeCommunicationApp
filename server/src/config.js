import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(serverRoot, '.env'), quiet: true });

const env = process.env;

function list(value) {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function positiveInt(name, fallback) {
  const parsed = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const TURN_CREDENTIAL_SECONDS = 24 * 60 * 60;

/**
 * With TURN_SECRET set, each user gets a short-lived credential (coturn's
 * use-auth-secret scheme), so nothing long-lived is handed to the browser or app.
 */
function turnCredentials(userId) {
  if (!env.TURN_SECRET) return { username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL };
  const username = `${Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_SECONDS}:${userId}`;
  return { username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') };
}

function iceServersFor(userId) {
  const servers = [];
  const stun = list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302');
  if (stun.length) servers.push({ urls: stun });
  const turn = list(env.TURN_URLS);
  if (turn.length) servers.push({ urls: turn, ...turnCredentials(userId) });
  return servers;
}

if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 characters. Run "npm run setup" first.');
}

export const config = Object.freeze({
  isProduction: env.NODE_ENV === 'production',
  port: positiveInt('PORT', 4000),
  jwtSecret: env.JWT_SECRET,
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  tlsKeyPath: resolve(serverRoot, env.TLS_KEY_PATH || '../certs/localhost-key.pem'),
  tlsCertPath: resolve(serverRoot, env.TLS_CERT_PATH || '../certs/localhost.pem'),
  allowHttp: env.ALLOW_HTTP === 'true',
  trustProxy: positiveInt('TRUST_PROXY', 0),
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  maxRoomParticipants: positiveInt('MAX_ROOM_PARTICIPANTS', 8),
  maxUploadBytes: positiveInt('MAX_UPLOAD_MB', 25) * 1024 * 1024,
  roomRetentionMs: positiveInt('ROOM_RETENTION_MINUTES', 30) * 60_000,
  authRateLimit: positiveInt('AUTH_RATE_LIMIT', 20),
  dataFile: resolve(env.DATA_DIR || resolve(serverRoot, 'data'), 'db.json'),
  uploadDir: resolve(env.UPLOAD_DIR || resolve(serverRoot, 'uploads')),
  clientDist: resolve(serverRoot, '../client/dist'),
  iceServersFor,
});
