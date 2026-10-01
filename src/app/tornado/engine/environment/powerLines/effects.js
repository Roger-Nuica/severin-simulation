import * as THREE from 'three';
import { pointScaleFor, markPoolDirty } from '../../particlePool.js';
import { WINDOW_LIT_COLOUR } from '../buildings.js';
import { WIRE_COLOUR, BOLT_MAX, BOLT_LIFE, BOLT_LEVELS, BOLT_ROUGHNESS, BOLT_POINTS, BOLT_WIDTH, BOLT_REGEN_FRAMES, BOLT_CORE, BOLT_GLOW, FLASH_COLOUR, FLASH_PRIORITY, WINDOW_ARC_COLOUR, SPARK_MAX, SPARK_SIZE, SPARK_HOT, SPARK_COOL, WIRE_LIVE_COLOUR, WIRE_FLASH_TIME, BOLT_VERTEX, BOLT_FRAGMENT, between, lightningPath } from './config.js';
/** @typedef {import('./config.js').PowerNode} PowerNode */
/** @typedef {import('./config.js').Bolt} Bolt */

/**
 * ===========================================================================
 * SECTION PL.3 — Arcs, flashes and sparks
 * ===========================================================================
 * What a fault looks like: the bolts, the flashes on the wires and windows,
 * the sparks.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see powerLines.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createPowerEffects(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Builds the fixed pool of bolt meshes: one quad strip each, BOLT_POINTS
   * pairs of vertices whose positions are rewritten while the bolt is live.
   * @returns {void}
   */
  function createBolts() {
    const uvs = new Float32Array(BOLT_POINTS * 4);
    /** @type {number[]} */
    const indices = [];
    for (let i = 0; i < BOLT_POINTS; i++) {
      uvs.set([0, i / (BOLT_POINTS - 1), 1, i / (BOLT_POINTS - 1)], i * 4);
      if (i < BOLT_POINTS - 1) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    for (let n = 0; n < BOLT_MAX; n++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 6), 3)
        .setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uCore: { value: BOLT_CORE },
          uGlow: { value: BOLT_GLOW },
          uOpacity: { value: 0 }
        },
        vertexShader: BOLT_VERTEX,
        fragmentShader: BOLT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `powerLines_bolt_${n}`;
      // Rewritten wherever the arc happens to be; bounds would be stale.
      mesh.frustumCulled = false;
      mesh.visible = false;
      Sim.three.scene.add(mesh);
      S.bolts.push({ mesh, material, path: [], a: new THREE.Vector3(), b: new THREE.Vector3(), life: 0, regen: 0 });
    }
  }

  /**
   * Starts a bolt between two nodes in a free slot, or the oldest one.
   * @param {PowerNode} from
   * @param {PowerNode} to
   * @returns {void}
   */
  function spawnBolt(from, to) {
    const bolt = S.bolts.find(b => b.life <= 0) || S.bolts.reduce((a, b) => (b.life < a.life ? b : a));
    bolt.a.copy(from.position);
    bolt.b.copy(to.position);
    bolt.life = between(BOLT_LIFE);
    bolt.regen = 0;
    bolt.mesh.visible = true;
    // Written now rather than on the next update, so its first frame on
    // screen is not whatever this slot last drew.
    updateBolt(bolt, 0);
  }

  /**
   * Regenerates a live bolt's jagged path every few frames, and rewrites its
   * strip every frame so it keeps facing the camera: each point is pushed
   * out either side along tangent x (camera - point), the usual billboarded
   * ribbon, narrowing towards the ends.
   * @param {Bolt} bolt
   * @param {number} dt
   * @returns {void}
   */
  function updateBolt(bolt, dt) {
    bolt.life -= dt;
    if (bolt.life <= 0) {
      bolt.mesh.visible = false;
      return;
    }
    if (--bolt.regen <= 0) {
      bolt.path = lightningPath(bolt.a, bolt.b, BOLT_LEVELS, BOLT_ROUGHNESS);
      bolt.regen = Math.round(between(BOLT_REGEN_FRAMES));
    }
    const camera = Sim.three.camera.position;
    const pos = bolt.mesh.geometry.attributes.position.array;
    const path = bolt.path;
    const last = path.length - 1;
    path.forEach((p, i) => {
      S.tangent.subVectors(path[Math.min(i + 1, last)], path[Math.max(i - 1, 0)]);
      S.toCamera.subVectors(camera, p);
      const taper = 0.45 + 0.55 * Math.sin(Math.PI * i / last);
      S.side.crossVectors(S.tangent, S.toCamera).normalize().multiplyScalar(BOLT_WIDTH * 0.5 * taper);
      pos.set([p.x + S.side.x, p.y + S.side.y, p.z + S.side.z, p.x - S.side.x, p.y - S.side.y, p.z - S.side.z], i * 6);
    });
    bolt.mesh.geometry.attributes.position.needsUpdate = true;
    bolt.material.uniforms.uOpacity.value = (0.55 + 0.45 * Math.random()) * Math.min(1, bolt.life / 0.05);
  }

  /**
   * Ages the light flashes and asks the shared light budget for each one,
   * above the lava vents' priority -- they only last a tenth of a second.
   * @param {number} dt
   * @returns {void}
   */
  function updateFlashes(dt) {
    S.flashes = S.flashes.filter(f => (f.life -= dt) > 0);
    const { requestLight } = ctx.systems.lightPool;
    for (const f of S.flashes) {
      requestLight({
        x: f.x, y: f.y, z: f.z,
        colour: FLASH_COLOUR,
        intensity: f.intensity * (f.life / f.maxLife) * (0.7 + 0.3 * Math.random()),
        distance: f.distance,
        priority: FLASH_PRIORITY
      });
    }
  }

  /**
   * Strobes the windows of buildings the arc has reached, then puts them
   * back to their lit colour. Only panes past darkCount are touched, so a
   * pane damage.js has blacked out in the meantime stays dark.
   * @param {number} dt
   * @returns {void}
   */
  function updateFlickers(dt) {
    for (const f of S.flickers) {
      f.timer -= dt;
      const { mesh, totalCount, darkCount } = f.windows;
      const on = f.timer > 0 && Math.random() < 0.55;
      for (let i = darkCount; i < totalCount; i++) mesh.setColorAt(i, on ? WINDOW_ARC_COLOUR : WINDOW_LIT_COLOUR);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    S.flickers = S.flickers.filter(f => f.timer > 0);
  }

  /**
   * Fades live wires back to their resting colour.
   * @param {number} dt
   * @returns {void}
   */
  function updateWireFlashes(dt) {
    /** @type {Set<THREE.LineSegments>} */
    const touched = new Set();
    for (const span of [...S.spans, ...S.dropSpans]) {
      if (span.flash <= 0) continue;
      span.flash -= dt;
      touched.add(span.lines);
      const t = Math.max(0, span.flash / WIRE_FLASH_TIME);
      S.scratch.setHex(WIRE_COLOUR).lerp(WIRE_LIVE_COLOUR, t);
      const colours = span.lines.geometry.attributes.color.array;
      for (let v = span.base; v < span.base + span.count; v++) {
        colours[v * 3] = S.scratch.r;
        colours[v * 3 + 1] = S.scratch.g;
        colours[v * 3 + 2] = S.scratch.b;
      }
    }
    for (const lines of touched) lines.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSparks(dt) {
    S.sparksAlive = 0;
    for (let i = 0; i < SPARK_MAX; i++) {
      if (S.sparks.life[i] <= 0) continue;
      S.sparks.life[i] -= dt;
      if (S.sparks.life[i] <= 0) {
        S.sparks.colours[i * 4 + 3] = 0;
        S.sparks.sizes[i] = 0;
        continue;
      }
      S.sparksAlive++;
      S.sparks.velocities[i * 3 + 1] -= 18 * dt;
      for (let k = 0; k < 3; k++) S.sparks.positions[i * 3 + k] += S.sparks.velocities[i * 3 + k] * dt;
      const u = 1 - S.sparks.life[i] / S.sparks.maxLife[i];
      const c = S.scratch.copy(SPARK_HOT).lerp(SPARK_COOL, u);
      S.sparks.colours[i * 4] = c.r;
      S.sparks.colours[i * 4 + 1] = c.g;
      S.sparks.colours[i * 4 + 2] = c.b;
      S.sparks.colours[i * 4 + 3] = (1 - u) * 0.95;
      S.sparks.sizes[i] = SPARK_SIZE * (0.5 + S.sparks.seed[i]) * (1 - u * 0.5);
    }
    markPoolDirty(S.sparks);
    S.sparks.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
  }

  return { createBolts, spawnBolt, updateBolt, updateFlashes, updateFlickers, updateWireFlashes, updateSparks };
}
