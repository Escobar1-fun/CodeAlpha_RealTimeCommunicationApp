const MAX_CHAT_HISTORY = 500;
const MAX_BOARD_OPS = 5000;
const MAX_BOARD_POINTS = 300_000;

/**
 * Live state of each meeting: who is present, chat history, the whiteboard log and
 * shared files. It exists while a meeting is active and is discarded (files included)
 * once a room has been empty for the retention period.
 */
export class RoomManager {
  constructor({ vault, retentionMs, maxParticipants }) {
    this.vault = vault;
    this.retentionMs = retentionMs;
    this.maxParticipants = maxParticipants;
    this.rooms = new Map();
  }

  #getOrCreate(roomId) {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        members: new Map(),
        chat: [],
        board: [],
        strokes: new Map(),
        boardPoints: 0,
        files: new Map(),
        purgeTimer: null,
      };
      this.rooms.set(roomId, room);
    }
    return room;
  }

  get(roomId) {
    return this.rooms.get(roomId);
  }

  participantCount(roomId) {
    return this.rooms.get(roomId)?.members.size ?? 0;
  }

  isUserPresent(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    for (const member of room.members.values()) {
      if (member.user.id === userId) return true;
    }
    return false;
  }

  /** Adds a member. Returns the room, or null when it is full. */
  join(roomId, member) {
    const room = this.#getOrCreate(roomId);
    if (room.members.size >= this.maxParticipants) return null;
    clearTimeout(room.purgeTimer);
    room.purgeTimer = null;
    room.members.set(member.id, member);
    return room;
  }

  leave(roomId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.members.delete(socketId);
    if (room.members.size === 0) {
      room.purgeTimer = setTimeout(() => this.purge(roomId), this.retentionMs);
      room.purgeTimer.unref();
    }
  }

  async purge(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    clearTimeout(room.purgeTimer);
    this.rooms.delete(roomId);
    await Promise.all([...room.files.keys()].map((id) => this.vault.remove(id)));
  }

  purgeAll() {
    return Promise.all([...this.rooms.keys()].map((id) => this.purge(id)));
  }

  addChat(room, message) {
    room.chat.push(message);
    if (room.chat.length > MAX_CHAT_HISTORY) room.chat.shift();
  }

  /**
   * Appends a batch of points to a stroke, creating it on first sight.
   * Returns the op's stored style so that relayed batches always match what late
   * joiners will replay, or null if the batch is not accepted.
   */
  applyStroke(room, opId, { tool, color, size, points, done }) {
    let op = room.strokes.get(opId);
    if (!op) {
      if (room.board.length >= MAX_BOARD_OPS) return null;
      op = { type: 'stroke', id: opId, tool, color, size, points: [], done: false };
      room.board.push(op);
      room.strokes.set(opId, op);
    }
    if (room.boardPoints + points.length > MAX_BOARD_POINTS) return null;
    op.points.push(...points);
    op.done = done;
    room.boardPoints += points.length;
    if (done) room.strokes.delete(opId);
    return op;
  }

  addBoardText(room, op) {
    if (room.board.length >= MAX_BOARD_OPS) return false;
    room.board.push(op);
    return true;
  }

  clearBoard(room) {
    room.board = [];
    room.strokes.clear();
    room.boardPoints = 0;
  }
}
