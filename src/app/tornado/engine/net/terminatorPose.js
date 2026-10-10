// @ts-check
/**
 * ===========================================================================
 * SECTION NT — A Terminator figure on the guest, posed from replicated state (pure)
 * ===========================================================================
 * The guest draws the host's Terminators and pursuers with the real model
 * (terminator/model.js), cloned from one template so the geometry and
 * materials are shared. There is no AI here: the walk cycle comes from how far
 * the interpolated row moved (rogerView.js `stepRunCycle`), and the pose is
 * the host's walk (terminator/movement.js) minus the combat extras (wind-up,
 * blow, lean into the wind), which need state the snapshot row does not carry.
 * No scene, no DOM, no module state, so it is tested without the browser.
 */

/** @typedef {{rotation: {x: number}, position?: {y: number}}} Joint */
/** @typedef {{hipL: Joint, hipR: Joint, kneeL: Joint, kneeR: Joint, shoulderL: Joint, shoulderR: Joint, body: Joint}} Joints */

/**
 * The host's stride pose for a point of the cycle, scaled by how fast it
 * walks (0 standing, 1 the host's own full stride).
 * @param {Joints} j The figure's joints.
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 to 1.
 * @returns {void}
 */
export const poseWalk = (j, phase, amount) => {
  const s = Math.sin(phase) * amount;
  j.hipL.rotation.x = s * 0.55;
  j.hipR.rotation.x = -s * 0.55;
  j.kneeL.rotation.x = Math.max(0, -s) * 0.7;
  j.kneeR.rotation.x = Math.max(0, s) * 0.7;
  j.shoulderL.rotation.x = -s * 0.4;
  j.shoulderR.rotation.x = s * 0.4;
  if (j.body.position) j.body.position.y = Math.abs(Math.cos(phase)) * 0.03 * amount;
};

/**
 * The tilt of the whole figure: upright while hunting, lying face down once
 * the row says it is down (the same pitch the capsule placeholder used).
 * @param {number} state The row's state column: 0 hunting, 1 down.
 * @returns {number} Radians about x.
 */
export const lieAngle = (state) => (state === 0 ? 0 : -Math.PI / 2 + 0.1);

/**
 * Finds the nodes of a clone that correspond to the template's joints, by
 * walking both trees in the same order (a clone keeps its child order).
 * @template {Record<string, any>} J
 * @param {{children: any[]}} template The template's root.
 * @param {{children: any[]}} copy A clone of it.
 * @param {J} joints The template's joints by name.
 * @returns {J} The same names, pointing into the clone.
 */
export const mapJoints = (template, copy, joints) => {
  /** @type {Map<any, any>} */
  const twin = new Map();
  /** @param {any} a @param {any} b */
  const walk = (a, b) => {
    twin.set(a, b);
    for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
  };
  walk(template, copy);
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, node] of Object.entries(joints)) out[name] = twin.get(node);
  return /** @type {J} */ (out);
};
