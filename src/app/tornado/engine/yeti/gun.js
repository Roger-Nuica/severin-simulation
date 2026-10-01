// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';

/**
 * ===========================================================================
 * SECTION YT.2 — The cold gun: what it looks like
 * ===========================================================================
 * The Yeti's Mr. Freeze blaster fires one continuous cone of cold, drawn in
 * three layers:
 *
 *  - The frost beam: two open cones from the muzzle (a wide pale-blue one
 *    and a white-hot core), additive, with streaks flowing down them.
 *  - Ice: glinting crystals blown down the cone (one particle pool on the
 *    shared budget: caps.particleRoom before every emission).
 *  - Frost on the ground: pale patches settling under the cone, which
 *    linger a few seconds and melt away (one instanced mesh, a fixed pool).
 *
 * The beam's length is given every frame, so where it meets the T-Rex's
 * flames (giants/clash.js) it stops there and goes no further. What the
 * cone freezes is decided in yeti.js, not here.
 */

export const GUN = {
  iceMax: 800,
  iceRate: 340,           // crystals a second while firing
  iceSpeed: 48,           // metres a second down the cone
  frostMax: 64,
  frostEvery: 0.12,       // seconds between two patches settling
  frostLife: 9,
  frostSize: [5, 11],     // metres across
  beamFade: 6             // how fast the beam goes when it stops (per second)
};

/**
 * The textures' own random numbers: drawn at start-up, they must not take
 * from Math.random, which the benchmark seeds (engine/perf/bench.js) -- the
 * same run would then play out differently.
 * @param {number} seed
 * @returns {() => number} 0..1
 */
function noiseFrom(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * Streaks for the beam, flowing along it as the texture scrolls.
 * @returns {THREE.CanvasTexture}
 */
function streakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const random = noiseFrom(7);
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 70; i++) {
    const x = random() * 64;
    const y = random() * 128;
    const v = 140 + random() * 115;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, y, 1 + random() * 2, 10 + random() * 40);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * A patch of frost: a pale disc of crystals, feathered at the edge.
 * @returns {THREE.CanvasTexture}
 */
function frostTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(235,248,255,0.95)');
  grad.addColorStop(0.55, 'rgba(205,232,255,0.7)');
  grad.addColorStop(1, 'rgba(190,225,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const random = noiseFrom(11);
  // Crystals: fine white spikes out from random seeds.
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const x = 20 + random() * 88;
    const y = 20 + random() * 88;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + random() * 0.3;
      const r = 4 + random() * 9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      g.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   init: () => void,
 *   fire: (from: THREE.Vector3, dir: THREE.Vector3, length: number, halfAngle: number, dt: number) => void,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   release: () => void
 * }}
 */
export function createColdGun(ctx) {
  const { Sim } = ctx;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let ice = null;
  let iceAlive = false;
  let owed = 0;
  /** @type {THREE.Group|null} */
  let beam = null;
  /** @type {THREE.Mesh[]} */
  let cones = [];
  /** @type {THREE.MeshBasicMaterial[]} */
  let beamMats = [];
  /** @type {THREE.CylinderGeometry|null} */
  let coneGeo = null;
  /** @type {THREE.Texture|null} */
  let streaks = null;
  /** @type {THREE.InstancedMesh|null} */
  let frost = null;
  /** @type {THREE.PlaneGeometry|null} */
  let frostGeo = null;
  /** @type {THREE.MeshBasicMaterial|null} */
  let frostMat = null;
  /** @type {THREE.Texture|null} */
  let frostMap = null;
  const patches = Array.from({ length: GUN.frostMax }, () => ({ x: 0, z: 0, size: 0, life: 0, spin: 0 }));
  let nextPatch = 0;
  let frostTimer = 0;
  let firing = false;
  let shown = 0;
  let flow = 0;
  const UP = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const spin = new THREE.Quaternion();

  /** @returns {void} */
  function init() {
    ice = createParticlePool(Sim.three.scene, GUN.iceMax, createSoftDotTexture(), THREE.AdditiveBlending, 'yeti_gun_ice');
    ctx.systems.caps.trackPool(ice);
    // The cones: open, narrow at the muzzle (y = 0) and 1 wide at y = 1.
    coneGeo = new THREE.CylinderGeometry(1, 0.08, 1, 24, 1, true);
    coneGeo.translate(0, 0.5, 0);
    streaks = streakTexture();
    beam = new THREE.Group();
    beam.name = 'yeti_cold_beam';
    beam.visible = false;
    beamMats = [
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.18, 0.62, 1.5), map: streaks, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.55, 1.35, 2.2), map: streaks, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    ];
    cones = beamMats.map((m, i) => {
      const mesh = new THREE.Mesh(coneGeo, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2 + i;
      /** @type {THREE.Group} */ (beam).add(mesh);
      return mesh;
    });
    Sim.three.scene.add(beam);

    frostGeo = new THREE.PlaneGeometry(1, 1);
    frostMap = frostTexture();
    frostMat = new THREE.MeshBasicMaterial({
      map: frostMap, color: new THREE.Color(0.95, 1, 1.1), transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    frost = new THREE.InstancedMesh(frostGeo, frostMat, GUN.frostMax);
    frost.name = 'yeti_frost';
    frost.frustumCulled = false;
    frost.count = 0;
    Sim.three.scene.add(frost);
  }

  /**
   * One frame of firing.
   * @param {THREE.Vector3} from the muzzle
   * @param {THREE.Vector3} dir unit
   * @param {number} length metres, to where it stops
   * @param {number} halfAngle radians
   * @param {number} dt
   * @returns {void}
   */
  function fire(from, dir, length, halfAngle, dt) {
    if (!beam || !ice) return;
    firing = true;
    const spread = Math.tan(halfAngle);
    beam.position.copy(from);
    beam.quaternion.setFromUnitVectors(UP, dir);
    const end = Math.max(1, length * spread);
    cones[0].scale.set(end, length, end);
    cones[1].scale.set(end * 0.32, length * 0.96, end * 0.32);
    // Crystals blown down the cone; they end where the beam does.
    owed += GUN.iceRate * dt;
    const n = Math.min(Math.floor(owed), ctx.systems.caps.particleRoom());
    owed -= Math.floor(owed);
    for (let k = 0; k < n; k++) {
      const i = ice.next;
      ice.next = (ice.next + 1) % GUN.iceMax;
      const speed = GUN.iceSpeed * (0.8 + Math.random() * 0.4);
      const life = (length / speed) * (0.55 + Math.random() * 0.45);
      ice.life[i] = life;
      ice.maxLife[i] = life;
      ice.seed[i] = Math.random();
      ice.positions.set([from.x, from.y, from.z], i * 3);
      // A direction inside the cone: dir, nudged sideways and up/down.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      // Two axes across dir.
      const ax = -dir.z;
      const az = dir.x;
      const vx = dir.x + (Math.cos(a) * r) * ax;
      const vy = dir.y + Math.sin(a) * r;
      const vz = dir.z + (Math.cos(a) * r) * az;
      const len = Math.hypot(vx, vy, vz);
      ice.velocities.set([(vx / len) * speed, (vy / len) * speed, (vz / len) * speed], i * 3);
    }
    if (n > 0) iceAlive = true;
    // Frost settling under the cone.
    frostTimer -= dt;
    if (frostTimer <= 0) {
      frostTimer = GUN.frostEvery;
      const patch = patches[nextPatch];
      nextPatch = (nextPatch + 1) % GUN.frostMax;
      const t = 0.2 + Math.random() * 0.8;
      const side = (Math.random() - 0.5) * 2 * spread * length * t;
      const flatLen = Math.hypot(dir.x, dir.z) || 1;
      patch.x = from.x + (dir.x / flatLen) * length * t - (dir.z / flatLen) * side;
      patch.z = from.z + (dir.z / flatLen) * length * t + (dir.x / flatLen) * side;
      const [lo, hi] = GUN.frostSize;
      patch.size = lo + Math.random() * (hi - lo);
      patch.life = GUN.frostLife;
      patch.spin = Math.random() * Math.PI * 2;
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function update(dt) {
    if (!beam || !ice || !frost) return;
    // The beam: up while it fires, fading out once it stops.
    shown = firing ? Math.min(1, shown + dt * 10) : Math.max(0, shown - dt * GUN.beamFade);
    firing = false;
    beam.visible = shown > 0.01;
    if (beam.visible) {
      flow += dt;
      if (streaks) streaks.offset.set(flow * 0.35, -flow * 2.6);
      const flicker = 0.85 + 0.15 * Math.sin(flow * 37) * Math.sin(flow * 23);
      beamMats[0].opacity = 0.6 * shown * flicker;
      beamMats[1].opacity = 0.6 * shown * flicker;
    }
    // The crystals.
    if (iceAlive) {
      ice.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
      let any = false;
      for (let i = 0; i < GUN.iceMax; i++) {
        if (ice.life[i] <= 0) {
          if (ice.sizes[i] !== 0) { ice.colours[i * 4 + 3] = 0; ice.sizes[i] = 0; }
          continue;
        }
        any = true;
        ice.life[i] -= dt;
        const t = 1 - Math.max(0, ice.life[i]) / ice.maxLife[i];
        const v = i * 3;
        ice.positions[v] += ice.velocities[v] * dt;
        ice.positions[v + 1] = Math.max(0.2, ice.positions[v + 1] + ice.velocities[v + 1] * dt);
        ice.positions[v + 2] += ice.velocities[v + 2] * dt;
        // Ice-blue, a few glinting white.
        const glint = ice.seed[i] > 0.9;
        if (glint) ice.colours.set([1.2, 1.4, 1.6, Math.min(1, t * 8) * (1 - t * t)], i * 4);
        else ice.colours.set([0.35, 0.75, 1.35, 0.8 * Math.min(1, t * 8) * (1 - t * t)], i * 4);
        ice.sizes[i] = (0.5 + t * 2.4) * (0.6 + ice.seed[i] * 0.8);
      }
      markPoolDirty(ice);
      iceAlive = any;
    }
    // The frost: grows in, lingers, shrinks away.
    let n = 0;
    for (const patch of patches) {
      if (patch.life <= 0) continue;
      patch.life -= dt;
      const age = GUN.frostLife - patch.life;
      const grow = Math.min(1, age / 0.5);
      const melt = Math.min(1, Math.max(0, patch.life) / 2);
      const size = patch.size * grow * melt;
      if (size <= 0.01) continue;
      spin.setFromAxisAngle(UP, patch.spin);
      q.copy(spin).multiply(flat);
      m4.compose(p.set(patch.x, 0.06, patch.z), q, s.set(size, size, 1));
      frost.setMatrixAt(n++, m4);
    }
    frost.count = n;
    if (n > 0) frost.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} */
  function clear() {
    if (ice) {
      ice.life.fill(0);
      ice.colours.fill(0);
      ice.sizes.fill(0);
      markPoolDirty(ice);
    }
    iceAlive = false;
    owed = 0;
    for (const patch of patches) patch.life = 0;
    if (frost) frost.count = 0;
    shown = 0;
    firing = false;
    if (beam) beam.visible = false;
  }

  /** @returns {void} */
  function release() {
    if (ice) disposeParticlePool(Sim.three.scene, ice);
    ice = null;
    if (beam) Sim.three.scene.remove(beam);
    beam = null;
    for (const m of beamMats) m.dispose();
    beamMats = [];
    cones = [];
    if (coneGeo) coneGeo.dispose();
    if (streaks) streaks.dispose();
    if (frost) {
      Sim.three.scene.remove(frost);
      frost.dispose();
    }
    frost = null;
    if (frostGeo) frostGeo.dispose();
    if (frostMat) frostMat.dispose();
    if (frostMap) frostMap.dispose();
  }

  return { init, fire, update, clear, release };
}
