// @ts-check
import * as THREE from 'three';
import { DEBRIS_KIND_NAMES } from './debris.js';
import { PERSON } from './scale.js';

/**
 * ===========================================================================
 * SECTION F.2 — Debris impacts
 * ===========================================================================
 * Until this existed, a car thrown by the vortex flew straight through a
 * house. Debris was simulated against the wind and the ground and nothing
 * else, so the most violent thing in the scene -- several tonnes of masonry
 * doing 30 units a second -- could not touch anything.
 *
 * This is the broad phase: it finds the hits and hands each one to
 * damage.js's damageFromImpact(), which owns what a hit actually does. The
 * split matters because the answer ("a wall comes off, and if that is its
 * third wall it collapses, which shocks its neighbours") already lives there.
 *
 * What is tested, and what deliberately is not:
 *  - only debris the vortex is *not* currently holding. Anything 'orbiting'
 *    or 'rising' is inside the column, where it is positioned kinematically
 *    at up to the funnel's full tangential speed; letting that collide would
 *    turn the funnel interior into a blender that levelled the town in
 *    seconds, and it is the stuff *thrown clear* that is dramatic anyway;
 *  - only debris carrying real energy (damage.js's IMPACT_MIN_ENERGY), which
 *    drops most of the pool most of the time before any test runs;
 *  - buildings via a uniform grid of footprint boxes, rebuilt only when the
 *    town is regenerated -- the same structure, cell size and slab test
 *    peopleMotion.js uses for walking into walls;
 *  - people, cars and standing trees by a swept sphere against the debris's
 *    own path.
 *
 * Every test is against the *segment* the debris covered this frame, not its
 * end point. At EF5 a piece moves over a unit per frame and the fastest ones
 * move several, so a point test would let exactly the most spectacular
 * impacts tunnel straight through a wall.
 */

// Grid cell size for the building broad phase. Matches peopleMotion.js's
// COLLISION_CELL: the same town, the same footprints, no reason to differ.
const COLLISION_CELL = 16;
// Seconds a piece of debris is inert after a hit. Without it a piece resting
// against a wall re-hits it every frame, and one unlucky bounce would take a
// building apart on its own.
const IMPACT_COOLDOWN = 0.45;
// How much speed a piece keeps after hitting something solid, and how hard it
// is pushed back out along the surface it hit.
const IMPACT_RESTITUTION = 0.32;
const IMPACT_KICKBACK = 2.5;
// Hit radii for the swept-sphere targets, in metres (a person from
// engine/scale.js PERSON); these are generous rather than exact, because
// a near miss that visibly should have connected reads as a bug.
const PERSON_HIT_RADIUS = PERSON.height * 0.35;
const CAR_HIT_RADIUS = 2.6;
const TREE_HIT_RADIUS = 1.8;
// Generous: a pillar is 3 units across at the base and a deck span is 9 wide
// and tens long, so this is the radius at which a hit reads as connecting
// rather than an exact bound.
const VIADUCT_HIT_RADIUS = 4.5;
// Debris above this is over the roofs and past anything on the ground.
const GROUND_TARGET_MAX_HEIGHT = 8;
// Clearance added to a building's wall height: a piece skimming just over the
// parapet should still clip it.
const BUILDING_HEIGHT_MARGIN = 1.2;

/**
 * @typedef {{minX:number, maxX:number, minZ:number, maxZ:number, top:number,
 *            building:SimObject, stamp:number}} ImpactBox
 */

/**
 * @param {Object} ctx
 * @returns {{ updateDebrisImpacts: (dt: number) => void }}
 */
export function createDebrisImpactsSystem(ctx) {
  const { Sim } = ctx;

  /** @type {Map<string, ImpactBox[]>} */
  let grid = new Map();
  /** @type {SimObject[]|null} the buildings array the grid was built from */
  let gridSource = null;
  let queryStamp = 0;

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();

  /**
   * (Re)builds the building grid when the town has been regenerated.
   * resetEnvironment() replaces Environment.buildings with a new array, so
   * comparing the reference is enough to notice.
   * @returns {void}
   */
  function ensureGrid() {
    const buildings = ctx.Environment.buildings;
    if (buildings === gridSource) return;
    gridSource = buildings;
    grid = new Map();
    for (const b of buildings) {
      const fp = b.mesh.userData.footprint;
      const p = b.mesh.position;
      /** @type {ImpactBox} */
      const box = {
        minX: p.x - fp.width / 2,
        maxX: p.x + fp.width / 2,
        minZ: p.z - fp.depth / 2,
        maxZ: p.z + fp.depth / 2,
        top: (b.mesh.userData.wallHeight || 4) + BUILDING_HEIGHT_MARGIN,
        building: b,
        stamp: 0
      };
      for (let cx = Math.floor(box.minX / COLLISION_CELL); cx <= Math.floor(box.maxX / COLLISION_CELL); cx++) {
        for (let cz = Math.floor(box.minZ / COLLISION_CELL); cz <= Math.floor(box.maxZ / COLLISION_CELL); cz++) {
          const key = `${cx},${cz}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(box);
        }
      }
    }
  }

  /**
   * Slab test of the ground-plane segment against a box, returning where it
   * first enters. Same algorithm as peopleMotion.js's segmentHitsBox, but it
   * reports the entry parameter rather than just whether they touch, because
   * the impact point is what decides which wall comes off.
   * @param {ImpactBox} box
   * @param {number} x0
   * @param {number} z0
   * @param {number} x1
   * @param {number} z1
   * @returns {number} entry t in [0, 1], or -1 for a miss
   */
  function segmentEntersBox(box, x0, z0, x1, z1) {
    let tMin = 0;
    let tMax = 1;
    const dx = x1 - x0;
    const dz = z1 - z0;
    for (const [o, d, lo, hi] of [[x0, dx, box.minX, box.maxX], [z0, dz, box.minZ, box.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (o <= lo || o >= hi) return -1;
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin >= tMax) return -1;
      }
    }
    return tMin;
  }

  /**
   * Parameter along the segment at which it passes closest to a point on the
   * ground plane, clamped to the segment.
   * @param {number} px
   * @param {number} pz
   * @returns {number}
   */
  function closestOnSegment(px, pz) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 1e-9) return 0;
    return THREE.MathUtils.clamp(((px - from.x) * dx + (pz - from.z) * dz) / lenSq, 0, 1);
  }

  /**
   * Stops a piece of debris dead-ish at a hit: most of its speed is lost, the
   * remainder reflected back the way it came, and it is held inert for
   * IMPACT_COOLDOWN so it cannot saw through the same wall frame after frame.
   * @param {SimObject} obj
   * @returns {void}
   */
  function absorbImpact(obj) {
    obj.velocity.multiplyScalar(-IMPACT_RESTITUTION);
    obj.velocity.y = Math.abs(obj.velocity.y) + IMPACT_KICKBACK;
    obj.angularVelocity.set(
      (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8
    );
    obj.impactCooldown = IMPACT_COOLDOWN;
  }

  /**
   * Finds the first thing this piece of debris hits along the path it covered
   * this frame, and applies it.
   * @param {SimObject} obj
   * @param {number} energy
   * @returns {boolean} whether anything was hit
   */
  function resolveDebris(obj, energy) {
    const { damageFromImpact } = ctx.systems.damage;
    let bestT = Infinity;
    /** @type {SimObject|null} */
    let bestTarget = null;

    // Buildings. Only the cells the segment's bounding rectangle covers are
    // visited, and each box is tested at most once per query.
    queryStamp++;
    const cx0 = Math.floor(Math.min(from.x, to.x) / COLLISION_CELL);
    const cx1 = Math.floor(Math.max(from.x, to.x) / COLLISION_CELL);
    const cz0 = Math.floor(Math.min(from.z, to.z) / COLLISION_CELL);
    const cz1 = Math.floor(Math.max(from.z, to.z) / COLLISION_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = grid.get(`${cx},${cz}`);
        if (!cell) continue;
        for (const box of cell) {
          if (box.stamp === queryStamp) continue;
          box.stamp = queryStamp;
          if (box.building.damageState === 'collapsed') continue;
          const t = segmentEntersBox(box, from.x, from.z, to.x, to.z);
          if (t < 0 || t >= bestT) continue;
          // Height check at the crossing point, so debris sailing over a
          // bungalow misses it and the same shot clips a tower block.
          if (THREE.MathUtils.lerp(from.y, to.y, t) > box.top) continue;
          bestT = t;
          bestTarget = box.building;
        }
      }
    }

    // People, cars and standing trees: swept sphere against the same segment.
    // Skipped entirely once the debris is above roof height, which is where
    // most of the pool spends its time.
    const env = ctx.Environment;
    /** @type {[Object[], number, number, number][]} list, radius, and the
     * vertical band the debris must be inside to count as hitting it. */
    const groups = [];
    // Skipped entirely once the debris is above roof height, which is where
    // most of the pool spends its time.
    if (Math.min(from.y, to.y) < GROUND_TARGET_MAX_HEIGHT) {
      groups.push(
        [env.people, PERSON_HIT_RADIUS, 0, GROUND_TARGET_MAX_HEIGHT],
        [env.cars, CAR_HIT_RADIUS, 0, GROUND_TARGET_MAX_HEIGHT],
        [env.trees, TREE_HIT_RADIUS, 0, GROUND_TARGET_MAX_HEIGHT]
      );
    }
    // The elevated highway's pillars and spans are targets in their own right,
    // not just a shelf the traffic sits on: a thrown car can bring a pillar
    // down (environment/viaduct.js). They get their own pass rather than
    // joining the ground groups because they live above the height those are
    // gated to, and each piece carries its own band -- this test is
    // horizontal-only, so without one a piece sailing high over a pillar
    // would register as having struck it. Rebuilt per query rather than
    // cached, since pieces leave the list as they fail and there are only
    // ever about fifteen.
    for (const target of ctx.systems.viaduct.impactTargets()) {
      groups.push([[target], VIADUCT_HIT_RADIUS, target.hitY[0], target.hitY[1]]);
    }

    for (const [list, radius, minY, maxY] of groups) {
      const radiusSq = radius * radius;
      for (const target of list) {
        if (target === obj || !target.mesh || !target.mesh.parent) continue;
        // Anything the vortex already has is not standing there to be hit.
        if (target.captureState && target.captureState !== 'grounded') continue;
        if (target.type === 'tree' && target.damageState === 'uprooted') continue;
        const p = target.mesh.position;
        const t = closestOnSegment(p.x, p.z);
        if (t >= bestT) continue;
        const y = THREE.MathUtils.lerp(from.y, to.y, t);
        if (y < minY || y > maxY) continue;
        const dx = THREE.MathUtils.lerp(from.x, to.x, t) - p.x;
        const dz = THREE.MathUtils.lerp(from.z, to.z, t) - p.z;
        if (dx * dx + dz * dz > radiusSq) continue;
        bestT = t;
        bestTarget = target;
      }
    }

    if (!bestTarget) return false;
    hitPoint.lerpVectors(from, to, bestT);
    Sim.stats.debrisImpacts++;
    if (damageFromImpact(bestTarget, hitPoint, energy)) {
      // Put it back where it struck rather than wherever it had reached, so
      // it does not end up inside the thing it just hit.
      obj.position.copy(hitPoint);
      obj.lastX = hitPoint.x;
      obj.lastY = hitPoint.y;
      obj.lastZ = hitPoint.z;
      absorbImpact(obj);
    }
    return true;
  }

  /**
   * Per frame, after integratePhysics() has moved everything: walks the debris
   * pool, works out what each fast-moving piece passed through, and applies
   * the first thing it hit.
   * @param {number} dt
   * @returns {void}
   */
  function updateDebrisImpacts(dt) {
    if (!ctx.Environment || !ctx.Environment.buildings.length) return;
    ensureGrid();
    const { DebrisPool, syncDebrisInstances } = ctx.systems.debris;
    const minEnergy = ctx.systems.damage.IMPACT_MIN_ENERGY;
    let hitAnything = false;

    for (const kind of DEBRIS_KIND_NAMES) {
      for (const obj of DebrisPool.slots[kind]) {
        if (!obj) continue;

        if (obj.impactCooldown > 0) {
          obj.impactCooldown -= dt;
          obj.lastX = obj.position.x;
          obj.lastY = obj.position.y;
          obj.lastZ = obj.position.z;
          continue;
        }

        // First sight of a recycled slot: spawnDebris builds a fresh object
        // literal, so there is no stale previous position to worry about.
        if (obj.lastX === undefined) {
          obj.lastX = obj.position.x;
          obj.lastY = obj.position.y;
          obj.lastZ = obj.position.z;
          continue;
        }

        from.set(obj.lastX, obj.lastY, obj.lastZ);
        to.copy(obj.position);
        obj.lastX = obj.position.x;
        obj.lastY = obj.position.y;
        obj.lastZ = obj.position.z;

        // Held by the vortex: see the note at the top of this file.
        if (obj.captureState === 'orbiting' || obj.captureState === 'rising') continue;

        const speedSq = obj.velocity.lengthSq();
        const energy = 0.5 * obj.mass * speedSq;
        if (energy < minEnergy) continue;

        // Poles and wires first, since they do not stop the piece: it can
        // bring a line down and still go on to hit whatever is behind it.
        ctx.systems.powerLines.debrisStrike(from, to);
        if (resolveDebris(obj, energy)) hitAnything = true;
      }
    }

    // integratePhysics() already wrote this frame's instance matrices before
    // this ran, so a piece pulled back to its impact point would otherwise
    // render one frame deep inside the wall it just hit. Only on a frame
    // where something actually connected, which is rare.
    if (hitAnything) syncDebrisInstances();
  }

  return { updateDebrisImpacts };
}
