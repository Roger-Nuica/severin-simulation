// @ts-check

/**
 * ===========================================================================
 * SECTION GN.1 — HAVOC, the heavy gunner: numbers and rules
 * ===========================================================================
 * Pure data and decisions for engine/gunner.js, free of three.js so they
 * run under `node --test` (tests/gunner.test.mjs). R-057.
 *
 * HAVOC walks in, plants his feet, spins up his six-barrel minigun (a red
 * laser sight on Roger, a rising whine) and sprays rounds you can see
 * coming. Each round is a real projectile on the world's clock, so Time
 * Slow (Q) slows the stream to a crawl, and any round that comes within
 * `catchRadius` of Roger while it lasts stops dead in the air. When Time
 * Slow ends, every round he caught turns round and goes back to the man
 * who fired it.
 */

export const GUNNER = Object.freeze({
  /** At most this many at once (one more per press of the button). */
  max: 3,
  /** Life-size: 2.3 m, armoured. */
  height: 2.3,
  /** Health (engine/health/damageTable.js `gunner`). */
  health: 24,
  /** Score for bringing one down. */
  score: 800,
  /** Where he comes in (m from Roger), and the range he fights from. */
  spawnDistance: 60,
  range: Object.freeze([26, 40]),
  walkSpeed: 3.2,
  /** Degrees a second he can swing the gun round while firing: run sideways and the stream lags behind. */
  traverse: 42,
  /** The cycle: spin-up (laser on, whine), firing, cool-down (barrels glowing, a step aside). */
  spinUp: 1.25,
  burst: 2.8,
  coolDown: 2.6,
  /** Rounds a second, their speed (m/s: slow enough to see), spread (radians). */
  rate: 16,
  speed: 70,
  spread: 0.018,
  /** Seconds a round lives (it flies past and is gone). */
  roundLife: 2.2,
  /** Health a round takes off Roger (engine/health/config.js `gunnerRound`). */
  damage: 3,
  /** Roger, as the rounds see him: a standing cylinder. */
  rogerRadius: 0.5,
  rogerTall: 1.9,
  /** Time Slow: rounds closer than this to Roger stop dead (m), and how fast they are thrown back (m/s). */
  catchRadius: 4.2,
  returnSpeed: 95,
  /** An EMP stuns him (no firing, no walking), seconds. */
  stun: 3.5,
  /** The round pool. */
  rounds: 240
});

/**
 * Whether a round should stop dead: Time Slow is on and it is inside the
 * catch radius (or already caught).
 * @param {number} distance from Roger, metres
 * @param {boolean} slowOn Time Slow running
 * @returns {boolean}
 */
export function caught(distance, slowOn) {
  return slowOn && distance <= GUNNER.catchRadius;
}

/**
 * Turns an angle toward another by at most `maxStep` (radians), the short
 * way round.
 * @param {number} from
 * @param {number} to
 * @param {number} maxStep
 * @returns {number}
 */
export function turnToward(from, to, maxStep) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

/**
 * Where to aim to meet a target moving at a steady velocity, for a round
 * at `speed` (first-order lead).
 * @param {{x: number, z: number}} from
 * @param {{x: number, z: number}} at the target now
 * @param {{x: number, z: number}} vel the target's velocity, m/s
 * @param {number} speed the round's
 * @returns {{x: number, z: number}}
 */
export function lead(from, at, vel, speed) {
  const t = Math.hypot(at.x - from.x, at.z - from.z) / Math.max(1, speed);
  return { x: at.x + vel.x * t, z: at.z + vel.z * t };
}

/**
 * The phase after `phase` once its time is up.
 * @param {'walking'|'spinning'|'firing'|'cooling'} phase
 * @param {boolean} inRange
 * @returns {'walking'|'spinning'|'firing'|'cooling'}
 */
export function nextPhase(phase, inRange) {
  if (phase === 'walking') return inRange ? 'spinning' : 'walking';
  if (phase === 'spinning') return 'firing';
  if (phase === 'firing') return 'cooling';
  return inRange ? 'spinning' : 'walking';
}
