// @ts-check
import { HEALTH } from './config.js';
import { IDLE_DOT, stepDot, dotAmount } from './dot.js';

/**
 * ===========================================================================
 * SECTION HP.4 — Ordinary fire burns Roger (10 a second)
 * ===========================================================================
 * Building fire, Firenado ground fire and a burning fuel station hurt Roger
 * while he stands in them, as ticks from the shared `dot.js` accumulator.
 * Each owner answers `contactAt` with its own radius. Lava and the T-Rex
 * are not ordinary fire (the T-Rex ticks from trex.js with the same helper),
 * and the Firenado's x1.5 damage multiplier stays score-only (R-017): this
 * reads only fire positions. A car occupant burns too (user decision Q5).
 * The accumulator is per instance, held in this closure (R-047).
 */

/**
 * Creates the ordinary-fire damage stepper for one simulation instance.
 * @param {any} ctx The simulation context.
 * @returns {{step: (dt: number) => void, reset: () => void}} Per-frame step and reset.
 */
export function createFireDamage(ctx) {
  let dot = IDLE_DOT;

  /**
   * Whether Roger stands in any ordinary fire.
   * @param {{x: number, z: number}} roger Roger's position.
   * @returns {boolean} True when an owner reports contact.
   */
  const inFire = (roger) => {
    const s = ctx.systems;
    return s.buildingFire.contactAt(roger.x, roger.z, HEALTH.dot.fireReach)
      || s.groundFire.contactAt(roger.x, roger.z)
      || s.fuelFire.contactAt(roger.x, roger.z);
  };

  /**
   * Per frame: ticks `ordinaryFire` while Roger is in contact.
   * @param {number} dt Seconds of player time (0 while paused).
   * @returns {void}
   */
  const step = (dt) => {
    const hero = ctx.systems.heroMode;
    const roger = hero && ctx.Hero && ctx.Hero.active ? hero.rogerTarget() : null;
    const next = stepDot(dot, roger !== null && inFire(roger), dt, HEALTH.dot.interval);
    dot = next.state;
    if (next.ticks > 0) {
      ctx.systems.health.damagePlayer({
        source: 'ordinaryFire',
        amount: dotAmount(HEALTH.damage.ordinaryFire.amount, HEALTH.dot.interval, next.ticks),
        type: 'fire',
        position: null,
        title: 'BURNED',
        sub: 'Roger burned to death',
      });
    }
  };

  /** @returns {void} Clears the accumulator (Restart, Reset). */
  const reset = () => { dot = IDLE_DOT; };

  return { step, reset };
}
