// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AP — World matrices, only where something moved
 * ===========================================================================
 * three.js brings every object's world matrix up to date before each render
 * (Object3D.updateMatrixWorld): for every object with matrixAutoUpdate it
 * rebuilds the local matrix from position, rotation and scale, and because
 * that always flags the world matrix as stale, it multiplies every world
 * matrix again too -- every building wall, every parked car's wheel, every
 * road decal, every frame, whether or not anything moved. Measured at 1 ms a
 * frame in an ordinary run and 4 ms with a hundred aliens about.
 *
 * updateWorldMatrices does the same job, and gives the same matrices, but
 * rebuilds a local matrix only when that object's position, rotation or
 * scale has changed since it was last built (the last values are kept on
 * the object), and a world matrix only when its own local matrix or its
 * parent's world matrix changed -- which is exactly three's rule, minus the
 * rebuilds that change nothing. Nothing has to be marked static by hand:
 * whatever moves is picked up the frame it moves, and whatever changes
 * parent too.
 *
 * Hidden subtrees are left alone until shown again (then rebuilt whole):
 * three never draws them, so their matrices would only be work thrown away.
 *
 * It honours what three honours: an object with matrixAutoUpdate off keeps
 * whatever matrix it was given (and its matrixWorldNeedsUpdate flag);
 * matrixWorldAutoUpdate off skips an object unless its parent changed; and
 * an object with its own updateMatrixWorld (a camera keeping its inverse,
 * anything else three or the game extends) is handed to that, with its
 * whole subtree, exactly as three would.
 *
 * Called once a frame by the instancer (environment/instancer.js), with the
 * render told not to repeat the pass (tornadoEngine.js animate).
 */

const BASE_UPDATE_MATRIX_WORLD = THREE.Object3D.prototype.updateMatrixWorld;
const BASE_UPDATE_MATRIX = THREE.Object3D.prototype.updateMatrix;

/**
 * Rebuilds an object's local matrix if its position, rotation or scale
 * changed since the last build. The last values live on the object, in ten
 * numbers (position, quaternion, scale).
 * @param {THREE.Object3D} o
 * @returns {boolean} whether the local matrix was rebuilt
 */
function refreshLocal(o) {
  const p = o.position;
  const q = o.quaternion;
  const s = o.scale;
  let c = o.__localKey;
  if (c && c[0] === p.x && c[1] === p.y && c[2] === p.z
    && c[3] === q.x && c[4] === q.y && c[5] === q.z && c[6] === q.w
    && c[7] === s.x && c[8] === s.y && c[9] === s.z) {
    return false;
  }
  if (!c) {
    c = new Float64Array(10);
    o.__localKey = c;
  }
  // Its own updateMatrix if it has one, as three would call it.
  o.updateMatrix();
  c[0] = p.x; c[1] = p.y; c[2] = p.z;
  c[3] = q.x; c[4] = q.y; c[5] = q.z; c[6] = q.w;
  c[7] = s.x; c[8] = s.y; c[9] = s.z;
  return true;
}

/**
 * @param {THREE.Object3D} o
 * @param {boolean} force the parent's world matrix changed
 * @returns {void}
 */
function visit(o, force) {
  // Something with its own idea of how to do this (a camera): as three does.
  if (o.updateMatrixWorld !== BASE_UPDATE_MATRIX_WORLD) {
    o.updateMatrixWorld(force);
    return;
  }
  // Hidden: three draws nothing under it, so nothing under it needs a world
  // matrix yet -- 700-odd objects in an ordinary town (pools waiting, the
  // mutated and the burnt variants, cars' lamps). Marked, and brought fully
  // up to date the frame it is shown again, whatever moved meanwhile.
  // Code that reads a hidden object's matrixWorld calls updateMatrixWorld
  // or updateWorldMatrix first, as it must anyway outside the render.
  if (o.visible === false) {
    o.__skipped = true;
    return;
  }
  if (o.__skipped === true) {
    o.__skipped = false;
    force = true;
  }
  // Moved to another parent (a wall torn off a building, a piece handed to
  // something else): its local values may not have changed, but where it
  // is in the world has.
  if (o.__lastParent !== o.parent) {
    o.__lastParent = o.parent;
    o.matrixWorldNeedsUpdate = true;
  }
  if (o.matrixAutoUpdate) {
    if (o.updateMatrix !== BASE_UPDATE_MATRIX) {
      o.updateMatrix();
    } else if (refreshLocal(o)) {
      o.matrixWorldNeedsUpdate = true;
    }
  }
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.parent === null) o.matrixWorld.copy(o.matrix);
    else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  const children = o.children;
  for (let i = 0, l = children.length; i < l; i++) {
    const child = children[i];
    if (child.matrixWorldAutoUpdate === true || force === true) visit(child, force);
  }
}

/**
 * Brings every world matrix under `root` up to date, rebuilding only what
 * changed (see the header).
 * @param {THREE.Object3D} root the scene
 * @returns {void}
 */
export function updateWorldMatrices(root) {
  visit(root, false);
}
