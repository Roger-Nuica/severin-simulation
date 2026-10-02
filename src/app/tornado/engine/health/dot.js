// @ts-check

/**
 * ===========================================================================
 * SECTION HP.3 — Damage over time: the shared tick accumulator
 * ===========================================================================
 * Continuous hazards (the T-Rex's flames, ordinary fire) hurt Roger as
 * discrete ticks at a fixed interval, never per frame, so every tick clears
 * the 0.2 s hit window (the interval is 0.25 s, `HEALTH.dot.interval`). The
 * helper is pure: it takes the state and returns a new one. The first tick
 * lands the moment contact begins, then one per interval; leaving contact
 * clears the accumulator, so stepping out stops the damage at once.
 */

/**
 * The accumulator of one hazard against one player.
 * @typedef {Object} DotState
 * @property {number} acc Seconds accumulated towards the next tick.
 * @property {boolean} active True while the player was in contact last step.
 */

/** @type {Readonly<DotState>} */
export const IDLE_DOT = Object.freeze({ acc: 0, active: false });

/**
 * Advances one hazard by `dt` seconds.
 * @param {DotState} state The accumulator so far.
 * @param {boolean} inContact Whether the player is in the hazard this step.
 * @param {number} dt Seconds since the last step; zero or less changes nothing.
 * @param {number} interval Seconds between ticks; above zero.
 * @returns {{state: DotState, ticks: number}} The new accumulator and the ticks due now.
 */
export const stepDot = (state, inContact, dt, interval) => {
  if (!inContact) return { state: IDLE_DOT, ticks: 0 };
  if (!(dt > 0)) return { state, ticks: 0 };
  const acc = (state.active ? state.acc : interval) + dt;
  const ticks = Math.floor(acc / interval);
  return { state: { acc: acc - ticks * interval, active: true }, ticks };
};

/**
 * Health points owed for a number of ticks of a per-second source.
 * @param {number} perSecond The source's configured amount per second.
 * @param {number} interval Seconds between ticks.
 * @param {number} ticks Ticks due now.
 * @returns {number} Points to remove in one hit.
 */
export const dotAmount = (perSecond, interval, ticks) => perSecond * interval * ticks;
