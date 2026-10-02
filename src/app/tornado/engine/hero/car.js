// @ts-check
import * as THREE from 'three';
import { CHASE_TUNE, carRadiusFor } from '../chase/car.js';
import { HERO } from './config.js';

/**
 * ===========================================================================
 * SECTION HM.5 — Roger's car
 * ===========================================================================
 * The glowing door of a parked car, getting in and out, and driving it.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroCar(ctx, S, api) {
  const { Sim, container } = ctx;

  // ---------------------------------------------------------------------
  // The car: in by the driver's door, and out again
  // ---------------------------------------------------------------------

  /**
   * Where a car's driver's door is on the ground: its left side, which is
   * the car's own +x (cars.js builds them facing +z), just outside the body.
   * @param {Object} car an Environment.cars SimObject
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3}
   */
  function doorPoint(car, out) {
    const h = car.mesh.rotation.y;
    const p = car.mesh.position;
    const offset = HERO.doorOffset * carScaleOf(car);
    return out.set(p.x + Math.cos(h) * offset, 0, p.z - Math.sin(h) * offset);
  }

  /**
   * @param {Object} car
   * @returns {number} how many times life-size it is drawn (1 but for the
   *   Chase Mode car, chase/car.js carScale)
   */
  function carScaleOf(car) {
    return car.mesh.userData.carScale || 1;
  }

  /**
   * @param {Object} car
   * @returns {boolean} whether it is the Chase Mode car waiting in town
   */
  function isChaseCar(car) {
    return !!(ctx.Chase && !ctx.Chase.active && car && car === ctx.Chase.parked);
  }

  /**
   * @returns {Object[]} every car he might get into: the town's, and the
   *   Chase Mode car
   */
  function doorCandidates() {
    const parked = ctx.Chase && !ctx.Chase.active ? ctx.Chase.parked : null;
    return parked ? [...ctx.Environment.cars, parked] : ctx.Environment.cars;
  }

  /**
   * @param {Object} car
   * @returns {boolean} whether it is a parked car on its wheels that can be
   *   driven off: on the ground, upright, not in the storm's hands, not one
   *   of the elevated highway's
   */
  function drivable(car) {
    const m = car.mesh;
    if (!m || !m.parent || m.position.y > 0.6) return false;
    if ((car.captureState || 'grounded') !== 'grounded') return false;
    if (Math.abs(m.rotation.x) > 0.3 || Math.abs(m.rotation.z) > 0.3) return false;
    // The Chase Mode car is never in the physics; the town's are, until the
    // storm has them.
    return isChaseCar(car) || Sim.objects.includes(car);
  }

  /**
   * The nearest drivable car's door within `reach` of Roger.
   * @param {number} reach
   * @returns {{car: Object, d: number}|null}
   */
  function nearestDoor(reach) {
    const r = S.roger.mesh.position;
    let best = null;
    let bestD = reach;
    for (const car of doorCandidates()) {
      if (!car.mesh) continue;
      const c = car.mesh.position;
      const size = 4 * carScaleOf(car);
      if (Math.abs(c.x - r.x) > reach + size || Math.abs(c.z - r.z) > reach + size) continue;
      if (!drivable(car)) continue;
      const d = doorPoint(car, S.scratchB).distanceTo(S.scratch.set(r.x, 0, r.z));
      if (d < bestD) {
        bestD = d;
        best = { car, d };
      }
    }
    return best;
  }

  /**
   * The glowing outline over the nearest car's driver's door, while Roger is
   * close enough to see which one: brighter, and the prompt up, once he is
   * touching it.
   * @returns {void}
   */
  function updateDoorCue() {
    const cue = S.state.phase === 'running' ? nearestDoor(HERO.doorSpotReach) : null;
    // A bigger door is easier to reach: the Chase Mode car's.
    S.doorCar = cue && cue.d < HERO.doorReach * Math.sqrt(carScaleOf(cue.car)) ? cue.car : null;
    // The Chase Mode car: in by itself at the door -- once he has walked
    // away from it since he last got out.
    if (!S.state.chaseDoorArmed && !(cue && isChaseCar(cue.car) && cue.d < HERO.doorSpotReach * 0.6)) {
      S.state.chaseDoorArmed = true;
    }
    if (S.doorCar && isChaseCar(S.doorCar) && S.state.chaseDoorArmed) {
      enterCar(S.doorCar);
      return;
    }
    if (S.hud) S.hud.classList.toggle('door', !!S.doorCar);
    if (!cue) {
      if (S.doorGlow) S.doorGlow.visible = false;
      return;
    }
    if (!S.doorGlow) {
      S.doorGlow = new THREE.Mesh(api.keepGeo(new THREE.BoxGeometry(0.08, 0.62, 1.05)), api.keepMat(new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 1.6, 0.4), transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false
      })));
      S.doorGlow.name = 'hero_door';
      Sim.three.scene.add(S.doorGlow);
    }
    const m = cue.car.mesh;
    S.doorGlow.visible = true;
    S.doorGlow.scale.setScalar(carScaleOf(cue.car));
    S.doorGlow.position.set(HERO.doorOffset - 0.2, 0.78, 0.15);
    m.localToWorld(S.doorGlow.position);
    S.doorGlow.quaternion.copy(m.quaternion);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
    S.doorGlow.material.opacity = S.doorCar ? 0.75 + 0.25 * pulse : 0.25 + 0.2 * pulse;
  }

  /**
   * In: the car leaves the physics (the storm, collisions, the explosions)
   * while he drives it, Roger's figure is put away, and the camera goes to
   * Chase Mode's, behind the car.
   * @param {Object} car
   * @returns {void}
   */
  function enterCar(car) {
    if (S.state.phase === 'aiming') api.leaveAim();
    S.driven = car;
    S.state.phase = 'driving';
    S.state.carSpeed = 0;
    S.state.carHeading = car.mesh.rotation.y;
    const at = Sim.objects.indexOf(car);
    if (at !== -1) Sim.objects.splice(at, 1);
    car.velocity.set(0, 0, 0);
    if (car.angularVelocity) car.angularVelocity.set(0, 0, 0);
    const chase = isChaseCar(car);
    car.mesh.userData.parked = false;
    // The minimap draws the car he is in as his own marker, not as parked.
    car.mesh.userData.heroDriving = true;
    car.mesh.position.y = 0;
    car.mesh.rotation.set(0, S.state.carHeading, 0);
    S.roger.mesh.visible = false;
    if (S.doorGlow) S.doorGlow.visible = false;
    S.doorCar = null;
    if (S.hud) S.hud.classList.add('driving');
    api.flashMessage(chase ? '🏁 CHASE MODE — E, Q or Esc to get out' : '🚗 DRIVING — E, Q or Esc to get out');
  }

  /**
   * Out by the same door: Roger beside it, on his feet, facing the way the
   * car does; the car handed back to the physics, parked where it stopped.
   * @returns {void}
   */
  function exitCar() {
    const car = S.driven;
    if (!car) return;
    S.driven = null;
    const h = S.state.carHeading;
    const c = car.mesh.position;
    const p = S.roger.mesh.position;
    // Beside the door: further out for the big Chase Mode car.
    const out = HERO.exitOffset + HERO.doorOffset * (carScaleOf(car) - 1);
    p.set(c.x + Math.cos(h) * out, 0, c.z - Math.sin(h) * out);
    api.pushOut(p, HERO.pad);
    S.roger.mesh.visible = true;
    S.state.heading = h;
    S.state.speed = 0;
    if (S.state.phase === 'driving') S.state.phase = 'running';
    car.velocity.set(0, 0, 0);
    car.captureState = 'grounded';
    car.mesh.userData.heroDriving = false;
    if (isChaseCar(car)) {
      // Left parked for Chase Mode, outside the physics as it always is, and
      // the door not taking him back until he has walked off.
      S.state.chaseDoorArmed = false;
    } else {
      car.mesh.userData.parked = true;
      if (!Sim.objects.includes(car)) Sim.objects.push(car);
    }
    if (S.hud) S.hud.classList.remove('driving');
  }

  /**
   * Driving: the Chase Mode car's own handling (chase/car.js CHASE_TUNE and
   * drive.js stepChaseDriveInput), round the buildings, wheels turning. A
   * funnel that reaches the car throws Roger out of it, dazed, and takes
   * the car.
   * @param {number} dt
   * @returns {void}
   */
  function updateCar(dt) {
    const car = S.driven;
    const T = CHASE_TUNE;
    // A solar storm (engine/solarStorm.js): the engine is dead, so the car
    // only coasts -- it still steers while it rolls.
    const dead = !!(ctx.systems.solarStorm && ctx.systems.solarStorm.stalled());
    const fwd = S.keys.up && !dead;
    const back = S.keys.down && !dead;
    if (fwd && !back) S.state.carSpeed += T.accel * dt;
    else if (back && !fwd) S.state.carSpeed -= T.accel * dt;
    else {
      const decel = T.brakeDecel * dt;
      S.state.carSpeed = S.state.carSpeed > 0 ? Math.max(0, S.state.carSpeed - decel) : Math.min(0, S.state.carSpeed + decel);
    }
    S.state.carSpeed = THREE.MathUtils.clamp(S.state.carSpeed, -T.maxReverseSpeed, T.maxSpeed);
    const frac = THREE.MathUtils.clamp(Math.abs(S.state.carSpeed) / T.maxSpeed, 0, 1);
    const turn = (S.keys.left ? 1 : 0) - (S.keys.right ? 1 : 0);
    S.state.carHeading += turn * (S.state.carSpeed >= 0 ? 1 : -1) * T.turnRate * frac * dt;

    const p = car.mesh.position;
    p.x += Math.sin(S.state.carHeading) * S.state.carSpeed * dt;
    p.z += Math.cos(S.state.carHeading) * S.state.carSpeed * dt;
    const bx = p.x;
    const bz = p.z;
    api.pushOut(p, carRadiusFor(car.mesh));
    // Into a wall: pushed back out, and most of the speed gone.
    if (Math.hypot(p.x - bx, p.z - bz) > 0.01) S.state.carSpeed *= 0.4;
    p.y = 0;
    car.mesh.rotation.set(0, S.state.carHeading, 0);
    for (const wheel of car.mesh.userData.carWheels || []) {
      wheel.spin.rotation.x += S.state.carSpeed * dt / (HERO.wheelRadius * carScaleOf(car));
      if (wheel.steers) wheel.pivot.rotation.y = turn * 0.4;
    }
    // Roger goes where the car goes: the pursuer, the bunker and the map all
    // read his position.
    S.roger.mesh.position.set(p.x, 0, p.z);
    S.nameTag.position.set(p.x, HERO.tagHeight + 1, p.z);

    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.neutralized || Vortex.birth < 0.3 || S.state.dazeImmunity > 0 || S.state.invincible) continue;
      const reach = Sim.params.radius * HERO.dazeReach * (Vortex.sizeMul || 1) * Vortex.birth;
      if (Math.hypot(p.x - Vortex.center.x, p.z - Vortex.center.z) < reach) {
        exitCar();
        api.daze(Vortex);
        api.flashMessage('THROWN FROM THE CAR');
        break;
      }
    }
    if (S.state.dazeImmunity > 0) S.state.dazeImmunity -= dt;
  }

  /**
   * Chase Mode's camera (chase/cameras.js updateChaseCamera): behind and
   * above the car along its heading, looking a little ahead of it.
   * @param {number} rawDt
   * @returns {void}
   */
  function placeDriveCamera(rawDt) {
    const p = S.driven.mesh.position;
    const fx = Math.sin(S.state.carHeading);
    const fz = Math.cos(S.state.carHeading);
    // Pulled out with a bigger car, as chase/cameras.js does.
    const zoom = 1 + (carScaleOf(S.driven) - 1) * 0.6;
    S.camGoal.set(p.x - fx * 9 * zoom, p.y + 4.5 * zoom, p.z - fz * 9 * zoom);
    S.lookAt.set(p.x + fx * 4 * zoom, p.y + 1.2 * zoom, p.z + fz * 4 * zoom);
    const k = 1 - Math.pow(0.001, rawDt);
    const cam = Sim.three.camera;
    cam.position.lerp(S.camGoal, k);
    Sim.three.controls.target.lerp(S.lookAt, k);
    cam.lookAt(Sim.three.controls.target);
  }

  /**
   * The car Roger is driving and how fast, for the car rescue
   * (chase/carRescue.js); null on foot.
   * @returns {{mesh: THREE.Object3D, speed: number}|null}
   */
  function drivingCar() {
    if (!S.Hero.active || !S.driven || S.state.phase !== 'driving') return null;
    return { mesh: S.driven.mesh, speed: Math.abs(S.state.carSpeed) };
  }

  return { doorPoint, carScaleOf, isChaseCar, doorCandidates, drivable, nearestDoor, updateDoorCue, enterCar, exitCar, updateCar, placeDriveCamera, drivingCar };
}
