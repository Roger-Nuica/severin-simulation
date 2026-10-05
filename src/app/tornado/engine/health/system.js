// @ts-check

/**
 * ===========================================================================
 * SECTION HP.2 — The health system and the one player-damage API
 * ===========================================================================
 * Registered on `ctx.systems.health`. Every hit on a player goes through
 * `damagePlayer`; nothing else changes health. Per-player state lives in a
 * map created inside the factory (so per instance, never at module level,
 * R-047) and is only ever replaced by the pure functions of `state.js`.
 *
 * Roger (target '0') is special: when his health reaches 0, or an instant
 * kill lands, the existing `heroMode.killRoger` runs, so the spawn shield,
 * co-op interception (`net.interceptRogerDeath`) and the death flow stay as
 * they are (R-035). Other ids (co-op guests) are stored in the same map and
 * are only bookkept here. Tornado and debris never reach this API with
 * damage (R-001), and no ability harms Roger (R-032).
 *
 * Time: `updateHealth` is fed real frame time, held at 0 while paused, never
 * the world's slow-motion time, so Time Slow and Bullet Time do not stretch
 * regeneration. Nothing calls `damagePlayer` yet (R-050).
 */

import { HEALTH } from './config.js';
import { createFireDamage } from './fire.js';
import { createHazardDamage } from './hazards.js';
import { createHealthAudio } from '../sound/healthAudio.js';
import { applyDamage, createHealthState, glowLevel, isHittable, isInstantKill as isInstant, isLowHealth, refillStarted, revivedState, stepRegen } from './state.js';

/** @typedef {import('./config.js').DamageEvent} DamageEvent */
/** @typedef {import('./config.js').HealthState} HealthState */

/**
 * What a call to `damagePlayer` did.
 * @typedef {Object} DamageResult
 * @property {boolean} applied True when health actually changed.
 * @property {boolean} killed True when the hit ended the player (Roger: `killRoger` was called).
 * @property {number} health Health of the target after the call.
 */

/**
 * The hit a caller describes; `title`, `sub` and `kind` only matter for Roger's death.
 * @typedef {Object} DamageRequest
 * @property {string} source Key into `HEALTH.damage`.
 * @property {number} [amount] Points removed; defaults to the source's configured amount.
 * @property {string} [type] Damage kind (`ray`, `melee`, `fire`, `blast`).
 * @property {{x: number, y: number, z: number} | null} [position] Attacker position, for the direction indicator.
 * @property {string} [targetId] Player id; defaults to `'0'` (Roger).
 * @property {boolean} [instantKill] Ignores the hit window and regeneration.
 * @property {string} [title] Death title; defaults to `KILLED`.
 * @property {string} [sub] Death sub-title; defaults to the source's configured message.
 * @property {''|'fall'} [kind] Death kind forwarded to `killRoger` (the chasm uses `'fall'`).
 * @property {boolean} [pierce] Goes through Invincible (never the spawn shield): Hank Granite's punch.
 */

/** @type {DamageResult} */
const NOTHING = Object.freeze({ applied: false, killed: false, health: HEALTH.max });

/**
 * Creates the health system for one simulation instance.
 * @param {any} ctx The simulation context.
 * @returns {{
 *   damagePlayer: (request: DamageRequest) => DamageResult,
 *   health: (id?: string) => number,
 *   state: (id?: string) => HealthState,
 *   glow: (id?: string) => number,
 *   isInstantKill: (request: DamageRequest) => boolean,
 *   revivePlayer: (id: string) => void,
 *   initHealth: () => void,
 *   updateHealth: (rawDt: number) => void,
 *   resetHealth: () => void,
 *   disposeHealth: () => void
 * }} The system's public surface.
 */
export function createHealthSystem(ctx) {
  /** @type {Map<string, HealthState>} */
  const players = new Map();
  const fireDamage = createFireDamage(ctx);
  const hazardDamage = createHazardDamage(ctx);
  const audio = createHealthAudio(ctx);
  /** @type {(() => void) | null} */
  let stopHurtListener = null;

  /** @returns {any} Hero Mode's system, looked up lazily. */
  const hero = () => ctx.systems.heroMode;

  /**
   * One player's state, created at full health on first use.
   * @param {string} id Player id.
   * @returns {HealthState} The state.
   */
  const stateOf = (id) => {
    const found = players.get(id);
    if (found) return found;
    const fresh = createHealthState(HEALTH);
    players.set(id, fresh);
    return fresh;
  };

  /**
   * Turns a request into the pure event, filling the configured amount.
   * @param {DamageRequest} request The caller's description.
   * @returns {DamageEvent} The event for `state.js`.
   */
  const toEvent = (request) => {
    const entry = /** @type {Record<string, import('./config.js').DamageEntry>} */ (HEALTH.damage)[request.source];
    return {
      source: request.source,
      amount: request.amount ?? (entry ? entry.amount : 0),
      type: request.type ?? '',
      position: request.position ?? null,
      targetId: request.targetId ?? '0',
      instantKill: request.instantKill ?? (entry ? entry.instantKill : false)
    };
  };

  /**
   * Whether a request kills outright, ignoring the hit window and regeneration.
   * @param {DamageRequest} request The caller's description.
   * @returns {boolean} True for an instant kill.
   */
  const isInstantKill = (request) => isInstant(toEvent(request), HEALTH);

  /**
   * Current health of a player; full when unknown.
   * @param {string} [id] Player id, `'0'` (Roger) by default.
   * @returns {number} Health, 0 to `HEALTH.max`.
   */
  const health = (id = '0') => (players.get(id) ?? stateOf(id)).value;

  /**
   * The full state of a player (read-only use), for the HUD.
   * @param {string} [id] Player id, `'0'` by default.
   * @returns {HealthState} The state.
   */
  const state = (id = '0') => stateOf(id);

  /**
   * The glow level 0 to 1 of a player's bar.
   * @param {string} [id] Player id, `'0'` by default.
   * @returns {number} The glow level.
   */
  const glow = (id = '0') => glowLevel(stateOf(id), HEALTH);

  /**
   * Whether Roger can be hurt now: Hero Mode is on, he is not already dying
   * or won, and the spawn shield (R-035) is down.
   * @returns {boolean} True when damage may land on Roger.
   */
  const rogerVulnerable = (pierce = false) => {
    const h = hero();
    if (!ctx.Hero || !ctx.Hero.active || !h) return false;
    const phase = h.rogerPhase();
    if (phase === 'dying' || phase === 'won') return false;
    // A piercing hit (Hank Granite's punch) goes through Invincible, never
    // through the spawn shield.
    return pierce ? !h.rogerSpawnShielded() : !h.rogerShielded();
  };

  /** @returns {any} The co-op system, looked up lazily (null when absent). */
  const net = () => ctx.systems.net;

  /**
   * The co-op registry entry of a player while this is a host in co-op.
   * @param {string} id Player id.
   * @returns {{state: string, shield: number} | null} The entry, or null outside co-op.
   */
  const coopEntry = (id) => {
    const n = net();
    return n && n.coopActive() ? n.players.get(id) ?? null : null;
  };

  /**
   * Whether a player is out of the fight in co-op (down or dead): no damage
   * lands and regeneration is held, so a downed bar stays at 0.
   * @param {string} id Player id.
   * @returns {boolean} True while down or dead.
   */
  const isOut = (id) => {
    const entry = coopEntry(id);
    return !!entry && entry.state !== 'up';
  };

  /**
   * Back to full health after a co-op revive (host only; the registry gives
   * the `REVIVE.shield` seconds of safety).
   * @param {string} id Player id.
   * @returns {void}
   */
  const revivePlayer = (id) => { players.set(id, revivedState(HEALTH)); };

  /**
   * The one way to hurt a player.
   *
   * Roger ('0'): a no-op while Hero Mode is off, while he is dying or won
   * (double-death guard) and while the spawn shield runs. At 0 health, or on
   * an instant kill, it calls `heroMode.killRoger`; co-op may still intercept
   * that into "down, not dead".
   *
   * Hit window: for `HEALTH.timers.hitInvulnerability` (0.2 s) after a hit,
   * non-instant damage is ignored. A continuous source (flame, fire) must
   * therefore apply discrete ticks at least 0.2 s apart, each carrying
   * `amount * tickSeconds`, never one call per frame.
   *
   * Guests ('1' and up, host only): ignored unless the registry says they are
   * up and past their revive shield; at 0 health, or on an instant kill, they
   * go down through `net.catchPlayer` (the existing down/revive flow). A
   * downed Roger takes no further damage either.
   * @param {DamageRequest} request The hit.
   * @returns {DamageResult} What happened.
   */
  const damagePlayer = (request) => {
    const event = toEvent(request);
    const isRoger = event.targetId === '0';
    if (isRoger && !rogerVulnerable(!!request.pierce)) return { ...NOTHING, health: health('0') };
    const entry0 = coopEntry(event.targetId);
    if (isRoger ? isOut('0') : !isHittable(entry0)) return { ...NOTHING, health: health(event.targetId) };
    const before = stateOf(event.targetId);
    const after = applyDamage(before, event, HEALTH);
    if (after === before) return { applied: false, killed: false, health: before.value };
    players.set(event.targetId, after);
    const killed = isInstant(event, HEALTH) || after.value <= 0;
    if (killed && isRoger) {
      const entry = /** @type {Record<string, import('./config.js').DamageEntry>} */ (HEALTH.damage)[event.source];
      hero().killRoger(request.title ?? 'KILLED', request.sub ?? (entry && entry.message) ?? '', request.pierce ? 'pierce' : (request.kind ?? ''));
    }
    if (killed && !isRoger) {
      const entry = /** @type {Record<string, import('./config.js').DamageEntry>} */ (HEALTH.damage)[event.source];
      net().catchPlayer(event.targetId, request.title ?? 'DOWN', request.sub ?? (entry && entry.message) ?? '');
    }
    // News for the HUD (hit flash, vignette, direction arrow); a killing blow
    // goes straight to the death card instead.
    if (isRoger && !killed) ctx.events.emit('playerHurt', { amount: event.amount, position: event.position });
    // A guest learns of its own hit by a discrete event (net/system.js notifyDamage).
    if (!isRoger) net().notifyDamage(event.targetId, event.source, killed ? HEALTH.max : event.amount, event.position);
    return { applied: true, killed, health: after.value };
  };

  /** @returns {void} Nothing to build; players are created on first use. */
  function initHealth() {
    players.clear();
    if (stopHurtListener) stopHurtListener();
    stopHurtListener = ctx.events.on('playerHurt', () => audio.playHurt());
  }

  /**
   * The heartbeat and muffle for Roger: on only while the game runs, he is
   * alive in Hero Mode and his health is low; off (filter open) otherwise,
   * paused included.
   * @param {number} rawDt Real seconds since the last frame.
   * @param {boolean} rogerOver True once he is dying, won, or Hero Mode is off.
   * @returns {void}
   */
  const updateAudio = (rawDt, rogerOver) => {
    const roger = stateOf('0');
    const active = !ctx.Sim.state.paused && !rogerOver && isLowHealth(roger, HEALTH);
    audio.updateHeartbeat(active, roger.value / HEALTH.max, HEALTH.lowThreshold, rawDt);
  };

  /**
   * Per frame: advances every player's regeneration timers on real time
   * (held at 0 while paused). Roger's stops once he is dying or won.
   * @param {number} rawDt Real seconds since the last frame.
   * @returns {void}
   */
  function updateHealth(rawDt) {
    const dt = ctx.Sim.state.paused ? 0 : rawDt;
    const h = hero();
    const rogerOver = !ctx.Hero || !ctx.Hero.active || !h
      || h.rogerPhase() === 'dying' || h.rogerPhase() === 'won';
    updateAudio(rawDt, rogerOver);
    if (!(dt > 0)) return;
    players.forEach((value, id) => {
      if (id === '0' && rogerOver) return;
      if (isOut(id)) return;
      const next = stepRegen(value, dt, HEALTH);
      players.set(id, next);
      if (id === '0' && refillStarted(value, next)) audio.playRecharge();
    });
    if (!rogerOver) {
      fireDamage.step(dt);
      hazardDamage.step(dt);
    }
  }

  /** @returns {void} Everyone back to full health, timers cleared (Restart, Reset). */
  function resetHealth() {
    players.clear();
    audio.release();
    fireDamage.reset();
    hazardDamage.reset();
  }

  /** @returns {void} Drops all state. */
  function disposeHealth() {
    if (stopHurtListener) stopHurtListener();
    stopHurtListener = null;
    audio.disposeHealthAudio();
    players.clear();
    fireDamage.reset();
    hazardDamage.reset();
  }

  return { damagePlayer, health, state, glow, isInstantKill, revivePlayer, initHealth, updateHealth, resetHealth, disposeHealth };
}
