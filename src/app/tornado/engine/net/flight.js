// @ts-check
/**
 * ===========================================================================
 * SECTION NJ — A guest's height in the air (pure)
 * ===========================================================================
 * The jetpack as Roger's own (hero/jetpack.js `stepAir`), for a co-op guest:
 * Space lights the pack at once and climbs, let go it sinks gently, there is
 * no fuel and no energy, and it lands on a roof or the street. A guest who
 * is down in the air falls under gravity. No scene, no DOM, no module state:
 * a state in, a new state out, so it is tested without the browser.
 */

/** @typedef {{alt: number, vy: number, air: boolean}} Air height of the feet above the ground (m), vertical speed (m/s), off the ground */
/** @typedef {{jumpSpeed: number, climbSpeed: number, hoverSink: number, lift: number, gravity: number, maxFall: number}} Rules the jetpack's own values */

/** @returns {Air} standing on the street */
export const newAir = () => ({ alt: 0, vy: 0, air: false });

/**
 * One step of height.
 * @param {Air} st Previous state (not changed).
 * @param {{jet: boolean, up: boolean}} input `jet`: Space held by a guest who can fly; `up`: the guest is on their feet (not down).
 * @param {number} dt Seconds.
 * @param {number} ground Height of what is underfoot (a roof's top, or 0).
 * @param {Rules} rules
 * @returns {Air} The next state.
 */
export const stepAir = (st, input, dt, ground, rules) => {
  let { alt, vy, air } = st;
  if (!air) {
    if (input.jet) { air = true; vy = rules.jumpSpeed; }
    else if (alt > ground + 0.05) { air = true; vy = 0; }
    else return { alt: ground, vy: 0, air: false };
  }
  if (input.up) {
    const want = input.jet ? rules.climbSpeed : -rules.hoverSink;
    const step = rules.lift * dt;
    vy = vy < want ? Math.min(want, vy + step) : Math.max(want, vy - step);
  } else {
    vy = Math.max(-rules.maxFall, vy - rules.gravity * dt);
  }
  alt += vy * dt;
  if (alt <= ground && vy <= 0) return { alt: ground, vy: 0, air: false };
  return { alt, vy, air };
};

/**
 * Is a guest's jetpack lit this frame: it has an input (a guest that has sent
 * none yet has none), may move on its feet, and holds the Space bit.
 * @param {{abil: number}|null|undefined} input the guest's latest input, if any
 * @param {boolean} canFly the guest is up and may move (not down, seated or locked)
 * @param {number} bit the input `abil` bit for Space
 * @returns {boolean}
 */
export const jetHeld = (input, canFly, bit) => !!input && !!canFly && (input.abil & bit) !== 0;
