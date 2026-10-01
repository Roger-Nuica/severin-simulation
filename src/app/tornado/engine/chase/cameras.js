// @ts-check
import * as THREE from 'three';
import { CHASE_TUNE } from './car.js';

// Behind, above and ahead of the car for the third-person camera, at
// carScale 1; pulled out with the car's size (CAMERA_PER_SCALE of it, not
// all of it, or a three-times car puts the camera a street away).
const FOLLOW = { back: 9, up: 4.5, ahead: 4, lookUp: 1.2 };
const CAMERA_PER_SCALE = 0.6;

/**
 * ===========================================================================
 * SECTION C.2 — Chase mode: cameras
 * ===========================================================================
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   updateChaseCamera: (dt: number) => void,
 *   updateCockpitCamera: () => void,
 *   updateCockpitWheel: (dt: number) => void,
 *   syncCockpitRigVisibility: () => void
 * }}
 */
export function createChaseCameraSystem(ctx) {
  const { Sim, Chase } = ctx;
  // Scratch, reused every frame rather than allocated (performance pass).
  const followPos = new THREE.Vector3();
  const followTarget = new THREE.Vector3();

  /**
   * Third-person chase camera: positioned behind and slightly above the car
   * along its facing direction, looking ahead of it. Mirrors
   * updateCinematicCamera's lerp-toward-desired-transform technique for
   * smoothness, and takes over Sim.three.controls.enabled the same way.
   * @param {number} dt
   * @returns {void}
   */
  function updateChaseCamera(dt) {
    Sim.three.controls.enabled = false;
    if (!Chase.car) return;
    const pos = Chase.car.mesh.position;
    const forwardX = Math.sin(Chase.heading);
    const forwardZ = Math.cos(Chase.heading);

    const k = 1 + ((Chase.car.mesh.userData.carScale || 1) - 1) * CAMERA_PER_SCALE;
    const desiredCamPos = followPos.set(pos.x - forwardX * FOLLOW.back * k, pos.y + FOLLOW.up * k, pos.z - forwardZ * FOLLOW.back * k);
    const desiredTarget = followTarget.set(pos.x + forwardX * FOLLOW.ahead * k, pos.y + FOLLOW.lookUp * k, pos.z + forwardZ * FOLLOW.ahead * k);

    const smoothing = 1 - Math.pow(0.001, dt); // frame-rate-independent exponential lerp
    Sim.three.camera.position.lerp(desiredCamPos, smoothing);
    Sim.three.controls.target.lerp(desiredTarget, smoothing);
    Sim.three.camera.lookAt(Sim.three.controls.target);
  }

  /**
   * First-person "cockpit view" camera: rigidly attached to the car at its
   * mesh.userData.cockpitCamOffset (computed once from the car's actual
   * bounding boxes, see buildCockpitFixtures) with no lag/smoothing (unlike
   * updateChaseCamera's lerp above), since it's meant to feel bolted to the
   * driver's seat rather than trailing behind. Recomputed from the car's own
   * position/heading every frame -- same inputs updateChaseCamera uses --
   * so it tracks correctly through every captureState (grounded, buffeted,
   * airborne, orbiting) with a plain position/rotation swap when toggled.
   *
   * The eye point sits *inside* the cabin box (behind its front/windshield
   * wall), not floating above the hood in open air. That's deliberate and
   * relies on standard back-face culling: every material on the car uses
   * THREE's default FrontSide rendering, so from a viewpoint inside a solid
   * box, that box's own walls face away from the camera and simply aren't
   * drawn -- the camera sees straight through them to the world beyond,
   * with no hollowing-out of the mesh required. The one exception is the
   * body/hood box, which *is* visible (correctly) from inside the cabin
   * since the camera sits above its top face -- which is why the
   * wheel/dashboard/windshield are all placed above that face in
   * buildCockpitFixtures, so they don't render embedded in it.
   * @returns {void}
   */
  function updateCockpitCamera() {
    Sim.three.controls.enabled = false;
    if (!Chase.car) return;
    const pos = Chase.car.mesh.position;
    const heading = Chase.heading;
    const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
    const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
    const o = Chase.car.mesh.userData.cockpitCamOffset;
    if (!o) return;

    Sim.three.camera.position.set(
      pos.x + rightX * o.x + forwardX * o.z,
      pos.y + o.y,
      pos.z + rightZ * o.x + forwardZ * o.z
    );
    // THREE.Camera looks down its own local -Z by default, whereas every
    // heading/forward-vector computation elsewhere in Chase (forwardX/Z
    // above, stepChaseDriveInput, updateChaseCamera's lookAt target) treats
    // +Z as forward. A bare `rotation.set(0, heading, 0)` therefore points
    // the camera exactly opposite the car's actual facing; the +PI corrects
    // for that mismatch so "forward" here means the same thing it does
    // everywhere else in this file.
    Sim.three.camera.rotation.set(0, heading + Math.PI, 0);
  }

  /**
   * Eases the cockpit steering wheel's visual spin (around its own forward
   * axis, i.e. rotation.z in its local frame since createCar/carMesh use +Z
   * as forward) toward the current A/D (or Left/Right) input, scaled by the
   * same speedFrac stepChaseDriveInput uses for the car's actual turn rate
   * -- so the wheel roughly mirrors how hard the car is turning without
   * reading from or touching the car's steering physics itself. Runs
   * unconditionally whenever Chase is active (not just while cockpit view
   * is the active camera) so the wheel is already at the right angle the
   * instant the player swaps into cockpit view.
   * @param {number} dt
   * @returns {void}
   */
  function updateCockpitWheel(dt) {
    if (!Chase.car) return;
    const wheel = Chase.car.mesh.userData.cockpitWheel;
    if (!wheel) return;
    const turnInput = (Chase.keys.left ? 1 : 0) - (Chase.keys.right ? 1 : 0);
    const speedFrac = THREE.MathUtils.clamp(Math.abs(Chase.speed) / CHASE_TUNE.maxSpeed, 0, 1);
    const target = Chase.gameOver ? 0 : turnInput * CHASE_TUNE.cockpitWheelMaxAngle * (0.35 + 0.65 * speedFrac);
    const smoothing = 1 - Math.pow(0.0001, dt); // frame-rate-independent exponential lerp, snappier than the camera's own
    Chase.wheelAngle = THREE.MathUtils.lerp(Chase.wheelAngle, target, smoothing);
    wheel.rotation.z = Chase.wheelAngle;
  }

  /**
   * Shows the cockpit fixtures only while cockpit view is the active camera.
   * Driven every frame from the animation loop rather than from the toggle
   * handler, so it stays correct across every other route into and out of
   * cockpit view (restartChaseRun, game over, the car being rebuilt).
   * @returns {void}
   */
  function syncCockpitRigVisibility() {
    if (!Chase.car) return;
    const rig = Chase.car.mesh.userData.cockpitRig;
    if (rig) rig.visible = Chase.viewMode === 'cockpit';
  }

  return { updateChaseCamera, updateCockpitCamera, updateCockpitWheel, syncCockpitRigVisibility };
}
