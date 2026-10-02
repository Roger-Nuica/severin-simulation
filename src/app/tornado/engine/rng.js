/**
 * Small seedable PRNG (mulberry32). Returns an independent generator per
 * call, so there is no module-level state. Used for deterministic town
 * generation (see environment/index.js); runtime gameplay randomness stays
 * on Math.random.
 * @param {number} seed any finite number; coerced to an unsigned 32-bit int
 * @returns {() => number} function yielding floats in [0, 1)
 */
export function createRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
