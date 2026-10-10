// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION HM.9b — The jetpack's model (shared by Roger and the co-op figures)
 * ===========================================================================
 * The pack itself, lifted out of hero/jetpack.js `attachJetpack` unchanged so
 * that Roger's own pack and the pack drawn on a co-op partner's figure are the
 * same model: a frame with two slim fuel tanks, a yoke to two thrusters at the
 * hips with bell nozzles, control arms to two grips, and a flame and a
 * white-hot core under each nozzle (hidden until the pack burns). No scene and
 * no state: the caller adds the group where it belongs and owns what is built.
 */

/**
 * @param {(g: THREE.BufferGeometry) => THREE.BufferGeometry} keepGeo registers a geometry for disposal and returns it
 * @param {(m: THREE.Material) => THREE.Material} keepMat registers a material for disposal and returns it
 * @returns {{pack: THREE.Group, flames: THREE.Mesh[], cores: THREE.Mesh[]}}
 */
export function buildJetpackPack(keepGeo, keepMat) {
  const metal = keepMat(new THREE.MeshStandardMaterial({ color: 0x4a4f57, metalness: 0.8, roughness: 0.35 }));
  const chrome = keepMat(new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.18 }));
  const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x17191d, metalness: 0.5, roughness: 0.6 }));
  const warn = keepMat(new THREE.MeshBasicMaterial({ color: 0xffb02e }));
  const flameMat = keepMat(new THREE.MeshBasicMaterial({
    color: 0xff8a26, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  const coreMat = keepMat(new THREE.MeshBasicMaterial({
    color: 0xbfe4ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  const cyl = (/** @type {number} */ rt, /** @type {number} */ rb, /** @type {number} */ h, open = false) => keepGeo(new THREE.CylinderGeometry(rt, rb, h, 14, 1, open));
  /**
   * A rod from a to b (local units).
   * @param {THREE.Vector3} a
   * @param {THREE.Vector3} b
   * @param {number} r
   * @param {THREE.Material} mat
   * @returns {THREE.Mesh}
   */
  const rod = (a, b, r, mat) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(cyl(r, r, len), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
    return m;
  };
  // A flame: a cone hanging point-down from the nozzle, scaled by the thrust.
  const flameGeo = keepGeo(new THREE.ConeGeometry(0.1, 1, 12, 1, true));
  flameGeo.rotateX(Math.PI);
  flameGeo.translate(0, -0.5, 0);
  const coreGeo = keepGeo(new THREE.ConeGeometry(0.055, 1, 10, 1, true));
  coreGeo.rotateX(Math.PI);
  coreGeo.translate(0, -0.5, 0);

  const pack = new THREE.Group();
  pack.name = 'hero_jetpack';
  // Fitted to the Storm Ranger suit (hero/rogerLook.js: a slim torso, the
  // Storm Core on the back at 1.2 m): two slim fuel tanks either side of
  // the core, leaving it in view, and a yoke from them down to the hips.
  // Roger's own frame: feet at 0, +z ahead.
  /** @type {THREE.Mesh[]} */
  const flames = [];
  /** @type {THREE.Mesh[]} */
  const cores = [];
  for (const side of [-1, 1]) {
    const tank = new THREE.Mesh(cyl(0.05, 0.05, 0.36), metal);
    tank.position.set(side * 0.13, 1.2, -0.2);
    tank.castShadow = true;
    const tankCap = new THREE.Mesh(keepGeo(new THREE.SphereGeometry(0.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), chrome);
    tankCap.position.set(0, 0.18, 0);
    tank.add(tankCap);
    const band = new THREE.Mesh(cyl(0.052, 0.052, 0.03), warn);
    band.position.set(0, 0.06, 0);
    tank.add(band);
    pack.add(tank);
    // The yoke, from the tank round the waist to the thruster.
    pack.add(rod(new THREE.Vector3(side * 0.13, 1.08, -0.2), new THREE.Vector3(side * 0.29, 1.06, -0.08), 0.02, chrome));
    const pod = new THREE.Mesh(cyl(0.09, 0.09, 0.32), metal);
    pod.position.set(side * 0.3, 0.98, -0.06);
    pod.castShadow = true;
    const cap = new THREE.Mesh(keepGeo(new THREE.SphereGeometry(0.09, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2)), chrome);
    cap.position.set(0, 0.16, 0);
    pod.add(cap);
    const ring = new THREE.Mesh(cyl(0.094, 0.094, 0.03), warn);
    ring.position.set(0, 0.07, 0);
    pod.add(ring);
    const bell = new THREE.Mesh(cyl(0.065, 0.11, 0.12, true), dark);
    bell.position.set(0, -0.22, 0);
    pod.add(bell);
    // The control arm, forward from the thruster to the grip.
    const grip = new THREE.Vector3(side * 0.24, 1.0, 0.27);
    pack.add(rod(new THREE.Vector3(side * 0.3, 1.04, 0.02), grip, 0.018, chrome));
    const handle = new THREE.Mesh(cyl(0.026, 0.026, 0.12), dark);
    handle.position.copy(grip);
    pack.add(handle);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0, -0.27, 0);
    flame.visible = false;
    flame.frustumCulled = false;
    pod.add(flame);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, -0.27, 0);
    core.visible = false;
    core.frustumCulled = false;
    pod.add(core);
    flames.push(flame);
    cores.push(core);
    pack.add(pod);
  }
  return { pack, flames, cores };
}
