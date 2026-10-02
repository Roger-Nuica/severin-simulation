// @ts-check
/**
 * ===========================================================================
 * SECTION EV — Events between systems
 * ===========================================================================
 * For news one system has for others, when it does not need an answer: the
 * sender emits it and does not know or care who listens. A new feature that
 * wants to react (a HUD line, a sound, a score) listens, in its own init,
 * rather than being called from every place the thing can happen. Commands
 * that return something (aliens.mutate, nuclear.nearestIntact) stay direct
 * calls.
 *
 * One bus per game instance, on ctx.events, so nothing outlives a dispose.
 * Listeners run at once, in the order they were added, inside emit().
 *
 * The events (every type emitted must be listed here; in development an
 * unlisted one is warned about):
 *   announce  {title, sub}      something big happened: Roger's HUD headlines
 *                               it while Hero Mode is on (hero/screen.js).
 *                               From the mothership, the nuclear plants,
 *                               Smooth Criminal, the UFO, the hunters.
 *   notice    {text}            a smaller line for Roger's HUD (the
 *                               EMP-charged tornado, a car rescue).
 *   empPulse  {x, z, radius}    an EMP wave went through (the Electric
 *                               Tornado, the EMP-charged funnel): Roger's
 *                               pursuers in it die, and Roger unless he is
 *                               in a car (hero/pursuers.js empSweep).
 *   rogerKill {}                Roger killed someone or something (minigun,
 *                               railgun, plasma): it breaks Smooth
 *                               Criminal's peace (smoothCriminal.js).
 *   explosion {x, z, size,      something in town blew up: a tanker, the
 *              source}          chemical works (barrels, tanks, blast), a
 *                               gas main, a fuel station, a car after one.
 *                               size 0..1 (player/energy.js BLAST_SIZE);
 *                               source is the thing that blew, once each.
 *                               Roger near it takes energy (player/energy.js).
 *   playerHurt {amount,         Roger lost health and is still alive (never
 *              position}        an instant kill; health/system.js): the HUD
 *                               flashes red and points at `position` (an
 *                               {x, y, z} or null) (hero/screen.js hurtFlash).
 */

export const EVENTS = ['announce', 'notice', 'empPulse', 'rogerKill', 'explosion', 'playerHurt'];

/**
 * @returns {{
 *   on: (type: string, listener: (payload: Object) => void) => () => void,
 *   emit: (type: string, payload?: Object) => void
 * }}
 */
export function createEventBus() {
  /** @type {Map<string, ((payload: Object) => void)[]>} */
  const listeners = new Map();
  const check = process.env.NODE_ENV === 'development';

  /**
   * @param {string} type
   * @param {(payload: Object) => void} listener
   * @returns {() => void} removes the listener
   */
  function on(type, listener) {
    if (check && !EVENTS.includes(type)) console.warn(`[events] listening for "${type}", which is not in engine/events.js`);
    let list = listeners.get(type);
    if (!list) {
      list = [];
      listeners.set(type, list);
    }
    list.push(listener);
    return () => {
      const i = list.indexOf(listener);
      if (i !== -1) list.splice(i, 1);
    };
  }

  /**
   * @param {string} type
   * @param {Object} [payload]
   * @returns {void}
   */
  function emit(type, payload = {}) {
    if (check && !EVENTS.includes(type)) console.warn(`[events] "${type}" emitted, which is not in engine/events.js`);
    const list = listeners.get(type);
    if (!list) return;
    // A copy: a listener may remove itself.
    for (const listener of list.slice()) listener(payload);
  }

  return { on, emit };
}
