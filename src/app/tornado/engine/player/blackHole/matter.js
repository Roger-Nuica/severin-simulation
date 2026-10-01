// @ts-check
import * as THREE from 'three';
import { LOOK } from './look.js';

/**
 * ===========================================================================
 * SECTION PB.2 — Matter falling in
 * ===========================================================================
 * Small, sharp, bright shards riding the spiral the swirl's shader draws
 * (look.js), so they read as the arms themselves carrying things in --
 * stretched boxes, oriented to their own direction of travel every frame
 * (the same InstancedMesh technique dissolve.js already uses for its
 * fragments, and wind.js for its streaks -- not the shared round-sprite
 * particlePool.js, which can only face the camera and cannot be oriented or
 * stretched, which is why the old version read as soft round "bubbles"):
 *
 *  - Dust and grit are torn up off the ground all the way out to the edge
 *    of the pull (100 m) and blown in, greyish brown, turning violet as they
 *    cross the no-escape line.
 *  - Ambient matter streams in all the time from the no-escape line (40 m)
 *    along the arms: rising off the ground out there, sweeping round and in,
 *    faster and faster, white-hot at the end, and gone at the horizon. It is
 *    what shows, from anywhere, how far the pull reaches and where it goes.
 *  - Whatever the hole is tearing apart sheds bits from where it is, and
 *    they join the same flow.
 *
 * Each shard keeps its radius and angle round the hole (not a velocity): it
 * turns with the swirl's own differential rotation and moves along the
 * logarithmic arm as it falls, so it stays on an arm instead of cutting
 * across them. Positions follow the hole as it drifts. Stretched along its
 * own instantaneous direction of travel and shrunk as it nears the horizon,
 * same as dissolve.js's fragments -- so the trail itself reads as curved,
 * not a straight streak, because the direction it is stretched along keeps
 * turning every frame.
 *
 * A fixed cap (MATTER.max, same figure the old point-pool used) rather than
 * the shared points-only particle budget (perf/caps.js's particleRoom(),
 * which only tracks THREE.Points pools) -- the same self-contained-cap
 * pattern dissolve.js's fragments and wind.js's streaks already use.
 */

export const MATTER = {
  max: 2400,
  ambientRate: 420,        // particles a second while the hole is open
  infall: [4, 34],         // m/s inward: at the line, and at the horizon
  life: 14,                // seconds, a backstop only: they end at the horizon
  size: [0.35, 1.1],       // shard length at full size (world units)
  stretch: 2.2              // how long a shard is drawn at the horizon, x its size
};

/**
 * @param {Object} ctx
 * @param {{escape: number, horizon: number, influence: number}} hole the hole's radii
 * @returns {{
 *   ambient: (dt: number, at: {x: number, y: number, z: number}, t: number) => void,
 *   shed: (from: THREE.Vector3, at: {x: number, y: number, z: number}, n: number) => void,
 *   step: (dt: number, at: {x: number, y: number, z: number}|null, t: number) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createHoleMatter(ctx, hole) {
  const { Sim } = ctx;
  const N = MATTER.max;
  const geometry = new THREE.BoxGeometry(0.12, 0.12, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const mesh = new THREE.InstancedMesh(geometry, material, N);
  mesh.name = 'black_hole_matter';
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(0, 0, 0));
  Sim.three.scene.add(mesh);

  // Per shard: radius and angle round the hole, height, the seed its size
  // and colour variance are drawn from, and how long it has left.
  const radius = new Float32Array(N);
  const angle = new Float32Array(N);
  const height = new Float32Array(N);
  const seed = new Float32Array(N);
  const life = new Float32Array(N);
  let next = 0;
  let alive = false;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const colour = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  let owed = 0;
  const inner = LOOK.coreRadius * 0.95;

  /**
   * The swirl's spin at a radius (look.js's differential rotation), in
   * radians a second -- the world sees it the other way round.
   * @param {number} r
   * @returns {number}
   */
  function spinAt(r) {
    const u = Math.min(1, Math.max(0, (r - inner) / (LOOK.swirlRadius - inner)));
    return LOOK.spinInner + (LOOK.spinOuter - LOOK.spinInner) * Math.sqrt(u);
  }

  /**
   * Where an arm crosses radius r now, as a world angle (x = cos, z = sin):
   * the shader's arm phase solved for the angle, turned into the world
   * through the group's precession.
   * @param {number} r
   * @param {number} t
   * @param {number} k which arm
   * @returns {number}
   */
  function armAngle(r, t, k) {
    const local = (Math.PI * 2 * k) / LOOK.arms - LOOK.twist * Math.log(Math.max(r, 0.01) / inner) + spinAt(r) * t;
    return -local - t * LOOK.precession;
  }

  /**
   * The height of the flow at radius r: up off the ground at the line, onto
   * the swirl's funnel inside it.
   * @param {number} r
   * @param {number} y the hole's centre height
   * @returns {number}
   */
  function heightAt(r, y) {
    if (r >= LOOK.swirlRadius) {
      const u = Math.min(1, (r - LOOK.swirlRadius) / Math.max(1, hole.escape - LOOK.swirlRadius));
      return y + (0.4 - y) * u;
    }
    return y - LOOK.funnelDepth * Math.pow(1 - r / LOOK.swirlRadius, 2.4);
  }

  /**
   * @param {number} r
   * @param {number} ang
   * @param {number} y
   * @returns {void}
   */
  function spawn(r, ang, y) {
    const i = next;
    next = (next + 1) % N;
    radius[i] = r;
    angle[i] = ang;
    height[i] = y;
    seed[i] = Math.random();
    life[i] = MATTER.life;
    alive = true;
  }

  /**
   * The ambient stream along the arms, from the line in.
   * @param {number} dt
   * @param {{x: number, y: number, z: number}} at the hole's centre
   * @param {number} t seconds since it opened
   * @returns {void}
   */
  function ambient(dt, at, t) {
    // The same adaptive quality ladder engine/post.js's lensing reads
    // (engine/quality.js) rather than a separate watcher: fewer shards a
    // second once the machine is visibly struggling.
    const step = ctx.systems.quality ? ctx.systems.quality.qualityStep() : 0;
    owed += MATTER.ambientRate * (1 - step * 0.18) * dt;
    const n = Math.min(Math.floor(owed), N);
    owed -= Math.floor(owed);
    for (let k = 0; k < n; k++) {
      // Dust from all the way out, most from out at the line, some from
      // inside the swirl already.
      const pick = Math.random();
      const r = pick < 0.35
        ? hole.escape + Math.random() * (hole.influence - hole.escape)
        : pick < 0.8
          ? hole.escape * (0.85 + Math.random() * 0.2)
          : LOOK.swirlRadius * (0.4 + Math.random() * 0.6);
      const arm = Math.floor(Math.random() * LOOK.arms);
      const ang = armAngle(r, t, arm) + (Math.random() - 0.5) * 0.35;
      spawn(r, ang, heightAt(r, at.y) + (Math.random() - 0.5) * 0.8);
    }
  }

  /**
   * Bits torn off something being drawn in, joining the flow where it is.
   * @param {THREE.Vector3} from
   * @param {{x: number, y: number, z: number}} at
   * @param {number} n
   * @returns {void}
   */
  function shed(from, at, n) {
    for (let k = 0; k < n; k++) {
      const dx = from.x - at.x + (Math.random() - 0.5) * 1.5;
      const dz = from.z - at.z + (Math.random() - 0.5) * 1.5;
      spawn(Math.max(hole.horizon, Math.hypot(dx, dz)), Math.atan2(dz, dx), Math.max(0.3, from.y) + Math.random() * 1.5);
    }
  }

  /**
   * Every shard a step further round and in, oriented and stretched along
   * its own direction of travel (dissolve.js's technique).
   * @param {number} dt
   * @param {{x: number, y: number, z: number}|null} at the hole, or null once it has closed
   * @param {number} t
   * @returns {void}
   */
  function step(dt, at, t) {
    void t;
    if (!alive) return;
    let any = false;
    const [v0, v1] = MATTER.infall;
    const [s0, s1] = MATTER.size;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) continue;
      if (!at) {
        // The hole gone: what is still in flight is hidden with it, the
        // same as dissolve.js's fragments on the same event.
        life[i] = 0;
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      life[i] -= dt;
      let r = radius[i];
      const closeness = 1 - Math.min(1, (r - hole.horizon) / (hole.escape - hole.horizon));
      const outside = r > hole.escape;
      // Faster the nearer it is: blown in from out there, a gentle drift at
      // the line, a plunge at the end.
      const dr = (outside ? v0 * Math.pow(hole.escape / r, 1.3) * 2.2 : v0 + (v1 - v0) * closeness * closeness) * dt;
      const spin = spinAt(r);
      angle[i] -= spin * dt + LOOK.twist * (dr / Math.max(r, 0.5));
      r = Math.max(0, r - dr);
      radius[i] = r;
      if (r <= hole.horizon) {
        life[i] = 0;
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      const y = height[i];
      const yy = y + (heightAt(r, at.y) - y) * Math.min(1, dt * 2.5);
      height[i] = yy;
      const a = angle[i];
      p.set(at.x + Math.cos(a) * r, yy, at.z + Math.sin(a) * r);
      // Its own direction of travel right now: round with the spin, and
      // inward by dr -- the same forward-vector dissolve.js's fragments use,
      // so the shard's long axis follows the curve instead of a fixed line.
      const angSpeed = spin;
      fwd.set(Math.sin(a) * angSpeed * r - Math.cos(a) * dr / dt, 0, -Math.cos(a) * angSpeed * r - Math.sin(a) * dr / dt);
      if (fwd.lengthSq() < 1e-6) fwd.set(Math.cos(a), 0, Math.sin(a));
      fwd.normalize();
      q.setFromUnitVectors(Z, fwd);
      const c = closeness;
      const sz = (s0 + (s1 - s0) * seed[i]) * (1 - 0.35 * c);
      const long = 1 + (MATTER.stretch - 1) * c * c;
      s.set(sz / Math.sqrt(long), sz / Math.sqrt(long), sz * long);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
      // Dust out beyond the line; deep purple at it, violet, then white-hot
      // going in -- same palette as before, just carried on a shard now.
      const hot = c * c;
      if (outside) {
        const far = (r - hole.escape) / (hole.influence - hole.escape);
        colour.setRGB(0.42, 0.36, 0.34 + 0.3 * (1 - far)).multiplyScalar(0.3 * (1 - far));
      } else {
        colour.setRGB(0.55 + 0.9 * c + 0.6 * hot, 0.18 + 0.25 * c + 1.1 * hot, 1.2 + 0.8 * c)
          .multiplyScalar(Math.min(1, (1 - c) * 6) * (0.35 + 0.65 * c));
      }
      mesh.setColorAt(i, colour);
      any = true;
    }
    mesh.count = N;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    alive = any;
  }

  /** @returns {void} */
  function clear() {
    life.fill(0);
    for (let i = 0; i < N; i++) mesh.setMatrixAt(i, hidden);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = 0;
    alive = false;
    owed = 0;
  }

  /** @returns {void} */
  function dispose() {
    Sim.three.scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    mesh.dispose();
  }

  return { ambient, shed, step, clear, dispose };
}
