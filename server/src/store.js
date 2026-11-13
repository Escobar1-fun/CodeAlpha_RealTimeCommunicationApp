import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Accounts and room records, held in memory and written through to a JSON file.
 * Writes go to a temp file and are renamed into place, one at a time, so a crash
 * can't leave a half-written database. Fine for one process; swap this class for
 * a real database before running several instances.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.users = new Map();
    this.usersByEmail = new Map();
    this.rooms = new Map();
    this.writeChain = Promise.resolve();

    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      for (const user of data.users ?? []) this.#indexUser(user);
      for (const room of data.rooms ?? []) this.rooms.set(room.id, room);
    }
  }

  #indexUser(user) {
    this.users.set(user.id, user);
    this.usersByEmail.set(user.email, user);
  }

  #persist() {
    const snapshot = JSON.stringify({
      users: [...this.users.values()],
      rooms: [...this.rooms.values()],
    });
    this.writeChain = this.writeChain
      .then(async () => {
        const temp = `${this.file}.tmp`;
        await writeFile(temp, snapshot, { mode: 0o600 });
        await rename(temp, this.file);
      })
      .catch((err) => console.error('Failed to persist data:', err));
    return this.writeChain;
  }

  flush() {
    return this.writeChain;
  }

  findUserByEmail(email) {
    return this.usersByEmail.get(email);
  }

  findUserById(id) {
    return this.users.get(id);
  }

  createUser({ name, email, passwordHash }) {
    const user = {
      id: randomUUID(),
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.#indexUser(user);
    this.#persist();
    return user;
  }

  createRoom({ id, name, createdBy }) {
    const room = { id, name, createdBy, createdAt: new Date().toISOString() };
    this.rooms.set(id, room);
    this.#persist();
    return room;
  }

  findRoom(id) {
    return this.rooms.get(id);
  }

  listRoomsCreatedBy(userId) {
    return [...this.rooms.values()]
      .filter((room) => room.createdBy === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
