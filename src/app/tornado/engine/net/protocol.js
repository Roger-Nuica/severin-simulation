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

/**
 * Version 2 added the peer's `hero` request flag to the input message (a guest
 * asking the host to bring it into Hero Mode). Version 3 gives the guest the
 * single-player controls: on foot the movement keys turn and run (the look is
 * only read while `aim` is held), `abil` gains bit 8 (V, Invincible), and the
 * host sends an `invincible` event. Version 4 (R-061) lets the guest see the
 * host's world: the snapshot gains the additive optional fields `fx`, `tw`,
 * `hole`, `aim` and `env`, and the input gains the optional `charge` and
 * `ability` fields. Host, relay and peer must run the same build: a mismatch is rejected with the `version` error, which the
 * client turns into a "refresh the page" message.
 */
export const PROTOCOL_VERSION = 4;

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
  worldBound: 400,
  /** Rows per additive snapshot field (R-061; the 64 KiB frame stays far away). */
  maxFx: 24,
  maxTw: 8,
  maxHole: 1,
  maxAim: 8,
  maxEnv: 1
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

/** Weapon wheel order (R-049, plus the Katana that heroWeapons.js appends). */
export const WEAPONS = ['rifle', 'minigun', 'railgun', 'fire', 'blackhole', 'katana'];

export const SNAPSHOT_KINDS = ['players', 'tornadoes', 'terminators', 'aliens', 'ships', 'vehicles'];

/** Major events the host may replicate (cosmetic destruction stays local). */
export const EVENT_TYPES = ['welcome', 'announce', 'notice', 'explosion', 'playerDown', 'playerRevived', 'playerDamage', 'gameOver', 'score', 'mission', 'invincible'];

/**
 * Kinds of a discrete guest-visible effect (`fx` column 1 is the index here).
 * Append only: an index is part of the wire contract. A row whose kind is not
 * in this list (a newer host) is dropped by `sanitizeFx`, never an error.
 */
export const FX_KINDS = ['bullet', 'rail', 'plasma', 'mega', 'fire', 'holeShot', 'cut', 'blast'];

/** Column order of an `fx` row: [id, kind, shooter, x, y, z, a, b, c, extra]. */
export const FX_COLUMNS = ['id', 'kind', 'shooter', 'x', 'y', 'z', 'a', 'b', 'c', 'extra'];

/** Row widths of the additive snapshot fields (`fx` is the widest). */
export const EXTRA_ROW_WIDTH = { fx: 10, tw: 6, hole: 4, aim: 4, env: 7 };

const CODE_RE = new RegExp(`^[${ROOM.codeAlphabet}]{${ROOM.codeLength}}$`);

/** @param {unknown} v @returns {v is number} */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
/** @param {unknown} v @param {number} lo @param {number} hi */
const inRange = (v, lo, hi) => num(v) && v >= lo && v <= hi;

/**
 * Parses a raw frame to a plain object, or null when it is too big, not
 * JSON, or not an object.
 * @param {string|Uint8Array|ArrayBuffer} raw
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

const INPUT_KEYS = new Set(['type', 'v', 'seq', 'mx', 'mz', 'yaw', 'pitch', 'fire', 'aim', 'weapon', 'abil', 'use', 'hero', 'charge', 'ability']);

/**
 * A peer's input: its intent only. Movement axes, look angles, buttons.
 * @typedef {{type:'input', v:number, seq:number, mx:number, mz:number,
 *   yaw:number, pitch:number, fire:boolean, aim:boolean, weapon:number,
 *   abil:number, use:boolean, hero:boolean, charge?:number, ability?:number}} PlayerInput
 * Optional (version 4, absent from older inputs): `charge` is the rifle charge
 * level 0-1 held by the guest; `ability` is a bit field 0-255 for the powers
 * that do not fit `abil` (G grapple, C telekinesis; bits assigned by the
 * subtask that uses them).
 * `hero` is a request level, not an order: true while the guest is asking to
 * join Hero Mode (the host acts on the rising edge only).
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
  if (typeof msg.fire !== 'boolean' || typeof msg.aim !== 'boolean' || typeof msg.use !== 'boolean' || typeof msg.hero !== 'boolean') return { ok: false, error: 'buttons' };
  if (!Number.isInteger(msg.weapon) || msg.weapon < 0 || msg.weapon >= WEAPONS.length) return { ok: false, error: 'weapon' };
  // Ability bits: 1 time slow, 2 teleport, 4 EMP, 8 Invincible (V).
  if (!Number.isInteger(msg.abil) || msg.abil < 0 || msg.abil > 31) return { ok: false, error: 'abil' };
  if (msg.charge !== undefined && !inRange(msg.charge, 0, 1)) return { ok: false, error: 'charge' };
  if (msg.ability !== undefined && (!Number.isInteger(msg.ability) || msg.ability < 0 || msg.ability > 255)) return { ok: false, error: 'ability' };
  /** @type {PlayerInput} */
  const input = {
    type: 'input', v: msg.v, seq: msg.seq, mx: msg.mx, mz: msg.mz, yaw: msg.yaw, pitch: msg.pitch,
    fire: msg.fire, aim: msg.aim, weapon: msg.weapon, abil: msg.abil, use: msg.use, hero: msg.hero
  };
  if (msg.charge !== undefined) input.charge = msg.charge;
  if (msg.ability !== undefined) input.ability = msg.ability;
  return { ok: true, input };
}

/**
 * Host -> peers snapshot. Entities are compact arrays by kind:
 *   players      [id, x, z, heading, state(0 up,1 down,2 dead), weapon, energy%, vehicleId|-1, seat(0 driver,1 passenger)|-1]
 *   tornadoes    [id, x, z, radius]
 *   terminators  [id, x, z, heading, state]
 *   aliens       [id, x, y, z, heading]
 *   ships        [id, x, y, z, heading]
 *   vehicles     [id, x, z, heading, speed]
 * Optional `hp` (added with per-player health; absent from older hosts, and
 * ignored by older clients, which read only the listed fields):
 *   hp           [id, health 0-100, sinceLastDamage seconds]
 * The client derives the bar's glow from `sinceLastDamage`; glow itself is
 * never sent. The players row keeps its nine columns on purpose: a longer
 * row would fail an older client's strict row-width check.
 * Optional `alt` (added with the guest's jetpack; same additive rule):
 *   alt          [playerId, height of the feet above the ground, metres]
 * Only players off the ground have a row; none means everyone is standing.
 * Optional `ack` (added for client-side prediction; absent from older hosts,
 * and ignored by older clients, which read only the listed fields):
 *   ack          [playerId, lastAcceptedInputSeq]
 * The last input `seq` the host accepted from each guest (the host itself,
 * id 0, never sends inputs and has no row). Same additive rule as `hp`.
 * Optional version 4 fields (R-061; same additive rule, absent means none):
 *   fx           [id, kind, shooter, x, y, z, a, b, c, extra]  (kind = index in FX_KINDS)
 *   tw           [id, birth, sizeMul, fade, leanX, leanZ]      (the tornado's position stays in `tornadoes`)
 *   hole         [x, z, age, closing 0|1]
 *   aim          [playerId, yaw, pitch, firingBits]
 *   env          [running 0|1, stormRamp, intensity, wind, radius, daylight, timeScale]
 * Caps: fx 24, tw 8, hole 1, aim 8, env 1. Unknown fx kinds are dropped by
 * `sanitizeFx`, not an error. Built and read by later subtasks; no row here
 * widens an existing one.
 * @typedef {{type:'snapshot', v:number, room:string, tick:number, t:number,
 *   score:number, players:number[][], tornadoes:number[][], terminators:number[][],
 *   aliens:number[][], ships:number[][], vehicles:number[][], hp?:number[][], ack?:number[][], alt?:number[][], fx?:number[][], tw?:number[][], hole?:number[][], aim?:number[][], env?:number[][]}} Snapshot
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
  if (msg.hp !== undefined) {
    if (!Array.isArray(msg.hp) || msg.hp.length > LIMITS.maxPerKind) return { ok: false, error: 'hp' };
    for (const row of msg.hp) {
      if (!Array.isArray(row) || row.length !== 3 || !row.every(num)) return { ok: false, error: 'hp' };
      if (!inRange(row[1], 0, 1000) || row[2] < 0) return { ok: false, error: 'hp' };
    }
  }
  if (msg.alt !== undefined) {
    if (!Array.isArray(msg.alt) || msg.alt.length > LIMITS.maxPerKind) return { ok: false, error: 'alt' };
    for (const row of msg.alt) {
      if (!Array.isArray(row) || row.length !== 2 || !row.every(num)) return { ok: false, error: 'alt' };
      if (!Number.isInteger(row[0]) || !inRange(row[1], 0, 1000)) return { ok: false, error: 'alt' };
    }
  }
  if (msg.ack !== undefined) {
    if (!Array.isArray(msg.ack) || msg.ack.length > LIMITS.maxPerKind) return { ok: false, error: 'ack' };
    for (const row of msg.ack) {
      if (!Array.isArray(row) || row.length !== 2 || !row.every(num)) return { ok: false, error: 'ack' };
      if (!Number.isInteger(row[0]) || !Number.isInteger(row[1]) || row[1] < 0 || row[1] > 0x7fffffff) return { ok: false, error: 'ack' };
    }
  }
  const extra = validateExtraFields(msg, b);
  if (extra) return { ok: false, error: extra };
  return { ok: true };
}

/**
 * Checks the optional version 4 snapshot fields. Returns the error code or null.
 * @param {any} msg
 * @param {number} b world half-extent
 * @returns {string|null}
 */
function validateExtraFields(msg, b) {
  /** @type {Record<string, number>} */
  const caps = { fx: LIMITS.maxFx, tw: LIMITS.maxTw, hole: LIMITS.maxHole, aim: LIMITS.maxAim, env: LIMITS.maxEnv };
  for (const name of Object.keys(caps)) {
    const rows = msg[name];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > caps[name]) return name;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== EXTRA_ROW_WIDTH[name] || !r.every(num)) return name;
      if (!extraRowOk(name, r, b)) return name;
    }
  }
  return null;
}

/**
 * Range check of one already-finite additive row.
 * @param {string} name
 * @param {number[]} r
 * @param {number} b world half-extent
 * @returns {boolean}
 */
function extraRowOk(name, r, b) {
  switch (name) {
    case 'fx':
      // Unknown kinds pass here (integer only) and are dropped by sanitizeFx.
      return Number.isInteger(r[0]) && r[0] >= 0 && Number.isInteger(r[1]) && r[1] >= 0 && r[1] <= 255
        && Number.isInteger(r[2]) && r[2] >= -1 && Math.abs(r[3]) <= b && Math.abs(r[4]) <= b && Math.abs(r[5]) <= b
        && Math.abs(r[6]) <= 1e4 && Math.abs(r[7]) <= 1e4 && Math.abs(r[8]) <= 1e4 && Math.abs(r[9]) <= 1e4;
    case 'tw':
      return Number.isInteger(r[0]) && r[0] >= 0 && r[1] >= 0 && inRange(r[2], 0, 100) && inRange(r[3], 0, 1)
        && Math.abs(r[4]) <= b && Math.abs(r[5]) <= b;
    case 'hole':
      return Math.abs(r[0]) <= b && Math.abs(r[1]) <= b && r[2] >= 0 && (r[3] === 0 || r[3] === 1);
    case 'aim':
      return Number.isInteger(r[0]) && r[0] >= 0 && inRange(r[1], -Math.PI * 4, Math.PI * 4) && inRange(r[2], -1.6, 1.6)
        && Number.isInteger(r[3]) && r[3] >= 0 && r[3] <= 255;
    case 'env':
      return (r[0] === 0 || r[0] === 1) && inRange(r[1], 0, 1) && inRange(r[2], 0, 10) && inRange(r[3], 0, 1000)
        && inRange(r[4], 0, 1000) && inRange(r[5], 0, 1) && inRange(r[6], 0, 10);
    default: return false;
  }
}

/**
 * Keeps the `fx` rows whose kind this build knows; an unknown kind (a newer
 * host) is dropped, never an error. Pure; returns a new array.
 * @param {number[][]|undefined} rows
 * @returns {number[][]}
 */
export function sanitizeFx(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => Array.isArray(r) && r.length === EXTRA_ROW_WIDTH.fx && Number.isInteger(r[1]) && r[1] >= 0 && r[1] < FX_KINDS.length);
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
