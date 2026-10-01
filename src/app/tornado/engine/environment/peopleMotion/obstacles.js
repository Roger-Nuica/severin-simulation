import * as THREE from 'three';
import { WORLD_BOUND, PERSON_CLEARANCE, COLLISION_CELL, FLEE_PROBE_DISTANCE, FLEE_PROBE_OFFSETS, UNSTICK_SECONDS, BOUND_MARGIN } from './config.js';
/** @typedef {import('./config.js').PersonMotion} PersonMotion */
/** @typedef {import('./config.js').BuildingBox} BuildingBox */

/**
 * ===========================================================================
 * SECTION PM.1 — What is in the way
 * ===========================================================================
 * The grid of solid buildings, whether a path is clear, pushing someone
 * out of a wall, and which way to run from a hazard or a funnel.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see peopleMotion.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createCrowdObstacles(ctx, S, api) {
  /**
   * (Re)builds the building grid if the town has been regenerated since the
   * last build. resetEnvironment() replaces Environment.buildings with a new
   * array, so comparing the reference is enough to notice.
   * @returns {void}
   */
  function ensureGrid() {
    const buildings = ctx.Environment.buildings;
    if (buildings === S.gridSource) return;
    S.gridSource = buildings;
    S.grid = new Map();
    for (const b of buildings) {
      const fp = b.mesh.userData.footprint;
      const p = b.mesh.position;
      /** @type {BuildingBox} */
      const box = {
        minX: p.x - fp.width / 2 - PERSON_CLEARANCE,
        maxX: p.x + fp.width / 2 + PERSON_CLEARANCE,
        minZ: p.z - fp.depth / 2 - PERSON_CLEARANCE,
        maxZ: p.z + fp.depth / 2 + PERSON_CLEARANCE,
        building: b,
        stamp: 0
      };
      for (let cx = Math.floor(box.minX / COLLISION_CELL); cx <= Math.floor(box.maxX / COLLISION_CELL); cx++) {
        for (let cz = Math.floor(box.minZ / COLLISION_CELL); cz <= Math.floor(box.maxZ / COLLISION_CELL); cz++) {
          const key = `${cx},${cz}`;
          if (!S.grid.has(key)) S.grid.set(key, []);
          S.grid.get(key).push(box);
        }
      }
    }
  }

  /**
   * @param {BuildingBox} box
   * @returns {boolean} whether the box still blocks movement
   */
  function isSolid(box) {
    return box.building.damageState !== 'collapsed';
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {BuildingBox|null} the box containing the point, if any
   */
  function boxAt(x, z) {
    const cell = S.grid.get(`${Math.floor(x / COLLISION_CELL)},${Math.floor(z / COLLISION_CELL)}`);
    if (!cell) return null;
    for (const box of cell) {
      if (isSolid(box) && x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) return box;
    }
    return null;
  }

  /**
   * 2D slab test: does the segment (x0,z0)->(x1,z1) pass through the box?
   * @param {BuildingBox} box
   * @param {number} x0
   * @param {number} z0
   * @param {number} x1
   * @param {number} z1
   * @returns {boolean}
   */
  function segmentHitsBox(box, x0, z0, x1, z1) {
    let tMin = 0;
    let tMax = 1;
    const dx = x1 - x0;
    const dz = z1 - z0;
    for (const [o, d, lo, hi] of [[x0, dx, box.minX, box.maxX], [z0, dz, box.minZ, box.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (o <= lo || o >= hi) return false;
      } else {
        let t1 = (lo - o) / d;
        let t2 = (hi - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin >= tMax) return false;
      }
    }
    return true;
  }

  /**
   * Whether a straight walk from (x0,z0) to (x1,z1) would pass through any
   * building. Only the grid cells the segment's bounding rectangle covers
   * are visited, and each box is tested at most once per query.
   * @param {number} x0
   * @param {number} z0
   * @param {number} x1
   * @param {number} z1
   * @returns {boolean}
   */
  function segmentBlocked(x0, z0, x1, z1) {
    S.queryStamp++;
    const cx0 = Math.floor(Math.min(x0, x1) / COLLISION_CELL);
    const cx1 = Math.floor(Math.max(x0, x1) / COLLISION_CELL);
    const cz0 = Math.floor(Math.min(z0, z1) / COLLISION_CELL);
    const cz1 = Math.floor(Math.max(z0, z1) / COLLISION_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const cell = S.grid.get(`${cx},${cz}`);
        if (!cell) continue;
        for (const box of cell) {
          if (box.stamp === S.queryStamp) continue;
          box.stamp = S.queryStamp;
          if (isSolid(box) && segmentHitsBox(box, x0, z0, x1, z1)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Moves a point that is inside a building box out through the nearest
   * side. Used once per person, for anyone generateEnvironment() happened to
   * place inside a building (its placement jitter does not check).
   * @param {THREE.Vector3} pos mutated in place
   * @returns {void}
   */
  function pushOutOfBuildings(pos) {
    for (let guard = 0; guard < 4; guard++) {
      const box = boxAt(pos.x, pos.z);
      if (!box) return;
      const exits = [
        { d: pos.x - box.minX, x: box.minX - 0.05, z: pos.z },
        { d: box.maxX - pos.x, x: box.maxX + 0.05, z: pos.z },
        { d: pos.z - box.minZ, x: pos.x, z: box.minZ - 0.05 },
        { d: box.maxZ - pos.z, x: pos.x, z: box.maxZ + 0.05 }
      ];
      exits.sort((a, b) => a.d - b.d);
      pos.x = exits[0].x;
      pos.z = exits[0].z;
    }
  }

  /**
   * The shortest way out of a ground hazard (engine/hazards.js).
   *
   * Not simply "away from the centre": a hazard can be far longer than it is
   * wide -- a viaduct span's shadow, or a burning gas main, which runs the
   * whole length of a street -- and running away from the centre of one of
   * those means running *along* it, which is the one direction that does not
   * get you out. Stepping away from the centre in units of each extent
   * instead points across the narrow way every time.
   * @param {THREE.Vector3} pos
   * @param {Object} hazard
   * @returns {number} heading, in this module's atan2(x, z) convention
   */
  function hazardEscapeHeading(pos, hazard) {
    const rx = Math.max(1, hazard.radius);
    const rz = Math.max(1, hazard.radiusZ || hazard.radius);
    const dx = (pos.x - hazard.x) / (rx * rx);
    const dz = (pos.z - hazard.z) / (rz * rz);
    // Dead centre of a hazard gives no direction at all; across the narrow
    // axis is the best guess available.
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
      return rx >= rz ? (Math.random() < 0.5 ? 0 : Math.PI) : Math.PI / 2;
    }
    return Math.atan2(dx, dz);
  }

  /**
   * Picks the heading a fleeing person should run on: straight away from
   * the funnel if that is clear for FLEE_PROBE_DISTANCE, otherwise the
   * nearest clear heading in the fan. If everything is blocked they keep
   * running straight away and the per-step slide does what it can.
   * Also used towards a shelter's door, with the probe shortened to the
   * distance left so the shelter itself does not count as in the way.
   * @param {THREE.Vector3} pos
   * @param {number} away heading directly away from the funnel (or towards the door)
   * @param {number} [reach] probe length
   * @returns {number}
   */
  function probeFleeHeading(pos, away, reach = FLEE_PROBE_DISTANCE) {
    for (const offset of FLEE_PROBE_OFFSETS) {
      const h = away + offset;
      if (headingClear(pos, h, reach)) return h;
    }
    return away;
  }

  /**
   * @param {THREE.Vector3} pos
   * @param {number} h heading
   * @param {number} reach
   * @returns {boolean} whether a straight run of `reach` along `h` clears
   *   every building and stays on the map
   */
  function headingClear(pos, h, reach) {
    const x1 = pos.x + Math.sin(h) * reach;
    const z1 = pos.z + Math.cos(h) * reach;
    const edge = WORLD_BOUND - BOUND_MARGIN;
    if (Math.abs(x1) > edge || Math.abs(z1) > edge) return false;
    return !segmentBlocked(pos.x, pos.z, x1, z1);
  }

  /**
   * The watchdog's remedy for someone stuck: out of any building they are
   * standing in, and off on the clear heading nearest the one they wanted
   * (or any clear one) for UNSTICK_SECONDS. A follower who got stuck trying
   * to keep up leaves the pair rather than getting stuck again at once.
   * @param {SimObject} person
   * @param {PersonMotion} m
   * @param {number} wanted the heading they were trying to go on
   * @returns {void}
   */
  function unstick(person, m, wanted) {
    const pos = person.mesh.position;
    pushOutOfBuildings(pos);
    let heading = wanted + Math.PI;
    for (let k = 0; k < 16; k++) {
      // Nearest to the wanted heading first, alternating sides, then behind.
      const offset = Math.ceil(k / 2) * (k % 2 ? 1 : -1) * (Math.PI / 8);
      if (headingClear(pos, wanted + offset, FLEE_PROBE_DISTANCE)) {
        heading = wanted + offset;
        // Straight ahead being clear means a wall is not the problem; turn
        // off it anyway, or the same thing that stopped them stops them again.
        if (offset !== 0) break;
      }
    }
    m.unstickHeading = heading;
    m.unstickTimer = UNSTICK_SECONDS;
    m.stuckTime = 0;
    m.fleeProbeTimer = UNSTICK_SECONDS;
    if (m.leader) {
      if (m.leader.motion && m.leader.motion.partner === person) m.leader.motion.partner = null;
      m.leader = null;
      m.partner = null;
    }
  }

  return { ensureGrid, isSolid, boxAt, segmentHitsBox, segmentBlocked, pushOutOfBuildings, hazardEscapeHeading, probeFleeHeading, headingClear, unstick };
}
