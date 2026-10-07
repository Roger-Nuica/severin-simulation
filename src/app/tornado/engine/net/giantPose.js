// @ts-check
/**
 * ===========================================================================
 * SECTION GP — The cyber T-Rex and Yeti on the guest: the `giants` kind, encoded and posed (pure)
 * ===========================================================================
 * Two single actors, so one additive optional kind (an older guest ignores
 * it, an older host never sends it):
 *   giants  [id, x, z, heading, state, a, b]
 * `id` is the actor (0 the T-Rex, 1 the Yeti). `state` is `GIANT_STATE`.
 * `a` is the main pose value: the T-Rex's head bow or the Yeti's gun-arm
 * raise (0 to 1) while it stands, the fall progress (0 to 1) once it is
 * going down. `b` is the Yeti's gun-arm pitch (0 for the T-Rex). The walk
 * cycle comes from the interpolated movement (rogerView.js `stepRunCycle`),
 * as for the Terminators. The strike swing, flames and beams are not here.
 * No scene, no DOM, no module state.
 */

/** Actor ids. */
export const GIANT = Object.freeze({ trex: 0, yeti: 1 });

/** The state column. */
export const GIANT_STATE = Object.freeze({ walking: 0, acting: 1, stunned: 2, falling: 3, dead: 4 });

/**
 * The state column for a host phase.
 * @param {string} phase The host's phase name.
 * @param {boolean} acting Breathing fire (T-Rex) or gun raised (Yeti).
 * @returns {number}
 */
export const giantState = (phase, acting) => {
  if (phase === 'dead') return GIANT_STATE.dead;
  if (phase === 'falling') return GIANT_STATE.falling;
  if (phase === 'stunned') return GIANT_STATE.stunned;
  return acting ? GIANT_STATE.acting : GIANT_STATE.walking;
};

/**
 * One `giants` row from the host's replicated state.
 * @param {number} id Actor id.
 * @param {{x: number, z: number, heading: number, phase: string, acting: boolean, a: number, b: number, fall: number}} s
 * @param {(v: number) => number} clamp Keeps a position inside the world.
 * @returns {number[]}
 */
export function giantRow(id, s, clamp) {
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  const state = giantState(s.phase, s.acting);
  const down = state === GIANT_STATE.falling || state === GIANT_STATE.dead;
  const a = state === GIANT_STATE.dead ? 1 : down ? s.fall : s.a;
  return [id, r2(clamp(s.x)), r2(clamp(s.z)), r2(s.heading), state, r2(a), down ? 0 : r2(s.b)];
}

/**
 * How far the actor has tipped over: group rotation and height.
 * @param {number} id Actor id.
 * @param {number} state Row state.
 * @param {number} a Row column a (the fall progress while going down).
 * @returns {{rx: number, rz: number, y: number}}
 */
export function fallPose(id, state, a) {
  if (state !== GIANT_STATE.falling && state !== GIANT_STATE.dead) return { rx: 0, rz: 0, y: 0 };
  const t = state === GIANT_STATE.dead ? 1 : Math.min(1, Math.max(0, a));
  // The host's own fall: the T-Rex over on its side and sinking, the Yeti over backwards.
  return id === GIANT.yeti ? { rx: -t * t * 1.4, rz: 0, y: 0 } : { rx: 0, rz: t * t * (Math.PI / 2 - 0.15), y: -t * 1.5 };
}

/** @typedef {{rotation: {x: number, y?: number}, position?: {y: number}}} Joint */
/** @typedef {{color: {copy: Function, multiplyScalar: Function, setRGB?: Function}}} Mat */

const isDown = (/** @type {number} */ state) => state === GIANT_STATE.falling || state === GIANT_STATE.dead;

/**
 * Poses the T-Rex's legs, tail, neck, head, jaw and glowing parts as trex.js `pose` does.
 * @param {{legL: Joint, legR: Joint, tail: Joint, neck: Joint, head: Joint, jaw: Joint, body: Joint}} j The figure's joints.
 * @param {{eyeMat: Mat, ventMat: Mat}} mats Shared materials.
 * @param {{eye: any, vent: any}} colours The lit colours.
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 (standing) to 1 (the host's own walk).
 * @param {number} state Row state.
 * @param {number} a Row column a (the head bow).
 * @param {number} t Seconds, for the tail's wag.
 * @returns {void}
 */
export function poseTrex(j, mats, colours, phase, amount, state, a, t) {
  const swing = state === GIANT_STATE.walking ? Math.sin(phase) * 0.45 * amount : 0;
  j.legL.rotation.x = swing;
  j.legR.rotation.x = -swing;
  j.tail.rotation.y = Math.sin(phase * 0.5 + t) * 0.22;
  const bow = isDown(state) ? 0 : a;
  j.neck.rotation.x = -0.5 + bow * 0.45;
  j.head.rotation.x = 0.32 + bow * 0.55;
  j.jaw.rotation.x = state === GIANT_STATE.acting ? 0.55 : state === GIANT_STATE.stunned ? 0.3 : 0.05;
  if (j.body.position) j.body.position.y = 8 + Math.abs(Math.sin(phase)) * 0.25 * amount;
  const lit = state === GIANT_STATE.stunned ? 0.08 : 1;
  mats.eyeMat.color.copy(colours.eye).multiplyScalar(lit);
  mats.ventMat.color.copy(colours.vent).multiplyScalar(lit);
}

/**
 * Poses the Yeti's legs and arms as yeti.js `pose` does (the strike swing is not replicated).
 * @param {{legL: Joint, legR: Joint, armL: Joint, armR: Joint}} j The figure's joints.
 * @param {{glowMat: Mat, coolantMat: Mat}} mats Shared materials.
 * @param {{visor: any}} colours The lit colour.
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 to 1.
 * @param {number} state Row state.
 * @param {number} a Row column a (the gun-arm raise).
 * @param {number} b Row column b (the gun-arm pitch).
 * @param {number} t Seconds.
 * @returns {void}
 */
export function poseYeti(j, mats, colours, phase, amount, state, a, b, t) {
  const s = state === GIANT_STATE.walking || state === GIANT_STATE.acting ? Math.sin(phase) * amount : 0;
  j.legL.rotation.x = s * 0.5;
  j.legR.rotation.x = -s * 0.5;
  j.armL.rotation.x = -s * 0.4;
  const aim = isDown(state) ? 0 : Math.min(1, Math.max(0, a));
  const carried = -0.35 + s * 0.15;
  const raised = -Math.PI / 2 + b + Math.sin(t * 9) * 0.02;
  j.armR.rotation.x = carried + (raised - carried) * aim;
  mats.glowMat.color.copy(colours.visor).multiplyScalar(state === GIANT_STATE.stunned ? 0.1 : 1);
  const pulse = 0.75 + 0.25 * Math.sin(t * (state === GIANT_STATE.acting ? 18 : 3));
  if (mats.coolantMat.color.setRGB) mats.coolantMat.color.setRGB(0.5 * pulse, 2.2 * pulse, 3 * pulse);
}
