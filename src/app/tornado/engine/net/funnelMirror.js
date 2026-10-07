// @ts-check
/**
 * ===========================================================================
 * SECTION NF — The host's funnels on the guest (pure)
 * ===========================================================================
 * Turns the snapshot's `tornadoes` rows ([id, x, z, radius], interpolated) and
 * `tw` rows ([id, birth, sizeMul, fade, leanX, leanZ]) into what the guest's own
 * funnels draw (`vortex.js` `remote`). No scene, no DOM, no allocation per frame:
 * the target and shown records are made once. `id` is the funnel's index in
 * `ctx.tornadoes.instances` on the host (the same on both rows and on the guest).
 */

/** Funnels the guest can draw (the host builds three). */
export const FUNNEL_SLOTS = 3;
/** Per second rate the guest eases birth, size, fade and lean towards the host's last values. */
export const EASE_RATE = 10;

/**
 * @typedef {object} FunnelTarget what the host said last for one funnel
 * @property {boolean} present a `tornadoes` row exists for it
 * @property {boolean} hasTw a `tw` row came with it
 * @property {number} x @property {number} z @property {number} radius
 * @property {number} birth @property {number} sizeMul @property {number} fade
 * @property {number} leanX @property {number} leanZ
 */

/**
 * @typedef {object} FunnelShown what the guest's funnel draws (`Vortex.remote`)
 * @property {boolean} on the funnel is in play on this screen
 * @property {number} x @property {number} z @property {number} radius
 * @property {number} birth @property {number} sizeMul @property {number} fade
 * @property {number} leanX @property {number} leanZ
 */

/** @returns {FunnelTarget} */
const blankTarget = () => ({ present: false, hasTw: false, x: 0, z: 0, radius: 14, birth: 0, sizeMul: 1, fade: 1, leanX: 0, leanZ: 0 });

/** @returns {FunnelShown} */
const blankShown = () => ({ on: false, x: 0, z: 0, radius: 14, birth: 0, sizeMul: 1, fade: 1, leanX: 0, leanZ: 0 });

/** @param {number} [n] @returns {FunnelTarget[]} */
export function newTargets(n = FUNNEL_SLOTS) {
  return Array.from({ length: n }, blankTarget);
}

/** @param {number} [n] @returns {FunnelShown[]} */
export function newShown(n = FUNNEL_SLOTS) {
  return Array.from({ length: n }, blankShown);
}

/**
 * Puts every shown record back to "not in play", in place.
 * @param {FunnelShown[]} shown
 * @returns {void}
 */
export function resetShown(shown) {
  for (const s of shown) Object.assign(s, blankShown());
}

/**
 * Reads the rows into the targets, in place. A funnel with a `tornadoes` row but
 * no `tw` row (an older host) is drawn full grown, upright and at normal size.
 * A `tw` row without a `tornadoes` row is ignored (the funnel is not in play).
 * @param {FunnelTarget[]} targets
 * @param {ReadonlyMap<number, ReadonlyArray<number>>|null|undefined} tornadoRows by id
 * @param {ReadonlyArray<ReadonlyArray<number>>|null|undefined} twRows
 * @returns {void}
 */
export function readTargets(targets, tornadoRows, twRows) {
  for (const t of targets) {
    t.present = false;
    t.hasTw = false;
  }
  if (tornadoRows) {
    for (const [id, r] of tornadoRows) {
      const t = targets[id];
      if (!t || !Number.isInteger(id) || id < 0) continue;
      t.present = true;
      t.x = r[1];
      t.z = r[2];
      t.radius = r[3];
      t.birth = 1; t.sizeMul = 1; t.fade = 1; t.leanX = 0; t.leanZ = 0;
    }
  }
  if (twRows) {
    for (const r of twRows) {
      const t = targets[r[0]];
      if (!t || !t.present) continue;
      t.hasTw = true;
      t.birth = r[1]; t.sizeMul = r[2]; t.fade = r[3]; t.leanX = r[4]; t.leanZ = r[5];
    }
  }
}

/** @param {number} cur @param {number} to @param {number} dt @returns {number} */
export function easeTo(cur, to, dt) {
  const k = 1 - Math.exp(-EASE_RATE * Math.max(0, dt));
  return cur + (to - cur) * k;
}

/**
 * One frame of one funnel: position and radius follow the (already
 * interpolated) target at once, the rest ease. A funnel that appears starts at
 * no birth and the host's size, fade and lean; one that goes away ropes out
 * with the birth easing to 0 and is off once it is gone.
 * @param {FunnelShown} shown
 * @param {FunnelTarget} target
 * @param {number} dt
 * @returns {void}
 */
export function stepShown(shown, target, dt) {
  if (target.present) {
    if (!shown.on) {
      shown.on = true;
      shown.birth = 0;
      shown.sizeMul = target.sizeMul;
      shown.fade = target.fade;
      shown.leanX = target.leanX;
      shown.leanZ = target.leanZ;
    }
    shown.x = target.x;
    shown.z = target.z;
    shown.radius = target.radius;
    shown.birth = easeTo(shown.birth, target.birth, dt);
    shown.sizeMul = easeTo(shown.sizeMul, target.sizeMul, dt);
    shown.fade = easeTo(shown.fade, target.fade, dt);
    shown.leanX = easeTo(shown.leanX, target.leanX, dt);
    shown.leanZ = easeTo(shown.leanZ, target.leanZ, dt);
    return;
  }
  if (!shown.on) return;
  shown.birth = easeTo(shown.birth, 0, dt);
  if (shown.birth < 0.002) { shown.birth = 0; shown.on = false; }
}

/**
 * The touchdown beat: the host's own birth went from below `edge` to `edge` or
 * past it between two snapshots. A funnel first seen already grown has no
 * previous value, so it is not a touchdown.
 * @param {number} prev the previous snapshot's birth, or a negative number when there was none
 * @param {number} now
 * @param {number} edge
 * @returns {boolean}
 */
export function crossedUp(prev, now, edge) {
  return prev >= 0 && prev < edge && now >= edge;
}
