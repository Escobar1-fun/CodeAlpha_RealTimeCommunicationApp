import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createApp } from './app.js';
import { config } from './config.js';
import { FileVault } from './fileVault.js';
import { RoomManager } from './roomManager.js';
import { attachSockets } from './socket.js';
import { Store } from './store.js';

function createHttpServer(app) {
  const hasCerts = existsSync(config.tlsKeyPath) && existsSync(config.tlsCertPath);
  if (hasCerts && !config.allowHttp) {
    return {
      scheme: 'https',
      server: https.createServer(
        { key: readFileSync(config.tlsKeyPath), cert: readFileSync(config.tlsCertPath) },
        app,
      ),
    };
  }
  if (config.allowHttp) {
    console.warn('ALLOW_HTTP is set: serving plain HTTP. TLS must be terminated upstream.');
    return { scheme: 'http', server: http.createServer(app) };
  }
  throw new Error(
    `TLS certificate not found at ${config.tlsCertPath}. Run "npm run setup" to create one.`,
  );
}

const store = new Store(config.dataFile);
const vault = new FileVault(config.uploadDir);
await vault.init();

const rooms = new RoomManager({
  vault,
  retentionMs: config.roomRetentionMs,
  maxParticipants: config.maxRoomParticipants,
});

const app = createApp({ store, rooms, vault });
const { scheme, server } = createHttpServer(app);
app.locals.io = attachSockets(server, { store, rooms });

server.listen(config.port, () => {
  console.log(`Signaling and API listening on ${scheme}://localhost:${config.port}`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  app.locals.io.close();
  await rooms.purgeAll();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
