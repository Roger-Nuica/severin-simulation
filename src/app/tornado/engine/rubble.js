// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AG — Rubble
 * ===========================================================================
 * What a building leaves lying in the road.
 *
 * Until now destruction was weightless in one very specific way: it never got
 * in anybody's way. A building came down, the pieces became debris, the
 * debris settled, and the street was as driveable as it had been. That was
 * fine while nothing had anywhere to be -- and it stopped being fine the
 * moment the town got fire engines (engine/emergency/index.js).
 *
 * A pile here does two things:
 *
 *  - it is **drawn**, as a heap of chunks from one instanced mesh, so a
 *    street that has had a tower fall across it looks like one;
 *  - it is **blocking**, and route-finding (environment/streets.js) will not
 *    plot a leg through it. A fire two streets away with every approach
 *    buried is a fire that burns, and the player did that on purpose.
 *
 * Deliberately separate from the debris pool. Debris is *in flight*: it is
 * integrated every frame, it collides, it is recycled the moment the pool
 * needs the slot back. A pile is the opposite of all of that -- it never
 * moves again, it is never recycled while anything can still see it, and the
 * only question ever asked of it is "is this spot passable".
 */

const RUBBLE = {
  // Piles kept at once. The oldest is dropped when a new one needs the room,
  // so a long run of collapses does not accumulate for ever.
  maxPiles: 64,
  chunksPerPile: 8,
  chunkSize: [0.8, 2.4],
  // A chunk sits at this fraction of its own size above the ground, so the
  // heap reads as resting on the road rather than half sunk into it.
  sit: 0.34,
  // How far out from a pile's centre the chunks scatter, as a fraction of the
  // pile's radius.
  scatter: 0.85,
  // Extra clearance a vehicle needs beyond the pile itself. A fire engine is
  // seven units long and does not thread gaps.
  clearance: 3.4,
  // How finely a route leg is sampled when testing it for blockage. Below the
  // smallest pile radius, so a pile cannot sit unnoticed between two samples.
  sampleStep: 3,
  colours: [0x6b6560, 0x5a5550, 0x7a736a, 0x4e4a46]
};

/**
 * @typedef {Object} Pile
 * @property {number} x
 * @property {number} z
 * @property {number} radius
 * @property {number} first index of its first chunk in the instanced mesh
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initRubble: () => void,
 *   addPile: (x: number, z: number, radius: number) => void,
 *   blocksPoint: (x: number, z: number, clearance?: number) => boolean,
 *   blocksSegment: (ax: number, az: number, bx: number, bz: number, clearance?: number) => boolean,
 *   pileCount: () => number,
 *   resetRubble: () => void,
 *   disposeRubble: () => void
 * }}
 */
export function createRubbleSystem(ctx) {
  const { Sim } = ctx;

  /** @type {Pile[]} */
  const piles = [];
  /** @type {THREE.InstancedMesh|null} */
  let chunks = null;
  let nextChunk = 0;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const colour = new THREE.Color();

  /** @returns {void} */
  function initRubble() {
    const total = RUBBLE.maxPiles * RUBBLE.chunksPerPile;
    // A one-subdivision icosahedron: enough facets that a heap of them reads
    // as broken masonry rather than as a pile of dice, and cheap enough that
    // five hundred of them are one draw call.
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    chunks = new THREE.InstancedMesh(geometry, material, total);
    chunks.name = 'rubble';
    chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // No shadow: too small to show in a 1024 shadow map, and every caster
    // is drawn a second time into it (performance pass).
    chunks.castShadow = false;
    chunks.receiveShadow = true;
    // Spread across the whole town, so bounds computed from the origin are
    // meaningless and culling would drop the lot.
    chunks.frustumCulled = false;
    // Every instance starts collapsed to nothing rather than stacked at the
    // origin, which is what an untouched InstancedMesh would otherwise draw.
    matrix.makeScale(0, 0, 0);
    for (let i = 0; i < total; i++) {
      chunks.setMatrixAt(i, matrix);
      chunks.setColorAt(i, colour.setHex(RUBBLE.colours[0]));
    }
    chunks.instanceMatrix.needsUpdate = true;
    chunks.instanceColor.needsUpdate = true;
    Sim.three.scene.add(chunks);
  }

  /**
   * Drops a heap of masonry. Called along the length of a building that has
   * toppled (engine/topple.js), so a tower across a street leaves a line of
   * these rather than one mound at its base.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {void}
   */
  function addPile(x, z, radius) {
    if (!chunks) return;
    if (piles.length >= RUBBLE.maxPiles) {
      // The oldest pile's chunks are overwritten in place by the new one, so
      // the instanced mesh never has to be compacted.
      const oldest = piles.shift();
      nextChunk = oldest.first;
    }
    const first = nextChunk;
    for (let i = 0; i < RUBBLE.chunksPerPile; i++) {
      const index = (first + i) % (RUBBLE.maxPiles * RUBBLE.chunksPerPile);
      const size = RUBBLE.chunkSize[0]
        + Math.random() * (RUBBLE.chunkSize[1] - RUBBLE.chunkSize[0]);
      const angle = Math.random() * Math.PI * 2;
      // Denser in the middle: the square root spreads points evenly over a
      // disc, and without it a heap is a ring.
      const out = Math.sqrt(Math.random()) * radius * RUBBLE.scatter;
      position.set(x + Math.cos(angle) * out, size * RUBBLE.sit, z + Math.sin(angle) * out);
      euler.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      quaternion.setFromEuler(euler);
      // Flattened a little, so a chunk reads as a slab of wall rather than a
      // boulder.
      scale.set(size, size * (0.45 + Math.random() * 0.4), size * (0.7 + Math.random() * 0.5));
      chunks.setMatrixAt(index, matrix.compose(position, quaternion, scale));
      chunks.setColorAt(index, colour.setHex(
        RUBBLE.colours[Math.floor(Math.random() * RUBBLE.colours.length)]
      ));
    }
    nextChunk = (first + RUBBLE.chunksPerPile) % (RUBBLE.maxPiles * RUBBLE.chunksPerPile);
    chunks.instanceMatrix.needsUpdate = true;
    chunks.instanceColor.needsUpdate = true;
    piles.push({ x, z, radius, first });
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} [clearance]
   * @returns {boolean} whether a vehicle could stand here
   */
  function blocksPoint(x, z, clearance = RUBBLE.clearance) {
    for (const pile of piles) {
      const reach = pile.radius + clearance;
      const dx = x - pile.x;
      const dz = z - pile.z;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
  }

  /**
   * Whether a straight run between two points is passable. Sampled rather
   * than solved: a route leg is at most two hundred units and the step is
   * three, so this is seventy distance tests against a list that is single
   * digits long most of the time.
   * @param {number} ax
   * @param {number} az
   * @param {number} bx
   * @param {number} bz
   * @param {number} [clearance]
   * @returns {boolean}
   */
  function blocksSegment(ax, az, bx, bz, clearance = RUBBLE.clearance) {
    if (!piles.length) return false;
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / RUBBLE.sampleStep));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (blocksPoint(ax + (bx - ax) * t, az + (bz - az) * t, clearance)) return true;
    }
    return false;
  }

  /** @returns {number} */
  function pileCount() {
    return piles.length;
  }

  /** @returns {void} */
  function resetRubble() {
    piles.length = 0;
    nextChunk = 0;
    if (!chunks) return;
    matrix.makeScale(0, 0, 0);
    for (let i = 0; i < chunks.count; i++) chunks.setMatrixAt(i, matrix);
    chunks.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} */
  function disposeRubble() {
    if (!chunks) return;
    Sim.three.scene.remove(chunks);
    chunks.geometry.dispose();
    chunks.material.dispose();
    chunks.dispose();
    chunks = null;
    piles.length = 0;
  }

  return {
    initRubble, addPile, blocksPoint, blocksSegment, pileCount, resetRubble, disposeRubble
  };
}
