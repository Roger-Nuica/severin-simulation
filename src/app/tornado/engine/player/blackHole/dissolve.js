// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION PB.3 — Dissolving the big things
 * ===========================================================================
 * A building does not fly into the hole as an intact block any more. It
 * comes apart where it stands, from the side facing the hole first:
 *
 *  - **The cut**: its materials (cloned for the purpose, so nothing else in
 *    town is touched) get a clipping plane, facing away from the hole, that
 *    sweeps through it from the near face to the far one over
 *    DISSOLVE.seconds (longer for bigger things). What the plane has passed
 *    is gone.
 *  - **The fragments**: all along the cut, the building breaks into small
 *    blocks of its own colour that stream off it into the hole on the same
 *    spiral as everything else -- faster as they go in, stretched towards
 *    the core, shrinking. One InstancedMesh for all of them, at most
 *    DISSOLVE.maxFragments alive.
 *
 * At most DISSOLVE.maxAtOnce things dissolve at a time; past that, the
 * caller fades the rest (shrinks them away) instead. Anything whose
 * materials cannot be clipped (custom shaders) still breaks into fragments,
 * and is hidden when the cut is through.
 */

export const DISSOLVE = {
  maxAtOnce: 6,
  maxFragments: 1400,
  seconds: [3, 6],          // the cut through: small, and the biggest
  rate: 90,                 // fragments a second from a 20 m building
  size: [0.5, 1.6],
  infall: [6, 38],          // m/s inward: at the line, and at the horizon
  spin: 1.6                 // radians a second round the hole at 40 m, faster inside
};

/**
 * @typedef {Object} Dissolving
 * @property {any} entry the hole's record of it (consumables.js Consumable)
 * @property {THREE.Vector3} dir from the hole towards it, on the ground
 * @property {number} near where the cut starts, along dir
 * @property {number} far where it ends
 * @property {number} t seconds in
 * @property {number} seconds to go through
 * @property {THREE.Plane} plane
 * @property {THREE.Material[]} clones
 * @property {[THREE.Mesh, THREE.Material|THREE.Material[]][]} originals put back when it is through
 * @property {THREE.Box3} box
 * @property {THREE.Color} colour
 * @property {number} owed fragments not yet emitted
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   start: (entry: any, hole: {x: number, z: number}) => boolean,
 *   busy: () => number,
 *   step: (dt: number, hole: {x: number, y: number, z: number, escape: number, horizon: number}|null) => any[],
 *   clear: () => any[],
 *   dispose: () => void
 * }}
 */
export function createDissolve(ctx) {
  const { Sim } = ctx;
  Sim.three.renderer.localClippingEnabled = true;
  /** @type {Dissolving[]} */
  let active = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, emissive: 0x2a0b48, emissiveIntensity: 0.6 });
  const mesh = new THREE.InstancedMesh(geometry, material, DISSOLVE.maxFragments);
  mesh.name = 'black_hole_fragments';
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  Sim.three.scene.add(mesh);
  // Per fragment: radius and angle round the hole, height, size, life.
  const N = DISSOLVE.maxFragments;
  const radius = new Float32Array(N);
  const angle = new Float32Array(N);
  const height = new Float32Array(N);
  const size = new Float32Array(N);
  const alive = new Uint8Array(N);
  let next = 0;
  let live = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmp = new THREE.Color();

  /**
   * Starts cutting something: false when too many are already going (the
   * caller fades it instead) or there is nothing to cut.
   * @param {any} entry
   * @param {{x: number, z: number}} hole
   * @returns {boolean}
   */
  function start(entry, hole) {
    const object = entry.object;
    if (!object || active.length >= DISSOLVE.maxAtOnce) return false;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return false;
    const centre = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3(centre.x - hole.x, 0, centre.z - hole.z);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    // The box's extent along dir: where the cut starts and ends.
    let near = Infinity;
    let far = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, 0, i & 2 ? box.max.z : box.min.z);
      const d = v.dot(dir);
      near = Math.min(near, d);
      far = Math.max(far, d);
    }
    const plane = new THREE.Plane(dir.clone(), -near);
    /** @type {THREE.Material[]} */
    const clones = [];
    /** @type {[THREE.Mesh, THREE.Material|THREE.Material[]][]} */
    const originals = [];
    const colour = new THREE.Color(0.55, 0.52, 0.5);
    let found = false;
    object.traverse((/** @type {any} */ o) => {
      if (!o.isMesh || !o.material) return;
      // Glazing and other instanced detail: gone at the start rather than
      // cut (their shaders are shared across the town).
      if (o.isInstancedMesh && o.material.isShaderMaterial) { o.visible = false; return; }
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const cut = list.map((/** @type {THREE.Material} */ m) => {
        const c = m.clone();
        c.clippingPlanes = [plane];
        c.clipShadows = true;
        clones.push(c);
        const any = /** @type {any} */ (m);
        if (!found && any.color) { colour.copy(any.color); found = true; }
        return c;
      });
      originals.push([o, o.material]);
      o.material = Array.isArray(o.material) ? cut : cut[0];
    });
    const extent = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    const [s0, s1] = DISSOLVE.seconds;
    active.push({
      entry, dir, near, far, t: 0, seconds: s0 + (s1 - s0) * Math.min(1, extent / 60),
      plane, clones, originals, box, colour, owed: 0
    });
    return true;
  }

  /**
   * Its own materials back (the consumer hides it), the clones freed.
   * @param {Dissolving} d
   * @returns {void}
   */
  function restore(d) {
    for (const [o, m] of d.originals) o.material = m;
    for (const c of d.clones) c.dispose();
  }

  /**
   * One fragment, at a point on the cut.
   * @param {Dissolving} d
   * @param {number} cut where the cut is now, along dir
   * @param {{x: number, z: number}} hole
   * @returns {void}
   */
  function emit(d, cut, hole) {
    const b = d.box;
    v.set(
      b.min.x + Math.random() * (b.max.x - b.min.x),
      b.min.y + Math.random() * (b.max.y - b.min.y),
      b.min.z + Math.random() * (b.max.z - b.min.z)
    );
    // Onto the plane: the face being eaten.
    const off = cut - v.x * d.dir.x - v.z * d.dir.z;
    v.x += d.dir.x * off;
    v.z += d.dir.z * off;
    const i = next;
    next = (next + 1) % N;
    if (!alive[i]) live++;
    alive[i] = 1;
    const dx = v.x - hole.x;
    const dz = v.z - hole.z;
    radius[i] = Math.hypot(dx, dz);
    angle[i] = Math.atan2(dz, dx);
    height[i] = v.y;
    size[i] = DISSOLVE.size[0] + Math.random() * (DISSOLVE.size[1] - DISSOLVE.size[0]);
    tmp.copy(d.colour).multiplyScalar(0.75 + Math.random() * 0.5);
    mesh.setColorAt(i, tmp);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /**
   * The cuts moving through, the fragments falling in.
   * @param {number} dt
   * @param {{x: number, y: number, z: number, escape: number, horizon: number}|null} hole
   * @returns {any[]} the entries whose cut is through (now to be consumed)
   */
  function step(dt, hole) {
    /** @type {any[]} */
    const done = [];
    for (let k = active.length - 1; k >= 0; k--) {
      const d = active[k];
      d.t += dt;
      const u = Math.min(1, d.t / d.seconds);
      // Slow at first, then eaten faster as the hole gets its teeth in.
      const cut = d.near + (d.far - d.near) * (u * u * (3 - 2 * u));
      d.plane.constant = -cut;
      if (hole) {
        const extent = d.box.max.y - d.box.min.y;
        d.owed += DISSOLVE.rate * dt * Math.max(0.4, extent / 20);
        while (d.owed >= 1) {
          d.owed -= 1;
          emit(d, cut, hole);
        }
      }
      if (u >= 1) {
        restore(d);
        active.splice(k, 1);
        done.push(d.entry);
      }
    }

    if (!live) return done;
    const [v0, v1] = DISSOLVE.infall;
    live = 0;
    for (let i = 0; i < N; i++) {
      if (!alive[i]) continue;
      if (!hole) {
        // The hole gone: what is in flight goes with it.
        alive[i] = 0;
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      const r = radius[i];
      const close = 1 - Math.min(1, Math.max(0, (r - hole.horizon) / (hole.escape - hole.horizon)));
      const dr = (v0 + (v1 - v0) * close * close) * dt;
      const r1 = Math.max(0, r - dr);
      const spin = DISSOLVE.spin * Math.min(6, hole.escape / Math.max(3, r));
      angle[i] -= spin * dt;
      radius[i] = r1;
      height[i] += (hole.y - height[i]) * Math.min(1, dt * (0.4 + close * 2.5));
      if (r1 <= hole.horizon) {
        alive[i] = 0;
        mesh.setMatrixAt(i, hidden);
        continue;
      }
      live++;
      const a = angle[i];
      v.set(hole.x + Math.cos(a) * r1, height[i], hole.z + Math.sin(a) * r1);
      // Along the way it is going: round and in.
      fwd.set(Math.sin(a) * spin * r1 - Math.cos(a) * dr / dt, 0, -Math.cos(a) * spin * r1 - Math.sin(a) * dr / dt).normalize();
      q.setFromUnitVectors(Z, fwd);
      const sz = size[i] * (1 - 0.8 * close);
      const long = 1 + 3 * close * close;
      s.set(sz / Math.sqrt(long), sz / Math.sqrt(long), sz * long);
      m4.compose(v, q, s);
      mesh.setMatrixAt(i, m4);
    }
    mesh.count = N;
    mesh.instanceMatrix.needsUpdate = true;
    return done;
  }

  /** @returns {any[]} every cut abandoned (their entries), every fragment gone */
  function clear() {
    const entries = active.map(d => d.entry);
    for (const d of active) restore(d);
    active = [];
    alive.fill(0);
    live = 0;
    for (let i = 0; i < N; i++) mesh.setMatrixAt(i, hidden);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = 0;
    return entries;
  }

  /** @returns {void} */
  function dispose() {
    clear();
    Sim.three.scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    mesh.dispose();
  }

  return { start, busy: () => active.length, step, clear, dispose };
}
