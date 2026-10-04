// @ts-check
import * as THREE from 'three';
import { glowMaterial, REPLICATOR } from './model.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { createSoftDotTexture } from '../../utils/textures.js';

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
 *    clone finishing itself or a swarm arriving;
 *  - **sparks**: a hit that does not bring a figure down (patientZero.js
 *    wounded) -- a spray of hot green sparks off it, away from the shot,
 *    with a few loose blocks knocked off (burst); one pooled Points within
 *    the shared particle cap;
 *  - **stain**: where a clone was built, a scorch of toxic green on the
 *    street -- a glowing blot speckled with stray blocks, flaring as it is
 *    left, burning steady for SWARM.stainHold seconds, then fading over
 *    SWARM.stainFade. The town fills with them as the swarm grows.
 *
 * One InstancedMesh of SWARM.max blocks (one draw call) with every block's
 * motion in fixed typed arrays, a small pool of ripple rings, and one
 * InstancedMesh of SWARM.stains ground stains (additive, faded through its
 * instance colours; the oldest is reused); nothing is allocated per frame. A block that would not fit is simply not sent.
 */

export const SWARM = {
  max: 900,
  size: 0.075,
  gravity: 14,
  ripples: 10,
  rippleSeconds: 0.7,
  stains: 60,
  stainSize: 2.4,       // metres across, for a clone
  stainHold: 10,        // seconds at full glow
  stainFade: 15,        // seconds fading out
  stainFlash: 0.4,      // seconds of the bright flash when it is left
  sparks: 240,          // particles in the spark pool
  sparkGravity: 12
};

/**
 * The stain's look, drawn once: a blot of green fading to its edge, ragged,
 * with small lit squares in it (stray blocks) and dark cracks.
 * @returns {THREE.CanvasTexture}
 */
function stainTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  // Seeded, so every run draws the same stain.
  let state = 7;
  const rand = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  // A ragged blot: overlapping soft circles.
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 22;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const grad = g.createRadialGradient(x, y, 0, x, y, 30 + rand() * 18);
    grad.addColorStop(0, 'rgba(90,255,120,0.55)');
    grad.addColorStop(0.6, 'rgba(40,200,70,0.25)');
    grad.addColorStop(1, 'rgba(0,80,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  // Splash streaks out from the middle.
  g.strokeStyle = 'rgba(70,240,100,0.35)';
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2;
    g.lineWidth = 1 + rand() * 2.5;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
    g.lineTo(64 + Math.cos(a) * (36 + rand() * 24), 64 + Math.sin(a) * (36 + rand() * 24));
    g.stroke();
  }
  // Stray blocks, lit.
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 40;
    const s = 2 + rand() * 4;
    g.fillStyle = rand() < 0.3 ? 'rgba(220,255,200,0.9)' : 'rgba(110,255,140,0.75)';
    g.fillRect(64 + Math.cos(a) * r - s / 2, 64 + Math.sin(a) * r - s / 2, s, s);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {THREE.Scene} scene
 * @param {Object} ctx the engine context (the particle cap, the camera)
 * @returns {{
 *   assemble: (fx: number, fy: number, fz: number, spread: number, tx: number, tz: number, n: number, seconds: number, scale?: number) => void,
 *   burst: (x: number, y: number, z: number, n: number, speed: number) => void,
 *   ripple: (x: number, z: number, radius: number, colour?: THREE.Color) => void,
 *   stain: (x: number, z: number, size?: number) => void,
 *   sparks: (x: number, y: number, z: number, dx: number, dz: number, n: number) => void,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createSwarm(scene, ctx) {
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

  // The stains on the ground.
  const stainTex = stainTexture();
  const stainGeo = new THREE.PlaneGeometry(1, 1);
  stainGeo.rotateX(-Math.PI / 2);
  const stainMat = new THREE.MeshBasicMaterial({
    map: stainTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const stains = new THREE.InstancedMesh(stainGeo, stainMat, SWARM.stains);
  stains.name = 'replicator_stains';
  stains.frustumCulled = false;
  stains.renderOrder = -1;
  stains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const black = new THREE.Color(0, 0, 0);
  for (let i = 0; i < SWARM.stains; i++) {
    stains.setMatrixAt(i, zero);
    stains.setColorAt(i, black);
  }
  stains.count = 0;
  scene.add(stains);
  const stainAge = new Float32Array(SWARM.stains).fill(-1);
  let stainNext = 0;
  let stainsLive = 0;
  const stainColour = new THREE.Color();

  // The sparks: hot green points, additive, one pool.
  const sparkPool = createParticlePool(scene, SWARM.sparks, createSoftDotTexture(), THREE.AdditiveBlending, 'replicator_sparks');
  ctx.systems.caps.trackPool(sparkPool);
  let sparksAlive = false;

  /**
   * A spray of sparks from (x, y, z), thrown mostly along (dx, dz) -- away
   * from the shot -- and up.
   * @param {number} x @param {number} y @param {number} z
   * @param {number} dx @param {number} dz unit-ish direction, or 0, 0 for all round
   * @param {number} n
   * @returns {void}
   */
  function sparks(x, y, z, dx, dz, n) {
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    const pool = sparkPool;
    for (let k = 0; k < count; k++) {
      const i = pool.next;
      pool.next = (pool.next + 1) % pool.life.length;
      const life = 0.22 + Math.random() * 0.35;
      pool.life[i] = life;
      pool.maxLife[i] = life;
      pool.seed[i] = Math.random();
      const v = i * 3;
      pool.positions[v] = x;
      pool.positions[v + 1] = y;
      pool.positions[v + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 10;
      const spread = 0.9;
      pool.velocities[v] = (dx + Math.cos(a) * spread) * speed;
      pool.velocities[v + 1] = (0.3 + Math.random() * 0.9) * speed * 0.6;
      pool.velocities[v + 2] = (dz + Math.sin(a) * spread) * speed;
    }
    if (count > 0) sparksAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSparks(dt) {
    if (!sparksAlive) return;
    const pool = sparkPool;
    pool.points.material.uniforms.uScale.value = pointScaleFor(ctx.Sim.three.renderer, ctx.Sim.three.camera);
    let any = false;
    for (let i = 0; i < pool.life.length; i++) {
      if (pool.life[i] <= 0) {
        if (pool.sizes[i] !== 0) {
          pool.colours[i * 4 + 3] = 0;
          pool.sizes[i] = 0;
        }
        continue;
      }
      any = true;
      pool.life[i] -= dt;
      const t = 1 - Math.max(0, pool.life[i]) / pool.maxLife[i];
      const v = i * 3;
      pool.velocities[v + 1] -= SWARM.sparkGravity * dt;
      pool.positions[v] += pool.velocities[v] * dt;
      pool.positions[v + 1] = Math.max(0.05, pool.positions[v + 1] + pool.velocities[v + 1] * dt);
      pool.positions[v + 2] += pool.velocities[v + 2] * dt;
      // White-hot, then green, then out.
      const c = i * 4;
      const hot = Math.max(0, 1 - t * 3);
      pool.colours[c] = 0.35 + 0.65 * hot;
      pool.colours[c + 1] = 1;
      pool.colours[c + 2] = 0.35 + 0.5 * hot;
      pool.colours[c + 3] = 1 - t;
      pool.sizes[i] = (0.16 + pool.seed[i] * 0.18) * (1 - t * 0.5);
    }
    markPoolDirty(pool);
    sparksAlive = any;
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
   * A stain left where a clone was built (the oldest reused when all are down).
   * @param {number} x @param {number} z
   * @param {number} [size] the figure's scale
   * @returns {void}
   */
  function stain(x, z, size = 1) {
    const i = stainNext;
    stainNext = (stainNext + 1) % SWARM.stains;
    if (stainAge[i] < 0) stainsLive++;
    stainAge[i] = 0;
    const across = SWARM.stainSize * size * (0.85 + Math.random() * 0.35);
    q.setFromAxisAngle(sc.set(0, 1, 0), Math.random() * Math.PI * 2);
    m4.compose(pos.set(x, 0.05, z), q, sc.set(across, 1, across));
    stains.setMatrixAt(i, m4);
    stains.count = Math.max(stains.count, i + 1);
    stains.instanceMatrix.needsUpdate = true;
  }

  /**
   * The stains' glow, a frame: the flash, the steady burn, the fade.
   * @param {number} dt
   * @returns {void}
   */
  function updateStains(dt) {
    if (stainsLive === 0) return;
    const total = SWARM.stainHold + SWARM.stainFade;
    for (let i = 0; i < SWARM.stains; i++) {
      if (stainAge[i] < 0) continue;
      stainAge[i] += dt;
      const age = stainAge[i];
      if (age >= total) {
        stainAge[i] = -1;
        stainsLive--;
        stains.setColorAt(i, black);
        stains.setMatrixAt(i, zero);
        stains.instanceMatrix.needsUpdate = true;
        continue;
      }
      let level = age < SWARM.stainFlash ? 1 + 1.5 * (1 - age / SWARM.stainFlash)
        : age < SWARM.stainHold ? 1 : 1 - (age - SWARM.stainHold) / SWARM.stainFade;
      // A slow uneven smoulder.
      level *= 0.85 + 0.15 * Math.sin(age * 2.3 + i * 1.7);
      stains.setColorAt(i, stainColour.setRGB(level, level, level));
    }
    if (stains.instanceColor) stains.instanceColor.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    updateStains(dt);
    updateSparks(dt);
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

  /** @returns {void} every block, ripple and stain gone */
  function clear() {
    stainAge.fill(-1);
    stainsLive = 0;
    stainNext = 0;
    for (let i = 0; i < SWARM.stains; i++) {
      stains.setMatrixAt(i, zero);
      stains.setColorAt(i, black);
    }
    stains.count = 0;
    stains.instanceMatrix.needsUpdate = true;
    if (stains.instanceColor) stains.instanceColor.needsUpdate = true;
    sparkPool.life.fill(0);
    sparkPool.sizes.fill(0);
    for (let i = 3; i < sparkPool.colours.length; i += 4) sparkPool.colours[i] = 0;
    markPoolDirty(sparkPool);
    sparksAlive = false;
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
    scene.remove(stains);
    stains.dispose();
    stainGeo.dispose();
    stainMat.dispose();
    stainTex.dispose();
    disposeParticlePool(scene, sparkPool);
  }

  return { assemble, burst, ripple, stain, sparks, update, clear, dispose };
}
