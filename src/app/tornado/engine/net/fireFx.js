// @ts-check
/**
 * ===========================================================================
 * SECTION FI — Fires on the guest: the `fires` kind, encoded and read (pure)
 * ===========================================================================
 * Building fires, the Firenado's ground fires, fuel stations and the gas mains
 * share one additive optional snapshot kind (an older guest ignores it, an
 * older host never sends it):
 *   fires  [id, type, x, z, level, a, b, c]
 * `id` is `fireId(type, index)`. What the columns mean depends on the type:
 *   building  x z the building's centre, level 0..1 burn, a width, b depth,
 *             c wall height (0 once collapsed: the fire burns low on the rubble)
 *   ground    x z the patch, level 0..1 burn (id index = the patch slot)
 *   fuel      x z the forecourt, a phase (1 leaking, 2 burning, 3 wreck),
 *             level how far the puddle has spread (leaking) or the wreck's
 *             smoke left (wreck), 1 while burning
 *   gas       id index = the main; a, b, c bit masks over its segments
 *             (burning, venting, spent); x z level 0
 * The guest only draws: the same pools, the same emitters, no spread, no
 * damage, no score. No scene, no DOM, no module state.
 */

/** Fire types (the `type` column). */
export const FIRE = Object.freeze({ building: 0, ground: 1, fuel: 2, gas: 3 });

/** Fuel station phases (the `a` column of a fuel row). */
export const FUEL_PHASE = Object.freeze({ leaking: 1, burning: 2, wreck: 3 });

/** Room each type's index has inside an id. */
export const FIRE_ID_SPAN = 1000;

/** Segments a mask can hold (a double holds 31 bits exactly). */
export const MASK_BITS = 30;

/** @param {number} type A `FIRE` value. @param {number} index Index within the type. @returns {number} */
export const fireId = (type, index) => type * FIRE_ID_SPAN + index;

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));
const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;

/**
 * @param {number} type
 * @param {number} index
 * @param {{x: number, z: number, level: number, a?: number, b?: number, c?: number}} s
 * @param {(v: number) => number} clamp Keeps a horizontal position inside the world.
 * @returns {number[]} One `fires` row (8 columns).
 */
export function fireRow(type, index, s, clamp) {
  return [fireId(type, index), type, r2(clamp(s.x)), r2(clamp(s.z)), r2(clamp01(s.level)), s.a || 0, s.b || 0, s.c || 0];
}

/**
 * @param {number} index Building index.
 * @param {{x: number, z: number, level: number, collapsed: boolean, width: number, depth: number, height: number}} f
 * @param {(v: number) => number} clamp
 * @returns {number[]}
 */
export function buildingRow(index, f, clamp) {
  return fireRow(FIRE.building, index, {
    x: f.x, z: f.z, level: f.level,
    a: r2(Math.min(200, Math.max(0, f.width))), b: r2(Math.min(200, Math.max(0, f.depth))),
    c: f.collapsed ? 0 : r2(Math.min(200, Math.max(0.1, f.height)))
  }, clamp);
}

/**
 * A bit mask of segment indices.
 * @param {ArrayLike<boolean>} flags One flag per segment.
 * @returns {number} Segments beyond `MASK_BITS` are dropped.
 */
export function maskOf(flags) {
  let m = 0;
  const n = Math.min(MASK_BITS, flags.length);
  for (let i = 0; i < n; i++) if (flags[i]) m += 2 ** i;
  return m;
}

/** @param {number} mask @param {number} i @returns {boolean} Whether bit `i` is set. */
export const hasBit = (mask, i) => i >= 0 && i < MASK_BITS && Math.floor(mask / 2 ** i) % 2 === 1;

/**
 * A segment's state from the three masks (spent shows under burning: a fresh
 * burn on a scar is still burning).
 * @param {number} burn @param {number} vent @param {number} spent @param {number} i
 * @returns {'burning'|'venting'|'spent'|'sealed'}
 */
export function segmentState(burn, vent, spent, i) {
  if (hasBit(burn, i)) return 'burning';
  if (hasBit(vent, i)) return 'venting';
  if (hasBit(spent, i)) return 'spent';
  return 'sealed';
}

/**
 * The rows to send, at most `cap`: the gas mains, then the fuel stations, then
 * the ground patches, then the building fires, fiercest first.
 * @param {{gas: number[][], fuel: number[][], ground: number[][], buildings: number[][]}} groups
 * @param {number} cap
 * @returns {number[][]}
 */
export function orderFires(groups, cap) {
  /** @type {number[][]} */
  const out = [];
  for (const rows of [groups.gas, groups.fuel, groups.ground]) for (const r of rows) if (out.length < cap) out.push(r);
  const rest = groups.buildings.slice().sort((p, q) => q[4] - p[4]);
  for (const r of rest) if (out.length < cap) out.push(r);
  return out;
}
