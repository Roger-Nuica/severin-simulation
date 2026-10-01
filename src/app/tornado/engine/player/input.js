// @ts-check
/**
 * ===========================================================================
 * SECTION PI — The player's input
 * ===========================================================================
 * The keyboard and mouse, kept apart from the game. The DOM listeners here
 * change nothing in the simulation: they only record what the player did --
 * which movement keys are held, how far the mouse moved, and a queue of
 * presses, clicks and wheel turns -- and the game reads it at the start of
 * its frame (heroMode.js consumeInput). Everything a press does is decided
 * there, against the state of that frame.
 *
 * That separation is for co-op (a second hero): a second player is a second
 * input -- the same shape filled from the network instead of the DOM -- and
 * the game code does not change.
 *
 * Bindings (GAME_RULES.md "Hero Mode"):
 *   W A S D             run (the arrow keys do nothing, on request)
 *   right mouse button  raise / lower the weapon
 *   left button, Enter  fire (Enter held charges the rifle; Enter at a car's
 *                       door gets in)
 *   mouse wheel         next / previous weapon
 *   Q E R               the abilities (engine/player/abilities.js): Time
 *                       Slow (or Bullet Time with the minigun), Teleport, EMP
 *   Esc                 lower the weapon; with E and Q, get out of a car
 *   T                   Landing Support (engine/spaceship/targeting.js, which
 *                       reads it itself, before this: while its marker is
 *                       down, R, T and Esc are its own)
 */

// Keys whose browser default (scrolling, a menu) is stopped while the player
// has the controls.
const OWNED_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Enter', 'NumpadEnter', 'KeyQ', 'KeyE', 'KeyR']);
const MOVE_KEYS = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };

/**
 * @typedef {{type: 'keydown', code: string, repeat: boolean}
 *   | {type: 'keyup', code: string}
 *   | {type: 'mousedown', button: number, onCanvas: boolean}
 *   | {type: 'mouseup', button: number}
 *   | {type: 'wheel', dir: number}
 *   | {type: 'blur'}
 *   | {type: 'pointerlock', locked: boolean}} InputEvent
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   held: {up: boolean, down: boolean, left: boolean, right: boolean},
 *   attachInput: () => void,
 *   detachInput: () => void,
 *   drain: () => InputEvent[],
 *   takeLook: () => {dx: number, dy: number},
 *   disposeInput: () => void
 * }}
 */
export function createPlayerInput(ctx) {
  const { Sim } = ctx;
  const held = { up: false, down: false, left: false, right: false };
  /** @type {InputEvent[]} */
  let queue = [];
  const look = { dx: 0, dy: 0 };
  /** @type {AbortController|null} the listeners of this attachment */
  let attached = null;

  /**
   * @param {EventTarget|null} target
   * @returns {boolean} typing in a form field, which keeps its keys
   */
  function inField(target) {
    const tag = target && /** @type {HTMLElement} */ (target).tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  /** @returns {void} */
  function releaseHeld() {
    held.up = held.down = held.left = held.right = false;
  }

  /**
   * Starts listening (Hero Mode starting).
   * @returns {void}
   */
  function attachInput() {
    if (attached) return;
    attached = new AbortController();
    const signal = AbortSignal.any ? AbortSignal.any([attached.signal, ctx.signal]) : attached.signal;
    const canvas = Sim.three.renderer.domElement;
    window.addEventListener('keydown', (e) => {
      if (inField(e.target)) return;
      if (OWNED_KEYS.has(e.code)) e.preventDefault();
      const move = MOVE_KEYS[/** @type {keyof typeof MOVE_KEYS} */ (e.code)];
      if (move) {
        held[/** @type {keyof typeof held} */ (move)] = true;
        return;
      }
      queue.push({ type: 'keydown', code: e.code, repeat: e.repeat });
    }, { signal });
    window.addEventListener('keyup', (e) => {
      const move = MOVE_KEYS[/** @type {keyof typeof MOVE_KEYS} */ (e.code)];
      if (move) {
        held[/** @type {keyof typeof held} */ (move)] = false;
        return;
      }
      queue.push({ type: 'keyup', code: e.code });
    }, { signal });
    window.addEventListener('blur', () => {
      releaseHeld();
      queue.push({ type: 'blur' });
    }, { signal });
    window.addEventListener('mousedown', (e) => {
      const onCanvas = e.target === canvas || document.pointerLockElement === canvas;
      if (onCanvas && e.button === 2) e.preventDefault();
      queue.push({ type: 'mousedown', button: e.button, onCanvas });
    }, { signal });
    window.addEventListener('mouseup', (e) => {
      queue.push({ type: 'mouseup', button: e.button });
    }, { signal });
    // Right-click is the weapon's button, not the browser's menu.
    window.addEventListener('contextmenu', (e) => {
      if (e.target === canvas) e.preventDefault();
    }, { signal });
    // The wheel changes weapon, over the game (not over the panel, which
    // scrolls).
    window.addEventListener('wheel', (e) => {
      const onCanvas = e.target === canvas || document.pointerLockElement === canvas;
      if (!onCanvas || !e.deltaY) return;
      e.preventDefault();
      queue.push({ type: 'wheel', dir: e.deltaY > 0 ? 1 : -1 });
    }, { signal, passive: false });
    // Relative movement is reported with or without the pointer lock, so it
    // still works where the browser refuses the lock.
    window.addEventListener('mousemove', (e) => {
      look.dx += e.movementX || 0;
      look.dy += e.movementY || 0;
    }, { signal });
    document.addEventListener('pointerlockchange', () => {
      queue.push({ type: 'pointerlock', locked: document.pointerLockElement === canvas });
    }, { signal });
  }

  /**
   * Stops listening (Hero Mode ending) and forgets everything held.
   * @returns {void}
   */
  function detachInput() {
    if (attached) attached.abort();
    attached = null;
    releaseHeld();
    queue = [];
    look.dx = look.dy = 0;
  }

  /** @returns {InputEvent[]} everything since the last call, oldest first */
  function drain() {
    const out = queue;
    queue = [];
    return out;
  }

  /** @returns {{dx: number, dy: number}} mouse movement since the last call */
  function takeLook() {
    const out = { dx: look.dx, dy: look.dy };
    look.dx = look.dy = 0;
    return out;
  }

  /** @returns {void} */
  function disposeInput() {
    detachInput();
  }

  return { held, attachInput, detachInput, drain, takeLook, disposeInput };
}
