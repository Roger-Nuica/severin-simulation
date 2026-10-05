// @ts-check

/**
 * ===========================================================================
 * SECTION AH.1 — Hank Granite: the numbers
 * ===========================================================================
 * Pure data and maths for engine/actionHero.js, free of three.js so they
 * run under `node --test` (tests/hank.test.mjs). R-040.
 *
 * Hank is the Human Landslide: a man of quarried granite with magma in the
 * cracks. The show (2026-10-05, on request): he drops out of the sky as a
 * boulder and stands up out of it, filmed from the front; two townspeople
 * walk up to him over about two seconds and he sends each a long way with
 * one punch, its distance counted live over it like a home run on TV. Then,
 * if Roger is out, Hank comes for him: a boss to fight, whose punch kills
 * even through Invincible.
 */

/**
 * @typedef {Object} Move
 * @property {string} name shown big on screen as it lands
 * @property {number} speed launch speed, m/s
 * @property {number} angle launch angle above the ground, radians
 * @property {number} wind seconds of wind-up before the blow
 */

const deg = Math.PI / 180;

/** The show's two punches, one townsperson each. */
export const MOVES = Object.freeze([
  Object.freeze({ name: 'HAYMAKER', speed: 36, angle: 30 * deg, wind: 0.45 }),
  Object.freeze({ name: 'KNOCKOUT', speed: 41, angle: 33 * deg, wind: 0.55 })
]);

export const HANK = Object.freeze({
  /** Life-size, but he is a landslide: 3.2 m (engine/scale.js CHARACTERS.hank). */
  height: 3.2,
  /** The boulder's fall and the stand-up out of it (s). */
  fall: 1.5,
  rise: 1.4,
  /** The two walking up to him (s), and the gap between his two punches. */
  approach: 2,
  every: 1.6,
  /** After the last punch: the bow, then (out of Hero Mode) he crumbles. */
  linger: 1.4,
  outro: 2.2,
  /** The world's time while the show runs (engine/time.js). */
  slowmo: 0.35,
  /** Gravity for the thrown, on real time (m/s²). */
  gravity: 9.8,
  /** Score: per townsperson thrown, and per metre of the throw. */
  perVictim: 500,
  perMetre: 5,
  /** After he is gone: moon gravity (as before, R-040). */
  lowGravity: Object.freeze({ scale: 0.3, seconds: 10, reach: 45, hop: Object.freeze([4, 7]) }),
  /** The fight (Hero Mode): health, walk, reach and the punch. */
  boss: Object.freeze({
    hp: 60,
    speed: 4.4,
    /** He winds up once Roger is this close, and the punch lands within `hit`. */
    reach: 3.1,
    hit: 3.7,
    windUp: 0.55,
    recover: 1.1,
    /** Roger above this (a roof, the jetpack) is out of reach: rocks instead. */
    highAbove: 2.4,
    rockEvery: 3.2,
    rockSpeed: 34,
    rockRange: 55,
    /** Anyone in his way is flung. */
    flingRadius: 2.6,
    /** An EMP staggers him (s). */
    stagger: 2,
    score: 3000
  })
});

/**
 * How far a throw lands on flat ground (the projectile's range).
 * @param {number} speed m/s
 * @param {number} angle radians
 * @param {number} [g]
 * @returns {number} metres
 */
export function rangeOf(speed, angle, g = HANK.gravity) {
  return (speed * speed * Math.sin(2 * angle)) / g;
}

/**
 * Seconds in the air.
 * @param {number} speed
 * @param {number} angle
 * @param {number} [g]
 * @returns {number}
 */
export function airTime(speed, angle, g = HANK.gravity) {
  return (2 * speed * Math.sin(angle)) / g;
}

/**
 * The seconds into the show at which punch `i` lands (at the earliest:
 * he waits for the one it is meant for to arrive).
 * @param {number} i
 * @returns {number}
 */
export function moveAt(i) {
  return HANK.fall + HANK.rise + HANK.approach + 0.3 + i * HANK.every;
}

/** @returns {number} the show's length in seconds, from the boulder to the last punch's bow */
export function showLength() {
  return moveAt(MOVES.length - 1) + HANK.linger;
}

/**
 * Whether a throw beats the record (strictly longer).
 * @param {number} metres
 * @param {number} record
 * @returns {boolean}
 */
export function isRecord(metres, record) {
  return metres > record;
}

/**
 * The score for one throw.
 * @param {number} metres
 * @returns {number}
 */
export function throwScore(metres) {
  return HANK.perVictim + Math.round(metres) * HANK.perMetre;
}

/**
 * What the boss does next, from where Roger is.
 * @param {{dist: number, rogerAlt: number, cooldown: number, rockTimer: number}} s
 * @returns {'punch'|'rock'|'walk'|'wait'}
 */
export function bossChoice({ dist, rogerAlt, cooldown, rockTimer }) {
  const B = HANK.boss;
  if (rogerAlt > B.highAbove) {
    if (rockTimer <= 0 && dist < B.rockRange) return 'rock';
    return dist > 6 ? 'walk' : 'wait';
  }
  if (dist <= B.reach) return cooldown <= 0 ? 'punch' : 'wait';
  return 'walk';
}
