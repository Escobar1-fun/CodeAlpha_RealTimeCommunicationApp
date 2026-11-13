import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { io as connect } from 'socket.io-client';

const dir = mkdtempSync(pathJoin(tmpdir(), 'roundtable-test-'));
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.DATA_DIR = dir;
process.env.UPLOAD_DIR = pathJoin(dir, 'uploads');
process.env.MAX_ROOM_PARTICIPANTS = '3';
process.env.MAX_UPLOAD_MB = '1';
process.env.AUTH_RATE_LIMIT = '1000';
process.env.TURN_URLS = 'turn:turn.example.com:3478';
process.env.TURN_SECRET = 'test-turn-secret';

const { createApp } = await import('../src/app.js');
const { FileVault } = await import('../src/fileVault.js');
const { RoomManager } = await import('../src/roomManager.js');
const { attachSockets } = await import('../src/socket.js');
const { Store } = await import('../src/store.js');
const { sanitizeText } = await import('../src/validation.js');

const MEDIA = { audio: true, video: true, screen: false };
const VALID_STROKE = { id: 'abc', tool: 'pen', color: '#112233', size: 4, points: [[1, 2]], done: false };

let server;
let io;
let base;
let store;
const sockets = [];
let counter = 0;

async function post(path, body, token) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(path, token) {
  const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return res;
}

async function newUser(name = 'Test User') {
  counter += 1;
  const { body } = await post('/api/auth/register', {
    name,
    email: `user${counter}@example.com`,
    password: 'correct horse',
  });
  return body;
}

async function newRoom(token) {
  const { body } = await post('/api/rooms', { name: 'Standup' }, token);
  return body.room;
}

function open(token) {
  return new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 2000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

const join = (socket, roomId) => socket.emitWithAck('room:join', { roomId, media: MEDIA });

async function pair() {
  const [alice, bob] = [await newUser('Alice'), await newUser('Bob')];
  const room = await newRoom(alice.token);
  const [a, b] = [await open(alice.token), await open(bob.token)];
  await join(a, room.id);
  await join(b, room.id);
  return { alice, bob, room, a, b };
}

function uploadForm(name, contents) {
  const form = new FormData();
  form.append('file', new Blob([contents]), name);
  return form;
}

const upload = (roomId, token, form) =>
  fetch(`${base}/api/rooms/${roomId}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

before(async () => {
  store = new Store(pathJoin(dir, 'db.json'));
  const vault = new FileVault(process.env.UPLOAD_DIR);
  await vault.init();
  const rooms = new RoomManager({ vault, retentionMs: 60_000, maxParticipants: 3 });
  const app = createApp({ store, rooms, vault });
  server = http.createServer(app);
  io = attachSockets(server, { store, rooms });
  app.locals.io = io;
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  server.closeAllConnections();
  await io.close();
  await store.flush();
  rmSync(dir, { recursive: true, force: true });
});

describe('sanitizeText', () => {
  it('removes tags, including ones assembled by removing another', () => {
    assert.equal(sanitizeText('hi <img src=x onerror=alert(1)>there'), 'hi there');
    assert.equal(sanitizeText('<scr<b>ipt>alert(1)</scr</b>ipt>'), 'alert(1)');
  });
  it('keeps ordinary comparisons and strips invisible characters', () => {
    assert.equal(sanitizeText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2');
    assert.equal(sanitizeText('a‮b\u0000c​'), 'abc');
  });
});

describe('REST auth', () => {
  it('registers without leaking the password hash, and logs in', async () => {
    const { user, token } = await newUser();
    assert.ok(token);
    assert.equal(user.passwordHash, undefined);
    const login = await post('/api/auth/login', { email: user.email, password: 'correct horse' });
    assert.equal(login.status, 200);
  });
  it('rejects bad credentials the same way for known and unknown accounts', async () => {
    const { user } = await newUser();
    const wrong = await post('/api/auth/login', { email: user.email, password: 'nope' });
    const unknown = await post('/api/auth/login', { email: 'ghost@example.com', password: 'nope' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });
  it('rejects duplicates, weak passwords and unexpected fields', async () => {
    const { user } = await newUser();
    const payload = { name: 'X', email: user.email, password: 'long enough pw' };
    assert.equal((await post('/api/auth/register', payload)).status, 409);
    assert.equal((await post('/api/auth/register', { ...payload, email: 'a@b.co', password: 'short' })).status, 400);
    assert.equal((await post('/api/auth/register', { ...payload, email: 'c@b.co', isAdmin: true })).status, 400);
  });
  it('protects endpoints', async () => {
    assert.equal((await get('/api/rooms')).status, 401);
    assert.equal((await get('/api/auth/me', 'garbage')).status, 401);
    const noneAlg = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
    assert.equal((await get('/api/auth/me', noneAlg)).status, 401);
  });
  it('sets security headers', async () => {
    const res = await get('/api/auth/me');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('rooms', () => {
  it('creates unique rooms that can be fetched', async () => {
    const { token } = await newUser();
    const [one, two] = [await newRoom(token), await newRoom(token)];
    assert.notEqual(one.id, two.id);
    assert.match(one.id, /^[A-Za-z0-9_-]{12}$/);
    assert.equal((await get(`/api/rooms/${one.id}`, token)).status, 200);
    assert.equal((await get('/api/rooms/doesnotexist', token)).status, 404);
  });
});

describe('sockets', () => {
  it('refuses connections without a valid token', async () => {
    await assert.rejects(open('not-a-token'), /Unauthorized/);
  });

  it('refuses browser connections from other origins', async () => {
    const { token } = await newUser();
    const socket = connect(base, {
      auth: { token },
      transports: ['polling'],
      reconnection: false,
      extraHeaders: { Origin: 'https://evil.example' },
    });
    sockets.push(socket);
    await assert.rejects(once(socket, 'connect'), /Timed out/);
  });

  it('announces peers and relays signaling with a server-set sender', async () => {
    const { alice, room, a, b } = await pair();
    const third = await open((await newUser('Cara')).token);
    const announced = once(a, 'peer:joined');
    const res = await join(third, room.id);
    assert.equal(res.peers.length, 2);
    assert.equal((await announced).user.name, 'Cara');

    const relayed = once(b, 'signal');
    const ack = await a.emitWithAck('signal', {
      to: b.id,
      description: { type: 'offer', sdp: 'v=0' },
    });
    assert.equal(ack.ok, true);
    const message = await relayed;
    assert.equal(message.from, a.id);
    assert.notEqual(alice.user.id, undefined);
  });

  it('never relays signaling outside the room or with a forged shape', async () => {
    const { a } = await pair();
    const other = await pair();
    const crossRoom = await a.emitWithAck('signal', { to: other.a.id, candidate: { candidate: '' } });
    assert.equal(crossRoom.ok, false);
    const forged = await a.emitWithAck('signal', { to: a.id, from: 'x', candidate: { candidate: '' } });
    assert.equal(forged.error, 'Invalid payload');
    const both = await a.emitWithAck('signal', {
      to: a.id,
      candidate: { candidate: '' },
      description: { type: 'offer', sdp: 'v=0' },
    });
    assert.equal(both.error, 'Invalid payload');
  });

  it('gives each user a short-lived TURN credential from the shared secret', async () => {
    const { alice, room } = await pair();
    const socket = await open(alice.token);
    const { iceServers } = await join(socket, room.id);
    const turn = iceServers.find((s) => [s.urls].flat().some((u) => u.startsWith('turn:')));
    const [expires, userId] = turn.username.split(':');
    assert.equal(userId, alice.user.id);
    assert.ok(Number(expires) > Date.now() / 1000);
    assert.equal(turn.credential, createHmac('sha1', 'test-turn-secret').update(turn.username).digest('base64'));
  });

  it('requires joining before using room events', async () => {
    const socket = await open((await newUser()).token);
    const res = await socket.emitWithAck('chat:send', { text: 'hello' });
    assert.equal(res.error, 'Not in a room');
  });

  it('enforces the participant limit and rejects unknown rooms', async () => {
    const { room } = await pair();
    const third = await open((await newUser()).token);
    assert.equal((await join(third, room.id)).ok, true);
    const fourth = await open((await newUser()).token);
    assert.equal((await join(fourth, room.id)).error, 'This meeting is full');
    assert.equal((await join(fourth, 'nosuchroom123')).error, 'This meeting does not exist');
  });

  it('sanitizes chat and shows history to late joiners', async () => {
    const { room, a, b } = await pair();
    const received = once(b, 'chat:message');
    await a.emitWithAck('chat:send', { text: '<script>alert(1)</script>hello' });
    assert.equal((await received).text, 'alert(1)hello');

    const empty = await a.emitWithAck('chat:send', { text: '<b></b>' });
    assert.equal(empty.ok, false);

    const late = await open((await newUser()).token);
    const res = await join(late, room.id);
    assert.equal(res.chat.length, 1);
  });

  it('syncs whiteboard strokes, text and clear, replaying to late joiners', async () => {
    const { room, a, b } = await pair();
    const first = once(b, 'wb:stroke');
    await a.emitWithAck('wb:stroke', VALID_STROKE);
    assert.equal((await first).id, `${a.id}:abc`);
    await a.emitWithAck('wb:stroke', { ...VALID_STROKE, points: [[3, 4]], done: true });

    const text = once(b, 'wb:text');
    await a.emitWithAck('wb:text', { id: 't1', x: 10, y: 10, text: '<i>note</i>', color: '#000000', size: 24 });
    assert.equal((await text).text, 'note');

    const late = await open((await newUser()).token);
    const { board } = await join(late, room.id);
    assert.equal(board.length, 2);
    assert.deepEqual(board[0].points, [[1, 2], [3, 4]]);

    const cleared = once(b, 'wb:clear');
    await a.emitWithAck('wb:clear', {});
    await cleared;
    late.disconnect();
    const again = await open((await newUser()).token);
    assert.equal((await join(again, room.id)).board.length, 0);
  });

  it('rejects malformed whiteboard data', async () => {
    const { a } = await pair();
    const bad = [
      { ...VALID_STROKE, color: 'red;background:url(x)' },
      { ...VALID_STROKE, points: [[99999, 1]] },
      { ...VALID_STROKE, size: 'huge' },
      { ...VALID_STROKE, tool: 'flamethrower' },
      { ...VALID_STROKE, extra: true },
    ];
    for (const payload of bad) {
      assert.equal((await a.emitWithAck('wb:stroke', payload)).error, 'Invalid payload');
    }
  });

  it('keeps identically named strokes from different clients separate', async () => {
    const { room, a, b } = await pair();
    await a.emitWithAck('wb:stroke', VALID_STROKE);
    await b.emitWithAck('wb:stroke', { ...VALID_STROKE, points: [[5, 6]] });
    const late = await open((await newUser()).token);
    const { board } = await join(late, room.id);
    assert.equal(board.length, 2);
    assert.deepEqual(board[0].points, [[1, 2]]);
  });

  it('rate-limits floods', async () => {
    const { a } = await pair();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => a.emitWithAck('chat:send', { text: 'spam' })),
    );
    assert.ok(results.some((r) => r.error === 'Too many requests'));
  });

  it('tells the room when someone leaves', async () => {
    const { a, b } = await pair();
    const left = once(a, 'peer:left');
    const id = b.id;
    b.disconnect();
    assert.equal((await left).id, id);
  });
});

describe('files', () => {
  it('stores ciphertext and returns the original to participants', async () => {
    const { alice, bob, room, b } = await pair();
    const secret = 'top secret meeting notes';
    const shared = once(b, 'file:shared');

    const res = await upload(room.id, alice.token, uploadForm('../../notes<b>.txt', secret));
    assert.equal(res.status, 201);
    const { file } = await res.json();
    assert.equal(file.secrets, undefined);
    assert.equal((await shared).id, file.id);
    assert.equal(file.name, 'notes.txt');

    const onDisk = readdirSync(process.env.UPLOAD_DIR);
    const stored = readFileSync(pathJoin(process.env.UPLOAD_DIR, `${file.id}.enc`));
    assert.ok(onDisk.length > 0);
    assert.ok(!stored.toString('latin1').includes('secret'));

    const download = await get(`/api/rooms/${room.id}/files/${file.id}`, bob.token);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), secret);
    assert.match(download.headers.get('content-disposition'), /^attachment/);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  });

  it('blocks anyone who is not in the meeting', async () => {
    const { alice, room } = await pair();
    const res = await upload(room.id, alice.token, uploadForm('a.txt', 'data'));
    const { file } = await res.json();
    const outsider = await newUser('Outsider');

    assert.equal((await get(`/api/rooms/${room.id}/files/${file.id}`)).status, 401);
    assert.equal((await get(`/api/rooms/${room.id}/files/${file.id}`, outsider.token)).status, 403);
    assert.equal((await upload(room.id, outsider.token, uploadForm('b.txt', 'x'))).status, 403);
  });

  it('enforces the size limit', async () => {
    const { alice, room } = await pair();
    const res = await upload(room.id, alice.token, uploadForm('big.bin', 'x'.repeat(1024 * 1024 + 1)));
    assert.equal(res.status, 413);
  });
});
