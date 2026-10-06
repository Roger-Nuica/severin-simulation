// @ts-check
import * as THREE from 'three';
import { HELD_PARTS } from '../net/heldWeapon.js';
import { fillKatana } from './katana/model.js';

/**
 * ===========================================================================
 * SECTION HW.2 — The weapon in a Roger proxy's hand (third person)
 * ===========================================================================
 * A small model of the weapon in hand, hung on the right arm of a Roger figure
 * (hero/rogerLook.js `rogerLimbs`). Models are made on first use, the geometry
 * and materials registered with the figure's own `Owned` keep, so they are
 * released by `disposeRoger` with the figure and nothing is shared between
 * figures (nothing to free twice or to leak on a rejoin). One mesh per part,
 * and only the weapon in hand is visible, so the draw calls stay low.
 */

/** Where the glove is, in the arm's frame: the end of the forearm. */
const HAND = Object.freeze({ y: -0.49, z: 0.05 });

/**
 * @typedef {Object} Held
 * @property {(key: string|null) => void} show Shows the weapon of this key, or none (null).
 */

/**
 * Hangs a held-weapon holder on the arm.
 * @param {THREE.Object3D} arm The Roger's right arm.
 * @param {{geo: (g: any) => any, mat: (m: any) => any}} keep The figure's registering functions.
 * @returns {Held}
 */
export function attachHeld(arm, keep) {
  const holder = new THREE.Group();
  holder.name = 'held_weapon';
  holder.position.set(0, HAND.y, HAND.z);
  arm.add(holder);
  /** @type {Map<string, THREE.Object3D>} */
  const made = new Map();
  /** @type {string|null} */
  let shown = null;

  /**
   * @param {string} key
   * @returns {THREE.Object3D|null}
   */
  const build = (key) => {
    const group = new THREE.Group();
    if (key === 'katana') {
      // The blade runs along +y; tilted so it points forward from the hand.
      const sword = new THREE.Group();
      fillKatana(sword, { keepGeo: keep.geo, keepMat: keep.mat });
      sword.rotation.x = 1.2;
      group.add(sword);
      return group;
    }
    const parts = HELD_PARTS[key];
    if (!parts) return null;
    for (const p of parts) {
      const geo = p.shape === 'box'
        ? new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2])
        : new THREE.CylinderGeometry(p.size[0], p.size[0], p.size[1], 10).rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: p.colour, roughness: 0.6, metalness: 0.4, emissive: p.glow || 0x000000 });
      const mesh = new THREE.Mesh(keep.geo(geo), keep.mat(mat));
      mesh.position.z = p.z;
      group.add(mesh);
    }
    return group;
  };

  return {
    show(key) {
      if (key === shown) return;
      shown = key;
      for (const [k, g] of made) g.visible = k === key;
      if (key && !made.has(key)) {
        const g = build(key);
        if (g) { made.set(key, g); holder.add(g); }
      }
    }
  };
}
