// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION PB.4 — The wind into the hole
 * ===========================================================================
 * The pull is a wind, the way the Downburst's is (engine/downburst.js),
 * turned round: instead of a straight blast outwards, a radial inflow with a
 * swirl on it, faster the nearer it gets -- a magnet drawing the town in.
 *
 *  - windAt(): the wind's velocity at a distance from the hole, for
 *    whatever it is dragging (blackHole.js): inflow WIND.inflow x
 *    (escape / d)^WIND.falloff, and WIND.swirl times that again round it.
 *  - The streaks: short, violet-white lines of blown dust flying along the
 *    same spiral, out to the edge of its reach, so the wind shows where it
 *    is going. Re-oriented to the wind's own direction every frame
 *    (windAt's inward+round) and kept short rather than long rods, so a
 *    curving path is read from many short, correctly-turned segments
 *    instead of one straight one -- the same principle as a motion-trail
 *    particle. One InstancedMesh of stretched boxes, additive (WIND.streaks
 *    of them).
 */

export const WIND = {
  inflow: 14,               // m/s inward at the no-escape line
  falloff: 1.3,             // faster nearer: (escape / d)^this
  maxInflow: 40,
  swirl: 0.9,               // round it, as a share of the inflow
  streaks: 320,
  streakLength: [1.1, 3.2],  // shorter: each segment hugs its own local curve
  streakLife: [1.0, 2.2]
};

/**
 * The wind at a distance d from the hole: inward and round.
 * @param {number} d metres from the hole (on the ground)
 * @param {number} escape the no-escape radius
 * @returns {{inward: number, round: number}} m/s
 */
export function windAt(d, escape) {
  const inward = Math.min(WIND.maxInflow, WIND.inflow * Math.pow(escape / Math.max(4, d), WIND.falloff));
  return { inward, round: inward * WIND.swirl };
}

/**
 * @param {Object} ctx
 * @returns {{
 *   step: (dt: number, hole: {x: number, y: number, z: number, escape: number, influence: number, horizon: number}|null, size: number) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createHoleWind(ctx) {
  const { Sim } = ctx;
  const N = WIND.streaks;
  const geometry = new THREE.BoxGeometry(0.12, 0.12, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const mesh = new THREE.InstancedMesh(geometry, material, N);
  mesh.name = 'black_hole_wind';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(0, 0, 0));
  mesh.visible = false;
  Sim.three.scene.add(mesh);
  const r = new Float32Array(N);
  const a = new Float32Array(N);
  const y = new Float32Array(N);
  const life = new Float32Array(N);
  const maxLife = new Float32Array(N);
  const len = new Float32Array(N);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const colour = new THREE.Color();
  // Pale cool violet-grey out at the line, through violet, to white-hot
  // right at the horizon -- purple/violet/white only, nothing warm.
  const far = new THREE.Color(0.5, 0.46, 0.6);
  const violet = new THREE.Color(0.85, 0.5, 1.5);
  const hot = new THREE.Color(2.2, 2.0, 2.6);

  /**
   * @param {number} i
   * @param {{escape: number, influence: number}} hole
   * @returns {void}
   */
  function spawn(i, hole) {
    r[i] = hole.escape * 0.6 + Math.random() * (hole.influence - hole.escape * 0.6);
    a[i] = Math.random() * Math.PI * 2;
    y[i] = 0.4 + Math.random() * 7;
    maxLife[i] = life[i] = WIND.streakLife[0] + Math.random() * (WIND.streakLife[1] - WIND.streakLife[0]);
    len[i] = WIND.streakLength[0] + Math.random() * (WIND.streakLength[1] - WIND.streakLength[0]);
  }

  /**
   * @param {number} dt
   * @param {{x: number, y: number, z: number, escape: number, influence: number, horizon: number}|null} hole
   * @param {number} size 0..1, opening and closing
   * @returns {void}
   */
  function step(dt, hole, size) {
    if (!hole || size <= 0.01) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    for (let i = 0; i < N; i++) {
      life[i] -= dt;
      if (life[i] <= 0 || r[i] <= hole.horizon * 2) spawn(i, hole);
      const w = windAt(r[i], hole.escape);
      const dr = w.inward * dt;
      const da = (w.round / Math.max(3, r[i])) * dt;
      r[i] = Math.max(0, r[i] - dr);
      a[i] -= da;
      // Rising towards the core's height as it gets in.
      const close = 1 - Math.min(1, r[i] / hole.influence);
      y[i] += (hole.y * close * close - y[i] + 1) * Math.min(1, dt * 0.8);
      const c = Math.cos(a[i]);
      const s = Math.sin(a[i]);
      p.set(hole.x + c * r[i], y[i], hole.z + s * r[i]);
      dir.set(s * w.round - c * w.inward, 0, -c * w.round - s * w.inward).normalize();
      q.setFromUnitVectors(Z, dir);
      sc.set(1, 1, len[i] * (0.6 + close));
      m4.compose(p, q, sc);
      mesh.setMatrixAt(i, m4);
      const u = 1 - life[i] / maxLife[i];
      const fade = Math.min(1, u * 5) * Math.min(1, (1 - u) * 3) * size * (0.25 + 0.75 * close);
      colour.copy(far).lerp(violet, Math.min(1, close * 1.6)).lerp(hot, close * close * close).multiplyScalar(fade);
      mesh.setColorAt(i, colour);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** @returns {void} */
  function clear() {
    life.fill(0);
    mesh.visible = false;
  }

  /** @returns {void} */
  function dispose() {
    Sim.three.scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    mesh.dispose();
  }

  return { step, clear, dispose };
}
