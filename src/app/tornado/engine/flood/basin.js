// @ts-check
import * as THREE from 'three';
import { FLOOD } from './config.js';

/**
 * ===========================================================================
 * SECTION FL.3 — The basin
 * ===========================================================================
 * The reservoir used to be a sheet of water lying open on the ground behind
 * the dam: no sides, the backdrop town's houses standing in it, and the end
 * of the world showing past its far edge. It is a closed basin now. Two side
 * walls and a far wall, as high and as thick as the dam, close it in, and
 * behind each one the earth is banked up (a long sloping berm) out past the
 * edge of the ground, so from anywhere in town the lake sits in a valley and
 * there is nothing to see beyond its walls. The backdrop leaves the whole
 * footprint clear (environment/backdrop.js, basinFootprint).
 *
 * Static: built once, matrices worked out once.
 */

/**
 * The ground the basin and its banks cover, for the backdrop to stay off.
 * @returns {{minX: number, maxX: number, halfZ: number}}
 */
export function basinFootprint() {
  const t = FLOOD.basinWallThickness;
  return {
    minX: FLOOD.basinFarX - t - FLOOD.bermWidth,
    maxX: FLOOD.damX + FLOOD.damThickness / 2 + 2,
    halfZ: FLOOD.damHalfWidth + t + FLOOD.bermWidth + 4
  };
}

/**
 * A bank of earth: a right-angled prism, its upright face at local x = 0
 * rising to `height`, sloping down to the ground at x = `width`, running
 * `length` along z (centred).
 * @param {number} height
 * @param {number} width
 * @param {number} length
 * @returns {THREE.BufferGeometry}
 */
function bermGeometry(height, width, length) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(width, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds the side and far walls and their banks into `group`.
 * @param {THREE.Group} group the flood's group
 * @param {THREE.Material} wallMat the dam's concrete
 * @returns {{meshes: THREE.Object3D[], materials: THREE.Material[]}}
 */
export function buildBasin(group, wallMat) {
  const t = FLOOD.basinWallThickness;
  const h = FLOOD.damHeight;
  const back = FLOOD.damX - FLOOD.damThickness / 2;    // the dam's lake-side face
  const far = FLOOD.basinFarX;
  const half = FLOOD.damHalfWidth;
  const sideLength = back - far + t;
  const bermMat = new THREE.MeshStandardMaterial({ color: FLOOD.bermColour, roughness: 1, flatShading: true });
  /** @type {THREE.Object3D[]} */
  const meshes = [];

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} mat
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} yaw
   * @param {string} name
   * @returns {void}
   */
  const add = (geo, mat, x, y, z, yaw, name) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.name = name;
    mesh.receiveShadow = true;
    meshes.push(mesh);
    group.add(mesh);
  };

  for (const side of [-1, 1]) {
    // The side wall, from the dam's back to the far wall's corner.
    add(new THREE.BoxGeometry(sideLength, h, t), wallMat,
      (back + far - t) / 2, h / 2, side * (half + t / 2), 0, `flood_basin_side_${side > 0 ? 'north' : 'south'}`);
    // Its bank, sloping away from the lake (+z on the north side).
    add(bermGeometry(h, FLOOD.bermWidth, sideLength), bermMat,
      (back + far - t) / 2, 0, side * (half + t), side > 0 ? -Math.PI / 2 : Math.PI / 2,
      `flood_basin_bank_${side > 0 ? 'north' : 'south'}`);
  }
  // The far wall, and the bank behind it out past the ground's edge.
  const farLength = (half + t) * 2;
  add(new THREE.BoxGeometry(t, h, farLength), wallMat, far - t / 2, h / 2, 0, 0, 'flood_basin_far');
  add(bermGeometry(h, FLOOD.bermWidth, farLength + FLOOD.bermWidth * 2), bermMat,
    far - t, 0, 0, Math.PI, 'flood_basin_bank_far');

  for (const mesh of meshes) {
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
  }
  return { meshes, materials: [bermMat] };
}
