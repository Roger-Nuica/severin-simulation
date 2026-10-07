// @ts-check
/**
 * ===========================================================================
 * SECTION FL — The sky and the big actors on the guest: the `flyers` kind, encoded and posed (pure)
 * ===========================================================================
 * Five kinds of actor that fly, are huge, or are lifted by the funnel need a
 * height and a tilt, so they share one additive optional kind (an older guest
 * ignores it, an older host never sends it) with a type column:
 *   flyers  [id, type, x, y, z, yaw, pitch, roll, state, a]
 * Angles are the actor's Euler angles in 'YXZ' order (net/carPose.js
 * `eulerYXZ` of its quaternion). `id` is `flyerId(type, index)`, so ids never
 * meet across types. What `state` and `a` mean depends on the type:
 *   jet         state throttle in thirds (0..3), a how far the cloak is dropped (0 gone .. 1 seen)
 *   chopper     state 0 circling the town, 1 chasing a funnel; a 0
 *   mothership  state MOTHER_STATE (the phase); a 0
 *   cow         state 0 grounded, 1 lifted; a how far the head is down (0 up .. 1 grazing)
 *   spotless    state 0; a how far along his walk (0 .. 1: his stride and the wave's pulse come from it)
 * The spun rotors, the blink, the searchlight and the glow are worked out on
 * the guest from the clock. No scene, no DOM, no module state.
 */

/** Actor types (the `type` column). */
export const FLYER = Object.freeze({ jet: 0, chopper: 1, mothership: 2, cow: 3, spotless: 4 });

/** The mothership's phase, as the `state` column. */
export const MOTHER_STATE = Object.freeze({ arriving: 0, charging: 1, cutting: 2, leaving: 3, falling: 4 });

/** Room each type's index has inside an id (cows are the most: COWS.count 8). */
export const FLYER_ID_SPAN = 32;

/**
 * @param {number} type A `FLYER` value.
 * @param {number} index The actor's index within its type.
 * @returns {number} A row id unique across types.
 */
export const flyerId = (type, index) => type * FLYER_ID_SPAN + index;

/** @param {string} phase The mothership's phase name. @returns {number} A `MOTHER_STATE` value. */
export const motherState = (phase) => {
  if (phase === 'charging') return MOTHER_STATE.charging;
  if (phase === 'cutting') return MOTHER_STATE.cutting;
  if (phase === 'leaving') return MOTHER_STATE.leaving;
  if (phase === 'falling') return MOTHER_STATE.falling;
  return MOTHER_STATE.arriving;
};

const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));

/** @param {number} throttle 0..1. @returns {number} The throttle in thirds. */
export const throttleState = (throttle) => Math.round(clamp01(throttle) * 3);

/** @param {number} state The row's throttle in thirds. @returns {number} 0..1. */
export const throttleOf = (state) => clamp01(state / 3);

/**
 * How far a cow's head is down, from its height (the host's grazing: 1.35 up, about 0.95 to 1.05 down).
 * @param {number} headY
 * @returns {number} 0 (up) to 1 (down).
 */
export const headDown = (headY) => clamp01((1.35 - headY) / 0.4);

/** @param {number} a Row column a. @returns {number} The head's height. */
export const headHeight = (a) => 1.35 - clamp01(a) * 0.4;

/**
 * One `flyers` row.
 * @param {number} type A `FLYER` value.
 * @param {number} index Index within the type.
 * @param {{x: number, y: number, z: number, state: number, a: number}} s Replicated state.
 * @param {{yaw: number, pitch: number, roll: number}} e Euler angles (YXZ).
 * @param {(v: number) => number} clamp Keeps a horizontal position inside the world.
 * @returns {number[]}
 */
export function flyerRow(type, index, s, e, clamp) {
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return [flyerId(type, index), type, r2(clamp(s.x)), r2(s.y), r2(clamp(s.z)), r2(e.yaw), r2(e.pitch), r2(e.roll), s.state, r2(clamp01(s.a))];
}

/**
 * Poses a flyer proxy's group from an interpolated row.
 * @param {{position: {set: Function}, rotation: {set: Function, order?: string}}} obj
 * @param {number[]} row
 * @returns {void}
 */
export function poseFlyer(obj, row) {
  obj.position.set(row[2], row[3], row[4]);
  obj.rotation.order = 'YXZ';
  obj.rotation.set(row[6], row[5], row[7]);
}

/**
 * The cloak and glow of a GHOST jet as airSupport.js `look` works them out.
 * @param {number} vis 0 cloaked .. 1 seen (row column a).
 * @param {number} state Row throttle in thirds.
 * @param {number} t Seconds.
 * @param {number} index The jet's index (staggers the strobe).
 * @param {number} flicker 0.85..1.15, the flame's flutter.
 * @param {number} reach Half the fighter's length plus margin (airSupport/model.js `REACH`).
 * @returns {{reveal: number, shown: boolean, flameLength: number, flameWidth: number, strobe: boolean}}
 */
export function jetLook(vis, state, t, index, flicker, reach) {
  const v = clamp01(vis);
  const throttle = throttleOf(state);
  const shown = v > 0.55;
  return {
    reveal: -reach + 2 * reach * v,
    shown,
    flameLength: (0.45 + throttle * 1.25) * flicker,
    flameWidth: v * (0.7 + throttle * 0.4),
    strobe: shown && ((t + index * 0.4) % 1.3) < 0.07
  };
}

/**
 * The news helicopter's rotors, beacon and searchlight as newsChopper.js works them out.
 * @param {number} state Row state (0 town, 1 chasing).
 * @param {number} t Seconds.
 * @param {{radius: number, height: number}} storm The chase circle (CHOPPER.storm).
 * @returns {{rotor: number, tail: number, beacon: boolean, beamTilt: number, beamOpacity: number}}
 */
export function chopperLook(state, t, storm) {
  const chasing = state === 1;
  return {
    rotor: t * 28,
    tail: t * 40,
    beacon: (t % 1.1) < 0.12,
    // The cone tips forward from the vertical until its end meets the funnel's foot (the host aims it there).
    beamTilt: chasing ? -Math.atan2(storm.radius, storm.height) : -0.35,
    beamOpacity: chasing ? 0.13 : 0.06
  };
}

/**
 * Captain Spotless's stride and the pulse of his wave as cleaner.js works them out.
 * @param {number} a Row column a: how far along his walk (0..1).
 * @param {number} stridePerWalk Radians of stride over the whole walk (40).
 * @returns {{left: number, right: number, wave: number}}
 */
export function spotlessLook(a, stridePerWalk) {
  const u = clamp01(a);
  const stride = u * stridePerWalk;
  return { left: Math.sin(stride) * 0.4, right: -Math.sin(stride) * 0.4, wave: 0.35 + 0.15 * Math.sin(u * 60) };
}
