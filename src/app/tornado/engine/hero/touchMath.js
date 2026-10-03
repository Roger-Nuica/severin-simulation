// @ts-check
/**
 * ===========================================================================
 * SECTION HM.T1 — The touch controls' arithmetic
 * ===========================================================================
 * Pure functions for hero/touch.js and hero/movement.js: no three.js, no
 * DOM, so they run under node --test (tests/touch-math.test.mjs).
 *
 *   stickFromDrag   a thumb's offset from the joystick's centre → a stick
 *                   value in -1..1 with a dead zone and a soft response
 *   heldFromStick   the same as the four W A S D booleans (the car, and
 *                   every system that still reads S.keys)
 *   steerRun        on foot: the way the stick points on screen, relative
 *                   to the camera, turned into a new heading and a speed
 *   pickAimTarget   aim assist: the target nearest the crosshair inside a
 *                   cone, and how far to turn to it
 */

/** Tuning, in one place. */
export const TOUCH = Object.freeze({
  /** Joystick travel, CSS px from the centre to the rim. */
  stickRadius: 56,
  /** Below this share of the travel the stick reads as centred. */
  deadZone: 0.14,
  /** A W A S D boolean is held past this share of the travel on its axis. */
  keyThreshold: 0.38,
  /** Radians per CSS px of a look drag while aiming (the mouse's is 0.0021 per px). */
  lookPerPx: 0.0034,
  /** Radians per CSS px of a drag on foot: turns Roger (and the camera behind him). */
  turnPerPx: 0.006,
  /** How fast Roger swings round to the stick on foot, radians per second. */
  steerRate: 5,
  /** Aim assist: the cone it helps inside (radians either side of the crosshair) and its reach (m). */
  assistCone: 0.16,
  assistRange: 160,
  /** How much of the gap it closes per second: resting, and with the trigger down. */
  assistPull: 2.2,
  assistPullFiring: 5.5
});

/**
 * @param {number} a radians
 * @returns {number} the same angle in -π..π
 */
export function wrapAngle(a) {
  const t = Math.PI * 2;
  return ((((a + Math.PI) % t) + t) % t) - Math.PI;
}

/**
 * A thumb's offset from the joystick's centre as a stick value: x right,
 * y down (screen), each -1..1, length at most 1. Inside the dead zone it is
 * zero; past it the travel is rescaled from 0 and eased (a light push walks,
 * a full one runs) so small corrections stay small.
 * @param {number} dx CSS px
 * @param {number} dy CSS px
 * @param {number} [radius]
 * @param {number} [deadZone]
 * @returns {{x: number, y: number, mag: number}}
 */
export function stickFromDrag(dx, dy, radius = TOUCH.stickRadius, deadZone = TOUCH.deadZone) {
  const len = Math.hypot(dx, dy) / radius;
  if (len <= deadZone || len === 0) return { x: 0, y: 0, mag: 0 };
  const k = Math.min(1, (Math.min(1, len) - deadZone) / (1 - deadZone));
  const mag = k * (0.35 + 0.65 * k);
  const nx = dx / (len * radius);
  const ny = dy / (len * radius);
  return { x: nx * mag, y: ny * mag, mag };
}

/**
 * The stick as W A S D.
 * @param {number} x
 * @param {number} y
 * @param {number} [threshold]
 * @returns {{up: boolean, down: boolean, left: boolean, right: boolean}}
 */
export function heldFromStick(x, y, threshold = TOUCH.keyThreshold) {
  return { up: y < -threshold, down: y > threshold, left: x < -threshold, right: x > threshold };
}

/**
 * On foot with the stick: up on the stick is the way the camera looks,
 * right is the screen's right. Roger swings round toward that way at
 * `rate` and runs at the stick's strength, slower while he is still turning
 * hard (so a U-turn does not slide sideways).
 *
 * Heading convention (hero/movement.js): forward is (sin h, cos h); the
 * camera's yaw the same way, from the camera toward Roger.
 * @param {number} heading Roger's now
 * @param {number} cameraYaw
 * @param {number} sx stick x (right +)
 * @param {number} sy stick y (down +)
 * @param {number} dt seconds
 * @param {number} [rate] radians per second
 * @returns {{heading: number, speed: number}} speed as a share of the run speed, 0..1
 */
export function steerRun(heading, cameraYaw, sx, sy, dt, rate = TOUCH.steerRate) {
  const mag = Math.min(1, Math.hypot(sx, sy));
  if (mag === 0) return { heading, speed: 0 };
  const fx = Math.sin(cameraYaw);
  const fz = Math.cos(cameraYaw);
  const ahead = -sy;
  const across = sx;
  // Right of forward is (-fz, fx) with this convention.
  const dx = fx * ahead - fz * across;
  const dz = fz * ahead + fx * across;
  const want = Math.atan2(dx, dz);
  const gap = wrapAngle(want - heading);
  const step = Math.max(-rate * dt, Math.min(rate * dt, gap));
  const next = heading + step;
  const facing = Math.cos(wrapAngle(want - next));
  return { heading: next, speed: mag * Math.max(0.25, facing) };
}

/**
 * Aim assist: of the candidates (centres, world units), the one closest to
 * the line of sight inside the cone and the range, and the yaw and pitch it
 * sits at. Yaw by the module's convention (atan2(dx, dz)), pitch up +.
 * @param {{x: number, y: number, z: number}} eye
 * @param {number} yaw
 * @param {number} pitch
 * @param {readonly {x: number, y: number, z: number}[]} targets
 * @param {number} [cone]
 * @param {number} [range]
 * @param {number} [count] how many of `targets` are in use (a reused array)
 * @returns {{index: number, yaw: number, pitch: number, off: number}|null}
 */
export function pickAimTarget(eye, yaw, pitch, targets, cone = TOUCH.assistCone, range = TOUCH.assistRange, count = targets.length) {
  let best = null;
  for (let i = 0; i < count; i++) {
    const t = targets[i];
    const dx = t.x - eye.x;
    const dy = t.y - eye.y;
    const dz = t.z - eye.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 1 || flat > range) continue;
    const ty = Math.atan2(dx, dz);
    const tp = Math.atan2(dy, flat);
    const off = Math.hypot(wrapAngle(ty - yaw), tp - pitch);
    if (off > cone) continue;
    if (!best || off < best.off) best = { index: i, yaw: ty, pitch: tp, off };
  }
  return best;
}
