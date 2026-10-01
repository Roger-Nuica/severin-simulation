// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION C.1 — Cinematic camera
 * ===========================================================================
 * A toggleable automatic orbit around the funnel, layered on top of the
 * existing OrbitControls camera rather than replacing it. `Cinematic.blend`
 * ramps between 0 (fully manual) and 1 (fully automatic orbit) over a
 * couple of seconds whichever way it's toggled, so the camera never
 * jump-cuts. OrbitControls is only disabled while blend is actually
 * non-zero, so handing control back on toggle-off is just "stop nudging
 * the camera" — wherever the orbit left it becomes the new manual starting
 * point, with no snap back to a prior position.
 *
 * @param {Object} ctx
 * @returns {{
 *   Cinematic: Object,
 *   setCinematicView: (enabled: boolean) => void,
 *   updateCinematicCamera: (dt: number) => void
 * }}
 */
// How far out the cinematic orbit sits, as a multiple of the funnel's own top
// radius, and how high. 3x keeps the whole column in frame with room around it
// at the sizes a single tornado or a merged monster reaches.
const CINEMATIC_CLEARANCE = 3;
const CINEMATIC_RISE = 1.6;
// ...but three radii stops being framing once the funnel is the size of the
// town. An EF5 wedge (engine/wedge.js) has a ~137-unit top radius, and 411
// units out is far enough that the scene fog swallows the town entirely and
// takes most of the funnel with it -- a perfectly framed grey rectangle. Past
// WIDE_FROM the multiple therefore tightens towards these, which sit just clear
// of the wall: for a funnel with nothing outside it, "outside it" is the shot.
const CINEMATIC_WIDE_CLEARANCE = 1.45;
const CINEMATIC_WIDE_RISE = 0.85;
const CINEMATIC_WIDE_FROM = 45;
const CINEMATIC_WIDE_TO = 120;

// Master switch for every camera move the game makes on its own: the kill-cam
// replays (engine/killcam.js), the scripted shots below (the dam break's
// flood ride-along), and the EF5 wedge's automatic switch to the cinematic
// orbit (engine/wedge.js). Off on request -- they took the camera away at the
// moments the player most wanted it (dam break, meteors, the train going
// over). The code behind each is left intact so they can come back, perhaps
// shorter, by flipping this one flag.
export const SCRIPTED_CAMERAS = false;

export function createCameraSystem(ctx) {
  const { Sim, Vortex } = ctx;
  // Scratch, reused every frame rather than allocated (performance pass).
  const cinematicPos = new THREE.Vector3();
  const cinematicTarget = new THREE.Vector3();

  const Cinematic = {
    active: false,
    blend: 0,           // 0 = fully manual, 1 = fully automatic orbit
    angle: 0,            // radians; current bearing around the funnel
    transitionRate: 0.6  // blend units/sec, ~1.7s to fully engage/disengage
  };

  ctx.Cinematic = Cinematic;

  /**
   * @param {boolean} enabled
   * @returns {void}
   */
  function setCinematicView(enabled) {
    if (enabled === Cinematic.active) return;
    Cinematic.active = enabled;
    if (enabled) {
      // Start the orbit from the camera's current bearing around the
      // funnel, so the first orbit frame continues from roughly where the
      // camera already was rather than snapping to an arbitrary angle.
      const dx = Sim.three.camera.position.x - Vortex.center.x;
      const dz = Sim.three.camera.position.z - Vortex.center.z;
      Cinematic.angle = Math.atan2(dz, dx);
    }
    // Owned here rather than by the panel's click handler, because the view is
    // also taken automatically when an EF5 wedge comes up (engine/wedge.js) --
    // a button describing the opposite of the camera's actual mode is worse
    // than no button.
    const button = document.getElementById('btn-cinematic');
    if (!button) return;
    button.textContent = enabled ? '🎬 Exit Cinematic' : '🎬 Cinematic View';
    button.setAttribute('aria-pressed', String(enabled));
    button.classList.toggle('active', enabled);
  }

  ctx.setCinematicView = setCinematicView;

  /**
   * A scripted camera shot, for a disaster that is worth being shown rather
   * than merely happening somewhere behind the player. The dam break is the
   * first: it starts at the far western edge of the map, and until the wall
   * of water arrived there was nothing on screen to say it had begun.
   *
   * Layered over both the manual camera and the cinematic orbit -- whichever
   * is driving, the beat takes the camera for its duration and hands it
   * straight back, with no snap at either end: the weight eases up from zero
   * and back down, and wherever the shot leaves the camera simply becomes the
   * new manual position, exactly as the cinematic toggle behaves.
   */
  const Beat = {
    timer: 0,
    duration: 0,
    easeIn: 0.9,
    easeOut: 1.5,
    /** @type {((position: THREE.Vector3, target: THREE.Vector3, elapsed: number) => void)|null} */
    pose: null
  };
  const beatPos = new THREE.Vector3();
  const beatTarget = new THREE.Vector3();

  /**
   * @param {number} seconds
   * @param {(position: THREE.Vector3, target: THREE.Vector3, elapsed: number) => void} pose
   *   called every frame of the shot: writes where the camera should be and
   *   what it should be looking at *now*, so a beat can track something that
   *   is moving.
   * @param {{always?: boolean}} [options] `always` plays the shot even with
   *   SCRIPTED_CAMERAS off: the dam break asked for its camera back on its
   *   own, without bringing the kill-cam and the wedge's orbit back with it.
   * @returns {void}
   */
  function playCameraBeat(seconds, pose, options = {}) {
    if (!SCRIPTED_CAMERAS && !options.always) return;
    Beat.duration = seconds;
    Beat.timer = seconds;
    Beat.pose = pose;
  }

  /**
   * @param {number} dt
   * @returns {boolean} whether the beat is currently driving the camera
   */
  function updateCameraBeat(dt) {
    if (Beat.timer <= 0 || !Beat.pose) return false;
    Beat.timer = Math.max(0, Beat.timer - dt);
    const elapsed = Beat.duration - Beat.timer;
    // Ease in at the start and out at the end, whichever is the tighter
    // constraint right now.
    const weight = Math.min(
      THREE.MathUtils.smoothstep(elapsed, 0, Beat.easeIn),
      THREE.MathUtils.smoothstep(Beat.timer, 0, Beat.easeOut)
    );
    if (Beat.timer <= 0) Beat.pose = null;
    if (weight <= 0.002) return false;

    Beat.pose(beatPos, beatTarget, elapsed);
    Sim.three.controls.enabled = false;
    Sim.three.camera.position.lerp(beatPos, weight);
    Sim.three.controls.target.lerp(beatTarget, weight);
    return true;
  }

  /**
   * Drives the automatic orbit and blends it in/out against the manual
   * OrbitControls camera. Runs every frame regardless of Sim.state.running
   * (called from animate() the same way updateAtmosphere/updateLightning
   * are), so cinematic view also works to preview the idle scene before
   * Start is pressed.
   * @param {number} dt
   * @returns {void}
   */
  function updateCinematicCamera(dt) {
    const targetBlend = Cinematic.active ? 1 : 0;
    if (Cinematic.blend !== targetBlend) {
      const step = Cinematic.transitionRate * dt;
      Cinematic.blend = targetBlend > Cinematic.blend
        ? Math.min(targetBlend, Cinematic.blend + step)
        : Math.max(targetBlend, Cinematic.blend - step);
    }

    // Manual dragging is only blocked while genuinely committed to the
    // automatic orbit; the instant it starts easing back out, OrbitControls
    // regains control from wherever the orbit last left the camera.
    Sim.three.controls.enabled = Cinematic.blend <= 0.001;

    // A scripted shot outranks both the manual camera and the orbit.
    if (updateCameraBeat(dt)) return;

    if (Cinematic.blend <= 0.001) return;

    const p = Sim.params;
    // Deliberately slow; intensity only nudges speed/framing subtly for
    // restrained extra drama, never enough to feel disorienting.
    const angularSpeed = 0.035 + p.intensity * 0.03;
    if (ctx.Possess && ctx.Possess.active) {
      // Steering the funnel yourself: no orbit. The camera settles behind it
      // on the south side, looking north, so up on the keys is up the screen
      // and north on the minimap -- a fixed frame the keys can be learned
      // against (engine/possess.js steers relative to the view).
      const behind = Math.PI / 2;
      let delta = behind - Cinematic.angle;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      Cinematic.angle += delta * Math.min(1, dt * 1.5);
    } else {
      Cinematic.angle += angularSpeed * dt;
    }

    // Framing has to follow how big the funnel actually *is*, not just how
    // intense the storm is. The orbit used to be 78 units out falling to 58 as
    // intensity rose, which was fine for a 10-20m tornado and wrong for
    // anything bigger: at the EF5 preset's 28m radius the funnel's top is
    // already ~32 units across, so a 58-unit orbit put the camera inside the
    // funnel wall, and a Fujiwhara monster at sizeMul 2.4 was far worse. The
    // intensity ramp is kept as a floor -- it still pulls in for a small,
    // violent storm -- with the funnel's own reach taking over once that would
    // put the camera in the wall.
    const funnelRadius = Vortex.topRadius * (p.radius / 14) * Vortex.sizeMul;
    // The wider the funnel, the tighter the multiple (see the constants above).
    const wide = THREE.MathUtils.smoothstep(funnelRadius, CINEMATIC_WIDE_FROM, CINEMATIC_WIDE_TO);
    const clearance = THREE.MathUtils.lerp(CINEMATIC_CLEARANCE, CINEMATIC_WIDE_CLEARANCE, wide);
    const rise = THREE.MathUtils.lerp(CINEMATIC_RISE, CINEMATIC_WIDE_RISE, wide);
    const radius = Math.max(THREE.MathUtils.lerp(78, 58, p.intensity), funnelRadius * clearance);
    const height = Math.max(THREE.MathUtils.lerp(34, 44, p.intensity), funnelRadius * rise);
    // Vortex.height is the lathe's own height, before the group's vertical
    // scale: a funnel that sizeMul has made two and a half times taller (a
    // merged monster, a wedge) was being looked at a sixth of the way up.
    const lookHeight = Vortex.height * (1 + (Vortex.sizeMul - 1) * 0.5) * 0.4;

    const desiredPos = cinematicPos.set(
      Vortex.center.x + Math.cos(Cinematic.angle) * radius,
      height,
      Vortex.center.z + Math.sin(Cinematic.angle) * radius
    );
    const desiredTarget = cinematicTarget.set(Vortex.center.x, lookHeight, Vortex.center.z);

    // Smoothstep the ramped blend value itself for a gentler ease in/out
    // rather than a constant-speed hand-off.
    const eased = Cinematic.blend * Cinematic.blend * (3 - 2 * Cinematic.blend);
    Sim.three.camera.position.lerp(desiredPos, eased);
    Sim.three.controls.target.lerp(desiredTarget, eased);
  }

  // -----------------------------------------------------------------------
  // The glide: a character just called in from the panel, framed.
  // -----------------------------------------------------------------------
  /**
   * Pressing a character's button (the Yeti, the T-Rex, the Terminators,
   * Patient Zero, Captain Spotless, Hank Granite) glides the camera over to
   * it in GLIDE.seconds, eased in and out, rather than leaving it somewhere
   * off screen. Then the camera mode in use carries on:
   *  - the free camera (OrbitControls, nothing else driving): it stays
   *    framing the newcomer, the new manual starting point;
   *  - a mode that drives the camera every frame (Hero Mode, Chase,
   *    Control Tornado, the cinematic orbit): the shot holds for
   *    GLIDE.hold and eases back into that mode over GLIDE.back.
   * The mode keeps running underneath all along: its own camera pose is
   * put back at the start of every frame (restoreGlide) and what it
   * writes is blended with the shot after every other writer (placeGlide),
   * so it neither stalls nor drifts towards the shot.
   *
   * A glide without a subject (easeIntoMode) eases from where the camera
   * was into whatever the frame's writers now ask for: Hank Granite's scene
   * cuts to its own framing, and this turns the cut into a glide.
   *
   * Smooth Criminal's ascent (smoothCriminal.js) uses the same with a shot
   * of its own (glideWith), held through the explosion (GlideOptions.hold).
   */
  const GLIDE = { seconds: 1, hold: 1.3, back: 1 };
  /**
   * @typedef {Object} GlideOptions
   * @property {number} [hold] seconds the shot holds after the glide, in a
   *   driven mode, or in any mode when `always`
   * @property {boolean} [always] hold and ease back even with the free camera
   * @property {number} [seconds]
   */
  const Glide = {
    active: false,
    t: 0,
    free: false,
    hold: 0,
    seconds: GLIDE.seconds,
    /** @type {((position: THREE.Vector3, target: THREE.Vector3, elapsed: number) => void)|null} */
    pose: null,
    startPos: new THREE.Vector3(),
    startQuat: new THREE.Quaternion(),
    modePos: new THREE.Vector3(),
    modeQuat: new THREE.Quaternion(),
    modeTarget: new THREE.Vector3(),
    goalPos: new THREE.Vector3(),
    goalTarget: new THREE.Vector3(),
    goalQuat: new THREE.Quaternion(),
    look: new THREE.Matrix4(),
    up: new THREE.Vector3(0, 1, 0)
  };

  /** @returns {boolean} whether something drives the camera every frame */
  function cameraDriven() {
    return !!((ctx.Hero && ctx.Hero.active) || (ctx.Chase && ctx.Chase.active)
      || (ctx.Possess && ctx.Possess.active) || Cinematic.active
      || (ctx.systems.actionHero && ctx.systems.actionHero.active()));
  }

  /**
   * @param {((position: THREE.Vector3, target: THREE.Vector3, elapsed: number) => void)|null} pose
   *   where the shot is now (called every frame, so it can follow), given
   *   the real seconds since the glide began; null: the mode's own framing
   * @param {GlideOptions} [options]
   * @returns {void}
   */
  function beginGlide(pose, options = {}) {
    // Not under the benchmark (engine/perf/bench.js): its scenarios press
    // the character buttons, and a camera move would change what it measures.
    if (ctx.benchmarking) return;
    const cam = Sim.three.camera;
    Glide.active = true;
    Glide.t = 0;
    Glide.pose = pose;
    Glide.seconds = options.seconds || GLIDE.seconds;
    Glide.free = !options.always && !cameraDriven();
    Glide.hold = Glide.free || !pose ? 0 : (options.hold !== undefined ? options.hold : GLIDE.hold);
    Glide.startPos.copy(cam.position);
    Glide.startQuat.copy(cam.quaternion);
    Glide.modePos.copy(cam.position);
    Glide.modeQuat.copy(cam.quaternion);
    Glide.modeTarget.copy(Sim.three.controls.target);
  }

  /**
   * Frame a character: from the side the camera is on now, far enough back
   * for its whole height, looking at its middle; following it if it moves.
   * @param {() => ({x: number, y?: number, z: number}|null)} where
   * @param {number} height metres
   * @param {GlideOptions} [options]
   * @returns {void}
   */
  function glideTo(where, height, options = {}) {
    const at = where();
    if (!at) return;
    const cam = Sim.three.camera.position;
    const bearing = Math.atan2(cam.x - at.x, cam.z - at.z);
    const back = Math.max(12, height * 2.6);
    const up = Math.max(4, height * 0.85);
    beginGlide((position, target) => {
      const p = where() || at;
      const y = p.y || 0;
      position.set(p.x + Math.sin(bearing) * back, y + up, p.z + Math.cos(bearing) * back);
      target.set(p.x, y + height * 0.5, p.z);
    }, options);
  }

  /**
   * @param {GlideOptions} [options]
   * @returns {void}
   */
  function easeIntoMode(options = {}) {
    beginGlide(null, options);
  }

  /**
   * At the start of a frame: the driving mode's own pose put back, so it
   * carries on from where it was rather than from the shot.
   * @returns {void}
   */
  function restoreGlide() {
    if (!Glide.active || Glide.free) return;
    Sim.three.camera.position.copy(Glide.modePos);
    Sim.three.camera.quaternion.copy(Glide.modeQuat);
    Sim.three.controls.target.copy(Glide.modeTarget);
  }

  /**
   * After every camera writer: the shot blended in.
   * @param {number} rawDt real seconds
   * @returns {void}
   */
  function placeGlide(rawDt) {
    if (!Glide.active) return;
    const cam = Sim.three.camera;
    const controls = Sim.three.controls;
    // What the mode wrote this frame (for the free camera: where it was).
    Glide.modePos.copy(cam.position);
    Glide.modeQuat.copy(cam.quaternion);
    Glide.modeTarget.copy(controls.target);
    Glide.t += rawDt;
    const ease = (/** @type {number} */ u) => u * u * (3 - 2 * u);
    const tIn = Glide.seconds;
    if (!Glide.pose) {
      // Into the mode's own framing.
      const w = ease(Math.min(1, Glide.t / tIn));
      cam.position.lerpVectors(Glide.startPos, Glide.modePos, w);
      cam.quaternion.slerpQuaternions(Glide.startQuat, Glide.modeQuat, w);
      if (w >= 1) Glide.active = false;
      return;
    }
    Glide.pose(Glide.goalPos, Glide.goalTarget, Glide.t);
    // A camera's look (down its -z), not an object's (+z).
    Glide.look.lookAt(Glide.goalPos, Glide.goalTarget, Glide.up);
    Glide.goalQuat.setFromRotationMatrix(Glide.look);
    if (Glide.t < tIn) {
      // From where the camera was to the shot.
      const w = ease(Glide.t / tIn);
      cam.position.lerpVectors(Glide.startPos, Glide.goalPos, w);
      cam.quaternion.slerpQuaternions(Glide.startQuat, Glide.goalQuat, w);
      if (Glide.free) {
        controls.enabled = false;
        controls.target.copy(Glide.goalTarget);
      }
      return;
    }
    if (Glide.free) {
      // There: it is the free camera's new starting point.
      cam.position.copy(Glide.goalPos);
      cam.quaternion.copy(Glide.goalQuat);
      controls.target.copy(Glide.goalTarget);
      Glide.active = false;
      return;
    }
    // Held, then back into the mode.
    const back = Glide.t - tIn - Glide.hold;
    const w = back <= 0 ? 1 : 1 - ease(Math.min(1, back / GLIDE.back));
    cam.position.lerpVectors(Glide.modePos, Glide.goalPos, w);
    cam.quaternion.slerpQuaternions(Glide.modeQuat, Glide.goalQuat, w);
    if (back >= GLIDE.back) Glide.active = false;
  }

  /** @returns {void} */
  function resetGlide() {
    Glide.active = false;
    Glide.pose = null;
  }

  return {
    Cinematic, setCinematicView, updateCinematicCamera, playCameraBeat,
    glideTo, glideWith: beginGlide, easeIntoMode, restoreGlide, placeGlide, resetCamera: resetGlide,
    gliding: () => Glide.active
  };
}
