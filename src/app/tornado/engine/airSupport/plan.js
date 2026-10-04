// @ts-check

/**
 * ===========================================================================
 * SECTION AS.1 — GHOST flight: the numbers and the rules
 * ===========================================================================
 * Pure data and decisions for the air support (engine/airSupport.js), free
 * of three.js so they run under `node --test` (tests/air-support.test.mjs).
 *
 * The contract (R-056, user request 2026-10-04): 30 s into a run three
 * stealth fighters arrive and stay over the town, and they kill at most one
 * alien every 5 s, with either the gun (tracer rounds, like the minigun) or
 * a pair of rockets.
 */

export const AIR = Object.freeze({
  /** Seconds of world time into a run before the flight arrives. */
  arriveAfter: 30,
  jets: 3,
  callsigns: Object.freeze(['GHOST 1', 'GHOST 2', 'GHOST 3']),
  /** At most one alien per this many seconds, for the whole flight. */
  killEvery: 5,
  /** The racetrack over the town: radius, base height and the step between jets (m), speed (m/s). */
  orbit: Object.freeze({ radius: 125, height: 86, step: 8, speed: 62 }),
  /** Coming in: from this far out (m), this low, this fast; decloaking this far from the middle. */
  ingress: Object.freeze({ from: 950, height: 42, speed: 150, reveal: 320 }),
  /**
   * The attack run, a wheel off the circle: speed (m/s); how far it flies on
   * while rolling in (m); the dive must be at least `minDive` long; it fires
   * from `gunRange` / `rocketRange` out (flat metres) and pulls out
   * `pullOut` short of the target at `pullHeight`, above the rooftops.
   */
  attack: Object.freeze({ speed: 92, turn: 75, minDive: 110, gunRange: 140, rocketRange: 175, pullOut: 45, pullHeight: 36 }),
  /** The gun: rounds per second, burst length (s), tracer speed (m/s), how far short of the target the burst starts walking (m). */
  gun: Object.freeze({ rate: 42, burst: 0.95, speed: 900, walk: 22 }),
  /** Rockets: two, this far apart in time (s); speeds (m/s). */
  rockets: Object.freeze({ count: 2, gap: 0.28, speed0: 110, speed1: 280, turn: 3.2 }),
  /** Seconds to cloak or decloak. */
  cloakSeconds: 0.9,
  /** While circling: seconds seen, then seconds cloaked (each a [min, max] range). */
  seen: Object.freeze([5, 8]),
  hidden: Object.freeze([7, 11]),
  /** How long a jet stays seen after it pulls out of a run (s). */
  afterRun: 2.4
});

/** @typedef {'gun'|'rockets'} Weapon */

/**
 * Whether a new strike may begin now. Only one run at a time is on its way
 * in (before its weapons have hit), and the hit it plans, `lead` seconds
 * from now, must land at least `AIR.killEvery` after the last kill.
 * @param {{busy: boolean, now: number, lastKill: number, lead: number}} s
 *   busy: a run is on its way in; lastKill: when the last alien went down
 *   (-Infinity before the first)
 * @returns {boolean}
 */
export function mayStartStrike({ busy, now, lastKill, lead }) {
  if (busy) return false;
  return now + lead >= lastKill + AIR.killEvery;
}

/**
 * Whether a hit landing now may kill (the hard limit, whatever the timing
 * of the run): at least `AIR.killEvery` since the last kill, with a small
 * tolerance for frame steps.
 * @param {number} now
 * @param {number} lastKill
 * @returns {boolean}
 */
export function mayKill(now, lastKill) {
  return now - lastKill >= AIR.killEvery - 1e-6;
}

/**
 * The next run's weapon: usually the other one (so both are seen), now and
 * then the same again.
 * @param {Weapon|null} last
 * @param {number} roll a random number in [0, 1)
 * @returns {Weapon}
 */
export function nextWeapon(last, roll) {
  if (!last) return roll < 0.5 ? 'gun' : 'rockets';
  const other = last === 'gun' ? 'rockets' : 'gun';
  return roll < 0.75 ? other : last;
}

/**
 * The alien to go after: the nearest to where the run starts that is far
 * enough to dive on (`minDist`), and never one close to Roger (a rocket
 * would land beside him) unless there is no other.
 * @param {{x: number, z: number}[]} aliens
 * @param {{x: number, z: number}} from where the run turns in
 * @param {{x: number, z: number}|null} roger
 * @param {{keepClear?: number, minDist?: number}} [opts] metres
 * @returns {number} its index, or -1
 */
export function pickTarget(aliens, from, roger, { keepClear = 9, minDist = 0 } = {}) {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < aliens.length; i++) {
    const a = aliens[i];
    const d = Math.hypot(a.x - from.x, a.z - from.z);
    if (d < minDist) continue;
    const score = d + (roger && Math.hypot(a.x - roger.x, a.z - roger.z) < keepClear ? 1e6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * A random value in a [min, max] range.
 * @param {readonly number[]} range
 * @param {number} roll in [0, 1)
 * @returns {number}
 */
export function inRange(range, roll) {
  return range[0] + (range[1] - range[0]) * roll;
}
