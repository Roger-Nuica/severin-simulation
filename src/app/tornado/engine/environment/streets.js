// @ts-check
/**
 * ===========================================================================
 * SECTION AB — The street grid
 * ===========================================================================
 * Where the roads are, and how to get from one place to another along them.
 *
 * The grid itself is drawn by environment/roadsDecor.js, and until now every
 * system that cared about it kept its own copy of these numbers: the utility
 * poles strung along the streets (environment/powerLines.js), the crowd's
 * walking routes (environment/peopleMotion.js), the buried mains
 * (engine/gasMains.js). That was survivable while the only question anyone
 * asked was "is this point near a street".
 *
 * Emergency vehicles ask a harder one -- "how do I drive from here to there"
 * -- and a vehicle that answers it from a stale copy of the grid drives down
 * the pavement. So the grid lives here now, with the routing on top of it.
 *
 * Deliberately a hand-rolled Manhattan route rather than a graph search.
 * There are six streets. A route is: get to the nearest one, run along it to
 * the crossing nearest the destination, turn, run to the destination's own
 * coordinate, and then drive the last few units straight at the target
 * because buildings are set back from the road and no street goes to the
 * door. A* over eight junctions would produce the same answer and need a
 * priority queue to do it.
 */

// Streets running along x, at these z, and along z, at these x. The same
// centre lines roadsDecor.js draws.
export const STREET_Z_LINES = [-20, -8, 8, 20];
export const STREET_X_LINES = [-30, 30];
// How far out from the centre each street runs before it leaves the town.
export const STREET_HALF_LENGTH = 105;
// Roads are 5 wide; this is the offset from the centre line a vehicle drives
// on, so two vehicles meeting head-on pass rather than overlap.
export const STREET_LANE_OFFSET = 1.2;

/**
 * @typedef {Object} StreetPoint
 * @property {'x'|'z'} axis the axis the street runs along
 * @property {number} line its fixed coordinate on the other axis
 * @property {number} along where on the street the point is
 * @property {number} distance how far the queried point was from it
 */

/**
 * The nearest street to a point, and where on it.
 * @param {number} x
 * @param {number} z
 * @returns {StreetPoint}
 */
export function nearestStreet(x, z) {
  /** @type {StreetPoint} */
  let best = { axis: 'x', line: STREET_Z_LINES[0], along: 0, distance: Infinity };
  for (const line of STREET_Z_LINES) {
    const along = clampAlong(x);
    const d = Math.hypot(x - along, z - line);
    if (d < best.distance) best = { axis: 'x', line, along, distance: d };
  }
  for (const line of STREET_X_LINES) {
    const along = clampAlong(z);
    const d = Math.hypot(x - line, z - along);
    if (d < best.distance) best = { axis: 'z', line, along, distance: d };
  }
  return best;
}

/**
 * @param {number} along
 * @returns {number} clamped to the length of a street
 */
function clampAlong(along) {
  return Math.max(-STREET_HALF_LENGTH, Math.min(STREET_HALF_LENGTH, along));
}

/**
 * Turns a street point back into world coordinates.
 * @param {StreetPoint|{axis: 'x'|'z', line: number, along: number}} point
 * @returns {{x: number, z: number}}
 */
export function streetPointToWorld(point) {
  return point.axis === 'x'
    ? { x: point.along, z: point.line }
    : { x: point.line, z: point.along };
}

/**
 * Which crossing street to turn at, between two parallel ones.
 *
 * The cheapest for the *whole journey*, not the one nearest the destination:
 * picking by the destination alone sends a unit leaving the depot at x = -76
 * east to the x = 30 crossing to reach something at x = 12, driving a hundred
 * units past its own turning to do it.
 * @param {number[]} lines the crossing streets available
 * @param {number} from where the journey starts along the first street
 * @param {number} to where it has to end up along the second
 * @returns {number}
 */
function bestCrossing(lines, from, to) {
  let best = lines[0];
  let bestCost = Infinity;
  for (const line of lines) {
    const cost = Math.abs(from - line) + Math.abs(line - to);
    if (cost >= bestCost) continue;
    bestCost = cost;
    best = line;
  }
  return best;
}

/**
 * A driveable route from one point to another: on to the grid, along it, off
 * it again. Each leg is a corner, so a vehicle following the list turns at
 * junctions and nowhere else.
 *
 * The last waypoint is the destination itself rather than a point on the
 * road, so the final leg is the short cut across the pavement to whatever
 * was being driven to. Everything before it is on a street.
 * @param {number} fromX
 * @param {number} fromZ
 * @param {number} toX
 * @param {number} toZ
 * @param {((ax: number, az: number, bx: number, bz: number) => boolean)|null} [isBlocked]
 *   whether a straight run between two points is impassable -- rubble in the
 *   road (engine/rubble.js). A route with any blocked leg is discarded, and if
 *   every candidate is blocked the answer is null: there is no way through,
 *   which is a real and useful thing for a fire engine to be told.
 * @returns {Array<{x: number, z: number}>|null}
 */
export function routeBetween(fromX, fromZ, toX, toZ, isBlocked = null) {
  const start = nearestStreet(fromX, fromZ);
  const end = nearestStreet(toX, toZ);
  const onGrid = streetPointToWorld(start);
  const offGrid = streetPointToWorld(end);

  /** @type {Array<Array<{x: number, z: number}>>} */
  const candidates = [];

  if (start.axis === end.axis && start.line === end.line) {
    // Same street: run straight down it.
    candidates.push([onGrid, offGrid]);
  } else if (start.axis === end.axis) {
    // Two parallel streets, so a crossing street between them. Every crossing
    // is a candidate, cheapest first -- which matters only when the cheapest
    // one has a building lying across it.
    const crossLines = start.axis === 'x' ? STREET_X_LINES : STREET_Z_LINES;
    const ordered = [...crossLines].sort((a, b) =>
      (Math.abs(start.along - a) + Math.abs(a - end.along))
      - (Math.abs(start.along - b) + Math.abs(b - end.along)));
    for (const cross of ordered) {
      candidates.push([
        onGrid,
        start.axis === 'x' ? { x: cross, z: start.line } : { x: start.line, z: cross },
        start.axis === 'x' ? { x: cross, z: end.line } : { x: end.line, z: cross },
        offGrid
      ]);
    }
  } else {
    // Crossing streets: one corner where they meet. The other way round the
    // block is the second candidate -- out along the start street to the far
    // crossing, across, and back -- which is what a driver does when the
    // junction itself is buried.
    const corner = start.axis === 'x'
      ? { x: end.line, z: start.line }
      : { x: start.line, z: end.line };
    candidates.push([onGrid, corner, offGrid]);

    const detourLines = start.axis === 'x' ? STREET_Z_LINES : STREET_X_LINES;
    for (const line of detourLines) {
      if (line === start.line) continue;
      const a = start.axis === 'x' ? { x: onGrid.x, z: line } : { x: line, z: onGrid.z };
      const b = start.axis === 'x' ? { x: end.line, z: line } : { x: line, z: end.line };
      candidates.push([onGrid, a, b, offGrid]);
    }
  }

  for (const legs of candidates) {
    const route = [...legs, { x: toX, z: toZ }];
    // Consecutive duplicates make a vehicle stall on a waypoint it is already
    // standing on, which reads as the driver having a moment.
    const cleaned = route.filter((p, i) => i === 0
      || Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z) > 0.5);
    if (!isBlocked) return cleaned;
    let clear = true;
    let prevX = fromX;
    let prevZ = fromZ;
    for (const point of cleaned) {
      if (isBlocked(prevX, prevZ, point.x, point.z)) { clear = false; break; }
      prevX = point.x;
      prevZ = point.z;
    }
    if (clear) return cleaned;
  }
  return null;
}
