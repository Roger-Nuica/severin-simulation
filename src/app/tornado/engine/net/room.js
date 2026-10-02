// @ts-check
/**
 * ===========================================================================
 * SECTION NR — Room registry (relay-side membership rules)
 * ===========================================================================
 * Pure membership logic for the WebSocket relay: rooms, invite codes,
 * capacity, reconnect grace and host loss. It sends nothing itself: every
 * outgoing message goes through the `send(connId, msg)` it is given, and
 * time comes from `now()`, so it is testable without sockets or timers.
 *
 * Approved policy (PLAN_coop.md): private rooms joined by invite code,
 * capacity 2 (one host + one peer), 30 s reconnect grace for a peer who
 * drops, no host migration -- if the host goes the room closes.
 */
import { ROOM, PROTOCOL_VERSION, isValidCode } from './protocol.js';

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {string} hostConn
 * @property {Map<string, {conn: string|null, token: string, dropAt: number}>} peers by player id
 * @property {number} seq next player id
 * @property {number} lastActive
 */

/**
 * @param {{send: (conn: string, msg: Object) => void,
 *   now?: () => number,
 *   random?: (n: number) => number,
 *   capacity?: number, graceMs?: number, idleMs?: number}} opts
 *   random(n) returns an integer in [0, n)
 */
export function createRoomRegistry(opts) {
  const { send } = opts;
  const now = opts.now || Date.now;
  const capacity = opts.capacity || ROOM.capacity;
  const graceMs = opts.graceMs ?? ROOM.graceMs;
  const idleMs = opts.idleMs ?? ROOM.idleMs;
  const random = opts.random || ((n) => Math.floor(Math.random() * n));

  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** @type {Map<string, {code: string, role: 'host'|'peer', id: string}>} */
  const conns = new Map();

  const makeCode = () => {
    for (let tries = 0; tries < 50; tries++) {
      let c = '';
      for (let i = 0; i < ROOM.codeLength; i++) c += ROOM.codeAlphabet[random(ROOM.codeAlphabet.length)];
      if (!rooms.has(c)) return c;
    }
    return null;
  };
  const makeToken = () => {
    let t = '';
    for (let i = 0; i < 24; i++) t += ROOM.codeAlphabet[random(ROOM.codeAlphabet.length)];
    return t;
  };

  /** @param {Room} room @returns {number} peers present (connected or in grace) */
  const peerCount = (room) => room.peers.size;

  /**
   * @param {string} conn
   * @returns {void}
   */
  function create(conn) {
    if (conns.has(conn)) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'already-in-room' });
    const code = makeCode();
    if (!code) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'busy' });
    rooms.set(code, { code, hostConn: conn, peers: new Map(), seq: 1, lastActive: now() });
    conns.set(conn, { code, role: 'host', id: '0' });
    send(conn, { type: 'created', v: PROTOCOL_VERSION, code, id: '0', capacity });
  }

  /**
   * @param {string} conn
   * @param {string} code
   * @returns {void}
   */
  function join(conn, code) {
    if (conns.has(conn)) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'already-in-room' });
    const room = isValidCode(code) ? rooms.get(code) : undefined;
    if (!room) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'no-room' });
    if (1 + peerCount(room) >= capacity) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'full' });
    const id = String(room.seq++);
    const token = makeToken();
    room.peers.set(id, { conn, token, dropAt: 0 });
    room.lastActive = now();
    conns.set(conn, { code, role: 'peer', id });
    send(conn, { type: 'joined', v: PROTOCOL_VERSION, code, id, token, host: '0' });
    send(room.hostConn, { type: 'peerJoined', v: PROTOCOL_VERSION, id });
  }

  /**
   * A peer that dropped returns with its token inside the grace window.
   * @param {string} conn
   * @param {string} code
   * @param {string} token
   * @returns {void}
   */
  function rejoin(conn, code, token) {
    if (conns.has(conn)) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'already-in-room' });
    const room = isValidCode(code) ? rooms.get(code) : undefined;
    if (!room) return send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'no-room' });
    for (const [id, p] of room.peers) {
      if (p.token !== token) continue;
      // The old connection, if it still looks alive, is replaced.
      if (p.conn) conns.delete(p.conn);
      p.conn = conn;
      p.dropAt = 0;
      conns.set(conn, { code, role: 'peer', id });
      room.lastActive = now();
      send(conn, { type: 'joined', v: PROTOCOL_VERSION, code, id, token, host: '0', rejoined: true });
      send(room.hostConn, { type: 'peerJoined', v: PROTOCOL_VERSION, id, rejoined: true });
      return;
    }
    send(conn, { type: 'error', v: PROTOCOL_VERSION, code: 'no-room' });
  }

  /**
   * A player left on purpose, or the socket closed.
   * @param {string} conn
   * @param {boolean} [graceful] true: removed now, false: peers get the grace window
   * @returns {void}
   */
  function drop(conn, graceful = false) {
    const info = conns.get(conn);
    if (!info) return;
    conns.delete(conn);
    const room = rooms.get(info.code);
    if (!room) return;
    if (info.role === 'host') {
      // No host migration: the room ends.
      for (const [, p] of room.peers) {
        if (p.conn) {
          conns.delete(p.conn);
          send(p.conn, { type: 'hostLeft', v: PROTOCOL_VERSION });
        }
      }
      rooms.delete(room.code);
      return;
    }
    const p = room.peers.get(info.id);
    if (!p) return;
    if (graceful) {
      room.peers.delete(info.id);
      send(room.hostConn, { type: 'peerLeft', v: PROTOCOL_VERSION, id: info.id, reason: 'left' });
    } else {
      p.conn = null;
      p.dropAt = now() + graceMs;
      send(room.hostConn, { type: 'peerLeft', v: PROTOCOL_VERSION, id: info.id, reason: 'dropped', graceMs });
    }
  }

  /**
   * Forwards a message with its sender stamped on, enforcing roles: a peer
   * may only reach the host; the host may reach every peer or one by id.
   * @param {string} conn
   * @param {Object} msg
   * @param {string} [to] peer id (host only); omitted = all peers
   * @returns {boolean} whether it was forwarded
   */
  function relay(conn, msg, to) {
    const info = conns.get(conn);
    if (!info) return false;
    const room = rooms.get(info.code);
    if (!room) return false;
    room.lastActive = now();
    if (info.role === 'peer') {
      if (msg.type !== 'input') return false;
      send(room.hostConn, { ...msg, from: info.id });
      return true;
    }
    if (msg.type !== 'snapshot' && msg.type !== 'event') return false;
    for (const [id, p] of room.peers) {
      if (p.conn && (to === undefined || to === id)) send(p.conn, msg);
    }
    return true;
  }

  /**
   * Expires peers whose grace ran out and rooms nobody used for idleMs.
   * @returns {void}
   */
  function tick() {
    const t = now();
    for (const room of [...rooms.values()]) {
      for (const [id, p] of [...room.peers]) {
        if (!p.conn && p.dropAt && t >= p.dropAt) {
          room.peers.delete(id);
          send(room.hostConn, { type: 'peerLeft', v: PROTOCOL_VERSION, id, reason: 'expired' });
        }
      }
      if (t - room.lastActive > idleMs) {
        for (const [, p] of room.peers) if (p.conn) { conns.delete(p.conn); send(p.conn, { type: 'hostLeft', v: PROTOCOL_VERSION }); }
        conns.delete(room.hostConn);
        send(room.hostConn, { type: 'error', v: PROTOCOL_VERSION, code: 'expired' });
        rooms.delete(room.code);
      }
    }
  }

  return { create, join, rejoin, drop, relay, tick, roomCount: () => rooms.size, has: (code) => rooms.has(code), role: (conn) => conns.get(conn) || null };
}
