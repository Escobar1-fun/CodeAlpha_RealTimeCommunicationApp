import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import { config } from './config.js';
import {
  chatSchema,
  emptySchema,
  joinSchema,
  mediaSchema,
  signalSchema,
  strokeSchema,
  textSchema,
} from './validation.js';

// Tokens per second and burst size, per socket and per event.
const LIMITS = {
  join: [1, 5],
  signal: [100, 300],
  media: [5, 20],
  chat: [3, 10],
  stroke: [60, 120],
  text: [5, 20],
  clear: [1, 3],
};

function tokenBucket([rate, burst]) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/**
 * CORS doesn't apply to WebSocket upgrades, so the origin is checked here.
 * Non-browser clients send no Origin, but they still have to present a valid JWT.
 */
export function isAllowedOrigin(req) {
  const { origin, host } = req.headers;
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function peerView(member) {
  return { id: member.id, user: member.user, media: member.media };
}

function fileView(file) {
  const { id, name, size, uploadedBy, uploadedAt } = file;
  return { id, name, size, uploadedBy, uploadedAt };
}

export function attachSockets(httpServer, { store, rooms }) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 256 * 1024,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req)),
  });

  io.use((socket, next) => {
    const claims = verifyToken(socket.handshake.auth?.token);
    const user = claims && store.findUserById(claims.sub);
    if (!user) return next(new Error('Unauthorized'));

    socket.data.user = { id: user.id, name: user.name };
    // A live socket must not outlast the token that authorised it.
    const expiry = setTimeout(() => socket.disconnect(true), claims.exp * 1000 - Date.now());
    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));
    next();
  });

  io.on('connection', (socket) => {
    const currentRoom = () => (socket.data.roomId ? rooms.get(socket.data.roomId) : undefined);

    /** Rate-limits, validates and dispatches one event; replies via the ack if given. */
    function handle(event, { schema, limit, needsRoom = true }, handler) {
      const allow = tokenBucket(LIMITS[limit]);
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allow()) return reply({ ok: false, error: 'Too many requests' });

        const parsed = schema.safeParse(payload);
        if (!parsed.success) return reply({ ok: false, error: 'Invalid payload' });

        const room = currentRoom();
        if (needsRoom && !room) return reply({ ok: false, error: 'Not in a room' });

        try {
          const result = await handler(parsed.data, room);
          reply({ ok: true, ...result });
        } catch (err) {
          console.error(`Socket handler "${event}" failed:`, err);
          reply({ ok: false, error: 'Server error' });
        }
      });
    }

    function leaveCurrentRoom() {
      const { roomId } = socket.data;
      if (!roomId) return;
      rooms.leave(roomId, socket.id);
      socket.leave(roomId);
      socket.to(roomId).emit('peer:left', { id: socket.id });
      socket.data.roomId = undefined;
    }

    handle('room:join', { schema: joinSchema, limit: 'join', needsRoom: false }, ({ roomId, media }) => {
      if (!store.findRoom(roomId)) return { ok: false, error: 'This meeting does not exist' };
      leaveCurrentRoom();

      const member = { id: socket.id, user: socket.data.user, media };
      const room = rooms.join(roomId, member);
      if (!room) return { ok: false, error: 'This meeting is full' };

      socket.data.roomId = roomId;
      socket.join(roomId);
      socket.to(roomId).emit('peer:joined', peerView(member));

      return {
        selfId: socket.id,
        // The joiner sends an offer to everyone already here.
        peers: [...room.members.values()].filter((m) => m.id !== socket.id).map(peerView),
        chat: room.chat,
        board: room.board,
        files: [...room.files.values()].map(fileView),
        iceServers: config.iceServersFor(socket.data.user.id),
      };
    });

    handle('signal', { schema: signalSchema, limit: 'signal' }, ({ to, description, candidate }, room) => {
      // Signaling never crosses a room boundary, and the sender can't be spoofed.
      if (!room.members.has(to)) return { ok: false, error: 'Peer not found' };
      io.to(to).emit('signal', { from: socket.id, description, candidate });
    });

    handle('media:state', { schema: mediaSchema, limit: 'media' }, (media, room) => {
      room.members.get(socket.id).media = media;
      socket.to(room.id).emit('media:state', { id: socket.id, media });
    });

    handle('chat:send', { schema: chatSchema, limit: 'chat' }, ({ text }, room) => {
      const message = {
        id: randomUUID(),
        user: socket.data.user,
        text,
        sentAt: new Date().toISOString(),
      };
      rooms.addChat(room, message);
      socket.to(room.id).emit('chat:message', message);
      return { message };
    });

    // Client ids are namespaced by socket so one client can't append to another's stroke.
    handle('wb:stroke', { schema: strokeSchema, limit: 'stroke' }, (stroke, room) => {
      const opId = `${socket.id}:${stroke.id}`;
      const op = rooms.applyStroke(room, opId, stroke);
      if (!op) {
        socket.emit('wb:full');
        return { ok: false, error: 'Whiteboard is full' };
      }
      socket.to(room.id).emit('wb:stroke', {
        id: opId,
        tool: op.tool,
        color: op.color,
        size: op.size,
        points: stroke.points,
        done: stroke.done,
      });
    });

    handle('wb:text', { schema: textSchema, limit: 'text' }, (text, room) => {
      const op = { type: 'text', ...text, id: `${socket.id}:${text.id}` };
      if (!rooms.addBoardText(room, op)) {
        socket.emit('wb:full');
        return { ok: false, error: 'Whiteboard is full' };
      }
      socket.to(room.id).emit('wb:text', op);
      return { op };
    });

    handle('wb:clear', { schema: emptySchema, limit: 'clear' }, (_payload, room) => {
      rooms.clearBoard(room);
      socket.to(room.id).emit('wb:clear', { by: socket.data.user.name });
    });

    socket.on('disconnect', leaveCurrentRoom);
  });

  return io;
}

export { fileView };
