// @ts-check

/**
 * ===========================================================================
 * SECTION AH.1 — Hank Granite: the moves and the numbers
 * ===========================================================================
 * Pure data and maths for engine/actionHero.js, free of three.js so they
 * run under `node --test` (tests/hank.test.mjs). R-040.
 *
 * Hank is the Human Landslide: a man of quarried granite with magma in the
 * cracks. He drops out of the sky as a boulder, stands up out of it and
 * puts on a show of five moves, one townsperson each, every one thrown a
 * long way in a tall arc with its distance counted live over it like a
 * home run on TV; the longest of the run is the record.
 */

/**
 * @typedef {Object} Move
 * @property {string} name shown big on screen as it lands
 * @property {number} speed launch speed, m/s
 * @property {number} angle launch angle above the ground, radians
 * @property {number} wind seconds of wind-up before the blow
 */

const deg = Math.PI / 180;

/** The five, in order. */
export const MOVES = Object.freeze([
  Object.freeze({ name: 'JAB', speed: 25, angle: 32 * deg, wind: 0.25 }),
  Object.freeze({ name: 'HAYMAKER', speed: 33, angle: 24 * deg, wind: 0.45 }),
  Object.freeze({ name: 'UPPERCUT', speed: 40, angle: 79 * deg, wind: 0.4 }),
  Object.freeze({ name: 'HAMMER THROW', speed: 40, angle: 38 * deg, wind: 1.3 }),
  Object.freeze({ name: 'GROUND POUND', speed: 29, angle: 58 * deg, wind: 0.7 })
]);

export const HANK = Object.freeze({
  /** Life-size, but he is a landslide: 3.2 m (engine/scale.js CHARACTERS.hank). */
  height: 3.2,
  /** The boulder's fall and the stand-up out of it (s). */
  fall: 1.5,
  rise: 1.4,
  /** Seconds between two moves; and the bow at the end. */
  every: 2,
  outro: 2.2,
  /** The world's time while he is on (engine/time.js). */
  slowmo: 0.35,
  /** Gravity for the thrown, on real time (m/s²). */
  gravity: 9.8,
  /** Score: per townsperson thrown, and per metre of the throw. */
  perVictim: 500,
  perMetre: 5,
  /** The rock spikes of the ground pound: how many, the ring's radius (m). */
  spikes: 12,
  spikeRing: 5,
  /** After the show: moon gravity (as before, R-040). */
  lowGravity: Object.freeze({ scale: 0.3, seconds: 10, reach: 45, hop: Object.freeze([4, 7]) })
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
 * The seconds into the show at which move `i` lands.
 * @param {number} i
 * @returns {number}
 */
export function moveAt(i) {
  return HANK.fall + HANK.rise + 0.4 + i * HANK.every;
}

/** @returns {number} the show's length in seconds, from the boulder to the bow */
export function showLength() {
  return moveAt(MOVES.length - 1) + HANK.outro;
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
