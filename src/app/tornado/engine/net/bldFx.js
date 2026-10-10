// @ts-check
/**
 * Building damage on the wire (the `bld` snapshot kind). Pure helpers: the bit
 * mask, the row, the changed-rows-plus-full-table tracker the host fills from,
 * and the bearing maths. No scene, no `ctx`.
 *
 * A row is `[index, mask, toppleDirDeg]` keyed by the building's INDEX in
 * `Environment.buildings` (0..35, deterministic from the town seed on both
 * machines), never by `obj.id`, which is not stable across the two towns. The
 * mask holds the facts the guest cannot know; the toppled pose is the
 * bearing (whole degrees, atan2(x, z)) or -1 when it did not go over. Fire
 * stays in the `fires` rows (type 0). Only buildings with a non-zero mask are
 * ever sent, so an intact town costs nothing.
 */

/** Mask bits: roof and the four walls torn off, collapsed, swallowed by the black hole. */
export const BLD_BIT = { roof: 1, N: 2, S: 4, E: 8, W: 16, collapsed: 32, consumed: 64 };
/** Every bit set (the validator's upper bound). */
export const BLD_MASK_MAX = 127;
/** Buildings in the town (33 buildings and 3 fuel stations); the row cap. */
export const MAX_BUILDINGS = 36;
/** Seconds between full tables (late join, lost frames). */
export const FULL_EVERY = 2;
/** The wall piece names, by mask bit. */
export const WALL_BITS = /** @type {const} */ ([['N', BLD_BIT.N], ['S', BLD_BIT.S], ['E', BLD_BIT.E], ['W', BLD_BIT.W]]);

/**
 * @param {string|undefined} pieceName a piece's `userData.pieceName`
 * @returns {number} its mask bit, 0 when it is not a known piece
 */
export function pieceBit(pieceName) {
  if (pieceName === 'roof') return BLD_BIT.roof;
  if (pieceName === 'wall-N') return BLD_BIT.N;
  if (pieceName === 'wall-S') return BLD_BIT.S;
  if (pieceName === 'wall-E') return BLD_BIT.E;
  if (pieceName === 'wall-W') return BLD_BIT.W;
  return 0;
}

/**
 * Bearing of a horizontal direction in whole degrees 0..359 (atan2(x, z)).
 * @param {number} x @param {number} z
 * @returns {number}
 */
export function bearingDeg(x, z) {
  return (Math.round(Math.atan2(x, z) * 180 / Math.PI) + 360) % 360;
}

/**
 * @param {number} deg a bearing from `bearingDeg`
 * @returns {{x: number, z: number}} the unit direction
 */
export function dirOfDeg(deg) {
  const r = deg * Math.PI / 180;
  return { x: Math.sin(r), z: Math.cos(r) };
}

/**
 * @param {number} index @param {number} mask @param {number} dirDeg -1 = did not topple
 * @returns {number[]}
 */
export function bldRow(index, mask, dirDeg) {
  return [index, mask, dirDeg];
}

/**
 * The host's sender: remembers what it last saw and returns the rows worth
 * sending, the ones that changed plus (about every FULL_EVERY seconds, and on
 * demand) every damaged building. Nothing is sent for an intact one.
 * @returns {{
 *   rows: (count: number, maskAt: (i: number) => number, dirAt: (i: number) => number, now: number) => number[][],
 *   forceFull: () => void,
 *   reset: () => void
 * }}
 */
export function createBldTracker() {
  const last = new Int16Array(MAX_BUILDINGS);
  const lastDir = new Int16Array(MAX_BUILDINGS).fill(-1);
  let nextFull = 0;
  let forced = true;
  return {
    rows(count, maskAt, dirAt, now) {
      const full = forced || now >= nextFull;
      if (full) { forced = false; nextFull = now + FULL_EVERY; }
      /** @type {number[][]} */
      const out = [];
      const n = Math.min(count, MAX_BUILDINGS);
      for (let i = 0; i < n; i++) {
        const mask = maskAt(i);
        const dir = mask & BLD_BIT.collapsed ? dirAt(i) : -1;
        const changed = mask !== last[i] || dir !== lastDir[i];
        last[i] = mask;
        lastDir[i] = dir;
        if (mask !== 0 && (changed || full)) out.push(bldRow(i, mask, dir));
      }
      return out;
    },
    forceFull() { forced = true; },
    reset() { last.fill(0); lastDir.fill(-1); nextFull = 0; forced = true; }
  };
}

/**
 * What a guest still has to apply for one row: the bits it has not applied
 * yet. Additive only; a row that lacks an applied bit (the host rebuilt its
 * town) changes nothing here.
 * @param {number} applied @param {number} mask
 * @returns {number}
 */
export function newBits(applied, mask) {
  return mask & ~applied;
}
