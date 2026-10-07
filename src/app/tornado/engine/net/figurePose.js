// @ts-check
/**
 * ===========================================================================
 * SECTION FP — Hank Granite, HAVOC and the samurai on the guest: the `figures` kind, encoded and posed (pure)
 * ===========================================================================
 * Three humanoid actors share one additive optional kind (an older guest
 * ignores it, an older host never sends it):
 *   figures  [id, type, x, y, z, heading, state, a, b]
 * `type` is `FIGURE` (0 Hank, 1 HAVOC, 2 a samurai), `y` is the feet height
 * (Hank rising out of the crater, a samurai on the ramp or sinking, HAVOC
 * sinking), `state` is the type's own `*_STATE`, and `a`, `b` are two pose
 * values whose meaning is per type:
 *   Hank     a wind-up progress 0..1, or how far he has crumbled; b the arm used (0 or 1)
 *   HAVOC    a barrel spin 0..1, b heat 0..1 (b the topple progress 0..1 once he is going down)
 *   samurai  a seconds into the cut, or into the fall; b the armour colour (0..3)
 * The walk cycle comes from the interpolated movement (rogerView.js
 * `stepRunCycle`), as for the Terminators. HAVOC's rounds are `fx` rows
 * (net/enemyFx.js); his laser sights, the samurai's cut effects and Hank's
 * boulder, dust and throws are not here. No scene, no DOM, no module state.
 */

/** Actor types (column 1). */
export const FIGURE = Object.freeze({ hank: 0, havoc: 1, samurai: 2 });

/** Hank's states. */
export const HANK_STATE = Object.freeze({ standing: 0, wind: 1, after: 2, throw: 3, stagger: 4, crumble: 5 });
/** HAVOC's states (the host's phases, then stunned, then going down). */
export const HAVOC_STATE = Object.freeze({ walking: 0, spinning: 1, firing: 2, cooling: 3, stunned: 4, down: 5 });
/** A samurai's states. */
export const SAMURAI_STATE = Object.freeze({ walking: 0, cutting: 1, dying: 2 });

/** The host's barrel spin ceiling, rad/s (gunner.js), the divisor of column `a`. */
export const HAVOC_SPIN_MAX = 40;
/** The host's topple time, seconds (gunner.js `topple`). */
export const HAVOC_TOPPLE = 0.9;
/** Hank's host stride per metre (actionHero.js: `boss.stride += step * 1.4`). */
export const HANK_STRIDE = 1.4;

const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
const unit = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));

/**
 * Hank's row. Id 0 (there is one).
 * @param {{x: number, y: number, z: number, heading: number, state: number, a: number, b: number}} s
 * @param {(v: number) => number} clamp Keeps a position inside the world.
 * @returns {number[]}
 */
export const hankRow = (s, clamp) => [0, FIGURE.hank, r2(clamp(s.x)), r2(s.y), r2(clamp(s.z)), r2(s.heading), s.state, r2(unit(s.a)), s.b > 0.5 ? 1 : 0];

/**
 * One HAVOC's row.
 * @param {number} id A stable id, apart from Hank's 0.
 * @param {{x: number, y: number, z: number, yaw: number, phase: string, stunned: boolean, spin: number, heat: number, dying: boolean, dead: number}} s
 * @param {(v: number) => number} clamp
 * @returns {number[]}
 */
export function havocRow(id, s, clamp) {
  const spin = r2(unit(s.spin / HAVOC_SPIN_MAX));
  let state = HAVOC_STATE.walking;
  let b = r2(unit(s.heat));
  if (s.dying) {
    state = HAVOC_STATE.down;
    b = r2(unit(s.dead / HAVOC_TOPPLE));
  } else if (s.stunned) state = HAVOC_STATE.stunned;
  else if (s.phase === 'spinning') state = HAVOC_STATE.spinning;
  else if (s.phase === 'firing') state = HAVOC_STATE.firing;
  else if (s.phase === 'cooling') state = HAVOC_STATE.cooling;
  return [id, FIGURE.havoc, r2(clamp(s.x)), r2(s.y), r2(clamp(s.z)), r2(s.yaw), state, spin, b];
}

/**
 * One samurai's row.
 * @param {number} id A stable id, apart from Hank's 0.
 * @param {{x: number, y: number, z: number, heading: number, phase: string, swing: number, timer: number, variant: number}} s
 * @param {(v: number) => number} clamp
 * @returns {number[]}
 */
export function samuraiRow(id, s, clamp) {
  const dying = s.phase === 'dying';
  const cutting = !dying && s.swing >= 0;
  const state = dying ? SAMURAI_STATE.dying : cutting ? SAMURAI_STATE.cutting : SAMURAI_STATE.walking;
  const a = dying ? Math.min(9.9, s.timer) : cutting ? Math.min(2, s.swing) : 0;
  return [id, FIGURE.samurai, r2(clamp(s.x)), r2(s.y), r2(clamp(s.z)), r2(s.heading), state, r2(a), Math.max(0, Math.min(3, Math.round(s.variant)))];
}

// ---------------------------------------------------------------------
// Hank
// ---------------------------------------------------------------------

/** @typedef {{x: number, y?: number}} Rot */
/** @typedef {{rotation: Rot, position?: {y: number}}} Joint */
/** @typedef {{torso: Joint, hip0: Joint, hip1: Joint, sh0: Joint, sh1: Joint, el0: Joint, el1: Joint}} HankJoints */
/** @typedef {{s0x: number, s1x: number, e0x: number, e1x: number, ty: number, tx: number, drop: number, legs: number}} HankPose */

/** @returns {HankPose} A pose at rest. */
export const newHankPose = () => ({ s0x: 0, s1x: 0, e0x: 0, e1x: 0, ty: 0, tx: 0, drop: 0, legs: 0 });

/**
 * The pose Hank is easing towards, as actionHero.js `restPose`, `showPose` and `stepBoss` set it.
 * @param {number} state Row state.
 * @param {number} a Row column a (the wind-up progress).
 * @param {number} b Row column b (the arm, 0 or 1).
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 to 1.
 * @param {number} t Seconds, for the breathing.
 * @param {HankPose} out Written.
 * @returns {HankPose}
 */
export function hankWant(state, a, b, phase, amount, t, out) {
  out.s0x = out.s1x = -0.1 + Math.sin(t * 2) * 0.04;
  out.e0x = out.e1x = -0.35;
  out.ty = 0;
  out.tx = 0.05;
  out.drop = 0;
  out.legs = 0;
  const arm = b > 0.5 ? 1 : 0;
  const side = arm === 0 ? 1 : -1;
  const setArm = (/** @type {number} */ shoulder, /** @type {number} */ elbow, /** @type {number} */ which = arm) => {
    if (which === 0) { out.s0x = shoulder; out.e0x = elbow; } else { out.s1x = shoulder; out.e1x = elbow; }
  };
  if (state === HANK_STATE.wind) {
    setArm(0.55, -1.85);
    out.ty = side * 0.75 * unit(a);
    out.drop = -0.15;
  } else if (state === HANK_STATE.after) {
    setArm(-1.55, -0.1);
    out.ty = -side * 0.45;
  } else if (state === HANK_STATE.throw) {
    setArm(-2.6, -0.3, 1);
  } else if (state === HANK_STATE.stagger) {
    out.tx = 0.35;
    out.drop = -0.2;
  } else if (state === HANK_STATE.standing && amount > 0.02) {
    const s = Math.sin(phase) * amount;
    out.legs = s * 0.5;
    out.s0x = -s * 0.4;
    out.s1x = s * 0.4;
  }
  return out;
}

/**
 * The magma's glow for a state, as the host's wind-up, blows and crumble drive it.
 * @param {number} state Row state.
 * @param {number} a Row column a.
 * @returns {number} emissiveIntensity.
 */
export function hankGlow(state, a) {
  if (state === HANK_STATE.wind) return 2 + 4 * unit(a);
  if (state === HANK_STATE.after) return 4;
  if (state === HANK_STATE.crumble) return Math.max(0.2, 1.2 * (1 - unit(a)));
  return 1.2;
}

/**
 * Eases Hank's held pose towards the wanted one and writes the joints (the host's `applyPose`, rate 16 a second).
 * @param {HankJoints} j
 * @param {HankPose} has Held pose, mutated.
 * @param {HankPose} want
 * @param {number} dt Real seconds.
 * @returns {void}
 */
export function applyHank(j, has, want, dt) {
  const r = Math.min(1, Math.max(0, dt) * 16);
  for (const key of /** @type {(keyof HankPose)[]} */ (Object.keys(has))) has[key] += (want[key] - has[key]) * r;
  j.sh0.rotation.x = has.s0x;
  j.sh1.rotation.x = has.s1x;
  j.el0.rotation.x = has.e0x;
  j.el1.rotation.x = has.e1x;
  /** @type {any} */ (j.torso.rotation).y = has.ty;
  j.torso.rotation.x = has.tx;
  if (j.torso.position) j.torso.position.y = 1.45 + has.drop;
  j.hip0.rotation.x = has.legs;
  j.hip1.rotation.x = -has.legs;
}

// ---------------------------------------------------------------------
// HAVOC
// ---------------------------------------------------------------------

/** @typedef {{rotation: {x: number, z: number}, position: {x: number, y: number, z: number}, visible?: boolean, scale?: any}} Part */
/** @typedef {{body: Part, legs: Part[], guns: {gun: Part, barrels: Part, flash: Part}[], heat: {emissive: {setRGB: Function}}, visor: {color: {setRGB: Function}}, marker: Part}} HavocParts */

/**
 * Poses HAVOC as gunner.js `animate` and `topple` do, from the row.
 * @param {HavocParts} p
 * @param {number} state Row state.
 * @param {number} a Row column a (spin 0..1).
 * @param {number} b Row column b (heat, or the topple progress once down).
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 to 1.
 * @param {number} t Seconds.
 * @param {number} dt Real seconds (the barrels' turn).
 * @param {() => number} [rand]
 * @returns {void}
 */
export function poseHavoc(p, state, a, b, phase, amount, t, dt, rand = Math.random) {
  const down = state === HAVOC_STATE.down;
  const firing = state === HAVOC_STATE.firing;
  const swing = Math.sin(phase) * 0.45 * (down ? 0 : amount);
  p.legs[0].rotation.x = swing;
  p.legs[1].rotation.x = -swing;
  const k = down ? unit(b) : 0;
  p.body.rotation.x = down ? -k * k * 1.45 : firing ? -0.06 + Math.sin(t * 60) * 0.012 : 0;
  p.body.position.z = down ? -k * 0.4 : 0;
  const spin = unit(a) * HAVOC_SPIN_MAX;
  for (let i = 0; i < p.guns.length; i++) {
    const g = p.guns[i];
    g.barrels.rotation.z += spin * dt * (i === 0 ? 1 : -1);
    g.flash.visible = firing && rand() < (i === 0 ? 0.85 : 0.3);
    if (g.flash.visible) {
      g.flash.rotation.z = rand() * Math.PI;
      g.flash.scale.setScalar(0.6 + rand() * 0.7);
    }
    const kick = firing ? Math.sin(t * 55) * 0.03 * (i === 0 ? 1 : -1) : 0;
    g.gun.position.z = 0.02 + kick;
  }
  const heat = down ? 0.4 : unit(b);
  p.heat.emissive.setRGB(heat * 2.2, heat * heat * 0.9, heat * heat * heat * 0.2);
  p.visor.color.setRGB(3.2, 0.15, 0.1);
  p.marker.visible = !down;
  p.marker.position.y = 3.05 + Math.sin(t * 4) * 0.12;
}

// ---------------------------------------------------------------------
// The samurai
// ---------------------------------------------------------------------

/** @typedef {{rotation: {x: number, set: Function}, position: {y: number}}} Limb */
/** @typedef {{pelvis: Limb, legL: Limb, legR: Limb, armL: Limb, armR: Limb, trail: {visible: boolean}, trailMat: {opacity: number}}} SamuraiParts */

/**
 * The cut's arm angle at `swing` seconds in (spaceship/samurai.js `pose`).
 * @param {number} swing Seconds into the cut.
 * @param {{windup: number, swing: number, recover: number}} c
 * @returns {number} Radians about x.
 */
export function cutAngle(swing, c) {
  const lerp = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ k) => x + (y - x) * k;
  if (swing < c.windup) {
    const k = unit(swing / c.windup);
    return lerp(-0.9, -3.25, k * k * (3 - 2 * k));
  }
  if (swing < c.windup + c.swing) return lerp(-3.25, -0.25, (swing - c.windup) / c.swing);
  return lerp(-0.25, -0.9, unit((swing - c.windup - c.swing) / c.recover));
}

/**
 * Poses a samurai as spaceship/samurai.js `pose` does, from the row and the walk cycle.
 * @param {SamuraiParts} r
 * @param {{windup: number, swing: number, recover: number, runSpeed: number, deathSeconds: number}} c The host's numbers.
 * @param {number} state Row state.
 * @param {number} a Row column a (seconds into the cut or the fall).
 * @param {number} phase Walk-cycle radians.
 * @param {number} amount 0 to 1 of `c.runSpeed`.
 * @returns {{tilt: number}} The tilt of the whole figure about x (a fall).
 */
export function poseSamurai(r, c, state, a, phase, amount) {
  const dying = state === SAMURAI_STATE.dying;
  const speed = dying ? 0 : amount * c.runSpeed;
  const s = Math.sin(phase);
  const amp = Math.min(0.95, speed * 0.12);
  r.legL.rotation.x = s * amp;
  r.legR.rotation.x = -s * amp;
  const running = speed > 3;
  r.pelvis.rotation.x = running ? 0.22 : 0.04;
  r.pelvis.position.y = running ? Math.abs(Math.cos(phase)) * 0.06 : 0.01 * Math.sin(phase * 0.5);
  r.trail.visible = false;
  if (state === SAMURAI_STATE.cutting) {
    const ang = cutAngle(a, c);
    r.armR.rotation.set(ang, 0, 0.3);
    r.armL.rotation.set(ang, 0, -0.3);
    const cut = (a - c.windup) / c.swing;
    const glow = cut > 0 && cut < 1.8 ? Math.sin(Math.min(1, cut / 1.8) * Math.PI) : 0;
    r.trail.visible = glow > 0.01;
    r.trailMat.opacity = 0.75 * glow;
  } else if (running) {
    r.armR.rotation.set(0.55, 0, 0.22);
    r.armL.rotation.set(-s * amp * 0.8, 0, -0.08);
  } else {
    r.armR.rotation.set(-0.95 + 0.04 * Math.sin(phase * 0.5), 0, 0.32);
    r.armL.rotation.set(-0.95 + 0.04 * Math.sin(phase * 0.5), 0, -0.32);
  }
  const fall = dying ? unit(a / c.deathSeconds) : 0;
  return { tilt: fall === 0 ? 0 : -fall * fall * (Math.PI / 2 - 0.08) };
}
