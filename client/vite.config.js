import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const certDir = resolve(dirname(fileURLToPath(import.meta.url)), '../certs');
const keyPath = resolve(certDir, 'localhost-key.pem');
const certPath = resolve(certDir, 'localhost.pem');

const backend = process.env.BACKEND_URL ?? 'https://localhost:4000';

export default defineConfig(({ command }) => {
  if (command === 'serve' && !(existsSync(keyPath) && existsSync(certPath))) {
    throw new Error('TLS certificate not found in certs/. Run "npm run setup" first.');
  }

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      https: command === 'serve' ? { key: readFileSync(keyPath), cert: readFileSync(certPath) } : undefined,
      // Same-origin in the browser, so the backend needs no CORS and sockets are wss://.
      proxy: {
        '/api': { target: backend, secure: false },
        '/socket.io': { target: backend, ws: true, secure: false },
      },
    },
  };
});
