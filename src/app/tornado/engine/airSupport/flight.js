// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AS.3 — GHOST flight: flight paths
 * ===========================================================================
 * A jet off the racetrack flies a chain of smooth curves (cubic Hermite
 * segments): each segment starts where the last ended, heading the same
 * way, so a run in (break, dive, pull-out, rejoin) has no kinks. Speed
 * eases from each segment's start speed to its end speed. Segments are
 * preallocated per jet and refilled for each run: nothing is allocated
 * while flying.
 */

/**
 * @typedef {Object} Segment
 * @property {THREE.Vector3} p0
 * @property {THREE.Vector3} p1
 * @property {THREE.Vector3} m0 tangent at the start (length matters)
 * @property {THREE.Vector3} m1 tangent at the end
 * @property {number} len approximate arc length (m)
 * @property {number} v0 speed at the start (m/s)
 * @property {number} v1 speed at the end
 */

/** @returns {Segment} */
export function makeSegment() {
  return { p0: new THREE.Vector3(), p1: new THREE.Vector3(), m0: new THREE.Vector3(), m1: new THREE.Vector3(), len: 1, v0: 1, v1: 1 };
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();

/**
 * Fills a segment from `p0` heading `dir0` to `p1` heading `dir1` (both
 * directions unit length).
 * @param {Segment} seg
 * @param {THREE.Vector3} p0
 * @param {THREE.Vector3} dir0
 * @param {THREE.Vector3} p1
 * @param {THREE.Vector3} dir1
 * @param {number} v0
 * @param {number} v1
 * @returns {Segment}
 */
export function setSegment(seg, p0, dir0, p1, dir1, v0, v1) {
  seg.p0.copy(p0);
  seg.p1.copy(p1);
  const chord = p0.distanceTo(p1);
  seg.m0.copy(dir0).multiplyScalar(chord);
  seg.m1.copy(dir1).multiplyScalar(chord);
  seg.v0 = v0;
  seg.v1 = v1;
  // Arc length by a dozen chords.
  let len = 0;
  a.copy(p0);
  for (let i = 1; i <= 12; i++) {
    pointAt(seg, i / 12, b);
    len += a.distanceTo(b);
    a.copy(b);
  }
  seg.len = Math.max(1, len);
  return seg;
}

/**
 * @param {Segment} seg
 * @param {number} u 0..1
 * @param {THREE.Vector3} out
 * @returns {THREE.Vector3}
 */
export function pointAt(seg, u, out) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return out.set(
    h00 * seg.p0.x + h10 * seg.m0.x + h01 * seg.p1.x + h11 * seg.m1.x,
    h00 * seg.p0.y + h10 * seg.m0.y + h01 * seg.p1.y + h11 * seg.m1.y,
    h00 * seg.p0.z + h10 * seg.m0.z + h01 * seg.p1.z + h11 * seg.m1.z
  );
}

/**
 * The direction of travel at `u` (unit length).
 * @param {Segment} seg
 * @param {number} u
 * @param {THREE.Vector3} out
 * @returns {THREE.Vector3}
 */
export function headingAt(seg, u, out) {
  const u2 = u * u;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  out.set(
    d00 * seg.p0.x + d10 * seg.m0.x + d01 * seg.p1.x + d11 * seg.m1.x,
    d00 * seg.p0.y + d10 * seg.m0.y + d01 * seg.p1.y + d11 * seg.m1.y,
    d00 * seg.p0.z + d10 * seg.m0.z + d01 * seg.p1.z + d11 * seg.m1.z
  );
  const l = out.length();
  return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, 0, 1);
}

/**
 * Seconds to fly a segment from `u` to its end.
 * @param {Segment} seg
 * @param {number} [u]
 * @returns {number}
 */
export function secondsLeft(seg, u = 0) {
  const v = (seg.v0 + seg.v1) / 2;
  return (seg.len * (1 - u)) / Math.max(1, v);
}
