import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Meeting attachments, encrypted at rest with AES-256-GCM.
 * Each file gets its own key, held only in memory, so what's on disk is unreadable
 * without the running process. Files don't outlive their meeting, which means
 * losing the keys on restart is harmless and leftovers are wiped at startup.
 */
export class FileVault {
  constructor(dir) {
    this.dir = dir;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    const leftovers = (await readdir(this.dir)).filter((name) => name.endsWith('.enc'));
    await Promise.all(leftovers.map((name) => unlink(join(this.dir, name))));
  }

  #path(id) {
    return join(this.dir, `${id}.enc`);
  }

  /** Encrypts and stores the buffer, returning the secrets needed to read it back. */
  async put(id, buffer) {
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    await writeFile(this.#path(id), ciphertext, { mode: 0o600 });
    return { key, iv, tag: cipher.getAuthTag() };
  }

  async get(id, { key, iv, tag }) {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const ciphertext = await readFile(this.#path(id));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async remove(id) {
    await unlink(this.#path(id)).catch(() => {});
  }
}
