// @ts-check
/**
 * ===========================================================================
 * SECTION TG — Time groups
 * ===========================================================================
 * Two clocks run in a frame (tornadoEngine.js frame): the world's, which
 * slow motion slows, and the player's, which it does not. This is who holds
 * them down. Anything that wants the world slower -- Time Slow (engine/
 * player/abilities.js), later a freeze, a cutscene -- takes a named hold on
 * a group at a scale; each group runs at the lowest scale held on it, and at
 * 1 when nothing holds it. Releasing a hold that is not there is harmless.
 *
 *   world   the storm, the town, the aliens, the Terminators: the
 *           simulation's dt (tornadoEngine.js: rawDt x GameFeel.timeScale,
 *           which the world hold caps through GameFeel.forcedScale).
 *   player  Roger (and, in co-op, the second hero): his run, aim, gun and
 *           cameras. Nothing holds it yet; it is there so a player-side
 *           effect (a freeze on him) has somewhere to go, and so the rule
 *           stays written down: slowing the world never slows the player.
 */

/** @typedef {'world'|'player'} TimeGroup */

/**
 * @param {Object} ctx
 * @returns {{
 *   hold: (id: string, group: TimeGroup, scale: number) => void,
 *   release: (id: string) => void,
 *   scale: (group: TimeGroup) => number,
 *   updateTime: () => void,
 *   resetTime: () => void
 * }}
 */
export function createTimeSystem(ctx) {
  /** @type {Map<string, {group: TimeGroup, scale: number}>} */
  const holds = new Map();

  /**
   * @param {string} id who holds it (one hold per id)
   * @param {TimeGroup} group
   * @param {number} scale 0..1
   * @returns {void}
   */
  function hold(id, group, scale) {
    holds.set(id, { group, scale });
  }

  /**
   * @param {string} id
   * @returns {void}
   */
  function release(id) {
    holds.delete(id);
  }

  /**
   * @param {TimeGroup} group
   * @returns {number} the lowest scale held on it, 1 when none
   */
  function scale(group) {
    let s = 1;
    for (const h of holds.values()) if (h.group === group && h.scale < s) s = h.scale;
    return s;
  }

  /**
   * Once a frame, before GameFeel: the world group's hold becomes the cap on
   * GameFeel's time scale (gamefeel.js forcedScale), which is what the
   * frame's dt is made from.
   * @returns {void}
   */
  function updateTime() {
    if (ctx.GameFeel) ctx.GameFeel.forcedScale = scale('world');
  }

  /** @returns {void} */
  function resetTime() {
    holds.clear();
    if (ctx.GameFeel) ctx.GameFeel.forcedScale = 1;
  }

  return { hold, release, scale, updateTime, resetTime };
}
