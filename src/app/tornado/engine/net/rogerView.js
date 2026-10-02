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
 * Poses the limbs of a Roger for a cycle (legs and arms swing in opposition).
 * @param {{legL: {rotation: {x: number}}, legR: {rotation: {x: number}}, armL: {rotation: {x: number}}, armR: {rotation: {x: number}}}} limbs
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
