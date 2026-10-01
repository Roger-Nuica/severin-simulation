/**
 * ===========================================================================
 * SECTION D.10 — What is in the road
 * ===========================================================================
 * For the vehicles that run a fixed line kinematically -- the train on its
 * rails (train.js) and the fuel tanker on the ring road (tanker.js). Neither
 * is in the physics pass while it is driving (both are `rooted`), so nothing
 * ever stopped them: the train ran straight through a tower lying across the
 * rails, and the tanker through the buildings that stand on the ring road and
 * the wrecks left on it. Now each looks a little way down its own line every
 * frame and brakes to a stop in front of whatever is there, and waits.
 *
 * What counts as in the way, cheapest first:
 *  - a building's footprint (buildings.js userData.footprint), standing or
 *    not -- a collapse leaves its heap where it stood;
 *  - a rubble pile (rubble.js), which is what a toppled building leaves
 *    along the line it fell;
 *  - a landed spaceship (spaceship.js);
 *  - a vehicle on the ground: a wreck, a thrown car, a derailed wagon, the
 *    train for the tanker and the tanker for the train. A long vehicle
 *    carries its own box (userData.blockBox, along its local +X); anything
 *    else is a car-sized circle. Airborne ones, the viaduct's traffic up on
 *    the deck, the emergency fleet (which already brakes for the tanker
 *    itself, emergency/vehicles.js) and a vehicle that has stopped to give
 *    way (userData.yielding) are left out -- two things each waiting for
 *    the other would never move again.
 *
 * Pure functions of ctx: no state of their own.
 */

/** A car-sized obstacle, for vehicles without a blockBox of their own. */
const CAR_RADIUS = 2.4;
/** Above this, a vehicle is up on the viaduct's deck, not in the road. */
const GROUND_HEIGHT = 3;

/**
 * @typedef {Object} BlockBox
 * @property {number} cx centre along the mesh's local +X
 * @property {number} hl half its length along local +X
 * @property {number} hw half its width across
 */

/**
 * Whether a ground point is within `reach` of a box lying along a mesh's
 * local +X, turned with the mesh's yaw.
 * @param {number} x
 * @param {number} z
 * @param {THREE.Object3D} mesh
 * @param {BlockBox} box
 * @param {number} reach
 * @returns {boolean}
 */
export function inBlockBox(x, z, mesh, box, reach) {
  const dx = x - mesh.position.x;
  const dz = z - mesh.position.z;
  const c = Math.cos(mesh.rotation.y);
  const s = Math.sin(mesh.rotation.y);
  // three.js yaw: local +X is world (cos, 0, -sin), local +Z (sin, 0, cos).
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx - box.cx) < box.hl + reach && Math.abs(lz) < box.hw + reach;
}

/**
 * @param {Object} ctx
 * @param {number} x
 * @param {number} z
 * @param {number} reach
 * @returns {boolean} whether a building's footprint covers the point
 */
function buildingAt(ctx, x, z, reach) {
  for (const building of ctx.Environment.buildings) {
    const fp = building.mesh.userData.footprint;
    if (!fp || !building.mesh.parent) continue;
    const b = building.mesh.position;
    if (Math.abs(x - b.x) < fp.width / 2 + reach && Math.abs(z - b.z) < fp.depth / 2 + reach) return true;
  }
  return false;
}

/**
 * @param {Object} ctx
 * @param {number} x
 * @param {number} z
 * @param {number} reach
 * @param {Set<Object>} skip the asking vehicle's own objects
 * @returns {boolean} whether a vehicle on the ground is at the point
 */
function vehicleAt(ctx, x, z, reach, skip) {
  for (const obj of ctx.Sim.objects) {
    if (obj.type !== 'car' || skip.has(obj)) continue;
    const mesh = obj.mesh;
    if (!mesh || !mesh.parent || !mesh.visible || mesh.userData.emergency) continue;
    // Stopped and giving way (the tanker waiting for the train): the other
    // one goes first, or each would wait for the other for good.
    if (mesh.userData.yielding) continue;
    if (mesh.position.y > GROUND_HEIGHT) continue;
    if (obj.captureState === 'rising' || obj.captureState === 'orbiting') continue;
    const box = mesh.userData.blockBox;
    if (box) {
      if (inBlockBox(x, z, mesh, box, reach)) return true;
    } else if (Math.hypot(x - mesh.position.x, z - mesh.position.z) < CAR_RADIUS + reach) {
      return true;
    }
  }
  return false;
}

/**
 * What stands at a ground point, if anything a vehicle has to stop for.
 * @param {Object} ctx
 * @param {number} x
 * @param {number} z
 * @param {number} reach half the asking vehicle's width, plus any margin
 * @param {Set<Object>} skip the asking vehicle's own objects
 * @returns {''|'building'|'rubble'|'ship'|'vehicle'} '' when the way is clear
 */
export function roadBlockAt(ctx, x, z, reach, skip) {
  if (buildingAt(ctx, x, z, reach)) return 'building';
  const rubble = ctx.systems.rubble;
  if (rubble && rubble.blocksPoint(x, z, reach)) return 'rubble';
  const ships = ctx.systems.spaceship && ctx.systems.spaceship.landedSpots
    ? ctx.systems.spaceship.landedSpots()
    : [];
  for (const ship of ships) {
    if (Math.hypot(x - ship.x, z - ship.z) < ship.radius + reach) return 'ship';
  }
  if (vehicleAt(ctx, x, z, reach, skip)) return 'vehicle';
  return '';
}

/**
 * Whether anything is in the way over a stretch of the line ahead, sampled
 * every `step` units from `from` to `to` along it.
 * @param {Object} ctx
 * @param {(along: number) => {x: number, z: number}} pointAt ground point
 *   `along` units ahead of the vehicle's front
 * @param {number} from
 * @param {number} to
 * @param {number} step
 * @param {number} reach
 * @param {Set<Object>} skip
 * @returns {number} how far ahead the first obstacle is; Infinity when clear
 */
export function firstBlockAhead(ctx, pointAt, from, to, step, reach, skip) {
  for (let along = from; along <= to; along += step) {
    const p = pointAt(along);
    if (roadBlockAt(ctx, p.x, p.z, reach, skip)) return along;
  }
  return Infinity;
}
