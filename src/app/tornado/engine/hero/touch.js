// @ts-check
import * as THREE from 'three';
import { HERO } from './config.js';
import { TOUCH, stickFromDrag, heldFromStick, pickAimTarget, wrapAngle } from './touchMath.js';

/**
 * ===========================================================================
 * SECTION HM.T — Hero Mode on a touch screen
 * ===========================================================================
 * On a phone or tablet (a coarse primary pointer, or `?touch=1`) Hero Mode
 * gets on-screen controls, and the screen is cleared for the game:
 *
 *   left thumb   a floating joystick: put the thumb down anywhere on the
 *                lower left and push. On foot Roger runs the way it points
 *                on screen (relative to the camera, as fast as it is pushed,
 *                hero/touchMath.js steerRun); raised into first person it
 *                walks and strafes; in a car it steers.
 *   right thumb  drag anywhere else to look while aiming, or to turn Roger
 *                (and the camera behind him) on foot.
 *   FIRE         raises the weapon into first person if it is down and
 *                fires; held, the rifle charges its MEGA BEAM and the
 *                minigun keeps going. With the Katana it slashes (on foot)
 *                or cuts along the right thumb's drag (first person).
 *   AIM          raises or lowers the weapon.
 *   weapon       the next weapon (its name on the button).
 *   ⏱ ✦ ⚡ 🪝 ✋  Time Slow (Q), Teleport (E), EMP (R), grappling hook (G),
 *                telekinesis (C, again to throw): each lit while running,
 *                dimmed while it cools down or energy is short.
 *   🚗           at a car's glowing door, get in; driving, get out.
 *   🤖           send in the Terminators (the panel's btn-terminator: five,
 *                each from a different side round Roger); dimmed while a
 *                squad is still standing.
 *   ✕            leave Hero Mode.
 *
 * Nothing here changes the game: the controls fill the same record the
 * keyboard and mouse do (engine/player/input.js: held, stick, look, and
 * the event queue), and Hero Mode's frame reads it as before
 * (hero/input.js consumeInput). The one thing added on top is a gentle aim
 * assist in first person: the view eases toward the enemy nearest the
 * crosshair inside a small cone, a little harder while the trigger is down.
 *
 * While it is on, `body.hero-touch-on` folds the control panel away, hides the
 * co-op box and the install button, and the Hero HUD shrinks to a strip
 * (tornado.css).
 */

const KEY_LOOK_SCALE = TOUCH.lookPerPx / HERO.lookSensitivity;
const ABILITIES = [
  { code: 'KeyQ', icon: '⏱', label: 'Slow' },
  { code: 'KeyE', icon: '✦', label: 'Blink' },
  { code: 'KeyR', icon: '⚡', label: 'EMP' },
  { code: 'KeyG', icon: '🪝', label: 'Hook' },
  { code: 'KeyC', icon: '✋', label: 'Grab' }
];
/** Seconds between two refreshes of the buttons' look. */
const BUTTON_REFRESH = 0.2;

/**
 * Whether this screen gets the touch controls.
 * @returns {boolean}
 */
export function wantsTouchControls() {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  return !!window.matchMedia?.('(pointer: coarse)').matches;
}

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroTouch(ctx, S, api) {
  const { Sim, container } = ctx;
  /** @type {HTMLDivElement|null} */
  let root = null;
  /** @type {{base: HTMLDivElement, knob: HTMLDivElement, fire: HTMLButtonElement, aim: HTMLButtonElement, weapon: HTMLButtonElement, car: HTMLButtonElement, bots: HTMLButtonElement, abilities: {code: string, el: HTMLButtonElement}[]}|null} */
  let ui = null;
  let enabled = false;
  let active = false;
  /** The joystick's thumb and where it went down. */
  const stickTouch = { id: -1, x: 0, y: 0 };
  /** The look thumb and where it was last. */
  const lookTouch = { id: -1, x: 0, y: 0 };
  let fireHeld = false;
  let refresh = 0;
  /** Aim-assist targets, reused frame to frame. @type {{x: number, y: number, z: number}[]} */
  const targets = [];
  let targetCount = 0;
  const eye = new THREE.Vector3();

  /** @returns {any} */
  const input = () => ctx.systems.playerInput;

  /**
   * Builds the controls once (hidden until a run starts on a touch screen).
   * @returns {void}
   */
  function buildTouch() {
    enabled = wantsTouchControls();
    if (!enabled) return;
    root = document.createElement('div');
    root.className = 'hero-touch';
    const base = document.createElement('div');
    base.className = 'ht-stick';
    const knob = document.createElement('div');
    knob.className = 'ht-knob';
    base.appendChild(knob);

    /** @param {string} cls @param {string} html @param {string} label */
    const button = (cls, html, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ht-btn ${cls}`;
      b.innerHTML = html;
      b.setAttribute('aria-label', label);
      return b;
    };
    const fire = button('ht-fire', '<span>FIRE</span>', 'Fire');
    const aim = button('ht-aim', '<span>AIM</span>', 'Raise or lower the weapon');
    const weapon = button('ht-weapon', '<b>⇄</b><span class="ht-wname"></span>', 'Next weapon');
    const car = button('ht-car', '🚗<span>DRIVE</span>', 'Get in or out of the car');
    const exit = button('ht-exit', '✕', 'Leave Hero Mode');
    const bots = button('ht-bots', '🤖', 'Send in the Terminators');
    const abilityBox = document.createElement('div');
    abilityBox.className = 'ht-abilities';
    const abilities = ABILITIES.map((a) => {
      const el = button('ht-ability', `<b>${a.icon}</b><span>${a.label}</span><i></i>`, a.label);
      abilityBox.appendChild(el);
      return { code: a.code, el };
    });
    root.append(base, abilityBox, weapon, aim, car, fire, bots, exit);
    container.appendChild(root);
    ui = { base, knob, fire, aim, weapon, car, bots, abilities };

    const opts = { signal: ctx.signal };
    /** A button that acts on press (and optionally on release), never the browser's tap. */
    const hold = (/** @type {HTMLElement} */ el, /** @type {() => void} */ down, /** @type {(() => void)|null} */ up = null) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        el.classList.add('pressed');
        if (active) down();
      }, opts);
      const end = () => {
        if (!el.classList.contains('pressed')) return;
        el.classList.remove('pressed');
        if (active && up) up();
      };
      el.addEventListener('pointerup', end, opts);
      el.addEventListener('pointercancel', end, opts);
      el.addEventListener('lostpointercapture', end, opts);
      el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    };
    hold(fire, fireDown, fireUp);
    hold(aim, () => input().push({ type: 'mousedown', button: 2, onCanvas: true }));
    hold(weapon, () => input().push({ type: 'wheel', dir: 1 }));
    hold(car, () => {
      if (S.state.phase === 'driving') tapKey('KeyE');
      else tapKey('Enter');
    });
    hold(exit, () => document.getElementById('btn-hero')?.click());
    hold(bots, () => {
      const panelButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-terminator'));
      if (panelButton && !panelButton.disabled) panelButton.click();
    });
    for (const a of abilities) hold(a.el, () => tapKey(a.code));

    // The thumbs on the game itself: the canvas (Hero Mode turns the orbit
    // controls off, so nothing else wants these touches). preventDefault on
    // the pointerdown stops the browser's emulated mouse events, which would
    // otherwise reach engine/player/input.js as clicks.
    const canvas = Sim.three.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!active || e.pointerType === 'mouse') return;
      e.preventDefault();
      const r = container.getBoundingClientRect();
      const lowerLeft = e.clientX - r.left < r.width * 0.45 && e.clientY - r.top > r.height * 0.3;
      if (lowerLeft && stickTouch.id === -1) {
        stickTouch.id = e.pointerId;
        stickTouch.x = e.clientX;
        stickTouch.y = e.clientY;
        placeBase(e.clientX - r.left, e.clientY - r.top);
        ui?.base.classList.add('live');
      } else if (lookTouch.id === -1) {
        lookTouch.id = e.pointerId;
        lookTouch.x = e.clientX;
        lookTouch.y = e.clientY;
      }
      canvas.setPointerCapture(e.pointerId);
    }, opts);
    canvas.addEventListener('pointermove', (e) => {
      if (!active) return;
      if (e.pointerId === stickTouch.id) moveStick(e.clientX - stickTouch.x, e.clientY - stickTouch.y);
      else if (e.pointerId === lookTouch.id) {
        const dx = e.clientX - lookTouch.x;
        const dy = e.clientY - lookTouch.y;
        lookTouch.x = e.clientX;
        lookTouch.y = e.clientY;
        if (S.state.phase === 'aiming') input().addLook(dx * KEY_LOOK_SCALE, dy * KEY_LOOK_SCALE);
        else if (S.state.phase === 'running') input().addTurn(dx);
      }
    }, opts);
    const release = (/** @type {PointerEvent} */ e) => {
      if (e.pointerId === stickTouch.id) {
        stickTouch.id = -1;
        moveStick(0, 0);
        restBase();
      } else if (e.pointerId === lookTouch.id) {
        lookTouch.id = -1;
      }
    };
    canvas.addEventListener('pointerup', release, opts);
    canvas.addEventListener('pointercancel', release, opts);
    canvas.addEventListener('contextmenu', (e) => { if (active) e.preventDefault(); }, opts);
  }

  /** @param {number} x @param {number} y container px */
  function placeBase(x, y) {
    if (!ui) return;
    ui.base.style.left = `${x}px`;
    ui.base.style.top = `${y}px`;
    ui.base.style.bottom = 'auto';
  }

  /** The joystick back where it rests when no thumb is on it. */
  function restBase() {
    if (!ui) return;
    ui.base.classList.remove('live');
    ui.base.style.left = '';
    ui.base.style.top = '';
    ui.base.style.bottom = '';
    ui.knob.style.transform = '';
  }

  /** @param {number} dx @param {number} dy CSS px from where the thumb went down */
  function moveStick(dx, dy) {
    const s = stickFromDrag(dx, dy);
    const inp = input();
    inp.stick.x = s.x;
    inp.stick.y = s.y;
    Object.assign(inp.held, heldFromStick(s.x, s.y));
    if (ui) {
      const len = Math.hypot(dx, dy);
      const k = len > TOUCH.stickRadius ? TOUCH.stickRadius / len : 1;
      ui.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  }

  /** @param {string} code */
  function tapKey(code) {
    input().push({ type: 'keydown', code, repeat: false });
    input().push({ type: 'keyup', code });
  }

  /** FIRE down: up into first person first if need be (not the Katana, whose on-foot click slashes). */
  function fireDown() {
    if (S.state.phase === 'driving') return;
    fireHeld = true;
    if (S.state.phase === 'running' && S.weapons.current() !== 'katana') input().push({ type: 'mousedown', button: 2, onCanvas: true });
    input().push({ type: 'mousedown', button: 0, onCanvas: true });
  }

  function fireUp() {
    fireHeld = false;
    input().push({ type: 'mouseup', button: 0 });
  }

  /**
   * A run starting (true) or ending (false).
   * @param {boolean} on
   * @returns {void}
   */
  function showTouch(on) {
    if (!enabled || !root) return;
    active = on;
    S.touchActive = on;
    document.body.classList.toggle('hero-touch-on', on);
    root.classList.toggle('visible', on);
    stickTouch.id = lookTouch.id = -1;
    fireHeld = false;
    restBase();
    if (on) {
      // The control panel folds away: on a phone it is most of the screen.
      const panel = document.getElementById('ui-panel');
      if (panel && !panel.classList.contains('collapsed')) document.getElementById('btn-panel-toggle')?.click();
      refresh = 0;
    }
  }

  /**
   * Per frame, after the input is consumed: the aim assist, and the
   * buttons' look a few times a second.
   * @param {number} rawDt
   * @returns {void}
   */
  function updateTouch(rawDt) {
    if (!active || !ui) return;
    // The assist does not fight a thumb that is looking, unless it is firing.
    if (S.state.phase === 'aiming' && S.weapons.current() !== 'katana' && (lookTouch.id === -1 || fireHeld)) assist(rawDt);
    refresh -= rawDt;
    if (refresh > 0) return;
    refresh = BUTTON_REFRESH;
    const phase = S.state.phase;
    const driving = phase === 'driving';
    const atDoor = !!S.doorCar && phase === 'running';
    ui.car.classList.toggle('shown', driving || atDoor);
    /** @type {HTMLElement} */ (ui.car.querySelector('span')).textContent = driving ? 'EXIT' : 'DRIVE';
    ui.aim.classList.toggle('on', phase === 'aiming');
    /** @type {HTMLElement} */ (ui.aim.querySelector('span')).textContent = phase === 'aiming' ? 'LOWER' : 'AIM';
    const name = S.weapons.hudLine();
    const wname = /** @type {HTMLElement} */ (ui.weapon.querySelector('.ht-wname'));
    if (wname.textContent !== name) wname.textContent = name;
    root?.classList.toggle('driving', driving);
    const panelButton = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-terminator'));
    ui.bots.classList.toggle('off', !panelButton || panelButton.disabled);
    const abilities = ctx.systems.abilities;
    for (const a of ui.abilities) {
      const st = abilities.buttonState ? abilities.buttonState(a.code) : null;
      a.el.classList.toggle('running', !!st?.active);
      a.el.classList.toggle('cooling', !!st && !st.active && st.cooldown > 0);
      a.el.classList.toggle('short', !!st && !st.active && st.cooldown <= 0 && !st.affordable);
      const i = /** @type {HTMLElement} */ (a.el.querySelector('i'));
      const text = st && !st.active && st.cooldown > 0 ? `${Math.ceil(st.cooldown)}` : '';
      if (i.textContent !== text) i.textContent = text;
    }
  }

  /**
   * First person: the view eases toward the enemy nearest the crosshair,
   * if one is inside the assist cone.
   * @param {number} rawDt
   * @returns {void}
   */
  function assist(rawDt) {
    const enemies = ctx.systems.enemies;
    if (!enemies) return;
    targetCount = 0;
    enemies.each((/** @type {any} */ e, /** @type {any} */ kind) => {
      if (!kind.hitbox) return;
      const h = kind.hitbox(e);
      if (!h) return;
      if (targetCount === targets.length) targets.push({ x: 0, y: 0, z: 0 });
      const t = targets[targetCount++];
      t.x = h.x;
      t.y = h.top * 0.6;
      t.z = h.z;
    });
    if (!targetCount) return;
    Sim.three.camera.getWorldPosition(eye);
    const pick = pickAimTarget(eye, S.state.yaw, S.state.pitch, targets, TOUCH.assistCone, TOUCH.assistRange, targetCount);
    if (!pick) return;
    const pull = 1 - Math.exp(-(fireHeld ? TOUCH.assistPullFiring : TOUCH.assistPull) * rawDt);
    S.state.yaw += wrapAngle(pick.yaw - S.state.yaw) * pull;
    S.state.pitch = THREE.MathUtils.clamp(S.state.pitch + (pick.pitch - S.state.pitch) * pull, HERO.pitchMin, HERO.pitchMax);
  }

  /** @returns {void} */
  function disposeTouch() {
    if (active) showTouch(false);
    root?.remove();
    root = null;
    ui = null;
    targets.length = 0;
  }

  return { buildTouch, showTouch, updateTouch, disposeTouch };
}
