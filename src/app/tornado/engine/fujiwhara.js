// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION C.1 — Fujiwhara merge (Outbreak mode)
 * ===========================================================================
 * Two Outbreak tornadoes (engine/tornadoes.js) that wander close enough
 * together do not pass through each other: they lock into a binary orbit
 * around their shared midpoint, spiral in, and combine into one monster
 * tornado bigger than any the sliders can make. Named after the Fujiwhara
 * effect, the mutual orbit of two nearby cyclones.
 *
 * A merge runs in phases rather than happening on the spot:
 *  - orbit (MERGE.orbitTime): both funnels are pinned off their wander paths
 *    (Vortex.pinned) and swung around the fixed midpoint, winding up faster
 *    as the orbit tightens, leaning into the turn and churning harder
 *    (Vortex.agitation, leanX/leanZ);
 *  - collapse (MERGE.collapseTime): they keep spiralling in until they meet.
 *    The survivor grows (Vortex.sizeMul) while the other thins and fades to
 *    nothing (Vortex.fade) -- one funnel absorbing the other, rather than an
 *    attempt to blend two particle systems into one;
 *  - on contact: anything the absorbed funnel was carrying is handed to the
 *    survivor (physics.js would otherwise drop it, as it does when an
 *    Outbreak ends), the absorbed funnel is retired through the registry's
 *    usual switch-off path, and the survivor becomes a monster, with the
 *    extra particles its buffers were allocated for (vortex.js MONSTER). A
 *    heavy camera shake, a banner and a large score bonus mark the event,
 *    and a rising whoosh (sound/fujiwhara.js) leads up to it;
 *  - settle (MERGE.settleTime): the survivor's lean and churn die away and
 *    it rejoins its wander path.
 *
 * One pair at a time, down to one funnel: with three active, two merge and
 * the third is untouched.
 *
 * The Fujiwhara preset (ui.js) turns on this module's own mode: it starts
 * with exactly two funnels, and a third forms on its own MERGE.extraDelay
 * seconds into the run (setFujiwharaMode, updateFujiwhara). A Reset puts it
 * back to two and starts that minute again. The primary tornado (ctx.Vortex, which the
 * camera, Chase Mode and the Firenado all follow) always survives a merge
 * it is part of; otherwise the bigger funnel does, then the lower index.
 *
 * Every run, whatever the preset, gets a second tornado MERGE.secondAfter
 * seconds (half a minute, on request; it was a minute and a half) after Start if only one is up by then
 * (updateSecondTornado) -- which is what lets a plain run end in a merge.
 */

const MERGE = {
  distance: 30,            // ground distance at which a pair starts to orbit
  minAge: 8,               // seconds both must have been active (no merge at spawn)
  orbitTime: 1.7,
  orbitSpin: [1.4, 4.2],   // rad/s about the midpoint, winding up over the orbit
  orbitTighten: 0.4,       // separation left at the end of the orbit, as a fraction
  collapseTime: 0.8,
  settleTime: 2.5,
  // Survivor's sizeMul: at the Fujiwhara preset's radius of 20 this is a
  // 48-unit funnel, well past the slider's 30 maximum, so a merged monster
  // is visibly a thing the sandbox cannot otherwise produce. Raised from 1.7
  // together with the force and lift scaling it now drives (forces.js
  // MONSTER_FORCE_GAIN, physics.js MONSTER_LIFT_GAIN) -- at 1.7 the survivor
  // was wider but no stronger and no more capable, which is exactly why it
  // did not read as an endgame.
  monsterSize: 2.4,
  maxLean: 0.16,           // radians the funnels tip into the turn
  shakeMagnitude: 1.6,
  shakeDuration: 1.4,
  score: 1500,
  bannerSeconds: 4,
  // Fujiwhara mode: run-seconds until the extra tornado forms, and how many
  // the preset starts with.
  extraDelay: 60,
  startCount: 2,
  // Every run, whatever the preset: a second tornado comes down this many
  // seconds after the first (Start), if only one is up by then.
  secondAfter: 30
};

/**
 * @typedef {import('./tornadoes.js').TornadoInstance} TornadoInstance
 */

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
function smooth(edge0, edge1, x) {
  return THREE.MathUtils.smoothstep(x, edge0, edge1);
}

/**
 * The survivor of a pair: the primary if it is in it, else the bigger
 * funnel (a previous monster), else the lower index.
 * @param {TornadoInstance} a
 * @param {TornadoInstance} b
 * @returns {{survivor: TornadoInstance, absorbed: TornadoInstance}}
 */
function chooseSurvivor(a, b) {
  const rank = (/** @type {TornadoInstance} */ t) => [t.Vortex.index === 0 ? 1 : 0, t.Vortex.sizeMul, -t.Vortex.index];
  const ra = rank(a);
  const rb = rank(b);
  const aWins = ra[0] !== rb[0] ? ra[0] > rb[0] : ra[1] !== rb[1] ? ra[1] > rb[1] : ra[2] > rb[2];
  return aWins ? { survivor: a, absorbed: b } : { survivor: b, absorbed: a };
}

/**
 * Tips a funnel towards a ground direction by `angle` radians. Rotating +Y
 * about X by +a carries it towards +Z; about Z by +a, towards -X.
 * @param {Object} Vortex
 * @param {number} dirX
 * @param {number} dirZ
 * @param {number} angle
 * @returns {void}
 */
function leanTowards(Vortex, dirX, dirZ, angle) {
  Vortex.leanX = dirZ * angle;
  Vortex.leanZ = -dirX * angle;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initFujiwhara: () => void,
 *   updateFujiwhara: (dt: number) => void,
 *   resetFujiwhara: () => void,
 *   setFujiwharaMode: (on: boolean) => void,
 *   disposeFujiwhara: () => void
 * }}
 */
export function createFujiwharaSystem(ctx) {
  const { Sim, container } = ctx;

  const state = {
    /** @type {'idle'|'orbit'|'collapse'|'settle'} */
    phase: 'idle',
    age: 0,
    /** @type {TornadoInstance|null} */
    survivor: null,
    /** @type {TornadoInstance|null} */
    absorbed: null,
    midX: 0,
    midZ: 0,
    angle: 0,
    radius: 0,
    startRadius: 0,
    startSize: 1,
    bannerTimer: 0
  };
  /** @type {Map<TornadoInstance, number>} seconds each tornado has been active */
  const ages = new Map();
  /** @type {HTMLDivElement|null} */
  let banner = null;
  // The Fujiwhara preset is on, and how long until its extra tornado forms
  // (0 once it has).
  let mode = false;
  let extraTimer = 0;
  // Whether this run's second tornado (MERGE.secondAfter) has come, or been
  // made unnecessary by there already being two.
  let secondDone = false;

  /**
   * Called by ui.js applyPreset: on for the Fujiwhara preset, off for any
   * other. Turning it on (again) starts the minute from the top.
   * @param {boolean} on
   * @returns {void}
   */
  function setFujiwharaMode(on) {
    mode = on;
    extraTimer = on ? MERGE.extraDelay : 0;
  }

  /**
   * Counts down to the extra tornado. Held back, not dropped, while a mode
   * that runs a single funnel (Chase, tornado control, the wedge) is on.
   * @param {number} dt
   * @returns {void}
   */
  function updateExtraTornado(dt) {
    updateSecondTornado();
    if (!mode || extraTimer <= 0) return;
    extraTimer -= dt;
    if (extraTimer > 0) return;
    const single = (ctx.Chase && ctx.Chase.active)
      || (ctx.Possess && ctx.Possess.active)
      || (ctx.systems.wedge && ctx.systems.wedge.isActive());
    if (single) {
      extraTimer = 1;
      return;
    }
    ctx.tornadoes.spawnExtra();
  }

  /**
   * The second tornado of every run: MERGE.secondAfter seconds after Start
   * (the first one's touchdown begins then), once, if there is still only
   * one. Held back, not dropped, while a one-funnel mode is on -- Chase,
   * tornado control, the wedge, Hero Mode -- and comes the moment it ends.
   * @returns {void}
   */
  function updateSecondTornado() {
    if (secondDone || !Sim.state.running || Sim.state.elapsed < MERGE.secondAfter) return;
    if (ctx.tornadoes.count() >= 2) {
      secondDone = true;
      return;
    }
    const single = (ctx.Chase && ctx.Chase.active)
      || (ctx.Possess && ctx.Possess.active)
      || (ctx.Hero && ctx.Hero.active)
      || (ctx.systems.wedge && ctx.systems.wedge.isActive());
    if (single) return;
    secondDone = true;
    if (ctx.tornadoes.spawnExtra()) showBanner('SECOND TORNADO', 'Another funnel is coming down');
  }

  /** @returns {void} */
  function initFujiwhara() {
    banner = document.createElement('div');
    banner.className = 'merge-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);
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
    state.bannerTimer = MERGE.bannerSeconds;
  }

  /**
   * The first pair of active tornadoes, both old enough, within merging
   * distance, or null.
   * @returns {[TornadoInstance, TornadoInstance]|null}
   */
  function findPair() {
    const active = ctx.tornadoes.active.filter(t => (ages.get(t) || 0) >= MERGE.minAge);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i].Vortex.center;
        const b = active[j].Vortex.center;
        if (Math.hypot(a.x - b.x, a.z - b.z) < MERGE.distance) return [active[i], active[j]];
      }
    }
    return null;
  }

  /**
   * @param {TornadoInstance} a
   * @param {TornadoInstance} b
   * @returns {void}
   */
  function beginMerge(a, b) {
    const { survivor, absorbed } = chooseSurvivor(a, b);
    const s = survivor.Vortex.center;
    const o = absorbed.Vortex.center;
    state.phase = 'orbit';
    state.age = 0;
    state.survivor = survivor;
    state.absorbed = absorbed;
    state.midX = (s.x + o.x) / 2;
    state.midZ = (s.z + o.z) / 2;
    state.angle = Math.atan2(s.z - state.midZ, s.x - state.midX);
    state.startRadius = Math.max(1, Math.hypot(s.x - o.x, s.z - o.z) / 2);
    state.radius = state.startRadius;
    state.startSize = survivor.Vortex.sizeMul;
    survivor.Vortex.pinned = true;
    absorbed.Vortex.pinned = true;
    ctx.systems.fujiwharaSound.playMergeWhoosh(MERGE.orbitTime + MERGE.collapseTime);
  }

  /**
   * Places both funnels on opposite sides of the midpoint at the current
   * angle and radius, leaning into the direction they are travelling.
   * @param {number} lean radians
   * @returns {void}
   */
  function placePair(lean) {
    const cos = Math.cos(state.angle);
    const sin = Math.sin(state.angle);
    const s = state.survivor.Vortex;
    const o = state.absorbed.Vortex;
    s.center.set(state.midX + cos * state.radius, 0, state.midZ + sin * state.radius);
    o.center.set(state.midX - cos * state.radius, 0, state.midZ - sin * state.radius);
    // Travelling anticlockwise seen from above: the tangent is (-sin, cos)
    // for the survivor and the opposite for its partner.
    leanTowards(s, -sin, cos, lean);
    leanTowards(o, sin, -cos, lean);
  }

  /**
   * Contact: hand over what the absorbed funnel was carrying, retire it,
   * and make the survivor a monster, with all the fanfare.
   * @returns {void}
   */
  function completeMerge() {
    const survivor = state.survivor;
    const absorbed = state.absorbed;
    for (const obj of Sim.objects) {
      if (obj.vortex === absorbed.Vortex) obj.vortex = survivor.Vortex;
    }
    ctx.tornadoes.retire(absorbed);
    ages.delete(absorbed);
    const s = survivor.Vortex;
    s.center.set(state.midX, 0, state.midZ);
    s.sizeMul = Math.max(s.sizeMul, MERGE.monsterSize);
    s.monster = true;
    s.pinned = false;

    const shake = ctx.systems.lightning.Lightning.shake;
    if (shake.timer * shake.magnitude < MERGE.shakeDuration * MERGE.shakeMagnitude) {
      shake.duration = MERGE.shakeDuration;
      shake.timer = MERGE.shakeDuration;
      shake.magnitude = MERGE.shakeMagnitude;
    }
    // ...and the game-feel layer's own hit on top of that rumble. The two do
    // different jobs and both belong here: the lightning shake above is a
    // long soft roll, this is the punch at the moment of contact, and being
    // a 'heavy' event it can also tip the frame into slow motion -- which is
    // the single moment in a run most worth slowing down for.
    ctx.systems.gamefeel.event('merge', s.center);
    // Through addDamageScore rather than straight onto the stat, so the merge
    // bonus picks up the combo multiplier it just extended and the Firenado's
    // multiplier if one is burning -- every other scoring event in the
    // simulation goes through that one funnel, and this was the exception.
    ctx.systems.damage.addDamageScore(MERGE.score);
    showBanner('Tornadoes merged', `Fujiwhara effect · +${MERGE.score}`);
    ctx.systems.stinger.playStinger();
    state.phase = 'settle';
    state.age = 0;
  }

  /**
   * Abandons a merge whose pair has been broken up from outside (a preset
   * change switching one of them off), leaving whatever is still active as
   * it was before the merge began.
   * @returns {void}
   */
  function abortMerge() {
    for (const t of [state.survivor, state.absorbed]) if (t) t.clearMergeState();
    ctx.systems.fujiwharaSound.fadeOutMergeSound();
    state.phase = 'idle';
    state.survivor = null;
    state.absorbed = null;
  }

  /**
   * Per frame, while the run is going and not paused, before the funnels'
   * own updateVortexVisuals (which reads what this writes).
   * @param {number} dt
   * @returns {void}
   */
  function updateFujiwhara(dt) {
    updateExtraTornado(dt);
    for (const t of ctx.tornadoes.instances) ages.set(t, t.Vortex.active ? (ages.get(t) || 0) + dt : 0);

    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }

    if (state.phase === 'orbit' || state.phase === 'collapse') {
      if (!state.survivor.Vortex.active || !state.absorbed.Vortex.active) {
        abortMerge();
        return;
      }
    }

    state.age += dt;
    switch (state.phase) {
      case 'idle': {
        if (ctx.tornadoes.active.length < 2) return;
        const pair = findPair();
        if (pair) beginMerge(pair[0], pair[1]);
        return;
      }
      case 'orbit': {
        const u = Math.min(1, state.age / MERGE.orbitTime);
        state.angle += THREE.MathUtils.lerp(MERGE.orbitSpin[0], MERGE.orbitSpin[1], u) * dt;
        state.radius = state.startRadius * THREE.MathUtils.lerp(1, MERGE.orbitTighten, smooth(0, 1, u));
        const agitation = smooth(0, 1, u);
        state.survivor.Vortex.agitation = agitation;
        state.absorbed.Vortex.agitation = agitation;
        placePair(MERGE.maxLean * agitation);
        if (u >= 1) {
          state.phase = 'collapse';
          state.age = 0;
        }
        return;
      }
      case 'collapse': {
        const v = Math.min(1, state.age / MERGE.collapseTime);
        const e = smooth(0, 1, v);
        state.angle += MERGE.orbitSpin[1] * dt;
        state.radius = state.startRadius * MERGE.orbitTighten * (1 - e);
        state.survivor.Vortex.sizeMul = THREE.MathUtils.lerp(state.startSize, MERGE.monsterSize, e);
        state.absorbed.Vortex.fade = 1 - e;
        placePair(MERGE.maxLean);
        if (v >= 1) completeMerge();
        return;
      }
      case 'settle': {
        const s = state.survivor.Vortex;
        const calm = 1 - smooth(0, 1, state.age / MERGE.settleTime);
        s.agitation = calm;
        s.leanX *= calm;
        s.leanZ *= calm;
        if (state.age >= MERGE.settleTime) {
          s.agitation = 0;
          s.leanX = 0;
          s.leanZ = 0;
          state.phase = 'idle';
          state.survivor = null;
          state.absorbed = null;
        }
        return;
      }
      default:
    }
  }

  /**
   * Clears any merge in progress and every monster, called from resetSim()
   * before the Outbreak's tornadoes are re-placed.
   * @returns {void}
   */
  function resetFujiwhara() {
    for (const t of ctx.tornadoes.instances) t.clearMergeState();
    ages.clear();
    state.phase = 'idle';
    state.age = 0;
    state.survivor = null;
    state.absorbed = null;
    state.bannerTimer = 0;
    secondDone = false;
    if (banner) banner.classList.remove('visible');
    ctx.systems.fujiwharaSound.fadeOutMergeSound();
    // Back to the pair it starts with, and the minute starts again. Before
    // resetSim reads the count to re-place them.
    if (mode) {
      ctx.tornadoes.setCount(MERGE.startCount);
      extraTimer = MERGE.extraDelay;
    }
  }

  /** @returns {void} */
  function disposeFujiwhara() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    ctx.systems.fujiwharaSound.disposeMergeSound();
  }

  return { initFujiwhara, updateFujiwhara, resetFujiwhara, setFujiwharaMode, disposeFujiwhara };
}
