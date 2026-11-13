// Runs everything for phone development over USB: the backend on plain HTTP, the web
// client, and Expo. React Native can't trust a self-signed certificate, so the backend
// uses HTTP here; adb reverse keeps that traffic on the USB cable.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const reversed = [4000, 8081].map((port) =>
  spawnSync('adb', ['reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'ignore', shell: true }).status === 0,
);
if (!reversed.every(Boolean)) {
  console.warn('adb reverse failed. Plug in the phone with USB debugging on, then restart this.');
}

const tasks = [
  { name: 'server', command: 'npm run dev -w server', env: { ALLOW_HTTP: 'true' } },
  { name: 'web', command: 'npm run dev -w client', env: { BACKEND_URL: 'http://localhost:4000' } },
  {
    name: 'expo',
    command: `npx expo start --localhost ${process.argv.includes('--go') ? '--go' : '--dev-client'}`,
    cwd: join(root, 'mobile'),
    // Expo stops watching for file changes when CI is set.
    env: { CI: '' },
  },
];

const children = tasks.map(({ name, command, cwd = root, env }) => {
  const child = spawn(command, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const relay = (stream, out) =>
    stream.on('data', (data) => {
      for (const line of data.toString().split(/\r?\n/)) if (line.trim()) out.write(`[${name}] ${line}\n`);
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  return child;
});

function stop() {
  children.forEach((child) => child.kill());
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
