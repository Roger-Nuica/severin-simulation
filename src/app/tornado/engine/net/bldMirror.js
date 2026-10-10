// @ts-check
import * as THREE from 'three';
import { hideBuildingWindows } from '../environment/buildings.js';
import { darkenBuildingWindows } from '../damage/buildings.js';
import { TOPPLE, extentAlong, lyingBoxes, toppleAngle } from '../topple.js';
import { BLD_BIT, WALL_BITS, MAX_BUILDINGS, newBits, dirOfDeg } from './bldFx.js';

/** Seconds a mirrored building takes to go over (the host's is 1.15 to 1.7). */
const FALL_SECONDS = 1.4;

/**
 * @typedef {Object} MirrorFall
 * @property {THREE.Group} root
 * @property {{x: number, z: number}} dir
 * @property {THREE.Vector3} axis
 * @property {THREE.Vector3} pivot
 * @property {THREE.Vector3} origin
 * @property {THREE.Quaternion} baseQuat
 * @property {number} height
 * @property {number} halfWidth
 * @property {number} t
 */

/**
 * The co-op guest's render-only copy of the host's building damage. It sets
 * the same visible state the host's damage code leaves behind (torn-off
 * pieces, dark and hidden windows, the collapsed state, the black hole's
 * hidden building, the lying pose and its solid boxes) and nothing else: no
 * debris, burst, score, fire, power-line fault, shock or event (R-053, R-048).
 * Because the damage state and `userData.lying` are what the walking rules
 * read, the guest's collision queries follow for free.
 * @param {any} ctx
 * @returns {{
 *   apply: (rows: Map<number, number[]>, dt: number) => void,
 *   active: () => boolean,
 *   clear: () => void
 * }}
 */
export function createBuildingMirror(ctx) {
  const applied = new Int16Array(MAX_BUILDINGS);
  /** @type {(THREE.Object3D|null)[]} */
  const roots = new Array(MAX_BUILDINGS).fill(null);
  /** @type {MirrorFall[]} */
  const falls = [];
  const scratchQuat = new THREE.Quaternion();
  const scratchVec = new THREE.Vector3();
  /** The first rows after entering show the host's town as it is: snap, do not animate. */
  let primed = false;

  /**
   * @param {any} b the building object
   * @param {number} bits mask bits to apply
   * @returns {void}
   */
  function tearPieces(b, bits) {
    const root = b.mesh;
    const { roof, walls } = root.userData.pieces;
    let torn = 0;
    if (bits & BLD_BIT.roof && !roof.userData.lost) {
      roof.userData.lost = true;
      root.remove(roof);
      b.damageState = 'roofLost';
      torn++;
    }
    for (const [name, bit] of WALL_BITS) {
      if (!(bits & bit)) continue;
      const wall = walls.find((/** @type {any} */ w) => w.userData.pieceName === `wall-${name}`);
      if (!wall || wall.userData.lost) continue;
      wall.userData.lost = true;
      root.remove(wall);
      hideBuildingWindows(root, name);
      b.damageState = 'wallLost';
      torn++;
    }
    // As the host: one outage step per piece lost.
    for (let i = 0; i < torn; i++) darkenBuildingWindows(b);
  }

  /**
   * @param {any} b @param {number} dirDeg @param {boolean} snap
   * @returns {void}
   */
  function startFall(b, dirDeg, snap) {
    const root = b.mesh;
    const fp = root.userData.footprint;
    const height = root.userData.wallHeight;
    if (!fp || !height || height < Math.min(fp.width, fp.depth) * TOPPLE.minAspect) return;
    const dir = dirOfDeg(dirDeg);
    const lever = extentAlong(fp, dir.x, dir.z);
    const base = root.position;
    const fall = {
      root, dir,
      axis: new THREE.Vector3(dir.z, 0, -dir.x),
      pivot: new THREE.Vector3(base.x + dir.x * lever, 0, base.z + dir.z * lever),
      origin: base.clone(),
      baseQuat: root.quaternion.clone(),
      height,
      halfWidth: extentAlong(fp, dir.z, dir.x) + TOPPLE.spread,
      t: 0
    };
    root.userData.lying = null;
    if (snap) { pose(fall, 1); land(fall); } else falls.push(fall);
  }

  /** @param {MirrorFall} fall @param {number} progress 0..1 @returns {void} */
  function pose(fall, progress) {
    scratchQuat.setFromAxisAngle(fall.axis, toppleAngle(progress));
    scratchVec.copy(fall.origin).sub(fall.pivot).applyQuaternion(scratchQuat);
    fall.root.position.copy(fall.pivot).add(scratchVec);
    fall.root.quaternion.copy(scratchQuat).multiply(fall.baseQuat);
  }

  /** @param {MirrorFall} fall @returns {void} */
  function land(fall) {
    const fp = fall.root.userData.footprint;
    fall.root.userData.lying = lyingBoxes(fp, fall.dir, fall.axis, fall.pivot, fall.height, fall.halfWidth);
  }

  /**
   * Applies the host's rows and steps the falls in progress. Called every
   * frame while viewing the host (an empty map between deltas).
   * @param {Map<number, number[]>} rows
   * @param {number} dt
   * @returns {void}
   */
  function apply(rows, dt) {
    const env = ctx.Environment;
    for (const [index, row] of rows) {
      const b = env && env.buildings[index];
      if (!b || !b.mesh || index < 0 || index >= MAX_BUILDINGS) continue;
      // A rebuilt town (a new seed) has new roots: start that building over.
      if (roots[index] !== b.mesh) { roots[index] = b.mesh; applied[index] = 0; }
      const bits = newBits(applied[index], row[1]);
      if (!bits) continue;
      applied[index] |= bits;
      tearPieces(b, bits);
      if (bits & BLD_BIT.collapsed) {
        b.damageState = 'collapsed';
        darkenBuildingWindows(b, true);
        hideBuildingWindows(b.mesh);
        if (row[2] >= 0) startFall(b, row[2], !primed);
      }
      if (bits & BLD_BIT.consumed) {
        b.consumed = true;
        b.damageState = 'collapsed';
        b.mesh.visible = false;
      }
    }
    if (rows.size) primed = true;
    for (let i = falls.length - 1; i >= 0; i--) {
      const fall = falls[i];
      if (!fall.root.parent) { falls.splice(i, 1); continue; }
      fall.t += dt;
      const progress = Math.min(1, fall.t / FALL_SECONDS);
      pose(fall, progress);
      if (progress >= 1) { land(fall); falls.splice(i, 1); }
    }
  }

  return {
    apply,
    active: () => falls.length > 0,
    /** Forget everything applied (leaving the host's view; the caller rebuilds the town). */
    clear() {
      applied.fill(0);
      roots.fill(null);
      falls.length = 0;
      primed = false;
    }
  };
}
