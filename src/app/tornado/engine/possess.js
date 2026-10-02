import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION C.4 — Possess mode: fly the tornado yourself
 * ===========================================================================
 * A second interaction mode alongside Chase Mode (engine/chase/*), but the
 * other way round: instead of driving a car away from an AI-steered storm,
 * this hands the storm itself to the player.
 *
 * The trick is that vortex.js already has exactly the right hook for it.
 * hunt.js steers a funnel by writing Vortex.huntTarget -- a point the funnel
 * chases at its own capped ground speed, with its own inertia, in place of
 * its usual wander path (see the wander block in updateVortexVisuals). This
 * mode does the same thing, one priority level higher
 * (Vortex.controlTarget), so a possessed funnel moves exactly like an
 * ordinary one always has -- it is only ever told where to go, never how
 * fast or how sharply, which is what keeps it feeling like the same tornado
 * and not a different, player-shaped vehicle bolted on top of it.
 *
 * The target is placed a fixed distance ahead of the funnel's own centre, in
 * whichever direction is currently held: a "carrot on a stick" that recedes
 * exactly as fast as the funnel closes on it, so as long as a key is held the
 * funnel drives at its full capped speed in that direction, and letting go
 * pulls the carrot back to right where the funnel already is -- an immediate,
 * full stop. Because the target is rebuilt fresh from the funnel's current
 * position every frame rather than accumulated, changing direction is
 * instant: the next frame's target simply points somewhere else.
 *
 * Runs one funnel only, the same way Chase Mode and the EF5 wedge do and for
 * the same reasons: an Outbreak's other tornadoes would otherwise wander (or
 * hunt) on their own regardless of where the player is steering, and a
 * Fujiwhara merge or a wedge ramp would fight the player for ownership of
 * Vortex.center/sizeMul. All three modes are mutually exclusive.
 */

// W A S D only, in every mode that steers (on request, 2026-10-01: the
// arrow keys do nothing anywhere).
const POSSESS_KEY_MAP = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right'
};

// World units ahead of the funnel's own centre the steered target is placed.
// Comfortably past the capped ground speed's per-frame step (a few tenths of
// a unit -- see vortex.js's WANDER.maxSpeedBase/maxSpeedIntensity) and past
// the force field's own radius, so the funnel is always moving at its full
// speed towards it rather than slowing as it "catches up" the way a close
// target would.
const LEAD_DISTANCE = 60;

// Extra multiplier on top of the funnel's own ground-speed cap (see
// Vortex.controlSpeedMul in vortex.js's wander block) while this mode is
// active: direct control should feel snappier than the AI's own wander/hunt
// pace, not merely match it.
const POSSESS_SPEED_MUL = 2;

// The three sandbox-only modes Chase Mode and the EF5 wedge already disable
// on entry, for the same reason: an Outbreak, a wedge ramp or a scripted
// Doomsday run would each fight the player for ownership of the funnel.
const EXCLUSIVE_BUTTON_IDS = ['preset-fujiwhara', 'btn-wedge', 'btn-doomsday'];

/**
 * @param {Object} ctx
 * @returns {{
 *   Possess: Object,
 *   updatePossess: () => void,
 *   setPossess: (on: boolean) => boolean,
 *   initPossessUI: () => void,
 *   resetPossess: () => void
 * }}
 */
export function createPossessSystem(ctx) {
  const { Vortex, Sim } = ctx;
  const forward = new THREE.Vector3();

  const Possess = {
    active: false,
    keys: { up: false, down: false, left: false, right: false },
    keydownHandler: /** @type {((e: KeyboardEvent) => void)|null} */ (null),
    keyupHandler: /** @type {((e: KeyboardEvent) => void)|null} */ (null),
    // Tornadoes running before this mode was entered (an Outbreak's),
    // restored on exit -- same bookkeeping as Chase.savedTornadoCount.
    savedTornadoCount: 0
  };
  ctx.Possess = Possess;

  /** @returns {void} */
  function attachInputListeners() {
    Possess.keydownHandler = (e) => {
      const k = POSSESS_KEY_MAP[e.code];
      if (!k) return;
      Possess.keys[k] = true;
      e.preventDefault();
    };
    Possess.keyupHandler = (e) => {
      const k = POSSESS_KEY_MAP[e.code];
      if (k) Possess.keys[k] = false;
    };
    window.addEventListener('keydown', Possess.keydownHandler, { signal: ctx.signal });
    window.addEventListener('keyup', Possess.keyupHandler, { signal: ctx.signal });
  }

  /** @returns {void} */
  function detachInputListeners() {
    if (Possess.keydownHandler) window.removeEventListener('keydown', Possess.keydownHandler);
    if (Possess.keyupHandler) window.removeEventListener('keyup', Possess.keyupHandler);
    Possess.keydownHandler = null;
    Possess.keyupHandler = null;
    Possess.keys = { up: false, down: false, left: false, right: false };
  }

  /**
   * Keeps the panel button showing what the mode is actually doing, the same
   * reason wedge.js's own syncButton exists.
   * @returns {void}
   */
  function syncButton() {
    const button = document.getElementById('btn-possess');
    if (!button) return;
    button.textContent = Possess.active ? '🕹️ Exit Tornado Control' : '🕹️ Control Tornado';
    button.setAttribute('aria-pressed', String(Possess.active));
    button.classList.toggle('active', Possess.active);
  }

  /** @returns {void} */
  function showPossessHud() {
    const hud = document.getElementById('possess-hud');
    if (hud) hud.classList.add('visible');
  }

  /** @returns {void} */
  function hidePossessHud() {
    const hud = document.getElementById('possess-hud');
    if (hud) hud.classList.remove('visible');
    for (const dir of ['up', 'down', 'left', 'right']) {
      const key = document.getElementById(`possess-key-${dir}`);
      if (key) key.classList.remove('active');
    }
  }

  /**
   * @param {boolean} disabled
   * @returns {void}
   */
  function setExclusiveButtonsDisabled(disabled) {
    for (const id of EXCLUSIVE_BUTTON_IDS) {
      const button = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (button) button.disabled = disabled;
    }
  }

  /**
   * Turns the mode on or off.
   * @param {boolean} on
   * @returns {boolean} whether the mode is now what was asked for; false only
   *   when turning it on was refused (Chase Mode or the EF5 wedge already
   *   owns the funnel).
   */
  function setPossess(on) {
    if (on === Possess.active) return true;
    if (on && ctx.Chase && ctx.Chase.active) return false;
    if (on && ctx.Hero && ctx.Hero.active) return false;
    if (on && ctx.systems.wedge && ctx.systems.wedge.isActive()) return false;

    Possess.active = on;
    syncButton();

    if (on) {
      // One funnel, and no Outbreak/wedge/Doomsday to fight over it -- the
      // same switch-down Chase Mode does on entry.
      Possess.savedTornadoCount = ctx.tornadoes.count();
      ctx.tornadoes.setCount(1);
      ctx.systems.wedge.setWedge(false);
      ctx.systems.doomsday.setDoomsday(false);
      setExclusiveButtonsDisabled(true);
      ctx.systems.ui.highlightMatchingPreset();
      attachInputListeners();
      Vortex.controlSpeedMul = POSSESS_SPEED_MUL;
      showPossessHud();
      // Taking the camera, once, if nothing else has it -- the same default
      // wedge.js applies when its own mode comes up, for the same reason: the
      // manual camera could be looking anywhere, and the whole point of this
      // mode is watching the funnel you are steering.
      if (!ctx.Cinematic.active) ctx.setCinematicView(true);
    } else {
      detachInputListeners();
      Vortex.controlTarget = null;
      Vortex.controlSpeedMul = 1;
      hidePossessHud();
      if (Possess.savedTornadoCount) {
        ctx.tornadoes.setCount(Possess.savedTornadoCount);
        Possess.savedTornadoCount = 0;
      }
      setExclusiveButtonsDisabled(false);
      ctx.systems.ui.highlightMatchingPreset();
      // The camera was taken for this mode, so it is handed back with it.
      if (ctx.Cinematic.active) ctx.setCinematicView(false);
    }
    return true;
  }

  /**
   * Per frame, unconditionally (like Chase Mode's updateChaseCar): steering
   * works immediately on toggle-on, whether or not Start has been pressed.
   * @returns {void}
   */
  function updatePossess() {
    if (!Possess.active) return;
    const k = Possess.keys;
    // Relative to the screen, not the map: up is away from the camera, right
    // is to the right of the frame, whichever way the camera happens to be
    // turned. On the fixed map axes the keys stopped making sense the
    // moment the view was rotated.
    const along = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    const across = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    if (along || across) {
      const camera = Sim.three.camera;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      // Right of the view: forward turned a quarter to the right about up.
      const rightX = -forward.z;
      const rightZ = forward.x;
      let dx = forward.x * along + rightX * across;
      let dz = forward.z * along + rightZ * across;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      Vortex.controlTarget = {
        x: Vortex.center.x + dx * LEAD_DISTANCE,
        z: Vortex.center.z + dz * LEAD_DISTANCE
      };
    } else {
      // No key held: the carrot sits exactly where the funnel already is, so
      // the wander block's own capped-speed seek covers zero distance -- a
      // full stop rather than coasting.
      Vortex.controlTarget = { x: Vortex.center.x, z: Vortex.center.z };
    }

    // The on-screen D-pad hint: lit up to match whatever is actually held
    // this frame.
    for (const dir of ['up', 'down', 'left', 'right']) {
      const key = document.getElementById(`possess-key-${dir}`);
      if (key) key.classList.toggle('active', k[dir]);
    }
  }

  /** @returns {void} */
  function initPossessUI() {
    const button = document.getElementById('btn-possess');
    if (button) button.addEventListener('click', () => setPossess(!Possess.active), { signal: ctx.signal });
  }

  /** @returns {void} */
  function resetPossess() {
    if (Possess.active) setPossess(false);
    for (const tornado of ctx.tornadoes.instances) {
      tornado.Vortex.controlTarget = null;
      tornado.Vortex.controlSpeedMul = 1;
    }
  }

  return { Possess, updatePossess, setPossess, initPossessUI, resetPossess };
}
