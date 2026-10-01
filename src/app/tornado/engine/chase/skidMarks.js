// @ts-check
import * as THREE from 'three';
import { CHASE_TUNE } from './car.js';

/**
 * Chase car tire-mark decals: a fixed-capacity ring buffer of flat quad
 * instances (same "InstancedMesh + fixed slot count" idiom as DebrisPool,
 * just recycled oldest-first instead of freelist-based since marks have no
 * individual lifetime to track). Kept as its own tiny system rather than
 * folded into PathTrack, since PathTrack is a single ever-growing ribbon
 * for the tornado's own ground scar over one run, while this needs to
 * recycle indefinitely across an open-ended chase session.
 */

const SKID_MARK_SIZE = { width: 0.28, length: 0.9 };
const SKID_TRACK_WIDTH = 0.9;   // lateral offset between the two tire marks
const SKID_MIN_SPACING = 0.55;  // world units between successive placements, so marks space out by distance travelled rather than by frame/time (arcade speed varies a lot)

/**
 * @param {Object} ctx
 * @returns {{
 *   SkidMarks: Object,
 *   initSkidMarks: () => void,
 *   addSkidMarkInstance: (x: number, z: number, heading: number) => void,
 *   updateSkidMarks: (pos: THREE.Vector3, heading: number, skidding: boolean) => void,
 *   clearSkidMarks: () => void
 * }}
 */
export function createSkidMarksSystem(ctx) {
  const { Sim } = ctx;

  const SkidMarks = {
    mesh: /** @type {THREE.InstancedMesh|null} */ (null),
    capacity: 240,
    nextIndex: 0,
    count: 0,
    dummy: new THREE.Object3D(),
    lastMarkPos: /** @type {THREE.Vector3|null} */ (null)
  };

  /** @returns {void} */
  function initSkidMarks() {
    const geo = new THREE.PlaneGeometry(SKID_MARK_SIZE.width, SKID_MARK_SIZE.length);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x14100c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const mesh = new THREE.InstancedMesh(geo, mat, SkidMarks.capacity);
    mesh.name = 'skidMarks';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    Sim.three.scene.add(mesh);
    SkidMarks.mesh = mesh;
  }

  /**
   * Stamps one tire-mark instance at world (x,z) aligned with `heading`,
   * overwriting the oldest instance once the ring buffer wraps.
   * @param {number} x
   * @param {number} z
   * @param {number} heading
   * @returns {void}
   */
  function addSkidMarkInstance(x, z, heading) {
    if (!SkidMarks.mesh) return;
    const idx = SkidMarks.nextIndex;
    SkidMarks.dummy.position.set(x, 0.02, z);
    SkidMarks.dummy.rotation.set(0, heading, 0);
    // As wide as the chase car's tyres, which are drawn at carScale.
    SkidMarks.dummy.scale.set(CHASE_TUNE.carScale, 1, CHASE_TUNE.carScale);
    SkidMarks.dummy.updateMatrix();
    SkidMarks.mesh.setMatrixAt(idx, SkidMarks.dummy.matrix);
    SkidMarks.nextIndex = (idx + 1) % SkidMarks.capacity;
    SkidMarks.count = Math.min(SkidMarks.count + 1, SkidMarks.capacity);
    SkidMarks.mesh.count = SkidMarks.count;
    SkidMarks.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Drops a pair of tire marks either side of the car's centreline while
   * it's skidding (cornering hard at speed, or being buffeted by the vortex
   * in the 'trembling' state) and grounded. No-ops otherwise, and resets the
   * distance gate so the next skid starts a fresh mark immediately rather
   * than waiting out the old spacing.
   * @param {THREE.Vector3} pos
   * @param {number} heading
   * @param {boolean} skidding
   * @returns {void}
   */
  function updateSkidMarks(pos, heading, skidding) {
    if (!skidding) { SkidMarks.lastMarkPos = null; return; }
    if (SkidMarks.lastMarkPos && SkidMarks.lastMarkPos.distanceTo(pos) < SKID_MIN_SPACING) return;
    SkidMarks.lastMarkPos = pos.clone();
    const half = SKID_TRACK_WIDTH * 0.5 * CHASE_TUNE.carScale;
    const perpX = Math.cos(heading) * half;
    const perpZ = -Math.sin(heading) * half;
    addSkidMarkInstance(pos.x + perpX, pos.z + perpZ, heading);
    addSkidMarkInstance(pos.x - perpX, pos.z - perpZ, heading);
  }

  /**
   * Clears all recorded tire marks, called on chase-mode entry (fresh
   * session) and from resetSim() (town regenerates, old marks would no
   * longer correspond to anything on the ground).
   * @returns {void}
   */
  function clearSkidMarks() {
    SkidMarks.nextIndex = 0;
    SkidMarks.count = 0;
    SkidMarks.lastMarkPos = null;
    if (SkidMarks.mesh) SkidMarks.mesh.count = 0;
  }

  return { SkidMarks, initSkidMarks, addSkidMarkInstance, updateSkidMarks, clearSkidMarks };
}
