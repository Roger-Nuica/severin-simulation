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

/** The `fx` kinds this build draws (the enemies' `ray`, `round` and `missile`, the Katana's `cut` and the teleport's `warp` among them); the rest (fire, blast) wait for their own subtasks and are left unplayed. A `holeShot` is its zap only: the hole itself comes from the `hole` row. */
export const PLAYED = Object.freeze(['bullet', 'rail', 'plasma', 'mega', 'holeShot', 'bolt', 'emp', 'ray', 'round', 'missile', 'cut', 'warp']);

/** Least seconds between two cues of a kind (the minigun fires 18 a second: about every third round sounds; the rifle's own cooldown is 0.35). */
export const CUE_GAP = Object.freeze({ bullet: 0.07, rail: 0.12, plasma: 0.2, mega: 0.2, holeShot: 0.2, bolt: 0.12, emp: 0.3, ray: 0.1, round: 1, missile: 0.3, cut: 0.15, warp: 0.3 });

/** The strike power of a rail bolt on this screen (presentation only): the host's own range is 0.8 to 1 (`strikeTargeting.js`). */
export const RAIL_POWER = 1;

/**
 * @param {number} kindIndex an `fx` row's kind column
 * @returns {'bullet'|'rail'|'plasma'|'mega'|'holeShot'|'bolt'|'emp'|'ray'|'round'|'missile'|'cut'|'warp'|null} what this build draws for it, null for a kind it does not (yet)
 */
export function playedKind(kindIndex) {
  const name = FX_KINDS[kindIndex];
  return PLAYED.includes(name) ? /** @type {any} */ (name) : null;
}

/**
 * How a plasma row's beam looks, from the host's own rule (`hero/plasma.js` `firePlasma`):
 * a mega beam is `megaWidth` wide and burns `megaSeconds`; a normal shot is a little
 * wider the longer the trigger was held (`extra` is the charge in hundredths of a second).
 * Plain numbers in, plain numbers out.
 * @param {boolean} mega
 * @param {number} extra the row's value above the hit code (charge seconds x 100; 0 for a guest's shot)
 * @param {{chargeSeconds: number, megaWidth: number, beamSeconds: number, megaBeamSeconds: number}} hero the host's numbers (`HERO`)
 * @returns {{life: number, width: number}} seconds the beam burns and its width factor
 */
export function beamLook(mega, extra, hero) {
  if (mega) return { life: hero.megaBeamSeconds, width: hero.megaWidth };
  const level = Math.min(hero.chargeSeconds, Math.max(0, extra / 100));
  return { life: hero.beamSeconds, width: 1 + 0.35 * (level / hero.chargeSeconds) };
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

/** The `aim` row's firing bit for the Fire Gun (`net/fxOut.js` `aimRow`: 1 Fire Gun firing, 2 minigun spinning). */
export const AIM_FIRE_BIT = 1;

/**
 * Does this `aim` row ask this screen to draw a flame? The Fire Gun bit is set, and the row is
 * not the viewer's own (its own flame is predicted at the press and draws itself; the host's row
 * for it would double it). A flame is state: no row, or the bit clear, is no flame.
 * @param {ReadonlyArray<number>|undefined} row [playerId, yaw, pitch, firingBits]
 * @param {number} ownId the viewer's player id (-1 when unknown)
 * @returns {boolean}
 */
export const flameWanted = (row, ownId) => !!row && row[0] !== ownId && ((row[3] | 0) & AIM_FIRE_BIT) !== 0;

/**
 * Where a player's flame leaves, from the interpolated position and the row's aim: the muzzle
 * is 0.8 m along the aim from the eye and 0.2 m below it (the guest's own flame and the host's
 * shots use the same offset), the eye at `eye` above the player's height `alt` (the jetpack).
 * Writes into `out` (no allocation).
 * @param {{mx: number, my: number, mz: number, dx: number, dy: number, dz: number}} out muzzle and unit direction
 * @param {number} x @param {number} z the player's ground position
 * @param {number} alt metres above the ground (0 on foot)
 * @param {number} yaw radians (0 faces +z) @param {number} pitch radians
 * @param {number} eye eye height above the player's feet
 * @param {number} [ahead] metres from the eye to the muzzle along the aim
 * @returns {typeof out}
 */
export function flameMuzzle(out, x, z, alt, yaw, pitch, eye, ahead = 0.8) {
  const cp = Math.cos(pitch);
  out.dx = Math.sin(yaw) * cp;
  out.dy = Math.sin(pitch);
  out.dz = Math.cos(yaw) * cp;
  out.mx = x + out.dx * ahead;
  out.my = alt + eye - 0.2 + out.dy * ahead;
  out.mz = z + out.dz * ahead;
  return out;
}
