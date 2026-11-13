import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { publicUser, requireAuth, signToken } from './auth.js';
import { config } from './config.js';
import { fileView } from './socket.js';
import {
  createRoomSchema,
  loginSchema,
  registerSchema,
  roomIdSchema,
  sanitizeFilename,
} from './validation.js';

const BCRYPT_ROUNDS = 12;
// Compared against when an email is unknown, so both login paths take the same time.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

function parseBody(schema, req, res) {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
  return null;
}

function roomView(room, rooms) {
  return { ...room, participants: rooms.participantCount(room.id) };
}

export function createApp({ store, rooms, vault }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // In production this is what enforces HTTPS for returning visitors. On localhost
      // it would pin HTTPS onto every other project served from that hostname.
      strictTransportSecurity: config.isProduction,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          mediaSrc: ["'self'", 'blob:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
    }),
  );

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));
  api.use(express.json({ limit: '32kb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.authRateLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Try again in a few minutes.' },
  });
  const authenticated = requireAuth(store);

  // --- Accounts ---------------------------------------------------------

  api.post('/auth/register', authLimiter, async (req, res) => {
    const body = parseBody(registerSchema, req, res);
    if (!body) return;
    if (store.findUserByEmail(body.email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    // Re-check: another request may have registered this email during the hash.
    if (store.findUserByEmail(body.email)) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    const user = store.createUser({ name: body.name, email: body.email, passwordHash });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  });

  api.post('/auth/login', authLimiter, async (req, res) => {
    const body = parseBody(loginSchema, req, res);
    if (!body) return;
    const user = store.findUserByEmail(body.email);
    const matches = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !matches) return res.status(401).json({ error: 'Incorrect email or password' });
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  api.get('/auth/me', authenticated, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  // --- Rooms ------------------------------------------------------------

  function loadRoom(req, res, next) {
    const id = roomIdSchema.safeParse(req.params.roomId);
    const room = id.success ? store.findRoom(id.data) : undefined;
    if (!room) return res.status(404).json({ error: 'This meeting does not exist' });
    req.room = room;
    next();
  }

  function requirePresence(req, res, next) {
    if (!rooms.isUserPresent(req.room.id, req.user.id)) {
      return res.status(403).json({ error: 'Join the meeting to access its files' });
    }
    next();
  }

  api.get('/rooms', authenticated, (req, res) => {
    res.json({ rooms: store.listRoomsCreatedBy(req.user.id).map((r) => roomView(r, rooms)) });
  });

  api.post('/rooms', authenticated, (req, res) => {
    const body = parseBody(createRoomSchema, req, res);
    if (!body) return;
    const room = store.createRoom({
      id: randomBytes(9).toString('base64url'),
      name: body.name ?? `${req.user.name}'s meeting`,
      createdBy: req.user.id,
    });
    res.status(201).json({ room: roomView(room, rooms) });
  });

  api.get('/rooms/:roomId', authenticated, loadRoom, (req, res) => {
    res.json({ room: roomView(req.room, rooms) });
  });

  // --- Files ------------------------------------------------------------

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0 },
    defParamCharset: 'utf8',
  });

  // Auth and presence run first so that strangers can't make the server buffer a body.
  api.post(
    '/rooms/:roomId/files',
    authenticated,
    loadRoom,
    requirePresence,
    upload.single('file'),
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No file provided' });

      const liveRoom = rooms.get(req.room.id);
      if (!liveRoom) return res.status(409).json({ error: 'The meeting has ended' });

      const id = randomUUID();
      const secrets = await vault.put(id, req.file.buffer);
      const file = {
        id,
        name: sanitizeFilename(req.file.originalname),
        size: req.file.size,
        uploadedBy: { id: req.user.id, name: req.user.name },
        uploadedAt: new Date().toISOString(),
        secrets,
      };
      liveRoom.files.set(id, file);

      const view = fileView(file);
      req.app.locals.io.to(req.room.id).emit('file:shared', view);
      res.status(201).json({ file: view });
    },
  );

  api.get('/rooms/:roomId/files/:fileId', authenticated, loadRoom, requirePresence, async (req, res) => {
    const file = rooms.get(req.room.id)?.files.get(req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const data = await vault.get(file.id, file.secrets);
    res.attachment(file.name);
    // Always opaque and always a download: uploads must never render on this origin.
    res.type('application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.send(data);
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // --- Built client (production) ----------------------------------------

  if (existsSync(join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist));
    app.get(/.*/, (_req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig
          ? `Files can be at most ${Math.round(config.maxUploadBytes / 1048576)} MB`
          : 'Invalid upload',
      });
    }
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
