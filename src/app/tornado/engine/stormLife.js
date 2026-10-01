// @ts-check
import { BIRTH } from './vortex.js';

/**
 * ===========================================================================
 * SECTION I.1 — The storm's life (between the systems)
 * ===========================================================================
 * What the frame loop did in between the systems, moved out of
 * tornadoEngine.js unchanged: the scene's brightness grade over a run, each
 * funnel's touchdown and rope-out (vortex.js BIRTH) with the Tornado button
 * coming back for a funnel Roger put out, and the dam holding the funnels on
 * the town's side. Called from tornadoEngine.js frame().
 */

// Scene brightness (post.js Post.brightness): 20% over the original grade
// at all times, and 40% once a run is two minutes old -- by then the storm
// sky, the fires burning out and the power going down have left the town
// too dark to follow. Eased in over BRIGHTNESS_EASE seconds rather than
// stepping.
export const BRIGHTNESS_BASE = 1.2;
const BRIGHTNESS_LATE = 1.4;
const BRIGHTNESS_LATE_AFTER = 120;
const BRIGHTNESS_EASE = 15;

/**
 * @param {Object} ctx
 * @returns {{
 *   updateBrightness: (rawDt: number) => void,
 *   updateBirth: (dt: number) => void,
 *   keepFunnelsOffTheDam: () => void,
 *   resetStormLife: () => void
 * }}
 */
export function createStormLifeSystem(ctx) {
  const { Sim } = ctx;

  // The eased grade, before any dimming (see updateBrightness).
  let brightness = 1;
  // Whether the Tornado button is on mid-run to bring back a funnel Roger
  // put out (updateBirth).
  let startRevivable = false;

  /**
   * @param {number} rawDt
   * @returns {void}
   */
  function updateBrightness(rawDt) {
    const Post = ctx.systems.post.Post;
    const late = Sim.state.running && Sim.state.elapsed >= BRIGHTNESS_LATE_AFTER;
    const target = late ? BRIGHTNESS_LATE : BRIGHTNESS_BASE;
    const step = (BRIGHTNESS_LATE - BRIGHTNESS_BASE) * rawDt / BRIGHTNESS_EASE;
    brightness = brightness < target
      ? Math.min(target, brightness + step)
      : Math.max(target, brightness - step * 3);
    // The alien mothership (engine/mothership.js) blots out the sky while it
    // is overhead: a dimming on top of the grade rather than a new target, so
    // the ease above carries on underneath it.
    Post.brightness = brightness * (1 - ctx.systems.mothership.dimming());
  }

  /**
   * The touchdown (vortex.js BIRTH). There is no tornado at all until the
   * storm is on -- Start, or Chase/Possess mode, which can both run before
   * it -- and then each active funnel is brought down out of the cloud and
   * grown to full size over BIRTH.seconds. An Outbreak funnel added mid-run
   * starts from nothing too, so it is born the same way rather than popping
   * in. Standing the storm down without a Reset withers it back up.
   *
   * The instant the rope reaches the ground is the one beat of it that is an
   * event rather than a ramp: a bolt out of the cloud onto the touchdown
   * point, a flash, and the ground shaking.
   * @param {number} dt
   * @returns {void}
   */
  function updateBirth(dt) {
    const HERO_ROPE_OUT_SECONDS = 1.6;
    const stormOn = Sim.state.running || ctx.Chase.active || ctx.Possess.active;
    for (const tornado of ctx.tornadoes.active) {
      const v = tornado.Vortex;
      const before = v.birth;
      // A funnel Hero Mode's laser has hit (engine/heroMode.js) ropes out
      // and stays gone -- the same retract as a storm standing down, several
      // times as fast -- until the flag is cleared, when a new one comes down.
      const on = stormOn && !v.neutralized;
      const retract = v.neutralized ? HERO_ROPE_OUT_SECONDS : BIRTH.retractSeconds;
      v.birth = on
        ? Math.min(1, v.birth + dt / BIRTH.seconds)
        : Math.max(0, v.birth - dt / retract);
      if (on && before < BIRTH.dropEnd && v.birth >= BIRTH.dropEnd) touchdown(v);
    }
    for (const tornado of ctx.tornadoes.instances) {
      if (!tornado.Vortex.active) tornado.Vortex.birth = 0;
    }
    // Once Roger has put a funnel out and it has roped out, the Tornado
    // button comes back on: pressing it (or a preset) brings a new one down
    // (startSim). It used to stay off for the rest of the run, with no way
    // to have a tornado again.
    const revivable = Sim.state.running
      && ctx.tornadoes.active.some(t => t.Vortex.neutralized && t.Vortex.birth <= 0.01);
    if (revivable !== startRevivable) {
      startRevivable = revivable;
      const startBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-start'));
      if (startBtn && Sim.state.running) startBtn.disabled = !revivable;
    }
  }

  /**
   * @param {Object} v the Vortex state that has just touched the ground
   * @returns {void}
   */
  function touchdown(v) {
    const at = v.center.clone();
    ctx.systems.lightning.strikeAt(at.clone().setY(0.5), 1);
    ctx.systems.lightning.flashScreen(at.clone().setY(20), 0.9);
    ctx.systems.gamefeel.event('touchdown', at);
    // The ring of dust punched outward from where the rope landed is the
    // funnel's own dust ring, pulsed wide by vortex.js birthShape().
  }

  /**
   * The dam is a wall, not a line on the map: no funnel crosses it into the
   * reservoir behind. Each funnel's centre is held far enough to the town
   * side of the wall that its whole width stays there, whatever is steering
   * it (the wander, the hunt, the player). Only along the wall's length --
   * past either end there is nothing to stop it.
   * @returns {void}
   */
  function keepFunnelsOffTheDam() {
    const wall = ctx.systems.flood.damWall();
    for (const tornado of ctx.tornadoes.active) {
      const v = tornado.Vortex;
      const funnel = Sim.params.radius * (v.sizeMul || 1) + 4;
      if (Math.abs(v.center.z) > wall.halfWidth + funnel) continue;
      const minX = wall.x + funnel;
      if (v.center.x < minX) v.center.x = minX;
    }
  }

  /**
   * Back to a fresh run (from resetSim).
   * @returns {void}
   */
  function resetStormLife() {
    startRevivable = false;
  }

  return { updateBrightness, updateBirth, keepFunnelsOffTheDam, resetStormLife };
}
