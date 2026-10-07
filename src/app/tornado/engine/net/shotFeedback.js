// @ts-check
import { resolveTrigger, coolDown, weaponAt } from './guestWeapons.js';
import { viewKeyAt } from './viewModel.js';

/**
 * ===========================================================================
 * SECTION NF — The guest's own shot feedback (pure)
 * ===========================================================================
 * What the guest's screen and speakers do at a fire press, at once, without
 * waiting for the host: the muzzle flash, the recoil kick, the minigun's
 * barrels spinning up, and the one cue per shot. It is cosmetic and
 * predicted: it uses the host's own cooldown table (`guestWeapons.js`), so a
 * shot the host refuses (the Black Hole Gun short of energy or with no target)
 * still shows its flash and plays its cue on the guest. Nothing here is sent,
 * scored or hurts anyone (R-027, R-053); the host resolves every shot itself.
 * No scene, no DOM, no audio: the caller draws the numbers, so it is tested
 * without the browser.
 *
 * Numbers follow the host's own close-up weapons (heroWeapons.js: the
 * minigun's `spinUp` 14 and `spinMax` 40, recoil kick 0.35 per round for the
 * minigun and 1 for the others, decay 5 a second, the flash lives).
 */

/** @typedef {{cd: number, recoil: number, spin: number, flash: number, flashKey: string|null, swing: number}} Feedback */

/** Barrel spin: radians a second squared up (x4 as the host applies it), and the top speed. */
export const SPIN = Object.freeze({ up: 14, rampBoost: 4, max: 40 });

/** Recoil: how fast it settles (per second), and the kick a round adds (capped at 1). */
export const RECOIL = Object.freeze({ decay: 5, minigun: 0.35, other: 1 });

/**
 * Each weapon's flash: seconds it lives, its size, and which audio cue plays
 * (an existing hero sound; null for none). The Fire Gun's flame and the
 * Katana's cut have no per-shot flash or cue here.
 */
export const SHOT_LOOK = Object.freeze({
  rifle: { life: 0.08, scale: 1.2, cue: 'plasma' },
  minigun: { life: 0.04, scale: 1.2, cue: 'bullet' },
  railgun: { life: 0.12, scale: 2, cue: 'zap' },
  blackhole: { life: 0.18, scale: 2.4, cue: 'zap' }
});

/**
 * Which wheel keys the guest's own predicted shot draws through the mirror
 * (a round with casings and sparks, a rail bolt: `net/mirror.js`) and which
 * still draw the bare tracer (until the plasma beam and the Black Hole Gun
 * get their own renderers in later subtasks).
 */
export const MIRROR_KEYS = Object.freeze(new Set(['minigun', 'railgun']));
export const TRACER_KEYS = Object.freeze(new Set(['rifle', 'blackhole']));

/** The Katana's cut on the guest's screen: how long the swing lasts (seconds), and how far the blade sweeps. */
export const SWING = Object.freeze({ life: 0.3, pitch: 1.2, yaw: -0.9, sweep: -0.25 });

/**
 * How far into its cut the blade is, out and back (0 at rest, 1 at the middle of the cut).
 * @param {number} left Seconds of swing left.
 * @returns {number}
 */
export const swingAmount = (left) => (left > 0 ? Math.sin((1 - Math.min(1, left / SWING.life)) * Math.PI) : 0);

/** @returns {Feedback} A quiet state. */
export const newFeedback = () => ({ cd: 0, recoil: 0, spin: 0, flash: 0, flashKey: null, swing: 0 });

/**
 * One frame of feedback.
 * @param {Feedback} fb Previous state.
 * @param {{fire: boolean, aim: boolean, up: boolean, weapon: number}} input fire is held or an unsent press is owed
 * @param {number} dt Real seconds.
 * @returns {{fb: Feedback, shot: string|null, flame: boolean}} The next state, the wheel key that fired this frame (null: none), and whether the Fire Gun's flame is breathing.
 */
export const stepFeedback = (fb, input, dt) => {
  const key = viewKeyAt(input.weapon);
  const trigger = input.fire && input.up ? { weapon: input.weapon, aim: input.aim } : null;
  const cd = coolDown(fb.cd, dt);
  const { verdict } = resolveTrigger(trigger, cd);
  const shoots = verdict === 'shoot';
  const w = shoots ? weaponAt(input.weapon) : null;
  const look = key && shoots && key in SHOT_LOOK ? SHOT_LOOK[/** @type {keyof typeof SHOT_LOOK} */ (key)] : null;
  const spinning = input.up && input.aim && input.fire && key === 'minigun';
  const kick = shoots && key !== 'fire' && key !== 'katana' ? (key === 'minigun' ? RECOIL.minigun : RECOIL.other) : 0;
  const flame = verdict === 'flame';
  const flash = look ? look.life : Math.max(0, fb.flash - dt);
  return {
    fb: {
      cd: w ? w.cooldown : cd,
      recoil: Math.min(1, Math.max(0, fb.recoil - dt * RECOIL.decay) + kick),
      spin: spinning ? Math.min(SPIN.max, fb.spin + SPIN.up * dt * SPIN.rampBoost) : Math.max(0, fb.spin - SPIN.up * dt),
      flash,
      flashKey: look ? key : (flash > 0 ? fb.flashKey : null),
      swing: shoots && key === 'katana' ? SWING.life : Math.max(0, fb.swing - dt)
    },
    shot: shoots ? key : null,
    flame
  };
};

/**
 * The flash's opacity (the host's rule: the life left times 20).
 * @param {number} flash Seconds of flash left.
 * @returns {number}
 */
export const flashOpacity = (flash) => Math.max(0, flash * 20);
