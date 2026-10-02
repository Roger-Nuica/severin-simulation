// @ts-check
import { HEALTH } from './config.js';
import { IDLE_DOT, stepDot } from './dot.js';

/**
 * ===========================================================================
 * SECTION HP.5 — Lava contact and the flood wave
 * ===========================================================================
 * Lava (earthquake vents and caldera lakes, the Lavanado's funnel footprint)
 * deals 50 on first contact, then every 1.5 s of continued contact, using
 * the shared `stepDot` accumulator with the lava interval. The dam flood's
 * breaking crest deals 50 once per flood event. Neither is ordinary fire:
 * `fire.js` never reads these owners. Radii are each owner's own: vent and
 * lake radius (`fissures.lavaContactAt`), funnel pickup reach (`lavanado.
 * contactAt`) and the crest region (`flood.atCrest`). A car occupant is
 * hurt too (user decision Q5). State is per instance, in this closure (R-047).
 */

/**
 * The once-per-event latch.
 * @typedef {Object} OnceState
 * @property {boolean} fired True once this event has hurt the player.
 */

/** @type {Readonly<OnceState>} */
export const IDLE_ONCE = Object.freeze({ fired: false });

/**
 * Pure once-per-event step: asks for a hit the first step the player is in
 * contact during an event; the latch clears when the event is over. The
 * caller sets `fired` only when the hit really landed (see `landed`).
 * @param {OnceState} state The latch so far.
 * @param {boolean} inContact Whether the player is in the hazard this step.
 * @param {boolean} eventActive Whether the event is still running.
 * @returns {boolean} True when a hit is due now.
 */
export const onceDue = (state, inContact, eventActive) => eventActive && inContact && !state.fired;

/**
 * Next latch after a step: cleared when the event ends, set when a hit landed.
 * @param {OnceState} state The latch so far.
 * @param {boolean} eventActive Whether the event is still running.
 * @param {boolean} landed Whether a due hit was applied this step.
 * @returns {OnceState} The new latch.
 */
export const onceNext = (state, eventActive, landed) => {
  if (!eventActive) return IDLE_ONCE;
  return landed && !state.fired ? { fired: true } : state;
};

/**
 * Creates the lava and flood damage stepper for one simulation instance.
 * @param {any} ctx The simulation context.
 * @returns {{step: (dt: number) => void, reset: () => void}} Per-frame step and reset.
 */
export function createHazardDamage(ctx) {
  let lavaDot = IDLE_DOT;
  let flood = IDLE_ONCE;

  /**
   * Whether Roger stands on lava.
   * @param {{x: number, z: number}} roger Roger's position.
   * @returns {boolean} True when an owner reports contact.
   */
  const onLava = (roger) => {
    const s = ctx.systems;
    return (!!s.fissures && s.fissures.lavaContactAt(roger.x, roger.z, HEALTH.hazards.lavaMinLevel))
      || (!!s.lavanado && s.lavanado.contactAt(roger.x, roger.z));
  };

  /**
   * Per frame: lava ticks while in contact; the flood crest hits once per event.
   * @param {number} dt Seconds of player time (0 while paused).
   * @returns {void}
   */
  const step = (dt) => {
    const s = ctx.systems;
    const hero = s.heroMode;
    const roger = hero && ctx.Hero && ctx.Hero.active ? hero.rogerTarget() : null;

    const nextLava = stepDot(lavaDot, roger !== null && onLava(roger), dt, HEALTH.damage.lava.interval ?? 1.5);
    lavaDot = nextLava.state;
    if (nextLava.ticks > 0) {
      s.health.damagePlayer({
        source: 'lava', type: 'lava', position: null,
        title: 'BURNED', sub: 'Roger was burned by lava'
      });
    }

    const active = !!s.flood && s.flood.isRunning();
    const touching = roger !== null && active && s.flood.atCrest(roger.x, roger.z);
    let landed = false;
    if (onceDue(flood, touching, active)) {
      landed = s.health.damagePlayer({
        source: 'flood', type: 'flood', position: null,
        title: 'SWEPT AWAY', sub: 'Roger was swept away by the flood'
      }).applied;
    }
    flood = onceNext(flood, active, landed);
  };

  /** @returns {void} Clears both (Restart, Reset). */
  const reset = () => {
    lavaDot = IDLE_DOT;
    flood = IDLE_ONCE;
  };

  return { step, reset };
}
