// @ts-check

/**
 * ===========================================================================
 * SECTION HP.2 — Melee touch with cooldown (pure helper)
 * ===========================================================================
 * One shared touch rule for alien crew, squad Terminators and Hero Mode
 * pursuers (Q6). The reach and cooldown come from `HEALTH.melee`, which
 * replaces `ALIENS.meleeReach` (1 m) and `HERO.catchRadius` (0.99 m) once the
 * wiring subtask lands. Every function returns a new state and nothing is
 * mutated or stored at module level (R-047); there is no Three.js import.
 * Nothing in the runtime calls this yet (R-050).
 *
 * "Counted once" decision: the cooldown belongs to the attacker (more exactly
 * to one attacker-target pair, because the caller keeps one `TouchState` per
 * attacker, and per target where several players can be hit). Two attackers
 * therefore never share a cooldown: a squad of 5 (R-022) or 2 pursuers
 * (R-028) can each land one touch per 3 s, but one attacker never hits the
 * same target twice inside the cooldown.
 *
 * Clock: `now` is supplied by the caller. Recommended with Time Slow in mind
 * is player (real) time, the same clock as the health regeneration: a slowed
 * world must not shorten or stretch the 3 s of safety the player was given.
 * Whichever clock is chosen, each attacker must always use the same one.
 *
 * Telegraph (Subtask 9): `meleeStep` adds the idle, windup, strike and recover
 * phases on top of `touchAttempt`. Inside `telegraphRange` an attacker off
 * its cooldown winds up for `windUp` seconds, then strikes: the blow goes
 * through `touchAttempt`, so it lands only if the target is within
 * `contactReach` at that moment and misses otherwise. The cooldown starts at
 * the strike, hit or miss, and the swing plus recovery (`strikeSeconds` +
 * `recoverSeconds`) end well inside it. A knocked-down attacker drops back to
 * idle at once and never winds up.
 */

/** @typedef {typeof import('./config.js').HEALTH} HealthConfig */

/**
 * One attacker's touch memory against one target.
 * @typedef {Object} TouchState
 * @property {number | null} lastTouchAt Clock time of the last strike (hit or miss); null if never.
 * @property {'idle' | 'windup' | 'strike' | 'recover'} phase Where the attacker is in its telegraph.
 * @property {number} phaseAt Clock time at which the current phase began.
 */

/**
 * Optional inputs of a touch attempt.
 * @typedef {Object} TouchOptions
 * @property {boolean} [staggered] True while the attacker is knocked down (`p.stagger > 0`); never touches.
 * @property {string} [source] Key into `HEALTH.damage` (default `terminatorTouch`).
 */

/**
 * Result of a touch attempt.
 * @typedef {Object} TouchResult
 * @property {TouchState} state The attacker's new state.
 * @property {number} damage Points to apply to the target; 0 when no touch landed.
 * @property {string | null} source Damage source key when a touch landed, else null.
 */

/**
 * Creates a fresh touch state: the attacker may touch immediately.
 * @returns {TouchState} A state with no previous touch.
 */
export const createTouchState = () => ({ lastTouchAt: null, phase: 'idle', phaseAt: 0 });

/**
 * Tells whether the 3 s cooldown has finished.
 * @param {TouchState} state The attacker's touch state.
 * @param {number} now Current time on the caller's chosen clock, in seconds.
 * @param {HealthConfig} config The health tunables.
 * @returns {boolean} True when a new touch is allowed.
 */
export const touchReady = (state, now, config) =>
  state.lastTouchAt === null || now - state.lastTouchAt >= config.melee.cooldown;

/**
 * Attempts one touch. It lands only when the attacker is not knocked down,
 * the target is within `contactReach` (inclusive) and the cooldown is over.
 * @param {TouchState} state The attacker's touch state (not mutated).
 * @param {number} targetDistance Distance to the target in metres.
 * @param {HealthConfig} config The health tunables.
 * @param {number} now Current time on the caller's chosen clock, in seconds.
 * @param {TouchOptions} [opts] Stagger flag and damage source.
 * @returns {TouchResult} The new state and the damage dealt.
 */
export const touchAttempt = (state, targetDistance, config, now, opts = {}) => {
  const source = opts.source ?? 'terminatorTouch';
  const miss = { state, damage: 0, source: null };
  if (opts.staggered) return miss;
  if (!(targetDistance <= config.melee.contactReach)) return miss;
  if (!touchReady(state, now, config)) return miss;
  return {
    state: { ...state, lastTouchAt: now },
    damage: config.damage[source].amount,
    source,
  };
};

/**
 * Result of one telegraph step.
 * @typedef {Object} MeleeStep
 * @property {TouchState} state The attacker's new state.
 * @property {number} damage Points to apply to the target; 0 unless a strike landed.
 * @property {string | null} source Damage source key when a strike landed, else null.
 * @property {boolean} windupStarted True on the step the wind-up begins (play the cue once).
 * @property {boolean} struck True on the step the blow is thrown, hit or miss.
 */

/**
 * Builds a state in a new phase, keeping the cooldown memory.
 * @param {TouchState} state The previous state.
 * @param {TouchState['phase']} phase The phase entered.
 * @param {number} now Clock time in seconds.
 * @returns {TouchState} The new state.
 */
const enter = (state, phase, now) => ({ ...state, phase, phaseAt: now });

/**
 * Advances the telegraph by one step. Pure: the clock is the caller's.
 * @param {TouchState} state The attacker's state (not mutated).
 * @param {number} targetDistance Distance to the target in metres.
 * @param {HealthConfig} config The health tunables.
 * @param {number} now Current time on the caller's chosen clock, in seconds.
 * @param {TouchOptions} [opts] Stagger flag and damage source.
 * @returns {MeleeStep} The new state and any damage dealt.
 */
export const meleeStep = (state, targetDistance, config, now, opts = {}) => {
  const m = config.melee;
  const same = { state, damage: 0, source: null, windupStarted: false, struck: false };
  if (opts.staggered) return state.phase === 'idle' ? same : { ...same, state: enter(state, 'idle', now) };
  const age = now - state.phaseAt;
  switch (state.phase) {
    case 'windup': {
      if (age < m.windUp) return same;
      const hit = touchAttempt(state, targetDistance, config, now, opts);
      const struck = hit.damage > 0 ? hit.state : { ...state, lastTouchAt: now };
      return { ...same, state: enter(struck, 'strike', now), damage: hit.damage, source: hit.source, struck: true };
    }
    case 'strike':
      return age < m.strikeSeconds ? same : { ...same, state: enter(state, 'recover', now) };
    case 'recover':
      return age < m.recoverSeconds ? same : { ...same, state: enter(state, 'idle', now) };
    default:
      return targetDistance <= m.telegraphRange && touchReady(state, now, config)
        ? { ...same, state: enter(state, 'windup', now), windupStarted: true }
        : same;
  }
};

/**
 * Glow level of the telegraph, 0 to 1: rises through the wind-up, peaks at
 * the blow and fades over the recovery.
 * @param {TouchState} state The attacker's state.
 * @param {number} now Current time on the caller's clock, in seconds.
 * @param {HealthConfig} config The health tunables.
 * @returns {number} 0 when idle.
 */
export const telegraphGlow = (state, now, config) => {
  const m = config.melee;
  const age = now - state.phaseAt;
  if (state.phase === 'windup') return Math.min(1, age / m.windUp);
  if (state.phase === 'strike') return 1;
  if (state.phase === 'recover') return Math.max(0, 1 - age / m.recoverSeconds);
  return 0;
};

/**
 * Right-arm pitch override of the telegraph, in radians about the shoulder
 * (negative is forward and up). Null when the walk cycle owns the arm.
 * @param {TouchState} state The attacker's state.
 * @param {number} now Current time on the caller's clock, in seconds.
 * @param {HealthConfig} config The health tunables.
 * @returns {number | null} The angle, or null when idle.
 */
export const telegraphArm = (state, now, config) => {
  const m = config.melee;
  const age = now - state.phaseAt;
  const clamp01 = (/** @type {number} */ x) => Math.min(1, Math.max(0, x));
  if (state.phase === 'windup') return -2.7 * clamp01(age / m.windUp);
  if (state.phase === 'strike') return -2.7 + 3 * clamp01(age / m.strikeSeconds);
  if (state.phase === 'recover') return 0.3 * (1 - clamp01(age / m.recoverSeconds));
  return null;
};
