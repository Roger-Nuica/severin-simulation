// @ts-check
import { KATANA_BLADE } from './config.js';

/**
 * ===========================================================================
 * SECTION KT.11 -- Blade Mode (state machine)
 * ===========================================================================
 * Pressing Q with the Katana drawn (heroWeapons.katanaBladeToggle) enters
 * Blade Mode: the world is held at KATANA_BLADE.holdScale through the named
 * time hold `bladeMode` (engine/time.js), Roger keeps his own clock (Q3), and
 * the mode lasts until
 *
 *  - Q is pressed again (`cancel`),
 *  - while it is on, a release with a line is one cut, made at once
 *    (bladeCut.js), and the mode stays on, so the next press-drag-release is
 *    the next cut; a line that crosses nothing cuts nothing, books nothing
 *    and also leaves the mode on, and a drag shorter than
 *    KATANA_BLADE.minLinePx does nothing at all (no slash, the mode stays on),
 *  - the Katana is cancelled (wheel, Esc, right-click out of first person,
 *    blur, pointer-lock loss, car, daze, freeze, death, the run ending), which
 *    also discards any queued cut,
 *  - the window's cuts are used up (KATANA_BLADE.maxCuts), or
 *  - KATANA_BLADE.maxSeconds of REAL time have passed.
 *
 * Every exit goes through one function that releases the hold exactly once
 * (the `active` flag guards it) and releases only its own id, so whatever
 * else is still held (Time Slow, Bullet Time, Action Hero, the hit-stop)
 * stays. Both timers run on the weapons' real clock, so the hold never
 * stretches them. Bullet Time's camera drift and audio muffle (Post.bulletTime)
 * are deliberately not used.
 *
 * State lives in this closure, made once per simulation by heroWeapons.js,
 * cleared with `cancel`/`clear` and freed by `dispose` (R-047).
 */

/**
 * @typedef {Object} KatanaBladeEnv what Blade Mode needs from Hero Mode
 * @property {() => boolean} canAct on foot, upright and not frozen
 * @property {() => ('none'|'miss'|'cut')} [cut] resolves the line just drawn
 *   (bladeCut.js): `none` when no line was drawn (a short drag), `miss` when it crossed
 *   nothing, `cut` when something was cut; without it a release does nothing
 */

/**
 * @typedef {Object} KatanaBlade
 * @property {() => boolean} active whether Blade Mode is on
 * @property {(rawDt: number) => void} update per frame, real time (the
 *   timeout, and leaving if he can no longer act)
 * @property {() => boolean} enter begin Blade Mode (false if on already or he cannot act)
 * @property {(r?: {dx: number, dy: number}) => boolean} release the button came up; true
 *   if Blade Mode was on and took the release
 * @property {() => boolean} queueCut books one cut of the window (`release`
 *   does this for a cut that was made); false when the window's cuts are all booked
 * @property {() => void} cutDone a booked cut was made (the mode ends after the last)
 * @property {() => number} cuts cuts made in this window
 * @property {() => number} queued cuts booked and not yet made
 * @property {() => void} cancel leave at once, discarding anything queued
 * @property {() => void} clear as `cancel`, silent (run start and end)
 * @property {() => void} dispose as `clear`, for the end of the simulation
 */

/**
 * @param {Object} ctx the simulation's context (systems looked up lazily)
 * @param {KatanaBladeEnv} env
 * @returns {KatanaBlade}
 */
export function createKatanaBlade(ctx, env) {
  let on = false;
  /** Real seconds since it began. */
  let elapsed = 0;
  let made = 0;
  let booked = 0;

  /**
   * The one way out: releases the hold once, clears the window, and (unless
   * silent) plays the exit sound.
   * @param {boolean} quiet
   * @returns {void}
   */
  function leave(quiet) {
    const was = on;
    on = false;
    elapsed = 0;
    made = 0;
    booked = 0;
    if (!was) return;
    const sys = /** @type {any} */ (ctx).systems;
    if (sys.time) sys.time.release(KATANA_BLADE.holdId);
    if (!quiet && sys.katanaSound) sys.katanaSound.playBladeModeExit();
  }

  /** @returns {boolean} */
  function active() {
    return on;
  }

  /** @returns {boolean} */
  function enter() {
    const sys = /** @type {any} */ (ctx).systems;
    if (on || !sys.time || !env.canAct()) return false;
    on = true;
    elapsed = 0;
    made = 0;
    booked = 0;
    sys.time.hold(KATANA_BLADE.holdId, 'world', KATANA_BLADE.holdScale);
    if (sys.katanaSound) sys.katanaSound.playBladeModeEnter();
    return true;
  }

  /**
   * @param {number} rawDt
   * @returns {void}
   */
  function update(rawDt) {
    if (on) {
      // A daze, freeze, car or death ends it even if no cancel reached us.
      if (!env.canAct()) {
        leave(false);
        return;
      }
      elapsed += rawDt;
      if (elapsed >= KATANA_BLADE.maxSeconds || made >= KATANA_BLADE.maxCuts) leave(false);
    }
  }

  /**
   * @param {{dx: number, dy: number}} [r]
   * @returns {boolean}
   */
  function release(r) {
    if (!on) return false;
    void r;
    const outcome = env.cut ? env.cut() : 'none';
    // No line (a drag shorter than minLinePx): nothing happens, the mode stays on.
    if (outcome === 'none') return true;
    // A cut counts towards the window's limit (the mode ends after the last);
    // a line that crossed nothing does not.
    if (outcome === 'cut' && queueCut()) cutDone();
    return true;
  }

  /** @returns {boolean} */
  function queueCut() {
    if (!on || made + booked >= KATANA_BLADE.maxCuts) return false;
    booked += 1;
    return true;
  }

  /** @returns {void} */
  function cutDone() {
    if (!on) return;
    if (booked > 0) booked -= 1;
    made += 1;
    if (made >= KATANA_BLADE.maxCuts) leave(false);
  }

  return {
    active, update, enter, release, queueCut, cutDone,
    cuts: () => made, queued: () => booked,
    cancel: () => leave(false),
    clear: () => leave(true),
    dispose: () => leave(true)
  };
}
