// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION D.7 — Birds
 * ===========================================================================
 * Three flocks of gulls wheel over the town, each in a loose cluster that
 * circles its own patch of sky, flapping and gliding. They are the first to
 * know: the moment a tornado is on the ground within FLEE.radius of a
 * flock, it breaks away from it, climbing and flapping hard, and only comes
 * back once the funnel is gone or far away. From above it reads at a glance
 * as "something is coming".
 *
 * Purely visual: not Sim.objects, nothing collides with them. Every bird
 * is an instance: one InstancedMesh for the bodies and one for each wing,
 * three draw calls for all of them, no shadows. No per-frame allocation.
 */

export const BIRDS = Object.freeze({
  flocks: 3,
  perFlock: 14,
  /** Where the flocks circle: centre, radius of the circle (m) and height. */
  homes: [
    { x: -45, z: -30, radius: 26, y: 34 },
    { x: 40, z: 10, radius: 32, y: 40 },
    { x: -10, z: 45, radius: 22, y: 30 }
  ],
  /** Cruising speed round the circle (m/s); fleeing. */
  speed: 9,
  fleeSpeed: 22,
  /** How far a flock's cluster spreads round its centre (m). */
  spread: 7,
  /** Wingspan of a gull (m): a little over life size, to read from the usual height. */
  span: 2.2
});

/** Fleeing: from a tornado nearer than `radius`, to `distance` away from it, up at `height`. */
const FLEE = { radius: 120, distance: 170, height: 58, calm: 190 };

/**
 * @param {Object} ctx
 * @returns {{initBirds: () => void, updateBirds: (dt: number) => void, resetBirds: () => void, disposeBirds: () => void,
 *   fleeing: () => boolean}}
 */
export function createBirdsSystem(ctx) {
  const { Sim } = ctx;
  const total = BIRDS.flocks * BIRDS.perFlock;
  /** @type {THREE.InstancedMesh|null} */
  let bodies = null;
  /** @type {THREE.InstancedMesh|null} */
  let wingsL = null;
  /** @type {THREE.InstancedMesh|null} */
  let wingsR = null;
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  /** @type {THREE.Material[]} */
  const materials = [];
  /**
   * @typedef {{home: {x: number, z: number, radius: number, y: number},
   *   cx: number, cy: number, cz: number, angle: number, dir: number,
   *   fleeing: boolean, fx: number, fz: number}} Flock
   */
  /** @type {Flock[]} */
  let flocks = [];
  // Each bird's place in its flock (x, y, z), flap phase and rate.
  const offset = new Float32Array(total * 3);
  const flapPhase = new Float32Array(total);
  let clock = 0;

  const m = new THREE.Matrix4();
  const wing = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);

  /** @returns {void} */
  function initBirds() {
    const s = BIRDS.span / 2;
    // A gull: a slim body, a pale wing tapering to a dark tip.
    const body = new THREE.ConeGeometry(0.11 * s, 0.9 * s, 6);
    body.rotateX(Math.PI / 2);
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.16 * s, s, 0, -0.08 * s, 0, 0, -0.18 * s,
      0, 0, 0.16 * s, 0.55 * s, 0, 0.12 * s, s, 0, -0.08 * s
    ], 3));
    wingGeo.computeVertexNormals();
    geometries.push(body, wingGeo);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.8 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xc9d0d8, roughness: 0.85, side: THREE.DoubleSide });
    materials.push(bodyMat, wingMat);
    bodies = new THREE.InstancedMesh(body, bodyMat, total);
    wingsL = new THREE.InstancedMesh(wingGeo, wingMat, total);
    wingsR = new THREE.InstancedMesh(wingGeo, wingMat, total);
    for (const mesh of [bodies, wingsL, wingsR]) {
      mesh.name = 'birds';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      Sim.three.scene.add(mesh);
    }
    flocks = BIRDS.homes.slice(0, BIRDS.flocks).map((home, f) => ({
      home, cx: home.x + home.radius, cy: home.y, cz: home.z, angle: f * 2.1, dir: f % 2 ? -1 : 1,
      fleeing: false, fx: home.x, fz: home.z
    }));
    for (let i = 0; i < total; i++) {
      // A loose, flattened cluster.
      const a = i * 2.399;
      const r = BIRDS.spread * Math.sqrt(((i * 7) % BIRDS.perFlock) / BIRDS.perFlock + 0.05);
      offset[i * 3] = Math.cos(a) * r;
      offset[i * 3 + 1] = Math.sin(i * 1.3) * 1.6;
      offset[i * 3 + 2] = Math.sin(a) * r;
      flapPhase[i] = Math.random() * Math.PI * 2;
    }
  }

  /**
   * The nearest tornado on the ground to a point, or null.
   * @param {number} x @param {number} z
   * @returns {{x: number, z: number, d: number}|null}
   */
  function nearestFunnel(x, z) {
    if (!Sim.state.running) return null;
    const registry = ctx.tornadoes;
    let best = null;
    for (const v of registry ? registry.activeVortices : []) {
      if ((v.birth ?? 1) < 0.25) continue;
      const d = Math.hypot(v.center.x - x, v.center.z - z);
      if (!best || d < best.d) best = { x: v.center.x, z: v.center.z, d };
    }
    return best;
  }

  /** @param {number} dt @returns {void} */
  function updateBirds(dt) {
    if (!bodies || !wingsL || !wingsR || dt <= 0) return;
    clock += dt;
    for (let f = 0; f < flocks.length; f++) {
      const flock = flocks[f];
      const { home } = flock;
      // Where the flock wants to circle: home, or well away from a funnel.
      const funnel = nearestFunnel(flock.cx, flock.cz);
      if (funnel && funnel.d < FLEE.radius) {
        flock.fleeing = true;
        const k = FLEE.distance / Math.max(funnel.d, 1);
        flock.fx = funnel.x + (flock.cx - funnel.x) * k;
        flock.fz = funnel.z + (flock.cz - funnel.z) * k;
      } else if (flock.fleeing && (!funnel || funnel.d > FLEE.calm)) {
        flock.fleeing = false;
      }
      const goalX = flock.fleeing ? flock.fx : home.x;
      const goalZ = flock.fleeing ? flock.fz : home.z;
      const goalY = flock.fleeing ? FLEE.height : home.y;
      const radius = flock.fleeing ? home.radius * 0.6 : home.radius;
      const speed = flock.fleeing ? BIRDS.fleeSpeed : BIRDS.speed;
      flock.angle += (flock.dir * speed * dt) / radius;
      const tx = goalX + Math.cos(flock.angle) * radius;
      const tz = goalZ + Math.sin(flock.angle) * radius;
      // The centre chases its point on the circle: a smooth path, never a jump.
      const ease = Math.min(1, dt * (flock.fleeing ? 1.4 : 0.6));
      const vx = (tx - flock.cx) * ease;
      const vz = (tz - flock.cz) * ease;
      flock.cx += vx;
      flock.cz += vz;
      flock.cy += (goalY + Math.sin(clock * 0.3 + f) * 2 - flock.cy) * Math.min(1, dt * 0.5);
      const heading = Math.atan2(vx, vz);
      const bank = flock.dir * -0.35;

      for (let b = 0; b < BIRDS.perFlock; b++) {
        const i = f * BIRDS.perFlock + b;
        const t = clock + flapPhase[i];
        p.set(
          flock.cx + offset[i * 3] + Math.sin(t * 0.7) * 0.8,
          flock.cy + offset[i * 3 + 1] + Math.sin(t * 1.1) * 0.5,
          flock.cz + offset[i * 3 + 2] + Math.cos(t * 0.6) * 0.8
        );
        e.set(0, heading + Math.sin(t * 0.5) * 0.15, bank);
        q.setFromEuler(e);
        m.compose(p, q, one);
        bodies.setMatrixAt(i, m);
        // Flap in bursts, glide in between; a fleeing flock flaps all the time.
        const flapping = flock.fleeing || Math.sin(t * 0.45) > -0.2;
        // Held in a shallow V when gliding (a gull's silhouette), swept
        // through it when flapping.
        const flap = flapping ? 0.2 + Math.sin(t * (flock.fleeing ? 14 : 8)) * 0.7 : 0.28;
        wing.makeRotationZ(flap);
        wingsL.setMatrixAt(i, wing.premultiply(m));
        wing.makeRotationZ(flap).premultiply(mirror).premultiply(m);
        wingsR.setMatrixAt(i, wing);
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    wingsL.instanceMatrix.needsUpdate = true;
    wingsR.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} */
  function resetBirds() {
    for (const flock of flocks) {
      flock.fleeing = false;
      flock.cx = flock.home.x + flock.home.radius;
      flock.cz = flock.home.z;
      flock.cy = flock.home.y;
    }
  }

  /** @returns {void} */
  function disposeBirds() {
    for (const mesh of [bodies, wingsL, wingsR]) {
      mesh?.removeFromParent();
      mesh?.dispose();
    }
    bodies = wingsL = wingsR = null;
    for (const g of geometries) g.dispose();
    for (const mat of materials) mat.dispose();
    geometries.length = materials.length = 0;
    flocks = [];
  }

  return { initBirds, updateBirds, resetBirds, disposeBirds, fleeing: () => flocks.some((f) => f.fleeing) };
}
