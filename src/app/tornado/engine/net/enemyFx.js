// @ts-check
/**
 * ===========================================================================
 * SECTION NZ — The enemies' projectiles, as `fx` rows (pure)
 * ===========================================================================
 * Three `fx` kinds (R-061); a place, a place, and a few numbers. The sub-type of
 * a kind travels in a column, not in more kinds:
 *
 *   ray      x, y, z = where it leaves (a gun's muzzle, a ship's belly)
 *            a, b, c = where it ends (a shot), or for a tracking laser
 *                      a = the foot's first x, b = its first z, c = the heading
 *                      the foot crawls in (degrees, atan2(dz, dx))
 *            extra   = sub-type (low 3 bits: 0 crew bolt, 1 green lance, 2 red lance,
 *                      3 UFO tracker, 4 hunter tracker); a tracker adds its crawl
 *                      in half metres above them (`sub + 8 * crawl`)
 *   round    x, y, z = the muzzle of a HAVOC gun; a, b, c = where the round ends
 *            (it flies the gunner's `speed` there); one in `ROUND_EVERY` is sent
 *   missile  x, y, z = the launch; a, b, c = where the host expects it to arrive;
 *            extra = the flight in tenths of a second
 *
 * The host announces them on the `weaponFx` bus as the last statement of each
 * spawn (hero/weaponFx.js, only while `net.fxLive()`); the guest draws them with
 * the aliens' and HAVOC's own builders and never hurts, pushes or scores (R-053).
 * A missile on the guest does not home: it flies the eased path below.
 * No scene, no ctx, no module state.
 */
import { GUNNER } from '../gunner/config.js';

/** The ray sub-types, by `extra` (append only, like `FX_KINDS`). */
export const RAY_SUBS = Object.freeze(['crew', 'lance', 'lanceRed', 'trackerUfo', 'trackerHunter']);
/** The sub-types that are tracking lasers. */
export const TRACKER_FIRST = 3;
/** Crawl is carried in half metres, in `extra` above the 3 bits of sub-type. */
export const CRAWL_UNIT = 0.5;
/** Most the crawl may be (m): 0..70 half metres keeps `extra` under its 600 cap. */
export const CRAWL_MAX = 35;

/** One HAVOC round in this many is announced (about 5 a second a gunner: the rows stay few and the stream still reads). */
export const ROUND_EVERY = 3;
/** HAVOC rounds are not announced while this many rows already wait for a snapshot (they give way to missiles and rays; the cap is 24 a snapshot). */
export const ROUND_BACKLOG = 12;

/** Missile flight: launch speed, top speed, acceleration (aliens/missiles.js `MISSILE`), and a margin for the turn it takes. */
const MISSILE_FLIGHT = Object.freeze({ speed0: 14, speed1: 30, accel: 14, curve: 1.15 });
/** The shortest and longest flight the guest will draw (s). */
export const MISSILE_SECONDS = Object.freeze({ min: 0.3, max: 16 });

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** @param {ReadonlyArray<number>} row @param {number} a @param {number} b */
const finite = (row, a, b) => { for (let i = a; i <= b; i++) if (!Number.isFinite(row[i])) return false; return true; };

/**
 * @param {'crew'|'ship'} style @param {'green'|'red'} colour
 * @returns {number} the ray sub-type (`extra`)
 */
export const raySub = (style, colour) => (style === 'crew' ? 0 : colour === 'red' ? 2 : 1);

/**
 * @param {number} sub a ray sub-type
 * @returns {{style: 'crew'|'ship', colour: 'green'|'red'}} how the aliens' own `fireRay` draws it
 */
export function rayLook(sub) {
  if (sub === 0) return { style: 'crew', colour: 'green' };
  return { style: 'ship', colour: sub === 2 ? 'red' : 'green' };
}

/**
 * @param {boolean} hunter a hunter's laser (red), not the UFO's (green)
 * @param {number} crawl metres the foot will crawl
 * @returns {number} the `extra` of a tracker row
 */
export const trackerExtra = (hunter, crawl) =>
  (hunter ? TRACKER_FIRST + 1 : TRACKER_FIRST) + 8 * Math.round(clamp(Number.isFinite(crawl) ? crawl : 0, 0, CRAWL_MAX) / CRAWL_UNIT);

/**
 * Fills `out` (the emitter's reused object) with a tracker's `to`: the foot's first place and heading.
 * @param {{x: number, y: number, z: number}} out
 * @param {number} fx @param {number} fz the foot's first place
 * @param {number} towardX @param {number} towardZ what it crawls towards
 * @returns {typeof out}
 */
export function trackerTo(out, fx, fz, towardX, towardZ) {
  out.x = fx;
  out.y = fz;
  out.z = Math.atan2(towardZ - fz, towardX - fx) * (180 / Math.PI);
  return out;
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row [id, kind, shooter, x, y, z, a, b, c, extra]
 * @returns {{sub: number, tracker: boolean, from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number},
 *   foot: {x: number, z: number, dx: number, dz: number, crawl: number}}|null}
 *   null when a number is not finite. A shot reads `to`; a tracker reads `foot` (a unit heading and the crawl in metres).
 */
export function rayFromRow(row) {
  if (!row || !finite(row, 3, 9)) return null;
  const sub = Math.min(RAY_SUBS.length - 1, Math.max(0, Math.floor(row[9] / 16) % 8 | 0));
  const tracker = sub >= TRACKER_FIRST;
  const rad = row[8] * (Math.PI / 180);
  return {
    sub, tracker,
    from: { x: row[3], y: row[4], z: row[5] },
    to: { x: row[6], y: row[7], z: row[8] },
    foot: {
      x: row[6], z: row[7], dx: Math.cos(rad), dz: Math.sin(rad),
      crawl: tracker ? clamp(Math.floor(Math.floor(row[9] / 16) / 8) * CRAWL_UNIT, 0, CRAWL_MAX) : 0
    }
  };
}

/**
 * Where a HAVOC round ends: along its heading for its whole life, cut where it meets the ground.
 * Fills `out` (the emitter's reused object); nothing is allocated.
 * @param {{x: number, y: number, z: number}} out
 * @param {{x: number, y: number, z: number}} from the muzzle
 * @param {{x: number, y: number, z: number}} dir unit heading
 * @param {number} [speed] m/s @param {number} [life] s
 * @returns {typeof out}
 */
export function roundTo(out, from, dir, speed = GUNNER.speed, life = GUNNER.roundLife) {
  const reach = speed * life;
  out.x = from.x + dir.x * reach;
  out.y = from.y + dir.y * reach;
  out.z = from.z + dir.z * reach;
  if (out.y < 0 && from.y > 0) {
    const k = from.y / (from.y - out.y);
    out.x = from.x + (out.x - from.x) * k;
    out.z = from.z + (out.z - from.z) * k;
    out.y = 0;
  }
  return out;
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row
 * @returns {{from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, seconds: number}|null}
 *   null when a number is not finite; `seconds` is the flight at the gunner's round speed
 */
export function roundFromRow(row) {
  if (!row || !finite(row, 3, 8)) return null;
  const d = Math.hypot(row[6] - row[3], row[7] - row[4], row[8] - row[5]);
  return {
    from: { x: row[3], y: row[4], z: row[5] },
    to: { x: row[6], y: row[7], z: row[8] },
    seconds: clamp(d / GUNNER.speed, 0.02, GUNNER.roundLife)
  };
}

/**
 * Seconds a homing missile takes to cover `distance` metres: it speeds up from its launch speed
 * to its top speed, and its turn adds a margin. The host's estimate at launch (the row's duration).
 * @param {number} distance m
 * @returns {number}
 */
export function missileSeconds(distance) {
  const { speed0, speed1, accel, curve } = MISSILE_FLIGHT;
  const d = Math.max(0, Number.isFinite(distance) ? distance : 0) * curve;
  const rampT = (speed1 - speed0) / accel;
  const rampD = ((speed0 + speed1) / 2) * rampT;
  const t = d <= rampD
    ? (-speed0 + Math.sqrt(speed0 * speed0 + 2 * accel * d)) / accel
    : rampT + (d - rampD) / speed1;
  return clamp(t, MISSILE_SECONDS.min, MISSILE_SECONDS.max);
}

/**
 * @param {number} seconds
 * @returns {number} the `extra` of a missile row (tenths of a second, inside the cap)
 */
export const missileExtra = (seconds) => Math.round(clamp(Number.isFinite(seconds) ? seconds : 0, 0, 60) * 10);

/**
 * @param {ReadonlyArray<number>} row an `fx` row
 * @returns {{from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, seconds: number}|null}
 *   null when a number is not finite
 */
export function missileFromRow(row) {
  if (!row || !finite(row, 3, 9)) return null;
  return {
    from: { x: row[3], y: row[4], z: row[5] },
    to: { x: row[6], y: row[7], z: row[8] },
    seconds: clamp(Math.floor(row[9] / 16) / 10, MISSILE_SECONDS.min, MISSILE_SECONDS.max)
  };
}

/**
 * The guest's missile path: it leaves slowly and speeds up, like the host's (0.35 of the average
 * speed at the start, 1.65 at the end). Position along the path, 0..1, at progress 0..1.
 * @param {number} u 0..1
 * @returns {number}
 */
export function missileEase(u) {
  const t = clamp(u, 0, 1);
  return 0.35 * t + 0.65 * t * t;
}
