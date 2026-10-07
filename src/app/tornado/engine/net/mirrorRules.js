// @ts-check
/**
 * ===========================================================================
 * SECTION NM — The guest's mirror: what to play, and how often (pure)
 * ===========================================================================
 * The decisions behind `net/mirror.js`, kept free of the scene so they are
 * tested without the browser: which `fx` kinds this build draws yet, the
 * least gap between two cues of a kind, where a shot's end really is (a ray
 * that ends under the ground is clipped to it, so a minigun round lands in
 * the dirt rather than below it), and the intake of one snapshot's rows
 * (unknown kinds out, the guest's own shots out, duplicates out).
 *
 * No scene, no DOM, no module state: plain numbers in, plain numbers out.
 */
import { FX_KINDS } from './protocol.js';
import { HIT_CODES } from './fxOut.js';
import { pushFx } from './fxQueue.js';
import { sanitizeFx } from './protocol.js';

/** The `fx` kinds this subtask draws; the rest (plasma, mega, holeShot, cut, fire) wait for their own subtasks and are left unplayed. */
export const PLAYED = Object.freeze(['bullet', 'rail']);

/** Least seconds between two cues of a kind (the minigun fires 18 a second: about every third round sounds). */
export const CUE_GAP = Object.freeze({ bullet: 0.07, rail: 0.12 });

/** The strike power of a rail bolt on this screen (presentation only): the host's own range is 0.8 to 1 (`strikeTargeting.js`). */
export const RAIL_POWER = 1;

/**
 * @param {number} kindIndex an `fx` row's kind column
 * @returns {'bullet'|'rail'|null} what this build draws for it, null for a kind it does not (yet)
 */
export function playedKind(kindIndex) {
  const name = FX_KINDS[kindIndex];
  return name === 'bullet' || name === 'rail' ? name : null;
}

/**
 * @param {number} last time of the last cue of this kind (seconds; -Infinity for none)
 * @param {number} now
 * @param {number} gap least seconds between cues
 * @returns {boolean} a cue may play now
 */
export const cueDue = (last, now, gap) => now - last >= gap;

/**
 * Where a shot ends and what it lands on, written into `out` (nothing allocated).
 * A ray with no hit that ends below the ground is cut where it meets the
 * ground (`ground`); one that ends above it is `sky`. A recorded ground hit
 * stays on the ground (y never below 0). Anything else keeps its recorded kind.
 * @param {{x: number, y: number, z: number}} from the muzzle
 * @param {{x: number, y: number, z: number}} to the recorded end
 * @param {number} hit a `HIT_CODES` index
 * @param {{x: number, y: number, z: number, kind: string}} out
 * @returns {{x: number, y: number, z: number, kind: string}} `out`
 */
export function shotEnd(from, to, hit, out) {
  const name = HIT_CODES[hit] || 'other';
  out.x = to.x; out.y = to.y; out.z = to.z;
  if (name === 'none' || name === 'sky' || name === 'ground') {
    if (to.y < 0 && from.y > 0) {
      const k = from.y / (from.y - to.y);
      out.x = from.x + (to.x - from.x) * k;
      out.z = from.z + (to.z - from.z) * k;
      out.y = 0;
      out.kind = 'ground';
    } else if (name === 'ground' || to.y <= 0.05) {
      out.y = Math.max(0, to.y);
      out.kind = 'ground';
    } else out.kind = 'sky';
    return out;
  }
  out.kind = name;
  return out;
}

/**
 * One snapshot's `fx` rows into the queue: rows of a kind this build does not
 * know dropped, then the queue's own rules (duplicates and the guest's own shots dropped).
 * @param {import('./fxQueue.js').FxQueue} queue
 * @param {ReadonlyArray<number[]>|undefined} rows the snapshot's `fx`
 * @param {number} hostT the snapshot's host time
 * @param {number} ownId the guest's room id, or -1
 * @returns {import('./fxQueue.js').FxQueue}
 */
export const takeRows = (queue, rows, hostT, ownId) => pushFx(queue, sanitizeFx(rows), hostT, ownId);
