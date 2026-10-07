// @ts-check
/**
 * ===========================================================================
 * SECTION NQ — Guest fx scheduling (pure)
 * ===========================================================================
 * The host stamps each snapshot with its time `t`; the `fx` rows in it are
 * discrete things (a shot, a cut, a blast) that happened by then. The guest
 * keeps them in a small queue and plays each when render time (the newest
 * host time minus `INTERP_DELAY`, the clock `net/interp.js` already uses; no
 * second clock here) reaches the time they were stamped with. Duplicates (by
 * id) and the guest's own shots (drawn locally, once) are dropped, the queue
 * is capped at `LIMITS.maxFx` with the oldest dropped first, and it is reset
 * on `welcome` and in `endSession` because ids restart with a Restart.
 *
 * No scene, no DOM, no module state: every function takes a queue and returns
 * a new one, so it is tested without the browser.
 */
import { LIMITS } from './protocol.js';
import { INTERP_DELAY } from './interp.js';

/** Render time (host seconds) for the newest host time received. */
export { INTERP_DELAY };
/** Longest an fx may wait (s): a stalled clock never holds a shot for ever. */
export const MAX_WAIT = 2;
/** Black Hole opening and closing durations (s), as `player/blackHole.js` HOLE. */
export const HOLE_OPEN_SECONDS = 1.5;
export const HOLE_CLOSE_SECONDS = 1.8;

/**
 * @typedef {ReadonlyArray<number>} FxRow [id, kind, shooter, x, y, z, a, b, c, extra]
 * @typedef {{row: FxRow, at: number}} Queued a row and the host time it plays at
 * @typedef {{items: ReadonlyArray<Queued>, seen: ReadonlyArray<number>}} FxQueue
 * `items` is ordered by `at` (then arrival); `seen` is the ids already taken, newest last.
 */

/** @returns {FxQueue} an empty queue (call on `welcome` and in `endSession`) */
export const newFxQueue = () => ({ items: [], seen: [] });

/**
 * Take the rows of one snapshot. Drops ids already seen (queued or played),
 * rows whose shooter is `ownId`, and malformed rows; keeps at most
 * `LIMITS.maxFx` waiting, the oldest dropped first. Never changes `queue`.
 * @param {FxQueue} queue
 * @param {ReadonlyArray<FxRow>|undefined} rows the snapshot's (sanitised) `fx`
 * @param {number} hostT the snapshot's host time `t`
 * @param {number} ownId the guest's own room id (shooter column), or -1 for none
 * @returns {FxQueue}
 */
export function pushFx(queue, rows, hostT, ownId) {
  if (!Array.isArray(rows) || rows.length === 0) return queue;
  const seen = new Set(queue.seen);
  const added = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const id = row[0];
    if (seen.has(id)) continue;
    seen.add(id);
    if (row[2] === ownId) continue;
    added.push({ row, at: hostT });
  }
  const seenList = queue.seen.concat([...seen].filter((id) => !queue.seen.includes(id))).slice(-LIMITS.maxFx * 4);
  if (added.length === 0) return { items: queue.items, seen: seenList };
  const items = queue.items.concat(added).sort((p, q) => p.at - q.at);
  return { items: items.slice(Math.max(0, items.length - LIMITS.maxFx)), seen: seenList };
}

/**
 * The rows whose time has come, oldest first, and the queue left. A row more
 * than `MAX_WAIT` ahead of render time is due at once (a clock that jumped back).
 * @param {FxQueue} queue
 * @param {number} renderT host time being drawn (newest host time minus `INTERP_DELAY`)
 * @returns {{due: ReadonlyArray<FxRow>, queue: FxQueue}}
 */
export function dueFx(queue, renderT) {
  if (queue.items.length === 0) return { due: [], queue };
  const due = [];
  const rest = [];
  for (const it of queue.items) (it.at <= renderT || it.at - renderT > MAX_WAIT ? due : rest).push(it);
  if (due.length === 0) return { due: [], queue };
  return { due: due.map((it) => it.row), queue: { items: rest, seen: queue.seen } };
}

/**
 * Blend two `tw` rows ([id, birth, sizeMul, fade, leanX, leanZ]) of the same
 * tornado; `birth` takes the newer row's value (it is discrete), the rest blend.
 * @param {ReadonlyArray<number>} a older row
 * @param {ReadonlyArray<number>} b newer row
 * @param {number} k 0..1 (clamped) from `a` to `b`
 * @returns {number[]}
 */
export function tornadoTarget(a, b, k) {
  const u = Math.min(1, Math.max(0, Number.isFinite(k) ? k : 0));
  const mix = (i) => a[i] + (b[i] - a[i]) * u;
  return [b[0], b[1], mix(2), mix(3), mix(4), mix(5)];
}

/**
 * The Black Hole's drawn size (0..1+) by the host's own curve: a smoothstep
 * open over `HOLE_OPEN_SECONDS`, then, once closing, a swell and a collapse
 * over `HOLE_CLOSE_SECONDS` (`player/blackHole.js`).
 * @param {number} age seconds since it opened
 * @param {number} closing seconds since the collapse began, or a negative number while open
 * @returns {number} size, 0 when gone
 */
export function holeAt(age, closing) {
  const o = Math.min(1, Math.max(0, age) / HOLE_OPEN_SECONDS);
  let size = o * o * (3 - 2 * o);
  if (closing >= 0) {
    const u = Math.min(1, closing / HOLE_CLOSE_SECONDS);
    if (u >= 1) return 0;
    size *= u < 0.25 ? 1 + 0.25 * (u / 0.25) : 1.25 * Math.pow(1 - (u - 0.25) / 0.75, 2);
  }
  return Math.min(1, size);
}
