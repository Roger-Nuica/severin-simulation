// @ts-check

import { ENEMY_HEALTH, WEAPON_VS_ENEMY } from './damageTable.js';

/**
 * ===========================================================================
 * SECTION HP.0 — Roger's health tunables
 * ===========================================================================
 * Every number the rechargeable health bar is tuned by, in one place: the
 * maximum, the regeneration timers, the damage each source deals, the melee
 * touch settings, the death messages and the weapon x enemy
 * tables. The config is frozen: per-instance state lives on `Sim`/`ctx`
 * (R-047), never here. This file is configuration only; nothing in the
 * runtime reads it yet (R-050), and no cap is changed (R-048).
 */

/**
 * One hit on a player, as the single damage API will receive it.
 * @typedef {Object} DamageEvent
 * @property {string} source Key into `HEALTH.damage` (for example `alienRay`).
 * @property {number} amount Health points removed; above `HEALTH.max` kills.
 * @property {string} type Damage kind (for example `ray`, `melee`, `fire`, `blast`).
 * @property {{x: number, y: number, z: number} | null} position World position of the attacker, for the direction indicator.
 * @property {string} targetId Player id: `'0'` is Roger, guests use their own ids.
 * @property {boolean} instantKill Ignores the hit window and regeneration.
 */

/**
 * One player's health, kept per instance on `Sim`/`ctx`.
 * @typedef {Object} HealthState
 * @property {number} value Current health, 0 to `HEALTH.max`.
 * @property {number} sinceLastDamage Seconds since the last damage (player time).
 * @property {boolean} refilling True while the fast refill is running.
 * @property {number} invuln Seconds of hit invulnerability left.
 * @property {string | null} lastSource Source key of the last damage taken.
 */

/**
 * One damage-over-time or one-off entry of the per-source table.
 * @typedef {Object} DamageEntry
 * @property {number} amount Points removed per hit, or per second when `perSecond` is set.
 * @property {boolean} [perSecond] True for continuous damage applied as `amount * dt`.
 * @property {number} [interval] Seconds between ticks for periodic damage (lava).
 * @property {boolean} [oncePerEvent] True when the source hurts once per event (flood).
 * @property {boolean} instantKill True when `amount` is a one-shot kill above the maximum.
 * @property {string | null} message Death message for an instant kill; null otherwise.
 */

/**
 * Freezes an object and every nested object or array, returning it typed.
 * @template T
 * @param {T} value The structure to freeze.
 * @returns {Readonly<T>} The same structure, deeply frozen.
 */
const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

/**
 * Builds a one-shot entry: an amount above the maximum plus its own message.
 * @param {string} message The death message shown for this source.
 * @returns {DamageEntry} The instant-kill entry.
 */
const kill = (message) => ({ amount: 100, instantKill: true, message });

/**
 * Builds a plain damage entry that never kills outright.
 * @param {number} amount Points removed.
 * @param {Partial<DamageEntry>} [extra] Optional per-second, interval or once-per-event flags.
 * @returns {DamageEntry} The damage entry.
 */
const hit = (amount, extra = {}) => ({ amount, instantKill: false, message: null, ...extra });

export const HEALTH = deepFreeze({
  max: 100,

  // Fraction of `max` at or below which the HEALTH bar turns red and the screen
  // keeps a low-health vignette (moved here from hero/screen.js, Subtask 14).
  lowThreshold: 0.3,

  // Regeneration, in seconds of player time since the last damage. Glow begins
  // at 4 s and intensifies until 7 s; the fast refill then runs about 4 s, so
  // full health is about 11 s after the last hit.
  timers: {
    regenDelay: 7,
    glowStart: 4,
    refillDuration: 4,
    hitInvulnerability: 0.2,     // never blocks instant kills
  },

  // Glow intensity (0 to 1) against seconds since the last damage, linear
  // between keyframes. Zero before `glowStart`, full at `regenDelay`.
  glowCurve: [
    { t: 0, level: 0 },
    { t: 4, level: 0 },
    { t: 7, level: 1 },
  ],

  // Damage per source. A kill entry is 100 (at or above max) with its own
  // death message; the "100" sources of the brief are all one-shots.
  damage: {
    alienRay: hit(20),
    alienTouch: hit(34),
    terminatorTouch: hit(50),
    hunterTracker: hit(50),       // once per burst hit
    ufoTracker: hit(20),          // once per burst hit
    trexFlame: hit(33, { perSecond: true }),
    ordinaryFire: hit(10, { perSecond: true }),
    lava: hit(50, { interval: 1.5 }),
    flood: hit(50, { oncePerEvent: true }),
    friendlyFire: hit(0),         // Roger's own blast; the amount comes from `damageToPlayer`
    tornado: hit(0),              // daze only (R-001)
    debris: hit(0),               // daze only
    ice: hit(0),                  // freeze only
    replicatorShard: hit(8),      // a Replicator clone's thrown shard (patientZero/encircle.js)
    gunnerRound: hit(3),          // one of HAVOC's minigun rounds (engine/gunner.js, R-057)
    hankRock: hit(25),            // a rock Hank Granite throws at Roger up high (engine/actionHero.js, R-040)
    // Hank Granite's punch: through Invincible too (R-040, on request 2026-10-05).
    hankPunch: kill('Knocked into orbit by Hank Granite'),
    mothershipBeam: kill('Vaporised by the mothership'),
    yeti: kill('Pulverised by the Yeti'),
    blackHole: kill('Swallowed by the black hole'),
    nuke: kill('Vaporised by the nuke'),
    chasm: kill('Lost in the crater'),
    explosion: kill('Caught in the blast'),
    meteor: kill('Crushed by a meteor'),
    lavaBomb: kill('Hit by a lava bomb'),
    fallingShip: kill('Crushed by a falling ship'),
    empWave: kill('Zapped by the EMP'),
    patientZero: kill('Infected by Patient Zero'),
  },

  // The melee touch shared by aliens, squad Terminators and Hero Mode pursuers
  // (Q6). `contactReach` is the new target of 2 m; the runtime still uses 1 m
  // (alien) and 0.9 / 0.99 m (Terminator) until the wiring subtasks land.
  melee: {
    cooldown: 3,                  // seconds per attacker
    contactReach: 2,              // metres
    telegraphRange: 6,            // metres, wind-up animation and cue start
    windUp: 0.6,                  // seconds between telegraph and the blow
    strikeSeconds: 0.15,          // the swing itself; damage is decided as it starts
    recoverSeconds: 0.6,          // arm back down; swing plus recovery stay inside `cooldown`
  },

  // Damage over time (Subtask 10): `trexFlame` and `ordinaryFire` above are
  // per second; they are applied as discrete ticks of `interval` seconds
  // (amount x interval each), never per frame. The interval must stay above
  // `timers.hitInvulnerability` (0.2 s) or the hit window swallows ticks.
  // `fireReach` is the margin, in metres, around a burning building's
  // footprint that still counts as standing in its fire.
  dot: {
    interval: 0.25,
    fireReach: 3,
  },

  // Lava and flood contact (Subtask 11). `lavaMinLevel` mirrors the Lavanado's
  // own `LAVA.minLava`: a vent or lake glowing less than this does not burn.
  hazards: {
    lavaMinLevel: 0.12,
  },

  // Weapon x enemy damage model (Subtask 16): data only, see damageTable.js.
  weaponVsEnemy: WEAPON_VS_ENEMY,
  enemyHealth: ENEMY_HEALTH,

  // Roger's own weapons against a player (Subtask 19, D4: friendly fire on).
  // Chip-sized for the non-explosive weapons so a stray shot hurts but never
  // kills (a full bar is 100): a plasma blast at the centre costs 15, a MEGA
  // BEAM 40 (its 18 m blast is the widest), a minigun round 3, a railgun
  // bolt 20 (it is also barred inside 9 m, R-030), a Fire Gun tick 2 (about
  // 8 a second would be ruinous, and it never reaches the shooter), a
  // katana cut 10. Splash falls away linearly with distance (friendlyFire.js).
  // The black hole, a rocket blast and any explosion already kill (100, own
  // paths, R-031/R-032); Roger's own EMP never harms him (R-032: 0).
  damageToPlayer: {
    plasma: 15,
    mega: 40,
    bullet: 3,
    bolt: 20,
    fire: 2,
    blade: 10,
    blackHole: 100,
    rocket: 100,
    explosion: 100,
    emp: 0,
    throw: 40,
  },

  // Self-hit guards. `muzzleGuard`: an impact closer than this to the muzzle
  // is a trace artefact and hurts nobody. `enabled`: D4, friendly fire on.
  friendlyFire: {
    enabled: true,
    muzzleGuard: 1.5,             // metres
  },
});
