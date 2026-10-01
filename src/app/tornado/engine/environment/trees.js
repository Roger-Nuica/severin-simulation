// @ts-check
import * as THREE from 'three';

/**
 * @param {Object} ctx
 * @returns {{ createTree: (x: number, z: number, index?: number) => Object }}
 */
export function createTreesSystem(ctx) {
  const { nextObjectId } = ctx;

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} [index] position in the environment's tree list, used only
   *   to give this tree a unique scene-graph name
   * @returns {SimObject}
   */
  function createTree(x, z, index = 0) {
    const trunkHeight = 3 + Math.random() * 2.5;
    const root = new THREE.Group();
    root.name = `tree_${index}`;
    root.position.set(x, 0, z);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4330, roughness: 1 });
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, trunkHeight, 8);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.name = `${root.name}_trunk`;
    trunk.position.y = trunkHeight / 2;
    // No shadow: too small to show in a 1024 shadow map, and every caster
    // is drawn a second time into it (performance pass). The canopy's shadow
    // covers the trunk's.
    trunk.castShadow = false;
    root.add(trunk);

    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 });
    const canopyGeo = new THREE.SphereGeometry(1.6 + Math.random() * 0.8, 8, 6);
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.name = `${root.name}_canopy`;
    canopy.position.y = trunkHeight + 1.2;
    canopy.castShadow = true;
    root.add(canopy);

    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'tree',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mass: 6 + Math.random() * 6,
      drag: 1.4,
      rooted: true,
      damageState: 'intact',
      breakThreshold: 2.2 + Math.random() * 1.4,
      liftEligible: 0.4,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    root.userData.simObject = obj;
    return obj;
  }

  return { createTree };
}
