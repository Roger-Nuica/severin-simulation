// Pure guest movement step, shared by the host (authoritative) and, later, the
// peer (prediction). No scene, no DOM, no module state.

/**
 * @typedef {{x: number, z: number}} Pos
 * @typedef {{mx: number, mz: number, yaw: number, aim: boolean|number}} MoveInput
 * @typedef {{run: number, aim: number, back: number}} MoveSpeeds
 * run: walking speed, aim: speed while aiming, back: speed while moving backwards
 * (all in metres per second; the hero's own values, passed in, never copied here).
 */

/**
 * Clamp a value to a symmetric bound (same arithmetic as THREE.MathUtils.clamp).
 * @param {number} v
 * @param {number} bound
 * @returns {number}
 */
const clampBound = (v, bound) => Math.max(-bound, Math.min(bound, v));

/**
 * One movement step from `pos`. Each axis is tried on its own, so a wall slides
 * rather than sticks; the result stays inside +/- `bound`. Returns a new
 * position and never mutates `pos`.
 * @param {Pos} pos
 * @param {MoveInput} input
 * @param {number} dt seconds
 * @param {(x: number, z: number) => boolean} standable whether a point may be stood on
 * @param {number} bound half-extent of the walkable square
 * @param {MoveSpeeds} speeds
 * @returns {Pos}
 */
export const stepMove = (pos, input, dt, standable, bound, speeds) => {
  const mag = Math.hypot(input.mx, input.mz);
  if (mag < 1e-3) return { x: pos.x, z: pos.z };
  const speed = (input.aim ? speeds.aim : speeds.run) * (input.mz < 0 ? speeds.back / speeds.run : 1);
  const k = Math.min(1, 1 / mag);
  const fx = Math.sin(input.yaw), fz = Math.cos(input.yaw);
  const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
  const dx = (fx * input.mz + rx * input.mx) * k * speed * dt;
  const dz = (fz * input.mz + rz * input.mx) * k * speed * dt;
  const nx = clampBound(pos.x + dx, bound);
  const x = standable(nx, pos.z) ? nx : pos.x;
  const nz = clampBound(pos.z + dz, bound);
  const z = standable(x, nz) ? nz : pos.z;
  return { x, z };
};
