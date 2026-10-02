// @ts-check

/**
 * ===========================================================================
 * SECTION HP.1 — Pure health state and regeneration functions
 * ===========================================================================
 * Every function takes a `HealthState` and returns a new one; nothing is
 * mutated and nothing is stored at module level (R-047). There is no Three.js
 * import, so the file runs under plain node for tests. Nothing in the runtime
 * calls these yet (R-050). Tornado and debris only daze, so they never reach
 * `applyDamage` with an amount above zero (R-001), and no ability damages
 * Roger (R-032). Time passed to `stepRegen` is player time, never world
 * slow-motion time, and a `dt` of 0 (paused) never regenerates.
 */

/** @typedef {import('./config.js').DamageEvent} DamageEvent */
/** @typedef {import('./config.js').HealthState} HealthState */
/** @typedef {typeof import('./config.js').HEALTH} HealthConfig */

/**
 * Creates a full-health state with all timers cleared.
 * @param {HealthConfig} config The health tunables.
 * @returns {HealthState} A fresh state at maximum health.
 */
export const createHealthState = (config) => ({
  value: config.max,
  sinceLastDamage: 0,
  refilling: false,
  invuln: 0,
  lastSource: null,
});

/**
 * Whether an event kills outright, ignoring the hit window and regeneration.
 * @param {DamageEvent} event The incoming hit.
 * @param {HealthConfig} config The health tunables.
 * @returns {boolean} True for an instant kill.
 */
export const isInstantKill = (event, config) =>
  event.instantKill === true || event.amount > config.max;

/**
 * Applies one hit. Zero-damage events (daze, freeze) and non-instant hits
 * inside the invulnerability window return the same state untouched. Any
 * applied damage resets the timer, clears the glow and cancels the refill.
 * @param {HealthState} state The current state.
 * @param {DamageEvent} event The incoming hit.
 * @param {HealthConfig} config The health tunables.
 * @returns {HealthState} The new state (the input itself when ignored).
 */
export const applyDamage = (state, event, config) => {
  const instant = isInstantKill(event, config);
  if (!instant && (event.amount <= 0 || state.invuln > 0)) return state;
  return {
    value: instant ? 0 : Math.max(0, state.value - event.amount),
    sinceLastDamage: 0,
    refilling: false,
    invuln: instant ? 0 : config.timers.hitInvulnerability,
    lastSource: event.source,
  };
};

/**
 * Advances the timers by `dt` seconds of player time. Once the regeneration
 * delay has passed the value rises at a constant `max / refillDuration` per
 * second, so a near-empty bar is full about `regenDelay + refillDuration`
 * seconds after the last hit.
 * @param {HealthState} state The current state.
 * @param {number} dt Seconds of player time; zero or less changes nothing.
 * @param {HealthConfig} config The health tunables.
 * @returns {HealthState} The advanced state.
 */
export const stepRegen = (state, dt, config) => {
  if (!(dt > 0)) return state;
  const { regenDelay, refillDuration } = config.timers;
  const since = state.sinceLastDamage + dt;
  const invuln = Math.max(0, state.invuln - dt);
  if (state.value >= config.max) {
    return { ...state, sinceLastDamage: since, invuln, refilling: false };
  }
  const refillTime = Math.max(0, since - Math.max(state.sinceLastDamage, regenDelay));
  if (refillTime <= 0) return { ...state, sinceLastDamage: since, invuln, refilling: false };
  const value = Math.min(config.max, state.value + (config.max / refillDuration) * refillTime);
  return { ...state, value, sinceLastDamage: since, invuln, refilling: value < config.max };
};

/**
 * Whether the fast refill began between two states (for the recharge cue).
 * @param {HealthState} before The state before the step.
 * @param {HealthState} after The state after the step.
 * @returns {boolean} True on the step where `refilling` turns on.
 */
export const refillStarted = (before, after) => !before.refilling && after.refilling;

/**
 * Whether the low-health feedback (heartbeat and muffle) should run.
 * @param {HealthState} state The player's state.
 * @param {HealthConfig} config The health tunables.
 * @returns {boolean} True while alive and at or below the low-health threshold.
 */
export const isLowHealth = (state, config) =>
  state.value > 0 && state.value <= config.max * config.lowThreshold;

/**
 * Glow intensity from 0 to 1: linear along the config curve while waiting,
 * full while refilling, and zero at full health.
 * @param {HealthState} state The current state.
 * @param {HealthConfig} config The health tunables.
 * @returns {number} The glow level.
 */
export const glowLevel = (state, config) => {
  if (state.value >= config.max) return 0;
  if (state.refilling) return 1;
  const curve = config.glowCurve;
  const t = state.sinceLastDamage;
  const last = curve[curve.length - 1];
  if (t >= last.t) return last.level;
  const next = curve.findIndex((k) => k.t > t);
  if (next <= 0) return curve[0].level;
  const a = curve[next - 1];
  const b = curve[next];
  return a.level + ((b.level - a.level) * (t - a.t)) / (b.t - a.t);
};

/**
 * Whether a co-op registry entry can take damage now: it must be up (not
 * down or dead) and past its revive shield. A missing entry cannot be hurt.
 * Used by the host for guests and for a downed Roger.
 * @param {{state: string, shield: number} | null | undefined} player The registry entry.
 * @returns {boolean} True when damage may land.
 */
export const isHittable = (player) => !!player && player.state === 'up' && !(player.shield > 0);

/**
 * The state a revived player returns with: full health, timers cleared. The
 * two seconds of safety are the registry's `REVIVE.shield`, kept there.
 * @param {HealthConfig} config The health tunables.
 * @returns {HealthState} A fresh full-health state.
 */
export const revivedState = (config) => createHealthState(config);
