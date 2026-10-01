// @ts-check
import * as THREE from 'three';
import { pointScaleFor, markPoolDirty } from '../particlePool.js';
import { SHIP, THRUST } from './config.js';

/**
 * ===========================================================================
 * SECTION SS.2 — Thrust, rings, craters
 * ===========================================================================
 * The samurai ship's exhaust, the shock rings on the ground, and the Rocket
 * Strike's crater.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see spaceship.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createSpaceshipEffects(ctx, S, api) {
  const { Sim, container } = ctx;

  /**
   * Retro-thruster exhaust from the nozzles under the hull, washing out
   * across the ground once it reaches it.
   * @param {number} dt
   * @param {number} brake 0..1
   * @param {number} fallSpeed current downward speed of the ship
   * @returns {void}
   */
  function emitThrust(dt, brake, fallSpeed) {
    const p = S.thrust;
    p.accumulator += THREE.MathUtils.lerp(THRUST.rate[0], THRUST.rate[1], brake) * dt;
    const origin = S.ship.group.position;
    while (p.accumulator >= 1) {
      p.accumulator -= 1;
      const i = p.next;
      p.next = (p.next + 1) % THRUST.max;
      const nozzle = Math.floor(Math.random() * THRUST.nozzles);
      const a = (nozzle / THRUST.nozzles) * Math.PI * 2;
      const r = SHIP.radius * THRUST.nozzleRadius;
      p.positions[i * 3] = origin.x + Math.cos(a) * r + (Math.random() - 0.5) * 0.8;
      p.positions[i * 3 + 1] = origin.y + 1.1;
      p.positions[i * 3 + 2] = origin.z + Math.sin(a) * r + (Math.random() - 0.5) * 0.8;
      const speed = api.between(THRUST.speed) * (0.5 + 0.5 * brake);
      p.velocities[i * 3] = Math.cos(a) * 2.5 + (Math.random() - 0.5) * 3;
      // Carries some of the ship's own descent, so during the fall the plume
      // stays with the ship rather than being left hanging above it.
      p.velocities[i * 3 + 1] = -speed - fallSpeed * 0.6;
      p.velocities[i * 3 + 2] = Math.sin(a) * 2.5 + (Math.random() - 0.5) * 3;
      p.life[i] = p.maxLife[i] = api.between(THRUST.life);
      p.seed[i] = Math.random();
      S.thrustAlive++;
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateThrust(dt) {
    const p = S.thrust;
    S.thrustAlive = 0;
    for (let i = 0; i < THRUST.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      S.thrustAlive++;
      const i3 = i * 3;
      p.positions[i3] += p.velocities[i3] * dt;
      p.positions[i3 + 1] += p.velocities[i3 + 1] * dt;
      p.positions[i3 + 2] += p.velocities[i3 + 2] * dt;
      // Hitting the ground: the downward speed turns into an outward wash.
      if (p.positions[i3 + 1] < 0.4) {
        p.positions[i3 + 1] = 0.4;
        const dx = p.positions[i3] - S.landing.x;
        const dz = p.positions[i3 + 2] - S.landing.z;
        const d = Math.hypot(dx, dz) || 1;
        const push = Math.abs(p.velocities[i3 + 1]) * 0.7;
        p.velocities[i3] += (dx / d) * push;
        p.velocities[i3 + 2] += (dz / d) * push;
        p.velocities[i3 + 1] = 0.6;
      }
      const damping = 1 - Math.min(1, 1.6 * dt);
      p.velocities[i3] *= damping;
      p.velocities[i3 + 2] *= damping;
      const u = 1 - p.life[i] / p.maxLife[i];
      p.colours[i * 4] = THREE.MathUtils.lerp(THRUST.hot.r, THRUST.cool.r, u);
      p.colours[i * 4 + 1] = THREE.MathUtils.lerp(THRUST.hot.g, THRUST.cool.g, u);
      p.colours[i * 4 + 2] = THREE.MathUtils.lerp(THRUST.hot.b, THRUST.cool.b, u);
      p.colours[i * 4 + 3] = (1 - u) * 0.8;
      p.sizes[i] = THRUST.size * (0.6 + 0.8 * p.seed[i]) * (0.7 + 1.6 * u);
    }
    markPoolDirty(p);
    p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
  }

  // ---------------------------------------------------------------------
  // Rings and craters
  // ---------------------------------------------------------------------

  /**
   * An expanding, fading ring flat on the ground.
   * @param {{x: number, z: number}} at
   * @param {number} from radius it starts at
   * @param {number} reach radius it grows to
   * @param {number} life seconds
   * @param {number} brightness
   * @param {THREE.Color} colour
   * @returns {void}
   */
  function spawnShockRing(at, from, reach, life, brightness, colour) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.045, 6, 64),
      new THREE.MeshBasicMaterial({
        color: colour.clone().multiplyScalar(brightness),
        transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    mesh.name = 'support_shockwave';
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(at.x, 0.8, at.z);
    mesh.scale.setScalar(from);
    S.group.add(mesh);
    S.rings.push({ mesh, age: 0, life, from, reach });
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateRings(dt) {
    for (let i = S.rings.length - 1; i >= 0; i--) {
      const ring = S.rings[i];
      ring.age += dt;
      const u = Math.min(1, ring.age / ring.life);
      // Fast out of the gate, slowing as it spreads, like a real blast front.
      const eased = 1 - Math.pow(1 - u, 3);
      ring.mesh.scale.setScalar(THREE.MathUtils.lerp(ring.from, ring.reach, eased));
      ring.mesh.material.opacity = (1 - u) * (1 - u);
      if (u >= 1) {
        S.group.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
        S.rings.splice(i, 1);
      }
    }
  }

  /**
   * A scorched scar on the ground for the rest of the run (the meteors'
   * crater decal), the oldest going past S.maxCraters.
   * @param {{x: number, z: number}} at
   * @param {number} radius
   * @returns {void}
   */
  function addCrater(at, radius) {
    const crater = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ map: S.craterTexture, transparent: true, depthWrite: false, opacity: 0.95 })
    );
    crater.name = 'rocket_crater';
    crater.rotation.x = -Math.PI / 2;
    crater.rotation.z = Math.random() * Math.PI * 2;
    // Just above the meteors' craters.
    crater.position.set(at.x, 0.028, at.z);
    S.group.add(crater);
    S.craters.push(crater);
    while (S.craters.length > 4) {
      const old = S.craters.shift();
      S.group.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  return { emitThrust, updateThrust, spawnShockRing, updateRings, addCrater };
}
