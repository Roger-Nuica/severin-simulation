// @ts-check
import * as THREE from 'three';
import { KATANA_GOO as CFG, KATANA_PIECES } from './config.js';
import { createSoftDotTexture } from '../../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../../particlePool.js';

/**
 * ===========================================================================
 * SECTION KT.8 -- Alien blood: goo burst, drips and splatter decals
 * ===========================================================================
 * What a cut alien leaves in the air and on the ground, all alien green.
 *
 *  - **Burst.** One shot of droplets along the cut line, sprayed out to both
 *    sides of the cut plane, so a longer cut makes a bigger burst (up to the
 *    per-cut cap). Droplets fall under gravity and fade; one that reaches
 *    the ground may leave a decal.
 *  - **Drips.** A few sources ride the two halves' cut faces (the same push,
 *    pop and gravity as the pieces, pieces.js) and shed a drip every little
 *    while for a second or two, so the halves bleed as they fall and lie.
 *  - **Decals.** A fixed ring of instanced quads on the ground that fade
 *    and are recycled oldest first (the idiom of chase/skidMarks.js): one
 *    draw call whatever the number, `polygonOffset` and no depth write so
 *    they never fight the ground.
 *
 * The droplets and drips are one shared particle pool (particlePool.js),
 * made once for the simulation (caps.trackPool has no untrack) and tracked
 * against the 10,000-particle budget (R-048): every emission is clamped to
 * `caps.particleRoom()`, the pool is a fixed size, and the typed arrays are
 * reused. `clear` empties everything between runs; `dispose` frees it all and
 * is for the end of the simulation. State lives in this closure (R-047).
 */

/** Seed marks in the pool: a burst droplet, and a drip. */
const SEED_DROPLET = 0;
const SEED_DRIP = 1;

/**
 * A blotchy splat as a texture: a few overlapping blobs, alpha only.
 * @returns {THREE.CanvasTexture}
 */
function createSplatTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    /** @type {[number, number, number][]} x, y, radius */
    const blobs = [[32, 32, 17], [20, 28, 9], [43, 24, 8], [44, 42, 10], [24, 44, 8], [32, 12, 4], [54, 34, 4], [10, 40, 3]];
    for (const [x, y, r] of blobs) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * @typedef {Object} KatanaGoo
 * @property {(from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3) => number} burst
 *   a burst along the cut line from `from` to `to` (world metres), the plane's unit normal given;
 *   how many particles were emitted
 * @property {(dt: number) => void} update world seconds
 * @property {() => void} clear every particle, drip and decal gone (between runs)
 * @property {() => number} liveParticles particles alive now
 * @property {() => number} liveDecals decals showing now
 * @property {() => void} dispose frees everything (the end of the simulation)
 */

/**
 * @param {Object} ctx
 * @returns {KatanaGoo}
 */
export function createKatanaGoo(ctx) {
  const { Sim } = ctx;
  const scene = Sim.three.scene;
  const N = CFG.poolSize;

  // ---- The particle pool, made once and tracked against the shared budget.
  const pool = createParticlePool(scene, N, createSoftDotTexture(), THREE.NormalBlending, 'katana_goo');
  ctx.systems.caps.trackPool(pool);
  let particlesLive = 0;
  let poolDirty = false;

  // ---- The drip sources: fixed slots, ring-recycled.
  const S = CFG.dripSlots;
  const sx = new Float32Array(S);
  const sy = new Float32Array(S);
  const sz = new Float32Array(S);
  const svx = new Float32Array(S);
  const svy = new Float32Array(S);
  const svz = new Float32Array(S);
  const sLeft = new Float32Array(S);
  const sOwed = new Float32Array(S);
  let nextSource = 0;
  let sourcesLive = 0;

  // ---- The decals: one instanced mesh, a ring of fixed capacity.
  const D = CFG.decalCapacity;
  const decalGeometry = new THREE.PlaneGeometry(1, 1);
  decalGeometry.rotateX(-Math.PI / 2);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(D), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  decalGeometry.setAttribute('aFade', fade);
  const decalMap = createSplatTexture();
  const decalMaterial = new THREE.MeshBasicMaterial({
    color: CFG.decalColour, map: decalMap, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
  // Each decal fades on its own: a per-instance alpha, as the one material
  // opacity would fade them all together.
  decalMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute float aFade;\nvarying float vFade;\n#include <common>')
      .replace('#include <begin_vertex>', 'vFade = aFade;\n#include <begin_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'varying float vFade;\n#include <common>')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n\tgl_FragColor.a *= vFade;');
  };
  decalMaterial.customProgramCacheKey = () => 'katanaGooDecal';
  const decals = new THREE.InstancedMesh(decalGeometry, decalMaterial, D);
  decals.name = 'katana_goo_decals';
  decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  decals.frustumCulled = false;
  decals.count = 0;
  scene.add(decals);
  /** Seconds each decal has lived; negative when its slot is free. */
  const decalAge = new Float32Array(D).fill(-1);
  let nextDecal = 0;
  let decalsUsed = 0;
  let decalsLive = 0;

  const dummy = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const line = new THREE.Vector3();
  const along = new THREE.Vector3();
  let stampsThisFrame = 0;

  /**
   * @param {number[]} range
   * @returns {number} a random number in the range
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Leaves a decal on the ground at x, z, recycling the oldest once the ring is full.
   * @param {number} x
   * @param {number} z
   * @param {number} size width in metres
   * @returns {void}
   */
  function stamp(x, z, size) {
    const i = nextDecal;
    nextDecal = (i + 1) % D;
    if (decalAge[i] < 0) decalsLive++;
    decalAge[i] = 0;
    decalsUsed = Math.max(decalsUsed, i + 1);
    dummy.position.set(x, CFG.decalY, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    dummy.scale.set(size, 1, size * (0.7 + Math.random() * 0.6));
    dummy.updateMatrix();
    decals.setMatrixAt(i, dummy.matrix);
    fade.setX(i, 1);
    decals.count = decalsUsed;
    decals.instanceMatrix.needsUpdate = true;
    fade.needsUpdate = true;
  }

  /**
   * A free slot in the pool, scanning on from the cursor.
   * @returns {number} -1 when the pool is full
   */
  function claim() {
    for (let k = 0; k < N; k++) {
      const i = (pool.next + k) % N;
      if (pool.life[i] <= 0) {
        pool.next = (i + 1) % N;
        return i;
      }
    }
    return -1;
  }

  /**
   * Starts one particle (the caller has checked the room).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} vx
   * @param {number} vy
   * @param {number} vz
   * @param {number} size
   * @param {number} life
   * @param {number} kind SEED_DROPLET or SEED_DRIP
   * @returns {boolean} false when the pool had no free slot
   */
  function emit(x, y, z, vx, vy, vz, size, life, kind) {
    const i = claim();
    if (i < 0) return false;
    const k = Math.random();
    const b = CFG.colourBright;
    const d = CFG.colourDark;
    const p = i * 3;
    pool.positions[p] = x;
    pool.positions[p + 1] = y;
    pool.positions[p + 2] = z;
    pool.velocities[p] = vx;
    pool.velocities[p + 1] = vy;
    pool.velocities[p + 2] = vz;
    const c = i * 4;
    pool.colours[c] = d[0] + (b[0] - d[0]) * k;
    pool.colours[c + 1] = d[1] + (b[1] - d[1]) * k;
    pool.colours[c + 2] = d[2] + (b[2] - d[2]) * k;
    pool.colours[c + 3] = CFG.alpha;
    pool.sizes[i] = size;
    pool.life[i] = life;
    pool.maxLife[i] = life;
    pool.seed[i] = kind;
    particlesLive++;
    poolDirty = true;
    return true;
  }

  /**
   * Ends particle i: free, and drawn at no alpha and no size.
   * @param {number} i
   * @returns {void}
   */
  function kill(i) {
    pool.life[i] = 0;
    pool.colours[i * 4 + 3] = 0;
    pool.sizes[i] = 0;
    particlesLive--;
  }

  /**
   * Sets a drip source going on one half's cut face.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {THREE.Vector3} normal the cut plane's unit normal
   * @param {number} sign which half: 1 or -1
   * @returns {void}
   */
  function startSource(x, y, z, normal, sign) {
    const i = nextSource;
    nextSource = (i + 1) % S;
    // Follows the half it bleeds from: the pieces' own push and pop (pieces.js).
    let vy = sign * normal.y * KATANA_PIECES.pushSpeed;
    if (vy < 0) vy *= 0.25;
    sx[i] = x;
    sy[i] = y;
    sz[i] = z;
    svx[i] = sign * normal.x * KATANA_PIECES.pushSpeed;
    svy[i] = vy + KATANA_PIECES.popSpeed;
    svz[i] = sign * normal.z * KATANA_PIECES.pushSpeed;
    if (sLeft[i] <= 0) sourcesLive++;
    sLeft[i] = between(CFG.dripLife);
    sOwed[i] = Math.random() * CFG.dripEvery;
  }

  /**
   * A burst along the cut line, drip sources on both halves, and a first
   * decal under the middle of the line.
   * @param {THREE.Vector3} from one end of the cut line, world metres
   * @param {THREE.Vector3} to the other end
   * @param {THREE.Vector3} normal the cut plane's unit normal
   * @returns {number} how many particles were emitted
   */
  function burst(from, to, normal) {
    const length = from.distanceTo(to);
    const wanted = Math.min(CFG.burstMax, Math.max(CFG.burstMin, Math.round(length * CFG.perMetre)));
    // Never past what the shared budget has left (R-048).
    const room = ctx.systems.caps.particleRoom();
    const n = Math.min(wanted, room);
    let made = 0;
    for (let k = 0; k < n; k++) {
      line.lerpVectors(from, to, Math.random());
      // Out to one side of the plane or the other, a little along the line, and up.
      const side = Math.random() < 0.5 ? 1 : -1;
      const speed = between(CFG.spray) * side;
      along.subVectors(to, from).multiplyScalar((Math.random() - 0.5) * 0.8);
      const ok = emit(
        line.x, line.y, line.z,
        normal.x * speed + along.x + (Math.random() - 0.5) * 0.8,
        normal.y * speed + between(CFG.lift),
        normal.z * speed + along.z + (Math.random() - 0.5) * 0.8,
        between(CFG.size), between(CFG.life), SEED_DROPLET
      );
      if (!ok) break;
      made++;
    }
    // Drips ride the halves, only while the budget has room for them.
    if (room > made) {
      const per = Math.floor(CFG.dripSources / 2);
      for (let k = 0; k < per; k++) {
        line.lerpVectors(from, to, (k + 0.5) / per);
        startSource(line.x, line.y, line.z, normal, 1);
        startSource(line.x, line.y, line.z, normal, -1);
      }
    }
    // One decal under the middle of the line so even a short cut leaves a mark.
    line.lerpVectors(from, to, 0.5);
    stamp(line.x, line.z, between(CFG.decalSize));
    return made;
  }

  /**
   * The drip sources fall and shed drips.
   * @param {number} dt
   * @returns {void}
   */
  function stepSources(dt) {
    const rest = KATANA_PIECES.restHeight;
    for (let i = 0; i < S; i++) {
      if (sLeft[i] <= 0) continue;
      sLeft[i] -= dt;
      if (sLeft[i] <= 0) { sourcesLive--; continue; }
      svy[i] -= KATANA_PIECES.gravity * dt;
      sx[i] += svx[i] * dt;
      sy[i] += svy[i] * dt;
      sz[i] += svz[i] * dt;
      if (sy[i] < rest) {
        sy[i] = rest;
        svy[i] = 0;
        const drag = Math.max(0, 1 - KATANA_PIECES.groundDrag * dt);
        svx[i] *= drag;
        svz[i] *= drag;
      }
      sOwed[i] += dt;
      while (sOwed[i] >= CFG.dripEvery) {
        sOwed[i] -= CFG.dripEvery;
        if (ctx.systems.caps.particleRoom() <= 0) { sOwed[i] = 0; break; }
        if (!emit(sx[i], sy[i], sz[i], svx[i] * 0.2, 0, svz[i] * 0.2, CFG.dripSize, 0.9, SEED_DRIP)) break;
      }
    }
  }

  /**
   * The droplets and drips fall, fade, and leave decals where they land.
   * @param {number} dt
   * @returns {void}
   */
  function stepParticles(dt) {
    pool.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    for (let i = 0; i < N; i++) {
      if (pool.life[i] <= 0) continue;
      pool.life[i] -= dt;
      if (pool.life[i] <= 0) { kill(i); continue; }
      const v = i * 3;
      pool.velocities[v + 1] -= CFG.gravity * dt;
      pool.positions[v] += pool.velocities[v] * dt;
      pool.positions[v + 1] += pool.velocities[v + 1] * dt;
      pool.positions[v + 2] += pool.velocities[v + 2] * dt;
      if (pool.positions[v + 1] <= CFG.groundY) {
        const chance = pool.seed[i] === SEED_DRIP ? CFG.dripDecalChance : CFG.decalChance;
        if (stampsThisFrame < CFG.decalsPerFrame && Math.random() < chance) {
          stampsThisFrame++;
          const size = pool.seed[i] === SEED_DRIP ? CFG.decalSize[0] : between(CFG.decalSize);
          stamp(pool.positions[v], pool.positions[v + 2], size);
        }
        kill(i);
        continue;
      }
      const left = pool.life[i] / (pool.maxLife[i] * CFG.fadeShare);
      pool.colours[i * 4 + 3] = CFG.alpha * Math.min(1, left);
    }
    poolDirty = true;
  }

  /**
   * The decals age and fade, then free their slot.
   * @param {number} dt
   * @returns {void}
   */
  function stepDecals(dt) {
    for (let i = 0; i < D; i++) {
      if (decalAge[i] < 0) continue;
      decalAge[i] += dt;
      const left = CFG.decalLife - decalAge[i];
      if (left <= 0) {
        decalAge[i] = -1;
        decalsLive--;
        decals.setMatrixAt(i, hidden);
        decals.instanceMatrix.needsUpdate = true;
        fade.setX(i, 0);
      } else {
        fade.setX(i, Math.min(1, left / CFG.decalFade));
      }
    }
    fade.needsUpdate = true;
  }

  /**
   * @param {number} dt world seconds
   * @returns {void}
   */
  function update(dt) {
    if (dt <= 0) return;
    stampsThisFrame = 0;
    if (sourcesLive > 0) stepSources(dt);
    if (particlesLive > 0) stepParticles(dt);
    if (decalsLive > 0) stepDecals(dt);
    if (poolDirty) {
      markPoolDirty(pool);
      poolDirty = particlesLive > 0;
    }
  }

  /** @returns {void} */
  function clear() {
    pool.life.fill(0);
    pool.colours.fill(0);
    pool.sizes.fill(0);
    pool.next = 0;
    markPoolDirty(pool);
    particlesLive = 0;
    poolDirty = false;
    sLeft.fill(0);
    sourcesLive = 0;
    nextSource = 0;
    decalAge.fill(-1);
    fade.array.fill(0);
    fade.needsUpdate = true;
    decals.count = 0;
    decalsUsed = 0;
    decalsLive = 0;
    nextDecal = 0;
    stampsThisFrame = 0;
  }

  /** @returns {void} */
  function dispose() {
    clear();
    disposeParticlePool(scene, pool);
    scene.remove(decals);
    decalGeometry.dispose();
    decalMaterial.dispose();
    decalMap.dispose();
    decals.dispose();
  }

  return { burst, update, clear, liveParticles: () => particlesLive, liveDecals: () => decalsLive, dispose };
}
