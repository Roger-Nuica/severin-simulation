// @ts-check
import * as THREE from 'three';
import { SUPPORT } from './config.js';
import { ROCKET } from './rocket.js';

/**
 * ===========================================================================
 * SECTION SS.3 — Landing Support: targeting
 * ===========================================================================
 * T (or the Landing tile) opens it: a marker on the ground under the
 * pointer -- the middle of the view in Hero Mode while the pointer is
 * locked -- with two rings round it:
 *  - ring A, blue: the samurai's coverage (SUPPORT.coverage);
 *  - ring B, red: the Rocket Strike's blast (ROCKET.blastRadius), turning
 *    a flashing warning red with Roger inside it.
 * In it the keys are its own:
 *  - R  Samurai Support at the marker (spaceship/descent.js);
 *  - T  the Rocket Strike at the marker (spaceship/rocket.js);
 *  - Esc or the right mouse button: away, nothing called.
 * Outside it R is Roger's EMP as ever: the keys are taken (before Hero
 * Mode's own listener, stopImmediatePropagation) only while it is open.
 * The HUD at the bottom shows both options and when each is ready.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see spaceship.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createSupportTargeting(ctx, S, api) {
  const { Sim, container } = ctx;
  const T = {
    on: false,
    hasPoint: false,
    point: new THREE.Vector3(),
    clientX: -1,
    clientY: -1,
    time: 0,
    /** @type {string} a message on the HUD for a moment */
    note: '',
    noteTimer: 0
  };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** @type {THREE.Group|null} */
  let marker = null;
  /** @type {THREE.Mesh|null} */
  let ringA = null;
  /** @type {THREE.Mesh|null} */
  let ringB = null;
  /** @type {HTMLDivElement|null} */
  let hud = null;
  const RING_B = new THREE.Color(2.4, 0.35, 0.25);
  const RING_B_WARN = new THREE.Color(4, 0.9, 0.3);

  /** @returns {void} */
  function initTargeting() {
    marker = new THREE.Group();
    marker.name = 'support_marker';
    marker.visible = false;
    /**
     * @param {number} inner
     * @param {number} outer
     * @param {THREE.Color} colour
     * @param {number} opacity
     * @returns {THREE.Mesh}
     */
    const ring = (inner, outer, colour, opacity) => {
      const geo = new THREE.RingGeometry(inner, outer, 96);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colour.clone(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      }));
      mesh.renderOrder = 3;
      marker.add(mesh);
      return mesh;
    };
    ringA = ring(SUPPORT.coverage - 1.4, SUPPORT.coverage, new THREE.Color(0.5, 1.3, 3), 0.8);
    ringB = ring(ROCKET.blastRadius - 1.4, ROCKET.blastRadius, RING_B, 0.85);
    // The point itself: a small ring and a cross through it.
    ring(2.2, 2.8, new THREE.Color(2.4, 2.4, 2.4), 0.9);
    for (const rot of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.35).rotateX(-Math.PI / 2).rotateY(rot), ringA.material.clone());
      bar.material.color.setRGB(2.4, 2.4, 2.4);
      bar.renderOrder = 3;
      marker.add(bar);
    }
    marker.position.y = 0.09;
    Sim.three.scene.add(marker);

    hud = document.createElement('div');
    hud.className = 'support-hud';
    hud.innerHTML = '<div class="support-title">LANDING SUPPORT</div>'
      + '<div class="support-option" data-k="samurai"><b>R</b><span class="name">SAMURAI SUPPORT</span><span class="state"></span></div>'
      + '<div class="support-option" data-k="rocket"><b>T</b><span class="name">ROCKET STRIKE</span><span class="state"></span></div>'
      + '<div class="support-foot"><b>Esc</b> / right-click to cancel</div>'
      + '<div class="support-warn">ROGER IS INSIDE THE BLAST RADIUS</div>'
      + '<div class="support-note"></div>';
    container.appendChild(hud);

    // Capture, on the window: before Hero Mode's own listener (R is its EMP
    // otherwise) and before the camera's.
    window.addEventListener('keydown', onKey, { signal: ctx.signal, capture: true });
    window.addEventListener('pointermove', (e) => {
      T.clientX = e.clientX;
      T.clientY = e.clientY;
    }, { signal: ctx.signal });
    /** @param {MouseEvent} e */
    const rightClick = (e) => {
      if (!T.on || e.button !== 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'mousedown') close();
    };
    window.addEventListener('pointerdown', rightClick, { signal: ctx.signal, capture: true });
    window.addEventListener('mousedown', rightClick, { signal: ctx.signal, capture: true });
    window.addEventListener('contextmenu', (e) => { if (T.on) e.preventDefault(); }, { signal: ctx.signal, capture: true });
  }

  /**
   * @param {EventTarget|null} target
   * @returns {boolean} typing in a form field, which keeps its keys
   */
  function inField(target) {
    const tag = target && /** @type {HTMLElement} */ (target).tagName;
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  /** @returns {boolean} whether something else has the controls or the camera */
  function blocked() {
    const s = ctx.systems;
    return !!(ctx.Chase && ctx.Chase.active) || !!(ctx.Possess && ctx.Possess.active)
      || !!(s.killcam && s.killcam.isReplaying()) || api.rocketActive()
      || !Sim.three || !ctx.Environment;
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {void}
   */
  function onKey(e) {
    if (e.repeat || inField(e.target)) return;
    const code = e.code;
    if (!T.on) {
      if (code !== 'KeyT') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      open();
      return;
    }
    if (code !== 'KeyT' && code !== 'KeyR' && code !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (code === 'Escape') close();
    else if (code === 'KeyR') chooseSamurai();
    else chooseRocket();
  }

  /** @returns {void} targeting on */
  function open() {
    if (T.on || blocked()) return;
    T.on = true;
    T.note = '';
    T.noteTimer = 0;
    if (marker) marker.visible = false;
    if (hud) hud.classList.add('visible');
    if (S.button) {
      S.button.classList.add('active');
      S.button.setAttribute('aria-pressed', 'true');
    }
  }

  /** @returns {void} targeting off */
  function close() {
    T.on = false;
    if (marker) marker.visible = false;
    if (hud) hud.classList.remove('visible', 'warn');
    if (S.button) {
      S.button.classList.remove('active');
      S.button.setAttribute('aria-pressed', 'false');
    }
  }

  /** @returns {void} the Landing tile: open, or away */
  function toggle() {
    if (T.on) close();
    else open();
  }

  /**
   * A word on the HUD for a moment (why an option is not there yet).
   * @param {string} text
   * @returns {void}
   */
  function note(text) {
    T.note = text;
    T.noteTimer = 2;
  }

  /** @returns {void} R */
  function chooseSamurai() {
    if (!T.hasPoint) return note('Point at the ground');
    if (S.state.phase !== 'idle') return note('The squad is already deployed');
    if (S.cooldown.samurai > 0) return note(`Samurai Support ready in ${Math.ceil(S.cooldown.samurai)} s`);
    const { x, z } = T.point;
    close();
    api.callSamurai(x, z);
  }

  /** @returns {void} T again */
  function chooseRocket() {
    if (!T.hasPoint) return note('Point at the ground');
    if (S.cooldown.rocket > 0) return note(`Rocket Strike ready in ${Math.ceil(S.cooldown.rocket)} s`);
    const { x, z } = T.point;
    close();
    api.fireRocket(x, z);
  }

  /**
   * The ground point under the pointer (or the middle of the view under a
   * pointer lock), into T.point.
   * @returns {void}
   */
  function aim() {
    const canvas = Sim.three.renderer.domElement;
    const locked = document.pointerLockElement === canvas;
    const rect = canvas.getBoundingClientRect();
    if (locked || T.clientX < 0) pointer.set(0, 0);
    else pointer.set(((T.clientX - rect.left) / rect.width) * 2 - 1, -((T.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, Sim.three.camera);
    T.hasPoint = !!raycaster.ray.intersectPlane(ground, T.point);
    if (!T.hasPoint) return;
    const b = SUPPORT.markerBound;
    T.point.x = THREE.MathUtils.clamp(T.point.x, -b, b);
    T.point.z = THREE.MathUtils.clamp(T.point.z, -b, b);
  }

  /**
   * Per frame, real time.
   * @param {number} dt
   * @returns {void}
   */
  function updateTargeting(dt) {
    if (!T.on) return;
    if (blocked()) {
      close();
      return;
    }
    T.time += dt;
    aim();
    if (marker) {
      marker.visible = T.hasPoint;
      marker.position.x = T.point.x;
      marker.position.z = T.point.z;
    }
    // Ring B: warning red, flashing, with Roger inside it.
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    const inside = !!roger && T.hasPoint && Math.hypot(roger.x - T.point.x, roger.z - T.point.z) < ROCKET.blastRadius;
    if (ringB) {
      const mat = /** @type {THREE.MeshBasicMaterial} */ (ringB.material);
      if (inside) {
        mat.color.copy(RING_B_WARN);
        mat.opacity = 0.55 + 0.45 * (Math.sin(T.time * 14) > 0 ? 1 : 0);
      } else {
        mat.color.copy(RING_B);
        mat.opacity = 0.85;
      }
    }
    if (ringA) /** @type {THREE.MeshBasicMaterial} */ (ringA.material).opacity = 0.55 + 0.25 * Math.sin(T.time * 3);
    if (!hud) return;
    hud.classList.toggle('warn', inside);
    const samurai = S.state.phase !== 'idle'
      ? (S.state.phase === 'guarding' ? `deployed · ${Math.ceil(S.state.stay)} s left` : 'deployed')
      : S.cooldown.samurai > 0 ? `${Math.ceil(S.cooldown.samurai)} s` : 'ready';
    const rocket = S.cooldown.rocket > 0 ? `${Math.ceil(S.cooldown.rocket)} s` : 'ready';
    setOption('samurai', samurai, samurai === 'ready');
    setOption('rocket', rocket, rocket === 'ready');
    if (T.noteTimer > 0) T.noteTimer -= dt;
    const noteEl = hud.querySelector('.support-note');
    noteEl.textContent = T.noteTimer > 0 ? T.note : '';
  }

  /**
   * @param {string} key
   * @param {string} text
   * @param {boolean} ready
   * @returns {void}
   */
  function setOption(key, text, ready) {
    const row = hud.querySelector(`.support-option[data-k="${key}"]`);
    if (!row) return;
    const state = row.querySelector('.state');
    if (state.textContent !== text) state.textContent = text;
    row.classList.toggle('ready', ready);
  }

  /** @returns {boolean} */
  function targeting() {
    return T.on;
  }

  /** @returns {void} */
  function resetTargeting() {
    close();
  }

  /** @returns {void} */
  function disposeTargeting() {
    close();
    if (marker) {
      Sim.three.scene.remove(marker);
      marker.traverse((child) => {
        const mesh = /** @type {THREE.Mesh} */ (child);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) /** @type {THREE.Material} */ (mesh.material).dispose();
      });
    }
    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    marker = ringA = ringB = null;
    hud = null;
  }

  return { initTargeting, updateTargeting, toggle, targeting, resetTargeting, disposeTargeting };
}
