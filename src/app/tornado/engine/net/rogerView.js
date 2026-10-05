// @ts-check
/**
 * ===========================================================================
 * SECTION NV — Roger's look and view for a co-op player (pure rules)
 * ===========================================================================
 * Everything the net system needs to dress, pose and follow a player as a
 * Roger, with no scene or DOM in it, so it can be tested:
 *
 *  - `rogerStyle`: which of the two Rogers a player is (name, tag colour, tee).
 *  - `stepRunCycle` / `swingLimbs`: the walk cycle, driven from the position
 *    the player actually moved, with no allocation.
 *  - `followCamera`: the per-client third-person camera (and the first-person
 *    one while aiming), written into a caller-owned scratch object.
 *  - `wheelHtml`: the weapon wheel's markup for the guest HUD.
 *  - `wrapAngle`: keeps the guest's look yaw inside the protocol's range.
 *  - `newFireLatch` / `fireLatchPress` / `fireLatchRelease` / `fireLatchSample`:
 *    a fire click held for at least one input message, so a short click is
 *    never lost between two samples.
 */

/**
 * @typedef {Object} RogerStyle
 * @property {string} label Name shown on the tag and the HUD.
 * @property {string} accent CSS colour of the tag's outline and text.
 * @property {number|null} tee Hex colour of the T-shirt, or null for Roger's own white one.
 */

/**
 * Which Roger a player is: the host (id '0') keeps the original look and the
 * gold tag; every guest is "ROGER 2" and so on, in teal, so the two read apart.
 * @param {string|number} id Player id.
 * @returns {RogerStyle} The style.
 */
export const rogerStyle = (id) => {
  const n = Number(id);
  if (!(n > 0)) return { label: 'ROGER', accent: '#ffc94d', tee: null };
  return { label: `ROGER ${n + 1}`, accent: '#35e0a1', tee: 0x35e0a1 };
};

/**
 * @typedef {Object} RunCycle
 * @property {number} phase Leg-cycle radians.
 * @property {number} lx Last x.
 * @property {number} lz Last z.
 * @property {number} amount 0 (standing) to 1 (full run), smoothed.
 */

/** @returns {RunCycle} A fresh cycle state. */
export const newRunCycle = () => ({ phase: 0, lx: NaN, lz: NaN, amount: 0 });

/**
 * Advances a walk cycle from where the player now is. The first call only
 * records the position, so a spawn is not a sprint.
 * @param {RunCycle} st The state, mutated.
 * @param {number} x Current x.
 * @param {number} z Current z.
 * @param {number} dt Seconds since the last call.
 * @param {number} stride Leg-cycle radians per metre.
 * @param {number} runSpeed Metres per second that counts as a full run.
 * @returns {number} The swing amount, 0 to 1.
 */
export const stepRunCycle = (st, x, z, dt, stride, runSpeed) => {
  if (!Number.isFinite(st.lx) || !(dt > 0)) {
    st.lx = x; st.lz = z;
    if (!(dt > 0)) return st.amount;
  }
  const moved = Math.hypot(x - st.lx, z - st.lz);
  st.lx = x; st.lz = z;
  const speed = moved / dt;
  const target = Math.min(1, speed / runSpeed);
  st.amount += (target - st.amount) * Math.min(1, dt * 12);
  if (st.amount < 0.01) st.amount = 0;
  // A teleport is not a stride: only a plausible distance advances the legs.
  if (speed < runSpeed * 3) st.phase = (st.phase + moved * stride) % (Math.PI * 2);
  return st.amount;
};

/**
 * How far a knee bends at a point of the stride: most while that leg swings
 * forward under the body (the foot lifted clear), a little while it pushes
 * off, straight at rest. The left leg swings forward while cos(phase) < 0
 * (its hip angle is sin(phase) times the swing).
 * @param {number} phase Leg-cycle radians.
 * @param {number} amount 0 to 1, how fast he runs.
 * @param {boolean} left The left leg.
 * @returns {number} The knee's bend, radians (the shin back).
 */
export const kneeBend = (phase, amount, left) => {
  const c = Math.cos(phase);
  return amount * (0.15 + 1.05 * Math.max(0, left ? -c : c));
};

/**
 * Poses the limbs of a Roger for a cycle (legs and arms swing in opposition,
 * the knees bending when the figure has them).
 * @param {{legL: {rotation: {x: number}}, legR: {rotation: {x: number}}, armL: {rotation: {x: number}}, armR: {rotation: {x: number}}, kneeL?: {rotation: {x: number}}, kneeR?: {rotation: {x: number}}}} limbs
 * @param {number} phase Leg-cycle radians.
 * @param {number} amount 0 to 1.
 * @returns {void}
 */
export const swingLimbs = (limbs, phase, amount) => {
  const s = Math.sin(phase) * amount;
  limbs.legL.rotation.x = s * 0.9;
  limbs.legR.rotation.x = -s * 0.9;
  limbs.armL.rotation.x = -s * 0.6;
  limbs.armR.rotation.x = s * 0.6;
  if (limbs.kneeL) limbs.kneeL.rotation.x = kneeBend(phase, amount, true);
  if (limbs.kneeR) limbs.kneeR.rotation.x = kneeBend(phase, amount, false);
};

/**
 * @typedef {Object} CameraPose
 * @property {number} px Camera position.
 * @property {number} py
 * @property {number} pz
 * @property {number} lx Look-at point.
 * @property {number} ly
 * @property {number} lz
 * @property {boolean} firstPerson True while aiming (the camera is at the eyes).
 */

/** @returns {CameraPose} A scratch pose. */
export const newCameraPose = () => ({ px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, firstPerson: false });

/**
 * The guest's camera: over Roger's shoulder, at the host's follow distances
 * (`HERO.followBack` and friends), or at his eyes while the aim button is held
 * (the host's right-click first person). Yaw 0 faces +z; positive pitch looks up.
 * @param {CameraPose} out Written and returned.
 * @param {number} x Roger's x.
 * @param {number} z Roger's z.
 * @param {number} yaw Look yaw, radians.
 * @param {number} pitch Look pitch, radians.
 * @param {boolean} aim The aim button is held.
 * @param {{back: number, height: number, lookAhead: number, lookHeight: number, eye: number}} cfg Distances, metres.
 * @returns {CameraPose} `out`.
 */
export const followCamera = (out, x, z, yaw, pitch, aim, cfg) => {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  if (aim) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    out.px = x + sy * 0.3; out.py = cfg.eye; out.pz = z + cy * 0.3;
    out.lx = out.px + sy * cp * 10; out.ly = out.py + sp * 10; out.lz = out.pz + cy * cp * 10;
    out.firstPerson = true;
    return out;
  }
  out.px = x - sy * cfg.back;
  out.py = Math.max(0.6, cfg.height + pitch * 3);
  out.pz = z - cy * cfg.back;
  out.lx = x + sy * cfg.lookAhead;
  out.ly = cfg.lookHeight + pitch * cfg.lookAhead;
  out.lz = z + cy * cfg.lookAhead;
  out.firstPerson = false;
  return out;
};

/** Display names of the wheel, in `WEAPONS` order (R-049). */
export const WHEEL_NAMES = Object.freeze(['RIFLE', 'MINIGUN', 'RAILGUN', 'FIRE', 'HOLE', 'KATANA']);

/**
 * The weapon wheel for the guest HUD: every weapon in order, the held one lit.
 * @param {number} current Index into the wheel.
 * @returns {string} Markup.
 */
export const wheelHtml = (current) =>
  `<div class="coop-wheel">${WHEEL_NAMES.map((n, i) => `<span${i === current ? ' class="on"' : ''}>${n}</span>`).join('')}</div>`;

/**
 * Wraps an angle into (-PI, PI]. The result is equivalent modulo 2*PI, so
 * sin/cos of it match the original; it keeps the guest's yaw inside the
 * protocol's accepted range however far the mouse has turned.
 * @param {number} angle Radians, any magnitude.
 * @returns {number} The same direction, within (-PI, PI]; 0 for a non-finite input.
 */
export const wrapAngle = (angle) => {
  if (!Number.isFinite(angle)) return 0;
  const TAU = Math.PI * 2;
  const r = angle - Math.floor((angle + Math.PI) / TAU) * TAU;
  // Floor maps +PI to -PI; keep the upper bound inclusive instead.
  return r <= -Math.PI ? Math.PI : r;
};

/**
 * @typedef {Object} FireLatch
 * @property {boolean} down Whether the fire input is held right now.
 * @property {boolean} pending Whether a press has not yet been sampled.
 */

/** @returns {FireLatch} A released latch with nothing pending. */
export const newFireLatch = () => ({ down: false, pending: false });

/**
 * A press: held, and owed to the next sample even if released first.
 * @param {FireLatch} _latch Previous latch (unused: a press always latches).
 * @returns {FireLatch} The new latch.
 */
export const fireLatchPress = (_latch) => ({ down: true, pending: true });

/**
 * A release: no longer held, but an unsampled press stays pending.
 * @param {FireLatch} latch Previous latch.
 * @returns {FireLatch} The new latch.
 */
export const fireLatchRelease = (latch) => ({ down: false, pending: latch.pending });

/**
 * Samples the latch when an input message is built: fire is true while held
 * or while a press is still unsent, so every click reaches at least one
 * message. The pending flag is consumed by the sample.
 * @param {FireLatch} latch Previous latch.
 * @returns {{fire: boolean, next: FireLatch}} The value to send and the new latch.
 */
export const fireLatchSample = (latch) => ({
  fire: latch.down || latch.pending,
  next: { down: latch.down, pending: false }
});
