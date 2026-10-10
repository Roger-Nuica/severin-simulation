// @ts-check
/**
 * ===========================================================================
 * SECTION NX — The host's explosions, drawn on the guest (pure rules)
 * ===========================================================================
 * The host forwards each `explosion` bus event as `{x, z, size}` where `size`
 * is the energy scale (player/energy.js BLAST_SIZE: a barrel 0.06, the tanker
 * 1, a rocket 3), not the fireball strength spawnImpactBurst takes (a barrel
 * 0.85, the tanker 42). This maps one to the other and rate-caps the sound.
 * No ctx, no THREE: the cosmetic entry itself is explosions/index.js
 * `cosmeticExplosion`, which never damages (R-053).
 */

/** Height of a forwarded blast: the event carries no y. */
export const BLAST_Y = 1.5;
/** Sounds the guest may start per second (owner decision 8: a per-kind rate cap). */
export const SOUND_PER_SECOND = 4;

/**
 * Energy size -> burst strength, read off the host's call sites
 * (barrel 0.06 -> 0.85, car 0.12 -> 1.5, factory tank 0.45 -> 12,
 * station 0.75 -> 11, tanker 1 -> 42, rocket 3 -> 46), linear between.
 */
const SIZE_TO_STRENGTH = /** @type {const} */ ([
  [0.06, 0.85], [0.12, 1.5], [0.45, 11], [0.75, 11], [1, 41], [3, 46]
]);

/**
 * @param {number} size
 * @returns {number} burst strength (the burst clamps it again to 0.4..60)
 */
export function strengthForSize(size) {
  const t = SIZE_TO_STRENGTH;
  if (!(size > t[0][0])) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (size <= t[i][0]) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      return y0 + ((size - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return t[t.length - 1][1];
}

/**
 * @param {any} d an `explosion` event's data
 * @returns {{x:number, y:number, z:number, strength:number}|null} null when the data is not finite numbers
 */
export function explosionParams(d) {
  if (!d) return null;
  const x = Number(d.x), z = Number(d.z), size = Number(d.size);
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(size)) return null;
  return { x, y: BLAST_Y, z, strength: strengthForSize(size) };
}

/**
 * A per-second cap on how many sounds may start: a sliding window.
 * @param {number} [perSecond]
 * @returns {{ allow: (nowMs: number) => boolean }}
 */
export function createSoundGate(perSecond = SOUND_PER_SECOND) {
  /** @type {number[]} */
  const starts = [];
  return {
    allow(nowMs) {
      while (starts.length && nowMs - starts[0] >= 1000) starts.shift();
      if (starts.length >= perSecond) return false;
      starts.push(nowMs);
      return true;
    }
  };
}
