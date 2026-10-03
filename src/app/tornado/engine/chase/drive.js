// @ts-check
import * as THREE from 'three';
import { CHASE_TUNE, carRadiusFor } from './car.js';

/**
 * ===========================================================================
 * SECTION C.2 — Chase mode: input & drive physics
 * ===========================================================================
 */

// W A S D only (on request, 2026-10-01: no arrow keys in any mode).
const CHASE_KEY_MAP = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right'
};

/**
 * @param {Object} ctx
 * @returns {{
 *   stepChaseDriveInput: (dt: number) => void,
 *   attachChaseInputListeners: () => void,
 *   detachChaseInputListeners: () => void,
 *   updateChaseCar: (dt: number) => void,
 *   buildChaseColliders: () => void,
 *   resolveChaseCollisions: (obj: SimObject) => void
 * }}
 */
export function createChaseDriveSystem(ctx) {
  const { Sim, Chase, Environment, Vortex } = ctx;
  const { updateCaptureState } = ctx.systems.physics;
  const { updateSkidMarks } = ctx.systems.skidMarks;
  const { triggerChaseGameOver } = ctx.systems.chase;

  /**
   * Maps Chase.survivalTime to a single 0..1(+) progress value driving every
   * ramped difficulty quantity (see applyChaseDifficulty below) in lockstep.
   * A plain smoothstep from 0 to CHASE_TUNE.difficulty.rampTime, continuing
   * as an uncapped linear creep past it -- see the difficulty block's own
   * comment in car.js for why this single curve satisfies both the
   * "EF4 around 30-45s" and "EF5 by 60-90s" milestones without needing
   * separate per-tier tuning.
   * @param {number} survivalTime seconds
   * @returns {number}
   */
  function chaseDifficultyProgress(survivalTime) {
    const { rampTime, overtimeRate } = CHASE_TUNE.difficulty;
    if (survivalTime >= rampTime) {
      return 1 + (survivalTime - rampTime) * overtimeRate;
    }
    return THREE.MathUtils.smoothstep(survivalTime, 0, rampTime);
  }

  /**
   * Writes the ramped intensity/windSpeed/rotationSpeed/wander-speed values
   * for the current survival time into Sim.params/Vortex, called once a
   * frame from updateChaseCar while Chase Mode is actively running (not
   * paused on game over). Sandbox behaviour is untouched by this function
   * except for the duration Chase Mode itself is active -- enterChaseMode()/
   * exitChaseMode() are what save and restore Sim.params around it.
   * @returns {void}
   */
  function applyChaseDifficulty() {
    const d = CHASE_TUNE.difficulty;
    const progress = chaseDifficultyProgress(Chase.survivalTime);
    Sim.params.intensity = THREE.MathUtils.lerp(d.baseIntensity, d.maxIntensity, progress);
    Sim.params.windSpeed = THREE.MathUtils.lerp(d.baseWindSpeed, d.maxWindSpeed, progress);
    Sim.params.rotationSpeed = THREE.MathUtils.lerp(d.baseRotationSpeed, d.maxRotationSpeed, progress);
    Vortex.wanderSpeedMul = THREE.MathUtils.lerp(d.baseWanderSpeedMul, d.maxWanderSpeedMul, progress);
  }

  /**
   * Snapshots the current town's buildings/trees into flat collider lists for
   * the chase car. Rebuilt fresh every time Chase Mode is entered (and on
   * restart), so it can never go stale across a resetSim() regeneration.
   * @returns {void}
   */
  function buildChaseColliders() {
    Chase.colliders.buildings = Environment.buildings.map(b => {
      const fp = b.mesh.userData.footprint;
      const p = b.mesh.position;
      return { minX: p.x - fp.width / 2, maxX: p.x + fp.width / 2, minZ: p.z - fp.depth / 2, maxZ: p.z + fp.depth / 2 };
    });
    Chase.colliders.trees = Environment.trees.map(t => ({ x: t.mesh.position.x, z: t.mesh.position.z, r: CHASE_TUNE.treeRadius }));
  }

  /** @returns {void} */
  function attachChaseInputListeners() {
    Chase.keydownHandler = (e) => {
      const k = CHASE_KEY_MAP[e.code];
      if (!k) return;
      Chase.keys[k] = true;
      e.preventDefault();
    };
    Chase.keyupHandler = (e) => {
      const k = CHASE_KEY_MAP[e.code];
      if (k) Chase.keys[k] = false;
    };
    window.addEventListener('keydown', Chase.keydownHandler, { signal: ctx.signal });
    window.addEventListener('keyup', Chase.keyupHandler, { signal: ctx.signal });
  }

  /** @returns {void} */
  function detachChaseInputListeners() {
    if (Chase.keydownHandler) window.removeEventListener('keydown', Chase.keydownHandler);
    if (Chase.keyupHandler) window.removeEventListener('keyup', Chase.keyupHandler);
    Chase.keydownHandler = null;
    Chase.keyupHandler = null;
    Chase.keys = { forward: false, back: false, left: false, right: false };
  }

  /**
   * Arcade-style direct speed/turn-rate response (no suspension/slip angles):
   * accelerate/brake toward a clamped max speed, engine-brake toward 0 with
   * no throttle input, and turn at a rate that scales with current speed so
   * the car can't spin in place at a standstill.
   * @param {number} dt
   * @returns {void}
   */
  function stepChaseDriveInput(dt) {
    const k = Chase.keys;
    // A solar storm (engine/solarStorm.js): the engine is dead; it coasts.
    const dead = !!(ctx.systems.solarStorm && ctx.systems.solarStorm.stalled());
    if (dead) {
      const decel = CHASE_TUNE.brakeDecel * 0.5 * dt;
      Chase.speed = Chase.speed > 0 ? Math.max(0, Chase.speed - decel) : Math.min(0, Chase.speed + decel);
    } else if (k.forward && !k.back) {
      Chase.speed += CHASE_TUNE.accel * dt;
    } else if (k.back && !k.forward) {
      Chase.speed -= CHASE_TUNE.accel * dt;
    } else {
      const decel = CHASE_TUNE.brakeDecel * dt;
      if (Chase.speed > 0) Chase.speed = Math.max(0, Chase.speed - decel);
      else if (Chase.speed < 0) Chase.speed = Math.min(0, Chase.speed + decel);
    }
    Chase.speed = THREE.MathUtils.clamp(Chase.speed, -CHASE_TUNE.maxReverseSpeed, CHASE_TUNE.maxSpeed);

    const speedFrac = THREE.MathUtils.clamp(Math.abs(Chase.speed) / CHASE_TUNE.maxSpeed, 0, 1);
    const turnInput = (k.left ? 1 : 0) - (k.right ? 1 : 0);
    const turnSign = Chase.speed >= 0 ? 1 : -1;
    Chase.heading += turnInput * turnSign * CHASE_TUNE.turnRate * speedFrac * dt;
    Chase.car.mesh.rotation.y = Chase.heading;
  }

  /**
   * Lightweight, chase-car-only collision: sphere-vs-AABB against building
   * footprints (real width/depth already stored on each building, see
   * createBuilding) and sphere-vs-sphere against a flat tree radius. Resolves
   * by pushing the car's collision sphere out of any overlap and cancelling
   * only the velocity component pointing into the obstacle, so hitting at an
   * angle slides along the surface rather than sticking dead. No general
   * collision system exists elsewhere in this file to reuse; this is scoped
   * entirely to the chase car per its own tuning constants.
   * @param {SimObject} obj
   * @returns {void}
   */
  function resolveChaseCollisions(obj) {
    const pos = obj.mesh.position;
    const r = carRadiusFor(obj.mesh);

    // The dam is the west edge of the world (flood/dam.js westLimit).
    const flood = ctx.systems.flood;
    if (flood && pos.x < flood.westLimit() + r) {
      pos.x = flood.westLimit() + r;
      if (obj.velocity.x < 0) obj.velocity.x = 0;
    }

    for (const b of Chase.colliders.buildings) {
      const cx = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
      const cz = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq < r * r) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const nx = dx / dist, nz = dz / dist;
        const penetration = r - dist;
        pos.x += nx * penetration;
        pos.z += nz * penetration;
        const vn = obj.velocity.x * nx + obj.velocity.z * nz;
        if (vn < 0) { obj.velocity.x -= vn * nx; obj.velocity.z -= vn * nz; }
        // Deliberately not decaying Chase.speed here: it drives stepChaseDriveInput's
        // turn-rate (speedFrac), and crushing it on every frame of contact starved
        // steering exactly when it's needed to turn away from what's blocked ahead,
        // producing a soft-lock against flat walls. Cancelling the velocity vector's
        // inward component (above) already fully stops motion into the obstacle;
        // leaving the drivetrain's own speed intact lets a turn input redirect the
        // next frame's desired velocity clear of the wall.
      }
    }

    for (const t of Chase.colliders.trees) {
      const dx = pos.x - t.x;
      const dz = pos.z - t.z;
      const distSq = dx * dx + dz * dz;
      const minDist = r + t.r;
      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const nx = dx / dist, nz = dz / dist;
        const penetration = minDist - dist;
        pos.x += nx * penetration;
        pos.z += nz * penetration;
        const vn = obj.velocity.x * nx + obj.velocity.z * nz;
        if (vn < 0) { obj.velocity.x -= vn * nx; obj.velocity.z -= vn * nz; }
      }
    }
  }

  /**
   * Per-frame chase car update: arrow-key drivetrain -> blend into velocity by
   * how much the tornado currently permits (controlFactor) -> shared vortex
   * buffeting/capture-state physics (updateCaptureState, reused verbatim) ->
   * ground clamp -> collision resolution -> survival stats -> game-over
   * check on the exact rising->orbiting transition debris already uses.
   * Called unconditionally from animate() while Chase.active, independent of
   * Sim.state.running.
   * @param {number} dt
   * @returns {void}
   */
  function updateChaseCar(dt) {
    if (!Chase.car) return;
    const obj = Chase.car;
    const pos = obj.mesh.position;

    if (!Chase.gameOver) {
      stepChaseDriveInput(dt);

      const controlFactor = CHASE_TUNE.controlFactor[obj.captureState] ?? 1;
      const forwardX = Math.sin(Chase.heading);
      const forwardZ = Math.cos(Chase.heading);
      const desiredVelX = forwardX * Chase.speed;
      const desiredVelZ = forwardZ * Chase.speed;
      obj.velocity.x = THREE.MathUtils.lerp(obj.velocity.x, desiredVelX, controlFactor);
      obj.velocity.z = THREE.MathUtils.lerp(obj.velocity.z, desiredVelZ, controlFactor);
    }
    // else: game over -- skip the drivetrain entirely; obj.velocity is left
    // to whatever the vortex leaves it as, so the car keeps visibly
    // spiralling/falling under pure vortex physics behind the overlay.

    const wasOrbiting = obj.captureState === 'orbiting';
    updateCaptureState(obj, pos, dt);

    if (obj.captureState !== 'orbiting' && pos.y < 0) {
      pos.y = 0;
      obj.velocity.y *= -0.25;
      obj.velocity.x *= 0.85;
      obj.velocity.z *= 0.85;
    }

    if (obj.captureState === 'grounded' || obj.captureState === 'trembling') {
      resolveChaseCollisions(obj);
    }

    // Skid marks: cornering hard at speed always counts, and simply being in
    // 'trembling' counts too -- that state IS the vortex fighting the car's
    // own traction, so the tires should visibly scrub sideways for it.
    const speedFrac = Math.min(Math.abs(Chase.speed) / CHASE_TUNE.maxSpeed, 1);
    const cornering = Chase.keys.left !== Chase.keys.right && speedFrac > CHASE_TUNE.skidSpeedFrac;
    const skidding = !Chase.gameOver && obj.captureState !== 'orbiting' && obj.captureState !== 'falling'
      && (cornering || obj.captureState === 'trembling');
    updateSkidMarks(pos, Chase.heading, skidding);

    if (!Chase.gameOver) {
      Chase.survivalTime += dt;
      applyChaseDifficulty();
      const distToCore = Math.hypot(pos.x - Vortex.center.x, pos.z - Vortex.center.z);
      Chase.minDistanceToCore = Math.min(Chase.minDistanceToCore, distToCore);
    }

    if (!wasOrbiting && obj.captureState === 'orbiting') {
      triggerChaseGameOver('tornado');
    }
  }

  return { stepChaseDriveInput, attachChaseInputListeners, detachChaseInputListeners, updateChaseCar, buildChaseColliders, resolveChaseCollisions };
}
