// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../../utils/textures.js';
import { CAR_WHEEL_X, CAR_WHEEL_Z } from './cars.js';
import { CHASE_TUNE } from '../chase/car.js';

/**
 * ---------------------------------------------------------------------
 * Wheel dust: a small pooled particle spray thrown up behind the rear
 * wheels while the Chase car is driving on the ground, reusing
 * createSoftDotTexture() like the funnel swirl and ground spray do.
 *
 * Unlike those two, this pool needs every particle to fade on its own
 * schedule, because they are emitted continuously at different times.
 * PointsMaterial carries one opacity for the whole system, so the alpha is
 * carried per-particle instead, in a four-component vertex colour attribute
 * -- three enables USE_COLOR_ALPHA when the colour attribute has itemSize 4,
 * which makes <color_fragment> multiply the alpha through as well.
 * ---------------------------------------------------------------------
 */
const CAR_DUST_COUNT = 80;
const CAR_DUST_RATE = 55;        // particles per second at full speed
const CAR_DUST_MIN_SPEED = 1.5;  // below this the car isn't moving enough to disturb anything
const CAR_DUST_GRAVITY = 4;
const CAR_DUST_DRAG = 0.25;
const CAR_DUST_ALPHA = 0.5;
const CAR_DUST_COLOUR = new THREE.Color(0xcbb896); // matches the ground spray's dun

/**
 * @param {Object} ctx
 * @returns {{
 *   CarDust: Object,
 *   initCarDust: () => void,
 *   updateCarDust: (dt: number) => void,
 *   resetCarDust: () => void
 * }}
 */
export function createCarDustSystem(ctx) {
  const { Sim, Chase } = ctx;

  const CarDust = {
    points: /** @type {THREE.Points|null} */ (null),
    positions: /** @type {Float32Array|null} */ (null),
    colours: /** @type {Float32Array|null} */ (null),
    velocities: /** @type {Float32Array|null} */ (null),
    life: /** @type {Float32Array|null} */ (null),
    maxLife: /** @type {Float32Array|null} */ (null),
    next: 0,
    emitAccumulator: 0,
    emitSide: 1
  };

  /**
   * Allocates the wheel-dust pool, parked invisible until the car starts
   * moving.
   * @returns {void}
   */
  function initCarDust() {
    const n = CAR_DUST_COUNT;
    const positions = new Float32Array(n * 3);
    const colours = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colours[i * 4] = CAR_DUST_COLOUR.r;
      colours[i * 4 + 1] = CAR_DUST_COLOUR.g;
      colours[i * 4 + 2] = CAR_DUST_COLOUR.b;
      colours[i * 4 + 3] = 0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 4));
    const dotTexture = createSoftDotTexture();
    const material = new THREE.PointsMaterial({
      size: 0.55,
      map: dotTexture,
      alphaMap: dotTexture,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'carDust';
    // Positions are rewritten every frame, so the bounding sphere computed
    // once from the initial all-zero buffer would wrongly cull the whole
    // system as soon as the car drove away from the world origin.
    points.frustumCulled = false;
    points.visible = false;
    Sim.three.scene.add(points);

    CarDust.points = points;
    CarDust.positions = positions;
    CarDust.colours = colours;
    CarDust.velocities = new Float32Array(n * 3);
    CarDust.life = new Float32Array(n);
    CarDust.maxLife = new Float32Array(n);
  }

  /**
   * Emits one dust particle at a rear wheel's world position.
   * @param {number} side -1 or 1, which rear wheel
   * @param {number} speedFrac
   * @returns {void}
   */
  function emitCarDust(side, speedFrac) {
    const i = CarDust.next;
    CarDust.next = (CarDust.next + 1) % CAR_DUST_COUNT;

    const pos = Chase.car.mesh.position;
    const heading = Chase.heading;
    const forwardX = Math.sin(heading), forwardZ = Math.cos(heading);
    const rightX = Math.cos(heading), rightZ = -Math.sin(heading);

    // At the wheels of a car drawn bigger than life (chase/car.js carScale).
    const s = Chase.car.mesh.userData.carScale || 1;
    const lateral = side * CAR_WHEEL_X * s;
    const behind = -CAR_WHEEL_Z * s;
    CarDust.positions[i * 3] = pos.x + rightX * lateral + forwardX * behind;
    CarDust.positions[i * 3 + 1] = 0.12;
    CarDust.positions[i * 3 + 2] = pos.z + rightZ * lateral + forwardZ * behind;

    // Thrown backward out of the wheel arch, with a little lift and outward
    // scatter. Faster driving throws it further, which is what ties the effect
    // to the sense of speed rather than just decorating the car.
    const back = -(1.2 + speedFrac * 4.5) * (Chase.speed >= 0 ? 1 : -1);
    const out = side * (0.4 + Math.random() * 0.9);
    CarDust.velocities[i * 3] = forwardX * back + rightX * out + (Math.random() - 0.5) * 0.6;
    CarDust.velocities[i * 3 + 1] = 0.9 + Math.random() * 1.6;
    CarDust.velocities[i * 3 + 2] = forwardZ * back + rightZ * out + (Math.random() - 0.5) * 0.6;

    CarDust.life[i] = 0;
    CarDust.maxLife[i] = 0.45 + Math.random() * 0.3;
    CarDust.colours[i * 4 + 3] = CAR_DUST_ALPHA;
  }

  /**
   * Integrates the wheel dust and tops it up while the car is driving on the
   * ground. Emission stops the moment the car leaves the ground -- there is
   * nothing to kick up once the wheels are off the terrain -- but particles
   * already in the air keep settling, so liftoff thins the trail out rather
   * than deleting it.
   * @param {number} dt
   * @returns {void}
   */
  function updateCarDust(dt) {
    if (!CarDust.points) return;

    const car = Chase.car;
    if (car) {
      const grounded = car.captureState === 'grounded' || car.captureState === 'trembling';
      const speedFrac = THREE.MathUtils.clamp(Math.abs(Chase.speed) / CHASE_TUNE.maxSpeed, 0, 1);
      if (grounded && car.mesh.position.y < 0.4 && Math.abs(Chase.speed) > CAR_DUST_MIN_SPEED) {
        CarDust.emitAccumulator += CAR_DUST_RATE * speedFrac * dt;
        while (CarDust.emitAccumulator >= 1) {
          CarDust.emitAccumulator -= 1;
          emitCarDust(CarDust.emitSide, speedFrac);
          CarDust.emitSide = -CarDust.emitSide; // alternate rear wheels
        }
      } else {
        CarDust.emitAccumulator = 0;
      }
    }

    const damping = Math.pow(CAR_DUST_DRAG, dt);
    let anyAlive = false;
    for (let i = 0; i < CAR_DUST_COUNT; i++) {
      if (CarDust.colours[i * 4 + 3] <= 0) continue;
      CarDust.life[i] += dt;
      const t = CarDust.life[i] / CarDust.maxLife[i];
      if (t >= 1) {
        CarDust.colours[i * 4 + 3] = 0;
        continue;
      }
      anyAlive = true;
      const v = i * 3;
      CarDust.velocities[v + 1] -= CAR_DUST_GRAVITY * dt;
      CarDust.velocities[v] *= damping;
      CarDust.velocities[v + 1] *= damping;
      CarDust.velocities[v + 2] *= damping;
      CarDust.positions[v] += CarDust.velocities[v] * dt;
      CarDust.positions[v + 1] += CarDust.velocities[v + 1] * dt;
      CarDust.positions[v + 2] += CarDust.velocities[v + 2] * dt;
      if (CarDust.positions[v + 1] < 0.04) {
        CarDust.positions[v + 1] = 0.04;
        CarDust.velocities[v + 1] = 0;
      }
      CarDust.colours[i * 4 + 3] = CAR_DUST_ALPHA * Math.pow(1 - t, 1.4);
    }

    CarDust.points.visible = anyAlive;
    if (anyAlive) {
      CarDust.points.geometry.attributes.position.needsUpdate = true;
      CarDust.points.geometry.attributes.color.needsUpdate = true;
    }
  }

  /**
   * Clears every live dust particle, called whenever the chase run restarts or
   * ends so a fresh run doesn't start inside the last one's dust cloud.
   * @returns {void}
   */
  function resetCarDust() {
    if (!CarDust.points) return;
    for (let i = 0; i < CAR_DUST_COUNT; i++) CarDust.colours[i * 4 + 3] = 0;
    CarDust.emitAccumulator = 0;
    CarDust.points.geometry.attributes.color.needsUpdate = true;
    CarDust.points.visible = false;
  }

  return { CarDust, initCarDust, updateCarDust, resetCarDust };
}
