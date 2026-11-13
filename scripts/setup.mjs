// One-time local setup: creates certs/localhost{,-key}.pem and server/.env.
// Existing files are left alone, so this is safe to re-run.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const certDir = join(root, 'certs');
const keyPath = join(certDir, 'localhost-key.pem');
const certPath = join(certDir, 'localhost.pem');

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function hasMkcert() {
  try {
    execFileSync('mkcert', ['-help'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function generateSelfSigned(hosts) {
  const { default: selfsigned } = await import('selfsigned');
  const altNames = hosts.map((value) =>
    /^[\d.]+$/.test(value) ? { type: 7, ip: value } : { type: 2, value },
  );
  // selfsigned v5 returns a promise; awaiting a plain object is harmless.
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    algorithm: 'sha256',
    days: 825,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert);
}

async function ensureCerts() {
  if (existsSync(keyPath) && existsSync(certPath)) {
    console.log('certs: already present, keeping them');
    return;
  }
  mkdirSync(certDir, { recursive: true });
  const hosts = ['localhost', '127.0.0.1', '::1', ...lanAddresses()];

  if (hasMkcert()) {
    execFileSync('mkcert', ['-key-file', keyPath, '-cert-file', certPath, ...hosts], {
      stdio: 'inherit',
    });
    console.log('certs: created with mkcert (trusted, provided you ran "mkcert -install")');
    return;
  }

  await generateSelfSigned(hosts.filter((h) => h !== '::1'));
  console.log('certs: created self-signed certificate');
  console.log('       Your browser will warn once per origin. Install mkcert for trusted certs.');
}

function ensureEnv() {
  const envPath = join(root, 'server', '.env');
  if (existsSync(envPath)) {
    console.log('env:   server/.env already present, keeping it');
    return;
  }
  copyFileSync(join(root, 'server', '.env.example'), envPath);
  const secret = randomBytes(48).toString('base64url');
  const contents = readFileSync(envPath, 'utf8').replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);
  writeFileSync(envPath, contents, { mode: 0o600 });
  console.log('env:   created server/.env with a random JWT secret');
}

await ensureCerts();
ensureEnv();
console.log('\nDone. Start everything with: npm run dev');
