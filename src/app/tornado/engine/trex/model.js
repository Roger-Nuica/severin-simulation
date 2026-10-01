// @ts-check
import * as THREE from 'three';
import { TREX } from './config.js';

/**
 * ===========================================================================
 * SECTION TX.1 — The cyber T-Rex: the model
 * ===========================================================================
 * Built from primitives like everything else: an ellipsoid body leaning
 * forward, a tail of three tapering cones, a neck and a boxy head with a
 * lower jaw on a hinge, two big legs (thigh, shin, foot) and two tiny arms.
 * The implants: steel plates bolted along the flank and over the jaw, a
 * row of steel spikes down the spine, a flame nozzle on the snout, glowing
 * orange vents in the plates and one glowing red eye.
 *
 * Materials are made once per T-Rex (its eye and vents dim when an EMP
 * knocks its implants out); the geometries once for the system.
 *
 * The rig: the root at the feet, facing +z. `parts` holds what moves: the
 * legs (hip pivots), the tail pivot, the jaw pivot, and the mouth (where
 * the flames come from).
 */

/**
 * @typedef {Object} TrexRig
 * @property {THREE.Group} root
 * @property {THREE.Object3D} legL hip pivot
 * @property {THREE.Object3D} legR
 * @property {THREE.Object3D} tail
 * @property {THREE.Object3D} jaw
 * @property {THREE.Object3D} mouth where the flames leave
 * @property {THREE.Object3D} body
 * @property {THREE.MeshBasicMaterial} eyeMat
 * @property {THREE.MeshBasicMaterial} ventMat
 * @property {THREE.Material[]} materials its own, to dispose
 */

/**
 * @returns {{ build: () => TrexRig, dispose: () => void }}
 */
export function createTrexModel() {
  const k = TREX.height / 15;
  const geo = {
    body: new THREE.SphereGeometry(1, 18, 12),
    cone: new THREE.ConeGeometry(1, 1, 12),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    spike: new THREE.ConeGeometry(0.35, 1.3, 6)
  };

  /**
   * @returns {TrexRig}
   */
  function build() {
    const skin = new THREE.MeshStandardMaterial({ color: TREX.skin, roughness: 0.85 });
    const belly = new THREE.MeshStandardMaterial({ color: TREX.belly, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: TREX.metal, roughness: 0.3, metalness: 0.85 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: TREX.eye.clone() });
    const ventMat = new THREE.MeshBasicMaterial({ color: TREX.vent.clone() });
    const root = new THREE.Group();
    root.name = 'cyber_trex';
    const rig = new THREE.Group();
    rig.scale.setScalar(k);
    root.add(rig);

    /**
     * @param {THREE.BufferGeometry} g
     * @param {THREE.Material} m
     * @param {THREE.Object3D} parent
     * @param {number[]} pos
     * @param {number[]} scale
     * @param {number[]} [rot]
     * @returns {THREE.Mesh}
     */
    const part = (g, m, parent, pos, scale, rot = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // The body, leaning forward, and its belly.
    const body = new THREE.Group();
    body.position.set(0, 8, 0);
    body.rotation.x = 0.18;
    rig.add(body);
    part(geo.body, skin, body, [0, 0, 0], [3, 3.1, 5.2]);
    part(geo.body, belly, body, [0, -1.2, 0.6], [2.4, 2, 4]);
    // Steel plates on each flank, with a glowing vent in each.
    for (const side of [-1, 1]) {
      part(geo.box, metal, body, [side * 2.7, 0.4, -0.3], [0.35, 2.2, 3.8], [0, side * 0.12, 0]);
      part(geo.box, ventMat, body, [side * 2.92, 0.4, -0.3], [0.08, 0.35, 2.4]);
    }
    // Steel spikes down the spine.
    for (let i = 0; i < 6; i++) {
      part(geo.spike, metal, body, [0, 3 - i * 0.12, 3 - i * 1.3], [1, 1, 1], [-0.25, 0, 0]);
    }

    // Neck and head.
    const neck = new THREE.Group();
    neck.position.set(0, 1.6, 4.4);
    neck.rotation.x = -0.5;
    body.add(neck);
    part(geo.cyl, skin, neck, [0, 1.2, 0], [1.3, 3, 1.3]);
    const head = new THREE.Group();
    head.position.set(0, 3, 0.4);
    head.rotation.x = 0.5 - 0.18;
    neck.add(head);
    part(geo.box, skin, head, [0, 0.6, 1.6], [2.2, 1.9, 4]);
    // The steel plate over the skull and the eye in it.
    part(geo.box, metal, head, [0.6, 1.2, 1.4], [1.3, 0.5, 2.6]);
    part(geo.body, eyeMat, head, [1.12, 1.0, 2.2], [0.28, 0.28, 0.28]);
    part(geo.body, skin, head, [-1.1, 1.0, 2.2], [0.2, 0.2, 0.2]);
    // The flame nozzle on the snout.
    part(geo.cyl, metal, head, [0, 1.25, 3.5], [0.35, 0.9, 0.35], [Math.PI / 2, 0, 0]);
    // The lower jaw on its hinge, with a steel plate.
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.3, 0);
    head.add(jaw);
    part(geo.box, belly, jaw, [0, -0.2, 1.6], [1.9, 0.6, 3.6]);
    part(geo.box, metal, jaw, [0, -0.55, 1.6], [2, 0.2, 3]);
    const mouth = new THREE.Object3D();
    mouth.position.set(0, 0.4, 3.8);
    head.add(mouth);

    // The tail: three cones, tapering, on a pivot that wags.
    const tail = new THREE.Group();
    tail.position.set(0, 0.2, -4.4);
    body.add(tail);
    part(geo.cone, skin, tail, [0, 0, -3], [2.2, 6.5, 2.2], [-Math.PI / 2 - 0.1, 0, 0]);
    part(geo.cone, metal, tail, [0, 0.9, -2.2], [0.7, 2.2, 0.7], [-Math.PI / 2 - 0.3, 0, 0]);

    // The legs: a hip pivot each, thigh, shin and a foot.
    /**
     * @param {number} side
     * @returns {THREE.Group}
     */
    const leg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 2.1, 8, -0.6);
      rig.add(hip);
      part(geo.body, skin, hip, [0, -2, 0.3], [1.3, 2.8, 1.8]);
      part(geo.box, metal, hip, [side * 1.05, -1.8, 0.3], [0.25, 2.2, 1.6]);
      part(geo.cyl, skin, hip, [0, -5.2, -0.4], [0.7, 3.6, 0.7], [-0.25, 0, 0]);
      part(geo.box, skin, hip, [0, -7.6, 0.4], [1.4, 0.7, 2.6]);
      return hip;
    };
    const legL = leg(-1);
    const legR = leg(1);

    // The tiny arms.
    for (const side of [-1, 1]) {
      part(geo.cyl, skin, body, [side * 1.6, -0.9, 4.1], [0.25, 1.4, 0.25], [0.9, 0, 0]);
    }

    return {
      root, legL, legR, tail, jaw, mouth, body, eyeMat, ventMat,
      materials: [skin, belly, metal, eyeMat, ventMat]
    };
  }

  /** @returns {void} */
  function dispose() {
    for (const g of Object.values(geo)) g.dispose();
  }

  return { build, dispose };
}
