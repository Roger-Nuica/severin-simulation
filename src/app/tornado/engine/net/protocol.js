// @ts-check
/**
 * ===========================================================================
 * SECTION NP — Co-op wire protocol
 * ===========================================================================
 * Pure message shapes and validators, shared by the relay (relay/server.mjs),
 * the host and the peers. Nothing here touches the DOM, sockets or Sim.
 *
 * Roles: one host runs the authoritative simulation; peers send inputs only.
 * A peer can never send positions, score, damage, kills or events -- the
 * validators below accept only the fields listed and reject anything else.
 *
 * Client -> relay: create, join, rejoin, leave
 * Peer -> host (relayed): input
 * Host -> peers (relayed): snapshot, event
 * Relay -> client: created, joined, peerJoined, peerLeft, hostLeft, error
 */

export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** Largest raw frame the relay or a client will parse, in bytes. */
  maxBytes: 65536,
  /** Largest peer->host input frame. */
  maxInputBytes: 512,
  /** Peer inputs accepted per second (the client sends ~30/s). */
  inputRate: 40,
  /** Host snapshots per second (approved: 15 Hz, inside the 10-20 Hz range). */
  snapshotHz: 15,
  /** Entities of each kind in one snapshot. */
  maxPerKind: 64,
  /** Events per second the host may emit. */
  eventRate: 30,
  /** World half-extent a position may claim, metres (R-024 Roger ~288 m). */
  worldBound: 400
};

export const ROOM = {
  capacity: 2,
  graceMs: 30000,
  codeLength: 6,
  /** No 0/O/1/I/L: invite codes are read aloud. */
  codeAlphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  /** An unused room (host never connected a peer) expires after this. */
  idleMs: 30 * 60 * 1000
};

/** Weapon wheel order (R-049). */
export const WEAPONS = ['rifle', 'minigun', 'railgun', 'fire', 'blackhole'];

export const SNAPSHOT_KINDS = ['players', 'tornadoes', 'terminators', 'aliens', 'ships', 'vehicles'];

/** Major events the host may replicate (cosmetic destruction stays local). */
export const EVENT_TYPES = ['announce', 'notice', 'explosion', 'playerDown', 'playerRevived', 'gameOver', 'score', 'mission'];

const CODE_RE = new RegExp(`^[${ROOM.codeAlphabet}]{${ROOM.codeLength}}$`);

/** @param {unknown} v @returns {v is number} */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {unknown} v @param {number} lo @param {number} hi */
const inRange = (v, lo, hi) => num(v) && v >= lo && v <= hi;

/**
 * Parses a raw frame to a plain object, or null when it is too big, not
 * JSON, or not an object.
 * @param {string|Buffer|ArrayBuffer} raw
 * @param {number} [max]
 * @returns {Object|null}
 */
export function parseFrame(raw, max = LIMITS.maxBytes) {
  if (typeof raw !== 'string') return null;
  if (raw.length > max) return null;
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : null;
  } catch {
    return null;
  }
}

/** @param {unknown} code @returns {boolean} */
export function isValidCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

/**
 * Client -> relay control messages.
 * @param {any} msg
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateControl(msg) {
  if (!msg || typeof msg.type !== 'string') return { ok: false, error: 'malformed' };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: 'version' };
  switch (msg.type) {
    case 'create': case 'leave': return { ok: true };
    case 'join': return isValidCode(msg.code) ? { ok: true } : { ok: false, error: 'code' };
    case 'rejoin':
      return isValidCode(msg.code) && typeof msg.token === 'string' && msg.token.length > 0 && msg.token.length <= 64
        ? { ok: true } : { ok: false, error: 'code' };
    default: return { ok: false, error: 'type' };
  }
}

const INPUT_KEYS = new Set(['type', 'v', 'seq', 'mx', 'mz', 'yaw', 'pitch', 'fire', 'aim', 'weapon', 'abil', 'use']);

/**
 * A peer's input: its intent only. Movement axes, look angles, buttons.
 * @typedef {{type:'input', v:number, seq:number, mx:number, mz:number,
 *   yaw:number, pitch:number, fire:boolean, aim:boolean, weapon:number,
 *   abil:number, use:boolean}} PlayerInput
 * @param {any} msg
 * @returns {{ok: true, input: PlayerInput} | {ok: false, error: string}}
 */
export function validateInput(msg) {
  if (!msg || msg.type !== 'input') return { ok: false, error: 'type' };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: 'version' };
  for (const k of Object.keys(msg)) if (!INPUT_KEYS.has(k)) return { ok: false, error: `field:${k}` };
  if (!Number.isInteger(msg.seq) || msg.seq < 0 || msg.seq > 0x7fffffff) return { ok: false, error: 'seq' };
  if (!inRange(msg.mx, -1, 1) || !inRange(msg.mz, -1, 1)) return { ok: false, error: 'move' };
  if (!inRange(msg.yaw, -Math.PI * 4, Math.PI * 4)) return { ok: false, error: 'yaw' };
  if (!inRange(msg.pitch, -1.6, 1.6)) return { ok: false, error: 'pitch' };
  if (typeof msg.fire !== 'boolean' || typeof msg.aim !== 'boolean' || typeof msg.use !== 'boolean') return { ok: false, error: 'buttons' };
  if (!Number.isInteger(msg.weapon) || msg.weapon < 0 || msg.weapon >= WEAPONS.length) return { ok: false, error: 'weapon' };
  // Ability bits: 1 time slow, 2 teleport, 4 EMP.
  if (!Number.isInteger(msg.abil) || msg.abil < 0 || msg.abil > 7) return { ok: false, error: 'abil' };
  return {
    ok: true,
    input: {
      type: 'input', v: msg.v, seq: msg.seq, mx: msg.mx, mz: msg.mz, yaw: msg.yaw, pitch: msg.pitch,
      fire: msg.fire, aim: msg.aim, weapon: msg.weapon, abil: msg.abil, use: msg.use
    }
  };
}

/**
 * Host -> peers snapshot. Entities are compact arrays by kind:
 *   players      [id, x, z, heading, state(0 up,1 down,2 dead), weapon, energy%, vehicleId|-1, seat(0 driver,1 passenger)|-1]
 *   tornadoes    [id, x, z, radius]
 *   terminators  [id, x, z, heading, state]
 *   aliens       [id, x, y, z, heading]
 *   ships        [id, x, y, z, heading]
 *   vehicles     [id, x, z, heading, speed]
 * @typedef {{type:'snapshot', v:number, room:string, tick:number, t:number,
 *   score:number, players:number[][], tornadoes:number[][], terminators:number[][],
 *   aliens:number[][], ships:number[][], vehicles:number[][]}} Snapshot
 */
const ROW_WIDTH = { players: 9, tornadoes: 4, terminators: 5, aliens: 5, ships: 5, vehicles: 5 };

/**
 * @param {any} msg
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateSnapshot(msg) {
  if (!msg || msg.type !== 'snapshot') return { ok: false, error: 'type' };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: 'version' };
  if (!Number.isInteger(msg.tick) || msg.tick < 0) return { ok: false, error: 'tick' };
  if (!num(msg.t) || msg.t < 0) return { ok: false, error: 't' };
  if (!num(msg.score) || msg.score < 0) return { ok: false, error: 'score' };
  const b = LIMITS.worldBound;
  for (const kind of SNAPSHOT_KINDS) {
    const rows = msg[kind];
    if (!Array.isArray(rows)) return { ok: false, error: `kind:${kind}` };
    if (rows.length > LIMITS.maxPerKind) return { ok: false, error: `count:${kind}` };
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== ROW_WIDTH[kind]) return { ok: false, error: `row:${kind}` };
      for (const c of row) if (!num(c)) return { ok: false, error: `cell:${kind}` };
      // Positions (x is column 1; z is the last position column) stay in the world.
      if (Math.abs(row[1]) > b) return { ok: false, error: `bound:${kind}` };
      if (kind === 'aliens' || kind === 'ships') {
        if (Math.abs(row[3]) > b) return { ok: false, error: `bound:${kind}` };
      } else if (Math.abs(row[2]) > b) return { ok: false, error: `bound:${kind}` };
    }
  }
  return { ok: true };
}

/**
 * Host -> peers major event.
 * @typedef {{type:'event', v:number, id:number, kind:string, data:Object}} NetEvent
 * @param {any} msg
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateEvent(msg) {
  if (!msg || msg.type !== 'event') return { ok: false, error: 'type' };
  if (msg.v !== PROTOCOL_VERSION) return { ok: false, error: 'version' };
  if (!Number.isInteger(msg.id) || msg.id < 0) return { ok: false, error: 'id' };
  if (!EVENT_TYPES.includes(msg.kind)) return { ok: false, error: 'kind' };
  if (!msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)) return { ok: false, error: 'data' };
  if (JSON.stringify(msg.data).length > 1024) return { ok: false, error: 'size' };
  return { ok: true };
}
