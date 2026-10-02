// @ts-check
import { HEALTH } from '../health/config.js';
import { meleeStep, telegraphArm, telegraphGlow } from '../health/melee.js';

/**
 * ===========================================================================
 * SECTION T800.T — The Terminator's wind-up (shared)
 * ===========================================================================
 * One helper for the squad and for Hero Mode pursuers. Within 6 m of Roger a
 * machine raises its right arm, its eyes flare and the servos whine (once per
 * wind-up); after 0.6 s it strikes, and the blow lands only if he is still
 * within 2 m (health/melee.js `meleeStep`). It reuses the existing
 * `shoulderR` joint and `eyeMat`; there is no new light or material. All state
 * lives on the machine's own `holder` (R-047), which is discarded with it.
 */

/** Brightness multiplier of the eyes at full wind-up. */
const EYE_FLARE = 2.5;

/**
 * Whatever carries the melee state: the squad unit itself, or a pursuer's `p`.
 * @typedef {Object} MeleeHolder
 * @property {import('../health/melee.js').TouchState} touch Cooldown and phase memory.
 * @property {number} touchClock World seconds, the clock of `touch`.
 * @property {boolean} [eyeFlared] True while the eyes carry the wind-up glow.
 */

/**
 * The parts of a machine the telegraph drives.
 * @typedef {Object} MeleeRig
 * @property {{shoulderR: {rotation: {x: number}}}} joints Its joints.
 * @property {{color: {copy: Function, multiplyScalar: Function}}} eyeMat Its eye material.
 */

/**
 * Advances one machine's wind-up and applies a landed blow.
 * @param {*} ctx The simulation context.
 * @param {MeleeHolder} holder The machine's melee state.
 * @param {number} distance Distance to Roger in metres.
 * @param {boolean} staggered True while the machine is knocked down.
 * @param {{x: number, y: number, z: number}} position The machine's position (cue and damage origin).
 * @param {string} sub Death-card subtitle for a lethal blow.
 * @param {string} [targetId] Player struck, `'0'` (Roger) by default; one cooldown per machine whoever it hunts.
 * @returns {boolean} True when the blow landed this step.
 */
export const stepTelegraph = (ctx, holder, distance, staggered, position, sub, targetId = '0') => {
  const step = meleeStep(holder.touch, distance, HEALTH, holder.touchClock, { staggered, source: 'terminatorTouch' });
  holder.touch = step.state;
  if (step.windupStarted) ctx.systems.creatureSounds.play('servo', position, { pitch: 0.8 });
  if (step.damage <= 0) return false;
  ctx.systems.health.damagePlayer({
    source: 'terminatorTouch', type: 'melee', title: 'TERMINATED', sub, targetId,
    position: { x: position.x, y: position.y, z: position.z }
  });
  return true;
};

/**
 * Drops the wind-up at once (target lost, machine down) and clears its pose.
 * @param {MeleeHolder} holder The machine's melee state.
 * @returns {void}
 */
export const cancelTelegraph = (holder) => {
  if (holder.touch.phase === 'idle') return;
  holder.touch = { ...holder.touch, phase: 'idle', phaseAt: holder.touchClock };
};

/**
 * Writes the raised arm and the eye glow, after the walk cycle has set the
 * joints. Does nothing when idle (and restores the eyes once when it ends).
 * @param {MeleeRig} rig The machine's joints and eye material.
 * @param {MeleeHolder} holder The machine's melee state.
 * @param {{set?: Function, clone?: Function}} eyeBase The resting eye colour.
 * @returns {void}
 */
export const applyTelegraph = (rig, holder, eyeBase) => {
  const arm = telegraphArm(holder.touch, holder.touchClock, HEALTH);
  if (arm === null) {
    if (holder.eyeFlared) {
      rig.eyeMat.color.copy(eyeBase);
      rig.joints.shoulderR.rotation.x = 0;
      holder.eyeFlared = false;
    }
    return;
  }
  rig.joints.shoulderR.rotation.x = arm;
  const glow = telegraphGlow(holder.touch, holder.touchClock, HEALTH);
  rig.eyeMat.color.copy(eyeBase).multiplyScalar(1 + (EYE_FLARE - 1) * glow);
  holder.eyeFlared = true;
};
