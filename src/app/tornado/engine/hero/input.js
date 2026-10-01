// @ts-check
import * as THREE from 'three';
import { HERO } from './config.js';

/**
 * ===========================================================================
 * SECTION HM.3 — The controls
 * ===========================================================================
 * W A S D to run, right-click to raise the weapon, click or Enter to fire,
 * the mouse wheel to switch weapon, Q W E R for the abilities, Enter at a
 * car's door to drive.
 *
 * The keyboard and mouse are read by engine/player/input.js, which changes
 * nothing in the game: it keeps what is held and queues what was pressed.
 * consumeInput, at the start of Hero Mode's frame, is where each of those
 * does what it does, against the state of that frame -- so a second
 * player's input (co-op) can be fed the same way.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroInput(ctx, S, api) {
  /** @returns {void} */
  function releaseKeys() {
    for (const k of Object.keys(S.keys)) S.keys[/** @type {keyof typeof S.keys} */ (k)] = false;
  }

  /**
   * The controls taken (a run starting).
   * @returns {void}
   */
  function attachKeys() {
    ctx.systems.playerInput.attachInput();
  }

  /**
   * The controls let go (a run ending).
   * @returns {void}
   */
  function detachKeys() {
    ctx.systems.playerInput.detachInput();
    releaseKeys();
  }

  /**
   * @param {string} code
   * @returns {boolean} Enter, either of them
   */
  function isEnter(code) {
    return code === 'Enter' || code === 'NumpadEnter';
  }

  /**
   * Everything the player did since the last frame, done now:
   *  - W A S D (held): run;
   *  - Enter: into a car at its glowing door with the weapon down, else
   *    fire (held, the rifle charges);
   *  - in a car: E, Q or Esc gets out, and nothing else works;
   *  - Esc: the weapon down;
   *  - mouse wheel: the next or the previous weapon;
   *  - Q E R: the abilities (engine/player/abilities.js) -- Time Slow (Bullet
   *    Time with the minigun), Teleport, EMP -- not while dying, safe or
   *    driving;
   *  - right button: raise / lower the weapon; left button: fire while it is
   *    raised;
   *  - the mouse moving: looking round while aiming.
   * @returns {void}
   */
  function consumeInput() {
    const input = ctx.systems.playerInput;
    const held = input.held;
    S.keys.up = held.up;
    S.keys.down = held.down;
    S.keys.left = held.left;
    S.keys.right = held.right;
    const phase = () => S.state.phase;
    for (const e of input.drain()) {
      switch (e.type) {
        case 'keydown': {
          // Held: the charge carries on from the first press.
          if (e.repeat) break;
          const code = e.code;
          if (phase() === 'driving') {
            if (code === 'KeyE' || code === 'KeyQ' || code === 'Escape') api.exitCar();
            break;
          }
          // Frozen solid (engine/effects/freeze.js): no firing, no car.
          if (S.state.frozen > 0 && isEnter(code)) break;
          if (isEnter(code)) {
            // At a car's door with the weapon down, Enter gets in; raised,
            // it fires.
            if (S.doorCar && phase() === 'running') api.enterCar(S.doorCar);
            else if (phase() === 'aiming') pullTrigger();
            else if (phase() === 'running') api.flashMessage('RIGHT-CLICK to raise the weapon · ENTER to fire');
          } else if (code === 'Escape' && phase() === 'aiming') {
            api.leaveAim();
          } else if ((phase() === 'running' || phase() === 'aiming' || phase() === 'dazed') && !(S.state.frozen > 0)) {
            ctx.systems.abilities.press(code);
          }
          break;
        }
        case 'keyup':
          if (isEnter(e.code)) releaseTrigger();
          break;
        case 'wheel':
          if (phase() === 'running' || phase() === 'aiming' || phase() === 'dazed') {
            api.cancelCharge();
            S.weapons.cycle(e.dir);
            if (S.viewRifle) S.viewRifle.group.visible = phase() === 'aiming' && S.weapons.current() === 'rifle';
          }
          break;
        case 'mousedown':
          if (!(e.onCanvas || S.state.locked)) break;
          if (e.button === 2) api.toggleAim();
          else if (e.button === 0 && phase() === 'aiming') pullTrigger();
          break;
        case 'mouseup':
          if (e.button === 0) releaseTrigger();
          break;
        case 'blur':
          releaseKeys();
          api.cancelCharge();
          S.weapons.triggerUp();
          break;
        case 'pointerlock': {
          // Esc under a pointer lock goes to the browser, which drops the
          // lock: that is the way out of aim mode then.
          if (S.state.locked && !e.locked && phase() === 'aiming') api.leaveAim();
          S.state.locked = e.locked;
          break;
        }
        default:
          break;
      }
    }
    // Mouse look, while aiming (the movement is taken either way, so it does
    // not pile up for the next time the weapon comes up).
    const look = input.takeLook();
    if (phase() === 'aiming' && (look.dx || look.dy)) {
      S.state.yaw -= look.dx * HERO.lookSensitivity;
      S.state.pitch = THREE.MathUtils.clamp(S.state.pitch - look.dy * HERO.lookSensitivity, HERO.pitchMin, HERO.pitchMax);
    }
  }

  // ---------------------------------------------------------------------
  // The trigger: a tap fires, HERO.chargeSeconds' hold (2 s) is a mega beam
  // ---------------------------------------------------------------------

  /**
   * The trigger goes down, for whichever weapon is in hand: the minigun and
   * the railgun take it (heroWeapons.js); the rifle starts its charge.
   * @returns {void}
   */
  function pullTrigger() {
    if (S.state.phase !== 'aiming') return;
    if (!S.weapons.triggerDown()) api.beginCharge();
  }

  /**
   * The trigger comes up.
   * @returns {void}
   */
  function releaseTrigger() {
    S.weapons.triggerUp();
    api.releaseCharge();
  }

  return { releaseKeys, attachKeys, detachKeys, consumeInput, pullTrigger, releaseTrigger };
}
