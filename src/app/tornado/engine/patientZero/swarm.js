// @ts-check
import * as THREE from 'three';
import { glowMaterial, REPLICATOR } from './model.js';

/**
 * ===========================================================================
 * SECTION PZ.2 — The nanite swarm
 * ===========================================================================
 * The blocks the Replicator is made of, seen moving (on request, 2026-10-04:
 * "a slick cloning animation"):
 *
 *  - **assemble**: a stream of small chrome blocks with green light in them
 *    pours from a source (the original's chest, an infected person's body,
 *    a clone dissolving somewhere else) and spirals in round the spot where
 *    a clone is building itself, arcing up and tightening as it lands, each
 *    block shrinking into the body as it arrives;
 *  - **burst**: a clone shot down falls apart -- its blocks thrown out,
 *    bouncing on the street, gone;
 *  - **ripple**: a ring of green light running out over the ground, under a
 *    clone finishing itself or a swarm arriving.
 *
 * One InstancedMesh of SWARM.max blocks (one draw call) with every block's
 * motion in fixed typed arrays, and a small pool of ripple rings; nothing is
 * allocated per frame. A block that would not fit is simply not sent.
 */

export const SWARM = {
  max: 900,
  size: 0.075,
  gravity: 14,
  ripples: 10,
  rippleSeconds: 0.7
};

/**
 * @param {THREE.Scene} scene
 * @returns {{
 *   assemble: (fx: number, fy: number, fz: number, spread: number, tx: number, tz: number, n: number, seconds: number, scale?: number) => void,
 *   burst: (x: number, y: number, z: number, n: number, speed: number) => void,
 *   ripple: (x: number, z: number, radius: number, colour?: THREE.Color) => void,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createSwarm(scene) {
  const N = SWARM.max;
  const geo = new THREE.BoxGeometry(SWARM.size, SWARM.size, SWARM.size);
  // Every block lit a little from inside.
  const glow = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < glow.length; i += 3) {
    glow[i] = REPLICATOR.green.r * 0.35;
    glow[i + 1] = REPLICATOR.green.g * 0.35;
    glow[i + 2] = REPLICATOR.green.b * 0.35;
  }
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
  const material = glowMaterial(1.4);
  const mesh = new THREE.InstancedMesh(geo, material, N);
  mesh.name = 'replicator_swarm';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);

  // 0 free, 1 flying in to assemble, 2 thrown out (ballistic).
  const mode = new Uint8Array(N);
  const t = new Float32Array(N);
  const dur = new Float32Array(N);
  const delay = new Float32Array(N);
  const from = new Float32Array(N * 3);
  const to = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const swirl = new Float32Array(N);
  const phase = new Float32Array(N);
  const spin = new Float32Array(N);
  const scale = new Float32Array(N);
  let next = 0;
  let high = 0;
  let alive = 0;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  /** @type {{mesh: THREE.Mesh, material: THREE.MeshBasicMaterial, t: number, radius: number}[]} */
  const ripples = [];
  const ringGeo = new THREE.RingGeometry(0.86, 1, 64);
  ringGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < SWARM.ripples; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: REPLICATOR.green, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, m);
    ring.visible = false;
    ring.frustumCulled = false;
    ring.name = 'replicator_ripple';
    scene.add(ring);
    ripples.push({ mesh: ring, material: m, t: 1, radius: 1 });
  }

  /** @returns {number} a free slot, or -1 when the swarm is full */
  function claim() {
    for (let k = 0; k < N; k++) {
      const i = (next + k) % N;
      if (mode[i] === 0) {
        next = (i + 1) % N;
        if (i >= high) high = i + 1;
        alive++;
        return i;
      }
    }
    return -1;
  }

  /**
   * Blocks pouring from round (fx, fy, fz) into a figure building itself at
   * (tx, tz), over about `seconds`.
   * @param {number} fx @param {number} fy @param {number} fz
   * @param {number} spread how far round the source they start
   * @param {number} tx @param {number} tz
   * @param {number} n
   * @param {number} seconds
   * @param {number} [size] the figure's scale (the original is bigger)
   * @returns {void}
   */
  function assemble(fx, fy, fz, spread, tx, tz, n, seconds, size = 1) {
    for (let k = 0; k < n; k++) {
      const i = claim();
      if (i < 0) return;
      mode[i] = 1;
      t[i] = 0;
      dur[i] = seconds * (0.55 + Math.random() * 0.45);
      delay[i] = Math.random() * seconds * 0.35;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      from[i * 3] = fx + Math.cos(a) * r;
      from[i * 3 + 1] = Math.max(0.05, fy + (Math.random() - 0.5) * spread);
      from[i * 3 + 2] = fz + Math.sin(a) * r;
      // Somewhere in the body: a column the figure's width, feet to crown.
      const b = Math.random() * Math.PI * 2;
      const rb = Math.sqrt(Math.random()) * 0.28 * size;
      to[i * 3] = tx + Math.cos(b) * rb;
      to[i * 3 + 1] = (0.1 + Math.random() * 1.95) * size;
      to[i * 3 + 2] = tz + Math.sin(b) * rb;
      swirl[i] = (1.2 + Math.random() * 2.2) * size;
      phase[i] = Math.random() * Math.PI * 2;
      spin[i] = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 5);
      scale[i] = 0.6 + Math.random() * 1.1;
    }
  }

  /**
   * A figure falling apart at (x, y, z): blocks thrown out and bouncing.
   * @param {number} x @param {number} y @param {number} z
   * @param {number} n
   * @param {number} speed
   * @returns {void}
   */
  function burst(x, y, z, n, speed) {
    for (let k = 0; k < n; k++) {
      const i = claim();
      if (i < 0) return;
      mode[i] = 2;
      t[i] = 0;
      dur[i] = 1.2 + Math.random() * 1.1;
      delay[i] = 0;
      from[i * 3] = x + (Math.random() - 0.5) * 0.5;
      from[i * 3 + 1] = Math.max(0.05, y + (Math.random() - 0.5) * 1.6);
      from[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5;
      const a = Math.random() * Math.PI * 2;
      const h = Math.random();
      vel[i * 3] = Math.cos(a) * speed * (0.3 + Math.random() * 0.7);
      vel[i * 3 + 1] = speed * (0.3 + h * 0.8);
      vel[i * 3 + 2] = Math.sin(a) * speed * (0.3 + Math.random() * 0.7);
      phase[i] = Math.random() * Math.PI * 2;
      spin[i] = (Math.random() - 0.5) * 20;
      scale[i] = 0.7 + Math.random() * 1.3;
    }
  }

  /**
   * @param {number} x @param {number} z
   * @param {number} radius
   * @param {THREE.Color} [colour]
   * @returns {void}
   */
  function ripple(x, z, radius, colour = REPLICATOR.green) {
    let best = ripples[0];
    for (const r of ripples) if (r.t > best.t) best = r;
    best.t = 0;
    best.radius = radius;
    best.material.color.copy(colour);
    best.mesh.position.set(x, 0.06, z);
    best.mesh.visible = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    for (const r of ripples) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / SWARM.rippleSeconds);
      const s = 0.2 + r.radius * (1 - (1 - r.t) * (1 - r.t));
      r.mesh.scale.set(s, 1, s);
      r.material.opacity = 0.9 * (1 - r.t);
      if (r.t >= 1) r.mesh.visible = false;
    }
    if (alive === 0 && mesh.count === 0) return;
    let top = 0;
    for (let i = 0; i < high; i++) {
      if (mode[i] === 0) continue;
      if (delay[i] > 0) {
        delay[i] -= dt;
        mesh.setMatrixAt(i, zero);
        top = i + 1;
        continue;
      }
      t[i] += dt;
      const u = t[i] / dur[i];
      if (u >= 1) {
        mode[i] = 0;
        alive--;
        mesh.setMatrixAt(i, zero);
        continue;
      }
      const j = i * 3;
      let size = scale[i];
      if (mode[i] === 1) {
        // Ease in, spiralling round the landing point and tightening.
        const e = u * u * (3 - 2 * u);
        const arc = Math.sin(Math.PI * e);
        const ang = phase[i] + spin[i] * e;
        const r = swirl[i] * arc * (1 - e * 0.5);
        pos.set(
          from[j] + (to[j] - from[j]) * e + Math.cos(ang) * r,
          from[j + 1] + (to[j + 1] - from[j + 1]) * e + arc * 1.4,
          from[j + 2] + (to[j + 2] - from[j + 2]) * e + Math.sin(ang) * r
        );
        // Shrinking into the body as it arrives.
        if (u > 0.8) size *= (1 - u) / 0.2;
        euler.set(ang * 2, ang, phase[i]);
      } else {
        vel[j + 1] -= SWARM.gravity * dt;
        from[j] += vel[j] * dt;
        from[j + 1] += vel[j + 1] * dt;
        from[j + 2] += vel[j + 2] * dt;
        if (from[j + 1] < SWARM.size * 0.5) {
          from[j + 1] = SWARM.size * 0.5;
          vel[j + 1] *= -0.35;
          vel[j] *= 0.6;
          vel[j + 2] *= 0.6;
        }
        pos.set(from[j], from[j + 1], from[j + 2]);
        if (u > 0.7) size *= (1 - u) / 0.3;
        phase[i] += spin[i] * dt;
        euler.set(phase[i], phase[i] * 0.7, 0);
      }
      q.setFromEuler(euler);
      m4.compose(pos, q, sc.set(size, size, size));
      mesh.setMatrixAt(i, m4);
      top = i + 1;
    }
    high = top;
    mesh.count = top;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} every block and ripple gone */
  function clear() {
    mode.fill(0);
    alive = 0;
    high = 0;
    mesh.count = 0;
    for (const r of ripples) {
      r.t = 1;
      r.mesh.visible = false;
    }
  }

  /** @returns {void} */
  function dispose() {
    clear();
    scene.remove(mesh);
    mesh.dispose();
    geo.dispose();
    material.dispose();
    for (const r of ripples) {
      scene.remove(r.mesh);
      r.material.dispose();
    }
    ringGeo.dispose();
  }

  return { assemble, burst, ripple, update, clear, dispose };
}
