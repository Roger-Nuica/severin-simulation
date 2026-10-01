// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION T — Game feel: combo meter, slow motion, impact shake
 * ===========================================================================
 * Presentation only. This module watches destruction happen and makes it feel
 * like more than it is; it never decides what gets destroyed, changes a force
 * or a threshold, or writes to anything the simulation reads back. Everything
 * it touches is either its own state, the score multiplier, the camera offset
 * after the controls have had their say, or a HUD element.
 *
 * Three effects, one shared event stream (see `event`):
 *
 *  - **Combo meter.** Each destruction event inside COMBO_WINDOW of the last
 *    one extends a chain. The multiplier it produces is applied inside
 *    damage.js's addDamageScore(), which every scoring event in the
 *    simulation already funnels through -- so this raises the existing score
 *    rather than running a second one alongside it, and the Firenado's own
 *    multiplier composes with it for free.
 *
 *  - **Slow motion.** Fires on a burst of heavy events or on the combo
 *    crossing a round number, and scales the *simulation's* delta time --
 *    physics, particles, animation. Not requestAnimationFrame, which would
 *    drop the frame rate rather than slow the world, and not the audio,
 *    which stays at full speed (see the note on the sound system below).
 *
 *  - **Impact shake.** A short, sharp camera offset per event. The engine
 *    already has one of these, in lightning.js -- reused by explosions.js for
 *    close blasts -- and this deliberately does not replace it: that one is a
 *    long, soft, pure-jitter rumble suited to a thunderclap rolling overhead.
 *    This one is a punch: a decaying sine (so the camera swings rather than
 *    just buzzing) with jitter layered over it, three to five times shorter,
 *    and sized by what was hit and how close it was.
 *
 * Timing note: every timer here runs on *real* delta time, never the scaled
 * value it produces. A slow-motion hold measured in scaled time would stretch
 * itself, and a combo window measured in scaled time would get longer exactly
 * when the player is doing best.
 */

// --- Combo ---
// Seconds since the last destruction event before a chain lapses.
const COMBO_WINDOW = 2.5;
const COMBO_PER_EVENT = 0.15;
const COMBO_MAX_BONUS = 3;
// Chains shorter than this never show a label: at a strong setting the storm
// keeps a two or three long chain running more or less permanently, and a
// counter that is always on stops reading as an achievement.
const COMBO_HUD_MIN = 3;

// --- Slow motion ---
const SLOWMO_SCALE = 0.3;
const SLOWMO_RAMP_IN = 0.1;
const SLOWMO_HOLD = 0.5;
const SLOWMO_RAMP_OUT = 0.3;
// Real seconds before another slow-motion can start, counted from the end of
// the last one. Without it a long chain triggers one continuously and the
// whole run plays at a third speed.
//
// 6 rather than the ~2 originally specified, on measurement: at 2 the storm
// crosses a combo milestone far faster than the cooldown expires, so a
// slow-motion fires the instant it legally can and the run spent 34-40% of
// its frames slowed -- one starting roughly every two and a half seconds,
// for the whole run. At that density it stops being an emphasis and becomes
// the default speed of the game. 6 puts it at a handful of moments a minute,
// which is what makes each one land.
const SLOWMO_COOLDOWN = 6;
// Heavy events (a building coming down, one burning out, tornadoes merging)
// inside this window that together count as one big moment.
const SLOWMO_BURST_WINDOW = 0.6;
const SLOWMO_BURST_COUNT = 3;
// ...or every time the combo crosses a multiple of this.
const SLOWMO_COMBO_STEP = 10;

// --- Shake ---
// Radians per second of the swing. Well above the lightning shake's rumble,
// which is what makes this read as a hit rather than a tremor.
const SHAKE_FREQUENCY = 42;
// Decay exponent: above 1 so the shake dies away fast after an abrupt start.
const SHAKE_DECAY = 1.7;
// How much of the motion is the coherent swing versus uncorrelated jitter.
const SHAKE_SWING = 0.65;
const SHAKE_JITTER = 0.5;
// Past this distance from the camera an event contributes no shake at all;
// closer than this it falls off with the square of the distance, the same
// shape explosions.js uses for its own proximity term.
const SHAKE_RANGE = 150;

/**
 * Per-event presentation weights. `shake` is the peak camera offset in world
 * units at point-blank range, `time` its duration in real seconds, `combo`
 * marks the events that extend a chain, and `heavy` the ones that can burst
 * into a slow-motion trigger.
 *
 * A car being thrown is a small shake, a building coming down a medium one,
 * and a chain collapse or a merge the biggest thing the module will do --
 * which is the ranking asked for, and also the ranking of how rare they are.
 *
 * `combo` exists because not everything that deserves a shake deserves to
 * count. Measured with every event counting: a Severe run reached a combo of
 * 144 within two and a half seconds and 287 within eight, with the multiplier
 * pinned at its 4x ceiling essentially from the start -- which is not a combo
 * meter, it is a constant. The cause is volume: a building shedding pieces
 * fires several times a second per building, so `piece`, `impact`, `fire` and
 * `arc` flood any chain. They still shake the camera, because that is what
 * per-impact shake is for; they just do not count towards the chain, which is
 * reserved for a thing being *destroyed* -- a car thrown, a tree taken out, a
 * building lost.
 * @type {Object<string, {shake: number, time: number, combo?: boolean, heavy?: boolean}>}
 */
const EVENTS = {
  impact: { shake: 0.18, time: 0.14 },
  // The funnel touching the ground at the start of a run (tornadoEngine.js
  // updateBirth). Not heavy and not a combo: it is the storm arriving, not
  // anything being destroyed yet.
  touchdown: { shake: 0.95, time: 0.35 },
  arc: { shake: 0.1, time: 0.12 },
  fire: { shake: 0.14, time: 0.16 },
  piece: { shake: 0.26, time: 0.16 },
  person: { shake: 0.12, time: 0.12, combo: true },
  // A Katana cut (hero/katana/feel.js): a small shake, and a combo link
  // because a cut is a thing being destroyed, deliberately counted like a
  // tree or a car. It is neither heavy (it never feeds the slow-motion burst
  // detector) nor frequent: the blade's cooldown is 0.35 s, so a chain of
  // cuts cannot flood the meter the way a shedding building would.
  slice: { shake: 0.14, time: 0.12, combo: true },
  tree: { shake: 0.22, time: 0.16, combo: true },
  car: { shake: 0.3, time: 0.18, combo: true },
  // A moving vehicle plucked off its path (environment/train.js). Weighted
  // above a parked car: it is rarer, it is harder for the storm to catch
  // cleanly, and a whole train derailing is a set piece rather than a hit.
  train: { shake: 0.55, time: 0.26, combo: true },
  // A car flung off an elevated deck is the rarest catch of the three kinds
  // of traffic, so it weighs the most of them.
  viaductCar: { shake: 0.6, time: 0.28, combo: true },
  derail: { shake: 1.0, time: 0.34, combo: true, heavy: true },
  // Bringing the highway down: a pillar snapping sits with a building
  // collapse, a whole span letting go above it.
  pillar: { shake: 0.8, time: 0.3, combo: true, heavy: true },
  deck: { shake: 1.05, time: 0.36, combo: true, heavy: true },
  collapse: { shake: 0.75, time: 0.3, combo: true, heavy: true },
  chain: { shake: 1.15, time: 0.34, combo: true, heavy: true },
  burnDown: { shake: 0.7, time: 0.3, combo: true, heavy: true },
  merge: { shake: 1.4, time: 0.4, combo: true, heavy: true },
  // The fuel tanker (environment/tanker.js): the single biggest bang in the
  // simulation, so it gets the heaviest shake the module will produce.
  tanker: { shake: 1.8, time: 0.55, combo: true, heavy: true },
  // A meteor strike (engine/meteors.js) is the tanker's equal: three of
  // them land seconds apart, and each deserves to be felt.
  meteor: { shake: 1.9, time: 0.6, combo: true, heavy: true },
  // The downburst's column hitting the ground (engine/downburst.js).
  downburst: { shake: 1.7, time: 0.6, combo: true, heavy: true },
  // The dam going (engine/flood.js). A long low shove rather than a sharp
  // crack, which is what a wall of water arriving actually is.
  flood: { shake: 1.5, time: 0.9, combo: true, heavy: true },
  // The chemical works (environment/factory.js). Half the tanker's blast,
  // so half its shake: bigger than any collapse, short of the two biggest.
  factory: { shake: 1.2, time: 0.45, combo: true, heavy: true },
  // The mothership shot down and coming down on the town (mothership.js,
  // explosions/megaBlast.js): bigger than the tanker, on request.
  mothershipCrash: { shake: 2.4, time: 0.9, combo: true, heavy: true },
  // A nuclear power plant going up (engine/nuclear.js): the biggest thing
  // in the game, by some way.
  nuke: { shake: 3.2, time: 1.4, combo: true, heavy: true },
  // The electric tornado's grid-wide discharge (engine/electricStorm.js). It
  // levels nothing by itself, so it does not count towards a combo -- but it
  // is the whole map going dark at once, which is worth the shake.
  emp: { shake: 1.3, time: 0.5, heavy: true },
  // A manhole cover leaving the road (engine/gasMains.js). Sharp and small:
  // there are a lot of them along a burning main, so one is a crack rather
  // than a shove, and the chain of them down a street does the work.
  gas: { shake: 0.8, time: 0.3, combo: true },
  // The flood front reaching molten ground (engine/collisions.js). The worst
  // single event in the scene, so it takes the top of the range: a volume of
  // water becoming steam under the town.
  steam: { shake: 2.1, time: 0.75, combo: true, heavy: true },
  // A ship setting down on the town (engine/spaceship.js). Deliberately the
  // top of the whole range, above the steam explosion: it is the one event
  // the player sits through in the cockpit waiting for, and the touchdown has
  // to land harder than anything the storm can do on its own.
  landing: { shake: 2.9, time: 1.1, combo: true, heavy: true },
  // The ground splitting open under the town (engine/chasm.js): a long, hard
  // heave rather than a crack, on top of the quake's own tremor.
  chasm: { shake: 2.4, time: 1.4, combo: true, heavy: true }
};

// Escalating labels, picked by the longest threshold the chain has passed.
const COMBO_LABELS = [
  { at: 40, text: 'APOCALYPSE' },
  { at: 25, text: 'CARNAGE' },
  { at: 15, text: 'MAYHEM' },
  { at: 8, text: 'CHAOS' },
  { at: 5, text: 'RAMPAGE' },
  { at: 0, text: 'COMBO' }
];

/**
 * @param {Object} ctx
 * @returns {{
 *   GameFeel: Object,
 *   event: (kind: string, at?: THREE.Vector3) => void,
 *   comboMultiplier: () => number,
 *   updateGameFeel: (rawDt: number) => void,
 *   applyGameFeelShake: (rawDt: number) => void,
 *   addShake: (magnitude: number, duration: number) => void,
 *   resetGameFeel: () => void
 * }}
 */
export function createGameFeelSystem(ctx) {
  const { Sim } = ctx;

  const GameFeel = {
    comboCount: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    // Highest SLOWMO_COMBO_STEP boundary this chain has already fired on, so
    // one chain cannot re-trigger on the same milestone.
    comboMilestone: 0,
    // What the simulation's delta time is multiplied by this frame. 1 unless
    // a slow-motion is running.
    timeScale: 1,
    // A ceiling on timeScale that another system holds for as long as it
    // needs one -- Hero Mode's aiming bullet-time (engine/heroMode.js). 1
    // when nobody is holding it; the combo slow-motion still applies under it.
    forcedScale: 1,
    /** @type {'idle'|'in'|'hold'|'out'} */
    slowmoPhase: 'idle',
    slowmoTimer: 0,
    slowmoCooldown: 0,
    shake: { timer: 0, duration: 0, magnitude: 0, phase: 0 },
    /** @type {number[]} real-time stamps of recent heavy events */
    heavyStamps: [],
    // Real seconds since the module started, for the heavy-event window.
    clock: 0
  };

  // Published for anything that needs to read the timescale without reaching
  // through ctx.systems -- the sound system does, to drop its pitch slightly
  // during a slow-motion rather than slowing the audio itself.
  ctx.GameFeel = GameFeel;

  /** @type {HTMLElement|null} */
  let hud = null;
  let hudVisible = false;

  /**
   * Starts a slow-motion, unless one is already running or the cooldown from
   * the last one has not expired.
   * @returns {boolean} whether one started
   */
  function triggerSlowmo() {
    if (GameFeel.slowmoPhase !== 'idle' || GameFeel.slowmoCooldown > 0) return false;
    GameFeel.slowmoPhase = 'in';
    GameFeel.slowmoTimer = 0;
    return true;
  }

  /**
   * Adds a shake, keeping whichever of the running one and the new one is
   * stronger rather than replacing outright -- so a small hit landing during
   * a building's collapse cannot cut the big shake short. Same rule
   * explosions.js applies to the lightning shake it borrows.
   * @param {number} magnitude peak offset in world units
   * @param {number} duration real seconds
   * @returns {void}
   */
  function addShake(magnitude, duration) {
    const shake = GameFeel.shake;
    const running = shake.timer > 0 ? shake.magnitude * (shake.timer / shake.duration) : 0;
    if (magnitude <= running) return;
    shake.magnitude = magnitude;
    shake.duration = duration;
    shake.timer = duration;
  }

  /**
   * Records one destruction event: extends the combo, shakes the camera by
   * however much the event is worth at that distance, and -- for the heavy
   * ones -- feeds the slow-motion burst detector.
   *
   * Unknown kinds are ignored rather than throwing: this is called from the
   * middle of the damage system's hot paths, and a typo in a call site should
   * cost a missing shake, not a broken frame.
   * @param {string} kind a key of EVENTS
   * @param {THREE.Vector3} [at] where it happened, for the shake falloff.
   *   Omitted means "no particular place", which gets full shake.
   * @returns {void}
   */
  function event(kind, at) {
    const def = EVENTS[kind];
    if (!def) return;

    // Combo. A chain continues while counting events keep arriving inside the
    // window; the high-frequency ones shake but do not count (see EVENTS).
    if (def.combo) {
      GameFeel.comboCount = GameFeel.comboTimer > 0 ? GameFeel.comboCount + 1 : 1;
      GameFeel.comboTimer = COMBO_WINDOW;
      GameFeel.comboMultiplier = 1 + Math.min(GameFeel.comboCount * COMBO_PER_EVENT, COMBO_MAX_BONUS);
    }

    // Shake, scaled by how close the event was to the camera.
    let proximity = 1;
    if (at) {
      const d = Sim.three.camera.position.distanceTo(at);
      proximity = 1 - THREE.MathUtils.clamp(d / SHAKE_RANGE, 0, 1);
      proximity *= proximity;
    }
    if (proximity > 0.01) addShake(def.shake * proximity, def.time);

    // A major destruction: the lights start their slow recovery
    // (dayNight.js noteDestruction), so a wrecked town does not go dark.
    if (def.heavy && ctx.systems.dayNight) ctx.systems.dayNight.noteDestruction();

    // Slow motion, on a burst of heavy events...
    if (def.heavy) {
      // The same classification decides what is worth a replay: this module
      // has already worked out how hard each event hit, and the kill-cam
      // (engine/killcam.js) only has to pick a threshold on it rather than
      // keep a second opinion about which events matter.
      if (at && ctx.systems.killcam) ctx.systems.killcam.notable(kind, at, def.shake);
      GameFeel.heavyStamps.push(GameFeel.clock);
      const cutoff = GameFeel.clock - SLOWMO_BURST_WINDOW;
      while (GameFeel.heavyStamps.length && GameFeel.heavyStamps[0] < cutoff) {
        GameFeel.heavyStamps.shift();
      }
      if (GameFeel.heavyStamps.length >= SLOWMO_BURST_COUNT && triggerSlowmo()) {
        GameFeel.heavyStamps.length = 0;
      }
    }

    // ...or on the combo crossing a round number.
    const milestone = Math.floor(GameFeel.comboCount / SLOWMO_COMBO_STEP) * SLOWMO_COMBO_STEP;
    if (milestone > 0 && milestone > GameFeel.comboMilestone) {
      GameFeel.comboMilestone = milestone;
      triggerSlowmo();
    }
  }

  /** @returns {number} the factor damage.js multiplies every score by */
  function comboMultiplier() {
    return GameFeel.comboMultiplier;
  }

  /**
   * Advances the slow-motion ramp, writing GameFeel.timeScale for the frame.
   * @param {number} rawDt real seconds
   * @returns {void}
   */
  function updateSlowmo(rawDt) {
    if (GameFeel.slowmoCooldown > 0) GameFeel.slowmoCooldown = Math.max(0, GameFeel.slowmoCooldown - rawDt);
    if (GameFeel.slowmoPhase === 'idle') {
      GameFeel.timeScale = 1;
      return;
    }

    GameFeel.slowmoTimer += rawDt;
    if (GameFeel.slowmoPhase === 'in') {
      const t = Math.min(1, GameFeel.slowmoTimer / SLOWMO_RAMP_IN);
      GameFeel.timeScale = THREE.MathUtils.lerp(1, SLOWMO_SCALE, t);
      if (t >= 1) {
        GameFeel.slowmoPhase = 'hold';
        GameFeel.slowmoTimer = 0;
      }
    } else if (GameFeel.slowmoPhase === 'hold') {
      GameFeel.timeScale = SLOWMO_SCALE;
      if (GameFeel.slowmoTimer >= SLOWMO_HOLD) {
        GameFeel.slowmoPhase = 'out';
        GameFeel.slowmoTimer = 0;
      }
    } else {
      const t = Math.min(1, GameFeel.slowmoTimer / SLOWMO_RAMP_OUT);
      // Eased rather than linear, so the world accelerates back rather than
      // snapping to full speed the instant the ramp completes.
      GameFeel.timeScale = THREE.MathUtils.lerp(SLOWMO_SCALE, 1, t * t);
      if (t >= 1) {
        GameFeel.slowmoPhase = 'idle';
        GameFeel.timeScale = 1;
        // Counted from the end, so back-to-back slow-motions are separated by
        // the full cooldown rather than overlapping their own duration.
        GameFeel.slowmoCooldown = SLOWMO_COOLDOWN;
      }
    }
  }

  /**
   * @param {number} count
   * @returns {string}
   */
  function comboLabel(count) {
    return COMBO_LABELS.find(l => count >= l.at).text;
  }

  /** @returns {void} */
  function updateComboHud() {
    if (!hud) hud = document.getElementById('combo-hud');
    if (!hud) return;
    const show = GameFeel.comboCount >= COMBO_HUD_MIN;
    if (show) {
      hud.textContent = `${GameFeel.comboCount}× ${comboLabel(GameFeel.comboCount)}`;
      // Fades out over the last of the window, so a chain about to lapse
      // visibly runs out rather than disappearing.
      hud.style.opacity = Math.min(1, GameFeel.comboTimer / (COMBO_WINDOW * 0.5)).toFixed(2);
      // Grows a little as the chain climbs, capped so it cannot take over the
      // screen at 40+.
      hud.style.fontSize = `${(15 + Math.min(GameFeel.comboCount, 30) * 0.45).toFixed(1)}px`;
    }
    if (show !== hudVisible) {
      hud.style.display = show ? 'block' : 'none';
      hudVisible = show;
    }
  }

  /**
   * Per frame, on real delta time, before the scaled delta is derived from
   * GameFeel.timeScale (see animate()).
   * @param {number} rawDt
   * @returns {void}
   */
  function updateGameFeel(rawDt) {
    GameFeel.clock += rawDt;

    if (GameFeel.comboTimer > 0) {
      GameFeel.comboTimer = Math.max(0, GameFeel.comboTimer - rawDt);
      if (GameFeel.comboTimer === 0) {
        GameFeel.comboCount = 0;
        GameFeel.comboMultiplier = 1;
        GameFeel.comboMilestone = 0;
      }
    }

    updateSlowmo(rawDt);
    if (GameFeel.forcedScale < 1) GameFeel.timeScale = Math.min(GameFeel.timeScale, GameFeel.forcedScale);
    updateComboHud();
  }

  /**
   * Offsets the camera for the current shake. Must run after
   * Sim.three.controls.update() and after whichever camera system owns the
   * frame (cinematic, chase or cockpit) has placed the camera -- exactly like
   * the lightning shake, and for the same reason: OrbitControls recomputes
   * the position from its own internal state next frame, so an offset applied
   * here reaches the renderer without ever accumulating.
   *
   * On real delta time, so a shake is the same length in slow motion as out
   * of it -- a punch stretched to three times its length stops being a punch.
   * @param {number} rawDt
   * @returns {void}
   */
  function applyGameFeelShake(rawDt) {
    const shake = GameFeel.shake;
    if (shake.timer <= 0) return;
    shake.timer = Math.max(0, shake.timer - rawDt);
    shake.phase += rawDt;

    const mag = shake.magnitude * Math.pow(shake.timer / shake.duration, SHAKE_DECAY);
    const swing = Math.sin(shake.phase * SHAKE_FREQUENCY);
    // The vertical axis runs at an incommensurate frequency, so the camera
    // traces a wobble rather than sliding along one diagonal.
    const swingY = Math.sin(shake.phase * SHAKE_FREQUENCY * 1.37 + 1.1);
    const camera = Sim.three.camera;
    camera.position.x += (swing * SHAKE_SWING + (Math.random() - 0.5) * SHAKE_JITTER) * mag;
    camera.position.y += (swingY * SHAKE_SWING + (Math.random() - 0.5) * SHAKE_JITTER) * mag * 0.7;
    camera.position.z += (swing * SHAKE_SWING * 0.6 + (Math.random() - 0.5) * SHAKE_JITTER) * mag;
  }

  /**
   * Clears every effect, called from resetSim() so a fresh run does not start
   * mid-combo, mid-shake or in slow motion.
   * @returns {void}
   */
  function resetGameFeel() {
    GameFeel.comboCount = 0;
    GameFeel.comboMultiplier = 1;
    GameFeel.comboTimer = 0;
    GameFeel.comboMilestone = 0;
    GameFeel.timeScale = 1;
    GameFeel.slowmoPhase = 'idle';
    GameFeel.slowmoTimer = 0;
    GameFeel.slowmoCooldown = 0;
    GameFeel.shake.timer = 0;
    GameFeel.shake.magnitude = 0;
    GameFeel.heavyStamps.length = 0;
    updateComboHud();
  }

  return { GameFeel, event, comboMultiplier, updateGameFeel, applyGameFeelShake, addShake, resetGameFeel };
}
