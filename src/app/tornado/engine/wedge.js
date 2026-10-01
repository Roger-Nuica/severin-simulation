// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { SCRIPTED_CAMERAS } from './camera.js';

/**
 * ===========================================================================
 * SECTION C.2 — EF5 wedge
 * ===========================================================================
 * The storm mode where the funnel is as wide as a whole district.
 *
 * Every tornado the sliders can make has an outside. The Radius slider tops
 * out at 30, which is a 54-unit force field (forces.js captureRadius) in a
 * town that runs 210 units from end to end -- so there is always somewhere to
 * stand, a street the funnel is not on, a side of the map to evacuate
 * towards. The wedge takes most of that away: at WEDGE.sizeMul on top of a
 * maxed Radius slider the field reaches across most of the town at once.
 * (It used to reach past all of it, which was unreadable on screen -- see
 * WEDGE.sizeMul.)
 *
 * Two knobs do the work, and both already existed for the Fujiwhara monster:
 *  - Vortex.sizeMul scales the funnel and, with it, the capture radius
 *    (forces.js), the lift capacity (physics.js), the ground scouring
 *    (groundFx.js), the minimap ring and the cinematic camera's clearance, so
 *    a wedge is felt by every system that already knew what a big tornado is;
 *  - Vortex.wedge squares the silhouette off (vortex.js WEDGE), because a cone
 *    scaled by four is still a cone standing on a point, and a wedge's whole
 *    character is that it meets the ground as wide as it is anywhere else.
 *
 * It is a mode rather than an event: it stays up until it is switched off,
 * ramping in over WEDGE.rampSeconds and back out over WEDGE.releaseSeconds so
 * the town is swallowed rather than teleported into a different storm.
 *
 * Three exclusivities, all for the same reason -- something else already owns
 * the field:
 *  - an Outbreak is switched down to one funnel on the way up (a wedge is one
 *    storm by definition), and the Fujiwhara preset is refused while it is on
 *    (ui.js applyPreset), which also means no Fujiwhara merge can start and
 *    fight over sizeMul;
 *  - Chase Mode is refused outright (its car cannot be outside a funnel that
 *    has no outside), the same way it refuses an Outbreak;
 *  - Possess mode (engine/possess.js) is refused for the same reason a wedge
 *    refuses Chase Mode: someone is already driving the funnel this ramps.
 *
 * Switching the wedge off does not put the sliders back. Coming up maxes them
 * out -- that much is what a wedge is -- and going back down leaves the storm
 * they describe: still EF5, merely a tornado-sized one again. Hiding an
 * EF5 slider set behind a snapshot restore would mean the panel disagreeing
 * with the funnel, which is the one thing the readouts are for.
 */

const WEDGE = {
  // Funnel scale on top of the Radius slider. Was 4 -- a 216-unit force
  // field over a 210-unit town -- which on screen was a wall of haze and
  // debris with nothing left readable in it. At 2.5 it is still a funnel
  // wider than any street and a field reaching across most of the town
  // (135 units), but the town is still there to watch it go through.
  sizeMul: 2.5,
  // Seconds to grow into it, and to come back out of it. The ramp is what
  // makes it read as the storm becoming something else rather than as a
  // different storm being swapped in.
  rampSeconds: 7,
  releaseSeconds: 4.5,
  // Blend past which the funnel draws its full monster particle budget
  // (vortex.js MONSTER). Early, because the thing is enormous well before the
  // ramp finishes and a sparse wall of that size reads as fog.
  monsterAt: 0.3,
  // What the panel is set to on the way up: an EF5 at every slider's maximum.
  params: {
    intensity: 1, windSpeed: 320, radius: 30, rotationSpeed: 5.5,
    debrisCount: 50, debrisSize: 2
  },
  // A wedge does not dart about. Slowing the wander is what turns it from a
  // very large tornado into a front crossing the town (vortex.js WANDER).
  wanderSpeedMul: 0.45,
  score: 2500,
  bannerSeconds: 4.5
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initWedge: () => void,
 *   updateWedge: (dt: number) => void,
 *   setWedge: (on: boolean) => boolean,
 *   isActive: () => boolean,
 *   blend: () => number,
 *   resetWedge: () => void,
 *   disposeWedge: () => void
 * }}
 */
export function createWedgeSystem(ctx) {
  const state = {
    active: false,
    // 0..1 raw ramp position; the eased value is what reaches the funnel.
    blend: 0,
    // What the funnel was before the wedge took it over. A Fujiwhara monster
    // is bigger than a plain funnel to begin with, and letting the wedge go
    // should hand back the monster rather than an ordinary tornado.
    baseSize: 1,
    baseMonster: false,
    bannerTimer: 0
  };

  /** @type {HTMLElement|null} */
  let banner = null;

  /** @returns {void} */
  function initWedge() {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'wedge-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }
    const button = document.getElementById('btn-wedge');
    if (button) button.addEventListener('click', () => setWedge(!state.active), { signal: ctx.signal });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    state.bannerTimer = WEDGE.bannerSeconds;
  }

  /**
   * Keeps the panel button showing what the mode is actually doing. Owned here
   * rather than by the click handler because the wedge can also be raised by
   * the Doomsday script (engine/doomsday.js), and a mode that is on with its
   * button looking off is worse than no button at all.
   * @returns {void}
   */
  function syncButton() {
    const button = document.getElementById('btn-wedge');
    if (!button) return;
    button.setAttribute('aria-pressed', String(state.active));
    button.classList.toggle('active', state.active);
  }

  /** @returns {boolean} */
  function isActive() {
    return state.active;
  }

  /** @returns {number} 0..1 how far into the wedge the funnel currently is */
  function blend() {
    return state.blend;
  }

  /**
   * Raises or drops the wedge.
   * @param {boolean} on
   * @returns {boolean} whether the mode is now what was asked for; false only
   *   when raising it was refused (Chase Mode or Possess mode is driving).
   */
  function setWedge(on) {
    if (on === state.active) return true;
    if (on && ctx.Chase && ctx.Chase.active) return false;
    if (on && ctx.Possess && ctx.Possess.active) return false;
    state.active = on;
    syncButton();
    const Vortex = ctx.Vortex;

    if (on) {
      // One funnel, and no merge in flight to argue with over sizeMul. This is
      // the same switch-down Chase Mode does on entry, and resetSim's own
      // setCount puts an Outbreak back afterwards.
      ctx.systems.fujiwhara.resetFujiwhara();
      ctx.tornadoes.setCount(1);
      state.baseSize = Vortex.sizeMul;
      state.baseMonster = Vortex.monster;
      ctx.systems.ui.setParams(WEDGE.params);
      Vortex.wanderSpeedMul = WEDGE.wanderSpeedMul;
      // Weighted with a Fujiwhara merge: the same kind of event, a funnel
      // becoming something the sandbox cannot otherwise produce.
      ctx.systems.gamefeel.event('merge', Vortex.center);
      // The "world-end" cue (sound/stinger.js), as for Start, Doomsday and a
      // merge: this is the storm becoming its worst version.
      ctx.systems.stinger.playStinger();
      ctx.systems.damage.addDamageScore(WEDGE.score);
      // Taking the camera, once, if nothing else has it. The manual camera sits
      // wherever it was last dragged, which for a funnel this size is almost
      // certainly inside the wall -- so the reward for pressing the button
      // would be a screen of brown haze. Switching it off again is left to the
      // player: the camera is theirs, this is only a default.
      if (SCRIPTED_CAMERAS && !ctx.Cinematic.active) ctx.setCinematicView(true);
      showBanner('FINAL BOSS', 'Wider than the town. Nowhere beside it to stand');
    } else {
      Vortex.wanderSpeedMul = 1;
      showBanner('FINAL BOSS LIFTING', 'The funnel is drawing back in');
    }
    return true;
  }

  /**
   * Ramps the funnel into (or out of) the wedge and writes the two fields that
   * make it one. Called every unpaused frame, before the Fujiwhara update:
   * while a merge is genuinely running it is the merge that should own
   * sizeMul, and it writes it afterwards.
   * @param {number} dt
   * @returns {void}
   */
  function updateWedge(dt) {
    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }

    const Vortex = ctx.Vortex;
    const settled = !state.active && state.blend <= 0;
    if (settled) {
      ctx.systems.screenCrack.setWedgeLevel(0);
      return;
    }

    const rate = state.active ? 1 / WEDGE.rampSeconds : -1 / WEDGE.releaseSeconds;
    state.blend = THREE.MathUtils.clamp(state.blend + rate * dt, 0, 1);
    // The screen-crack overlay (engine/screenCrack.js) tracks this directly:
    // it comes up and clears with the wedge itself, on the raw blend rather
    // than the eased curve below -- there is no reason the glass should ease
    // in the same way the funnel's silhouette does.
    ctx.systems.screenCrack.setWedgeLevel(state.blend);

    if (!state.active && state.blend <= 0) {
      // Fully back down: hand the funnel over exactly as it was found, and
      // stop writing to it, so a later merge has it to itself again.
      Vortex.wedge = 0;
      Vortex.sizeMul = state.baseSize;
      Vortex.monster = state.baseMonster;
      return;
    }

    // Eased rather than linear: a straight ramp on a four-fold scale change
    // arrives at a visible constant rate of growth, which reads mechanical.
    const eased = state.blend * state.blend * (3 - 2 * state.blend);
    Vortex.wedge = eased;
    Vortex.sizeMul = state.baseSize + (WEDGE.sizeMul - state.baseSize) * eased;
    Vortex.monster = state.baseMonster || eased > WEDGE.monsterAt;
  }

  /** @returns {void} */
  function resetWedge() {
    state.active = false;
    state.blend = 0;
    state.baseSize = 1;
    state.baseMonster = false;
    state.bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
    syncButton();
    const Vortex = ctx.Vortex;
    Vortex.wedge = 0;
    Vortex.sizeMul = 1;
    Vortex.monster = false;
    Vortex.wanderSpeedMul = 1;
  }

  /** @returns {void} */
  function disposeWedge() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return { initWedge, updateWedge, setWedge, isActive, blend, resetWedge, disposeWedge };
}
