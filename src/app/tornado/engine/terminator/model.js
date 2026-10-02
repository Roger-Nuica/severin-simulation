import * as THREE from 'three';
import { T800 } from './config.js';
import { createTouchState } from '../health/melee.js';
/** @typedef {import('./config.js').Unit} Unit */

/**
 * ===========================================================================
 * SECTION TM.1 — The machine
 * ===========================================================================
 * The Terminator's model, built from parts.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see terminator.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createTerminatorModel(ctx, S, api) {
  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {THREE.Object3D} parent
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {THREE.Mesh}
   */
  function part(geometry, material, parent, x, y, z) {
    S.buildGeoms.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * A low-poly endoskeleton in the person's own proportions (people.js),
   * jointed at hips, knees and shoulders for the walk.
   * @returns {Unit}
   */
  function build() {
    // Not fully metallic: the scene has no environment map for chrome to
    // reflect, and at 0.9 it rendered as a black silhouette.
    const chrome = new THREE.MeshStandardMaterial({
      color: T800.chrome, metalness: 0.55, roughness: 0.32,
      emissive: 0x1a1d22
    });
    const joint = new THREE.MeshStandardMaterial({ color: T800.joint, metalness: 0.7, roughness: 0.45 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: T800.eye.clone() });
    S.buildGeoms = [];

    const root = new THREE.Group();
    root.name = 'terminator';
    root.scale.setScalar(T800.scale);
    root.rotation.order = 'YXZ';

    const body = new THREE.Group();
    root.add(body);

    // Legs: thigh from the hip, shin from the knee, a flat foot.
    const legs = {};
    for (const [side, key] of /** @type {[number, string][]} */ ([[-1, 'L'], [1, 'R']])) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, 0.74, 0);
      body.add(hip);
      part(new THREE.CylinderGeometry(0.055, 0.045, 0.36, 6), chrome, hip, 0, -0.18, 0);
      part(new THREE.SphereGeometry(0.06, 6, 4), joint, hip, 0, 0, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -0.37, 0);
      hip.add(knee);
      part(new THREE.SphereGeometry(0.055, 6, 4), joint, knee, 0, 0, 0);
      part(new THREE.CylinderGeometry(0.045, 0.035, 0.34, 6), chrome, knee, 0, -0.17, 0);
      part(new THREE.BoxGeometry(0.1, 0.04, 0.2), joint, knee, 0, -0.35, 0.04);
      legs[`hip${key}`] = hip;
      legs[`knee${key}`] = knee;
    }

    // Pelvis, spine and a ribcage of bars.
    part(new THREE.BoxGeometry(0.3, 0.08, 0.14), joint, body, 0, 0.76, 0);
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), chrome, body, 0, 0.94, -0.02);
    for (let r = 0; r < 4; r++) {
      part(new THREE.BoxGeometry(0.36 - r * 0.02, 0.035, 0.2), chrome, body, 0, 1.06 + r * 0.075, 0);
    }
    part(new THREE.BoxGeometry(0.42, 0.05, 0.16), chrome, body, 0, 1.36, 0);

    // Arms from the shoulders.
    const arms = {};
    for (const [side, key] of /** @type {[number, string][]} */ ([[-1, 'L'], [1, 'R']])) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, 1.34, 0);
      body.add(shoulder);
      part(new THREE.SphereGeometry(0.055, 6, 4), joint, shoulder, 0, 0, 0);
      part(new THREE.CylinderGeometry(0.04, 0.035, 0.3, 6), chrome, shoulder, 0, -0.16, 0);
      part(new THREE.CylinderGeometry(0.035, 0.03, 0.28, 6), chrome, shoulder, 0, -0.45, 0.03);
      part(new THREE.BoxGeometry(0.07, 0.1, 0.05), joint, shoulder, 0, -0.63, 0.04);
      arms[`shoulder${key}`] = shoulder;
    }

    // Skull: cranium, jaw, and the two eyes that are its whole expression.
    const head = new THREE.Group();
    head.position.set(0, 1.42, 0);
    body.add(head);
    part(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 6), joint, head, 0, 0.03, 0);
    part(new THREE.SphereGeometry(0.13, 8, 6), chrome, head, 0, 0.18, 0);
    part(new THREE.BoxGeometry(0.16, 0.06, 0.12), chrome, head, 0, 0.07, 0.03);
    for (const side of [-1, 1]) {
      const eye = part(new THREE.SphereGeometry(0.025, 6, 4), eyeMat, head, side * 0.05, 0.19, 0.11);
      eye.castShadow = false;
    }

    return {
      root,
      joints: /** @type {Unit['joints']} */ ({ ...legs, ...arms, head, body }),
      eyeMat,
      phase: 'walking',
      heading: 0,
      cycle: Math.random() * Math.PI * 2,
      timer: 0,
      retarget: Math.random() * T800.retarget,
      target: null,
      materials: [chrome, joint, eyeMat],
      geometries: S.buildGeoms,
      detourHeading: 0,
      detourTimer: 0,
      detourSide: Math.random() < 0.5 ? -1 : 1,
      watchTimer: T800.watchdogSeconds,
      watchX: 0,
      watchZ: 0,
      ignore: null,
      ignoreTimer: 0,
      foe: null,
      strikeTimer: 0,
      touch: createTouchState(),
      touchClock: 0
    };
  }

  /**
   * A machine of the same build that this module does not run: Hero Mode's
   * pursuer (engine/heroMode.js) walks it itself. Not in the squad, so the
   * aliens leave it alone and the EMP asks heroMode.js about it separately. Its geometries and materials are in
   * the returned `geometries` and `materials` for the caller to dispose.
   * @returns {Unit}
   */
  function buildModel() {
    return build();
  }

  return { part, build, buildModel };
}
