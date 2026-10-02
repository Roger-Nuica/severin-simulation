// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION B.3 — Arrow-key map navigation
 * ===========================================================================
 * W A S D slide the free (OrbitControls) camera across the town, so
 * the wreckage can be toured without dragging the view about with the mouse.
 * Up/Down move along the way the camera is looking, flattened onto the
 * ground; Left/Right strafe across it. Camera and orbit target move together,
 * so the angle and zoom the player chose are kept.
 *
 * Nothing is shown on screen for it, on request. And it is off whenever
 * something else owns either W A S D or the camera: Chase Mode and
 * tornado control (Possess) both drive with W A S D, and so does Hero
 * Mode's runner, the spaceship's
 * hover steers with them, and the cinematic camera, the landing cutscene and
 * the kill-cam replay all place the camera themselves. A key held while one
 * of those starts simply stops counting.
 *
 * A focused form control keeps its keys: a slider in the panel is moved
 * with them, and stealing that would break the panel for keyboard users.
 *
 * The mouse wheel's zoom lives here too, in place of OrbitControls' own.
 * Theirs moves the camera by a factor per wheel event that grows with the
 * event's delta, straight at the orbit target: an accelerated mouse wheel or
 * a trackpad flick (dozens of events with momentum) jumped from the rooftops
 * to the edge of the map in one gesture, and even a careful notch zoomed
 * towards the middle of the screen rather than at what was being looked at.
 * Here each event moves a goal distance by a capped step, the camera eases
 * to it over a few frames, and zooming in closes on the ground point under
 * the cursor.
 */

const PAN = {
  // World units per second at the closest zoom; scaled with the camera's
  // distance from its target so a zoomed-out view crosses the town as fast
  // as it looks like it should.
  speedAtNear: 28,
  speedPerDistance: 0.75,
  ease: 9,       // 1/s: how fast the pan velocity follows the keys
  bound: 260     // the orbit target stays over the map
};

const ZOOM = {
  // Distance factor per notch-sized wheel event (deltaY 100), and the cap on
  // one event however large its delta: an accelerated wheel or a trackpad
  // flick can no longer cross the map in a gesture.
  perNotch: 1.12,
  maxNotches: 1.5,
  ease: 10,      // 1/s: how fast the camera follows the goal distance
  // Of each zoom-in step, how much of it closes on the point under the
  // cursor rather than the orbit target (1 keeps that point fixed on screen).
  towardCursor: 1
};

const KEYS = { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right' };

/**
 * @param {Object} ctx
 * @returns {{
 *   initKeyPan: () => void,
 *   updateKeyPan: (dt: number) => void,
 *   resetKeyPan: () => void,
 *   disposeKeyPan: () => void
 * }}
 */
export function createKeyPanSystem(ctx) {
  const { Sim } = ctx;
  // Scratch, reused every frame rather than allocated (performance pass).
  const zoomOffset = new THREE.Vector3();
  const held = { forward: false, back: false, left: false, right: false };
  // Eased pan velocity on the ground plane, world units per second.
  let vx = 0;
  let vz = 0;
  /** @type {((e: KeyboardEvent) => void)|null} */
  let onDown = null;
  /** @type {((e: KeyboardEvent) => void)|null} */
  let onUp = null;
  /** @type {(() => void)|null} */
  let onBlur = null;
  /** @type {((e: WheelEvent) => void)|null} */
  let onWheel = null;
  // Where the wheel wants the camera, as a distance from the orbit target;
  // null while nothing is pending.
  /** @type {number|null} */
  let zoomGoal = null;
  // The ground point under the cursor at the last zoom-in, which the view
  // closes on; null for a zoom out.
  /** @type {THREE.Vector3|null} */
  let zoomFocus = null;
  const raycaster = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointer = new THREE.Vector2();

  /**
   * Whether something else owns W A S D or the camera right now.
   * @returns {boolean}
   */
  function blocked() {
    const s = ctx.systems;
    return !!(ctx.Chase && ctx.Chase.active)
      || !!(ctx.Possess && ctx.Possess.active)
      || !!(ctx.Hero && ctx.Hero.active)
      // A co-op guest's WASD walks Roger 2; it must not also pan the town camera.
      || !!(s.net && s.net.isPeerView())
      || !!(ctx.Cinematic && ctx.Cinematic.active)
      || !!(s.spaceship && s.spaceship.isLanding())
      || !!(s.killcam && s.killcam.isReplaying());
  }

  /**
   * @param {EventTarget|null} target
   * @returns {boolean} whether the key belongs to a form control
   */
  function isFormControl(target) {
    const el = /** @type {HTMLElement|null} */ (target);
    if (!el || !el.tagName) return false;
    return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }

  /** @returns {void} */
  function releaseAll() {
    held.forward = held.back = held.left = held.right = false;
  }

  /** @returns {void} */
  function initKeyPan() {
    onDown = (e) => {
      const dir = KEYS[e.code];
      if (!dir || blocked() || isFormControl(e.target)) return;
      held[dir] = true;
      // The page would otherwise scroll with the keys as well.
      e.preventDefault();
    };
    onUp = (e) => {
      const dir = KEYS[e.code];
      if (dir) held[dir] = false;
    };
    // A key released while the tab was in the background never sends its
    // keyup; without this the camera would keep sliding when it comes back.
    onBlur = releaseAll;
    window.addEventListener('keydown', onDown, { signal: ctx.signal });
    window.addEventListener('keyup', onUp, { signal: ctx.signal });
    window.addEventListener('blur', onBlur, { signal: ctx.signal });

    const { controls, camera, renderer } = Sim.three;
    // Ours instead of OrbitControls' (see the header); rotate and pan stay theirs.
    controls.enableZoom = false;
    onWheel = (e) => {
      if (!controls.enabled) return;
      e.preventDefault();
      // Lines (Firefox) and pages, into pixels.
      const pixels = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);
      if (!pixels) return;
      const notches = THREE.MathUtils.clamp(pixels / 100, -ZOOM.maxNotches, ZOOM.maxNotches);
      const from = zoomGoal ?? camera.position.distanceTo(controls.target);
      zoomGoal = THREE.MathUtils.clamp(
        from * Math.pow(ZOOM.perNotch, notches), controls.minDistance, controls.maxDistance
      );
      zoomFocus = null;
      if (notches < 0) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
        if (hit) zoomFocus = hit;
      }
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false, signal: ctx.signal });
  }

  /**
   * Eases the camera to the wheel's goal distance, closing on the point under
   * the cursor as it zooms in. Whenever OrbitControls has the camera, as
   * their own zoom was, rather than only when W A S D are free.
   * @param {number} dt
   * @returns {void}
   */
  function updateWheelZoom(dt) {
    if (zoomGoal === null) return;
    const { camera, controls } = Sim.three;
    if (!controls.enabled) {
      zoomGoal = null;
      zoomFocus = null;
      return;
    }
    const offset = zoomOffset.copy(camera.position).sub(controls.target);
    const distance = offset.length();
    if (distance < 1e-4) {
      zoomGoal = null;
      return;
    }
    const next = distance + (zoomGoal - distance) * Math.min(1, ZOOM.ease * dt);
    if (zoomFocus && next < distance) {
      // Target and camera slide towards the focus by the share of the
      // distance just closed, which keeps that point under the cursor.
      const share = (1 - next / distance) * ZOOM.towardCursor;
      const tx = THREE.MathUtils.clamp(controls.target.x + (zoomFocus.x - controls.target.x) * share, -PAN.bound, PAN.bound);
      const tz = THREE.MathUtils.clamp(controls.target.z + (zoomFocus.z - controls.target.z) * share, -PAN.bound, PAN.bound);
      controls.target.x = tx;
      controls.target.z = tz;
    }
    camera.position.copy(controls.target).addScaledVector(offset, next / distance);
    if (Math.abs(zoomGoal - next) < 0.02) {
      zoomGoal = null;
      zoomFocus = null;
    }
  }

  /**
   * Per frame, real time, before OrbitControls.update() so the damping sees
   * the moved target. Runs the wheel zoom first.
   * @param {number} dt
   * @returns {void}
   */
  function updateKeyPan(dt) {
    updateWheelZoom(dt);
    if (blocked()) {
      releaseAll();
      vx = 0;
      vz = 0;
      return;
    }
    const { camera, controls } = Sim.three;
    // The camera's heading, flattened onto the ground.
    let fx = controls.target.x - camera.position.x;
    let fz = controls.target.z - camera.position.z;
    const flat = Math.hypot(fx, fz);
    if (flat < 1e-4) {
      // Looking straight down: "forward" is screen-up, which is where the
      // camera's own up vector points.
      fx = camera.up.x;
      fz = camera.up.z;
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len;
    fz /= len;
    // Right of forward on the ground, seen from above with +y up.
    const rx = -fz;
    const rz = fx;

    const ahead = (held.forward ? 1 : 0) - (held.back ? 1 : 0);
    const side = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const distance = camera.position.distanceTo(controls.target);
    const speed = PAN.speedAtNear + distance * PAN.speedPerDistance;
    let wx = (fx * ahead + rx * side) * speed;
    let wz = (fz * ahead + rz * side) * speed;
    if (ahead && side) {
      wx *= Math.SQRT1_2;
      wz *= Math.SQRT1_2;
    }
    const k = Math.min(1, PAN.ease * dt);
    vx += (wx - vx) * k;
    vz += (wz - vz) * k;
    if (Math.abs(vx) < 1e-3 && Math.abs(vz) < 1e-3) return;

    let dx = vx * dt;
    let dz = vz * dt;
    // Held over the map: the step is trimmed so the target never leaves it.
    const tx = Math.max(-PAN.bound, Math.min(PAN.bound, controls.target.x + dx));
    const tz = Math.max(-PAN.bound, Math.min(PAN.bound, controls.target.z + dz));
    dx = tx - controls.target.x;
    dz = tz - controls.target.z;
    controls.target.x += dx;
    controls.target.z += dz;
    camera.position.x += dx;
    camera.position.z += dz;
  }

  /** @returns {void} */
  function resetKeyPan() {
    releaseAll();
    zoomGoal = null;
    zoomFocus = null;
    vx = 0;
    vz = 0;
  }

  /** @returns {void} */
  function disposeKeyPan() {
    if (onDown) window.removeEventListener('keydown', onDown);
    if (onUp) window.removeEventListener('keyup', onUp);
    if (onBlur) window.removeEventListener('blur', onBlur);
    if (onWheel && Sim.three.renderer) Sim.three.renderer.domElement.removeEventListener('wheel', onWheel);
    onDown = onUp = onBlur = onWheel = null;
    resetKeyPan();
  }

  return { initKeyPan, updateKeyPan, resetKeyPan, disposeKeyPan };
}
