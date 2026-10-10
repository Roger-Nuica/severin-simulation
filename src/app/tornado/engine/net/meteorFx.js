// @ts-check
/**
 * ===========================================================================
 * SECTION MF — The host's meteors, drawn on the guest (pure)
 * ===========================================================================
 * One discrete `fx` row of the kind `meteor` per rock, sent when it leaves the
 * sky's edge (a fall is not simulated: its start, end and duration are fixed
 * at launch, so one row is the whole flight):
 *   meteor  x, y, z = where it enters; a, b, c = where it comes down;
 *           extra (above the hit code) = radius in tenths of a metre, plus
 *           AIRBURST_FLAG when it comes apart in the air instead of landing.
 * The row's id seeds the guest's shapes (the rock, its pieces, the ejecta and
 * the crater's turn), so the same rock is drawn the same way every time. The
 * guest flies it with the same mesh and trail and bursts cosmetically at the
 * end: nothing is damaged, ignited, cratered for gameplay or scored (R-053),
 * no shake (R-055). No scene, no DOM, no module state.
 */
import { unpackExtra } from './fxOut.js';

/** Added to the row's extra for a rock that comes apart in the air. */
export const AIRBURST_FLAG = 200;
/** The biggest radius (tenths of a metre) a row can carry below the flag. */
export const RADIUS_MAX_TENTHS = AIRBURST_FLAG - 1;

const finite = (/** @type {ReadonlyArray<number>} */ row, /** @type {number} */ a, /** @type {number} */ b) => {
  for (let i = a; i <= b; i++) if (!Number.isFinite(row[i])) return false;
  return true;
};

/**
 * @param {number} radius metres @param {boolean} airburst
 * @returns {number} the `extra` of a meteor row (inside the 600 the writer allows)
 */
export function meteorExtra(radius, airburst) {
  const tenths = Math.min(RADIUS_MAX_TENTHS, Math.max(1, Math.round((Number.isFinite(radius) ? radius : 1) * 10)));
  return tenths + (airburst ? AIRBURST_FLAG : 0);
}

/**
 * @param {ReadonlyArray<number>} row an `fx` row [id, kind, shooter, x, y, z, a, b, c, extra]
 * @returns {{seed: number, from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, radius: number, airburst: boolean}|null}
 *   null when a number is not finite or the rock has no size or no fall
 */
export function meteorFromRow(row) {
  if (!row || !finite(row, 0, 9)) return null;
  const { extra } = unpackExtra(row[9]);
  const airburst = extra >= AIRBURST_FLAG;
  const tenths = extra - (airburst ? AIRBURST_FLAG : 0);
  if (tenths < 1 || row[4] <= 0 || row[4] <= row[7]) return null;
  return {
    seed: Math.abs(Math.trunc(row[0])) + 1,
    from: { x: row[3], y: row[4], z: row[5] },
    to: { x: row[6], y: row[7], z: row[8] },
    radius: tenths / 10,
    airburst
  };
}
