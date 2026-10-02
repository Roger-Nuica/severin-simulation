// @ts-check

/**
 * ===========================================================================
 * SECTION HP.1 — Enemy health and the weapon x enemy damage table
 * ===========================================================================
 * Data only: nothing in the runtime reads this yet (the registry routing is
 * Subtask 17, the non-creature targets Subtask 18). Health is in the same
 * points the owners already use (Yeti 30, T-Rex 40, Patient Zero 12, hull
 * points for ships), so a "strong" cell keeps its runtime number exactly.
 *
 * Chip rule: every cell the old rules left at "no effect" (an unaccepted
 * hit type, a stun with no damage, a parry) becomes a small chip of
 * `CHIP_FRACTION` of the kind's health, in one constant. The only zero cells
 * are the three katana exclusions (nuclear plant, mothership, tornado).
 *
 * The Black Hole Gun is not a damage cell: it consumes any registry enemy
 * outright (`consume`), so it has no column here.
 *
 * Samurai are unkillable by enemies and disasters; only Roger's weapons
 * (the columns below) may damage them (`PLAYER_WEAPONS_ONLY`).
 */

/** Fraction of an enemy's health a weapon with no real effect on it removes per hit. */
export const CHIP_FRACTION = 0.02;

/** Weapon columns, in table order. `bullet` is the minigun, `bolt` the railgun. */
export const WEAPONS = Object.freeze([
  'plasma', 'mega', 'bullet', 'bolt', 'fire', 'blade', 'rocket', 'lightning', 'emp'
]);

/** Enemy kinds that only Roger's weapons may hurt (never enemies or disasters). */
export const PLAYER_WEAPONS_ONLY = Object.freeze(['samurai']);

/**
 * Health per enemy kind.
 * R-034 alien 1 (any accepted hit kills); R-029 Terminator and Hero Mode
 * pursuer 30 (30 minigun rounds, 1 each); R-037 T-Rex 40; R-038 Yeti 30;
 * R-039 Patient Zero 12, clones 1; R-015 hunter 4, UFO 6; samurai 3 (R-020:
 * `SAMURAI.bulletHits`); R-044 plant 5 (ship hits); R-036 mothership 15;
 * tornado 20 (new: the MEGA BEAM neutralises it, R-034).
 */
export const ENEMY_HEALTH = Object.freeze({
  alien: 1,
  terminator: 30,
  pursuer: 30,
  trex: 40,
  yeti: 30,
  patientZero: 12,
  patientZeroClone: 1,
  hunterShip: 4,
  ufo: 6,
  samurai: 3,
  nuclearPlant: 5,
  mothership: 15,
  tornado: 20
});

/**
 * One chip, rounded to three decimals.
 * @param {number} health The enemy's health.
 * @returns {number} The chip damage.
 */
const chip = (health) => Math.round(health * CHIP_FRACTION * 1000) / 1000;

/**
 * Builds one frozen row: every weapon starts as a chip, then the strong
 * cells and any explicit overrides replace it.
 * @param {number} health The enemy's health.
 * @param {Readonly<Record<string, number>>} strong Weapon cells with their runtime values.
 * @returns {Readonly<Record<string, number>>} The row, one finite number per weapon.
 */
const row = (health, strong) =>
  Object.freeze(Object.fromEntries(WEAPONS.map((w) => [w, strong[w] ?? chip(health)])));

/**
 * Damage per weapon per enemy kind. A comment per row names the source.
 * Cells not listed in a row are chips (see `CHIP_FRACTION`).
 */
export const WEAPON_VS_ENEMY = Object.freeze({
  // R-034/R-013: plasma, bolt, fire kill an alien; MEGA BEAM kills in the blast; katana slice kills (R-051).
  alien: row(ENEMY_HEALTH.alien, { plasma: 1, mega: 1, bolt: 1, lightning: 1, fire: 1, blade: 1 }),
  // R-029/R-013: 30 rounds; EMP, Lightning, railgun bolt and MEGA BEAM bring it down.
  terminator: row(ENEMY_HEALTH.terminator, { mega: 30, bullet: 1, bolt: 30, lightning: 30, emp: 30 }),
  // R-029/R-013: the Hero Mode pursuer shares the Terminator contract.
  pursuer: row(ENEMY_HEALTH.pursuer, { mega: 30, bullet: 1, bolt: 30, lightning: 30, emp: 30 }),
  // R-037: plasma 3, minigun 0.3, bolt/lightning 8, EMP 6, MEGA BEAM kills.
  trex: row(ENEMY_HEALTH.trex, { plasma: 3, mega: 40, bullet: 0.3, bolt: 8, lightning: 8, emp: 6 }),
  // R-030/R-038: fire 1.2 per tick of 30 HP; EMP stuns only (now a chip).
  yeti: row(ENEMY_HEALTH.yeti, { fire: 1.2 }),
  // R-039: plasma 3, minigun 0.5, lightning/bolt 6, EMP 4, MEGA BEAM kills.
  patientZero: row(ENEMY_HEALTH.patientZero, { plasma: 3, mega: 12, bullet: 0.5, bolt: 6, lightning: 6, emp: 4 }),
  // R-039: a clone dies to any accepted hit (plasma, bullet, bolt, EMP, fire).
  patientZeroClone: row(ENEMY_HEALTH.patientZeroClone, { plasma: 1, mega: 1, bullet: 1, bolt: 1, lightning: 1, fire: 1, emp: 1 }),
  // R-015/R-034: plasma 1, MEGA BEAM 5, minigun 0.25, bolt 2, fire 0.5 per tick; katana ignored (chip).
  hunterShip: row(ENEMY_HEALTH.hunterShip, { plasma: 1, mega: 5, bullet: 0.25, bolt: 2, lightning: 2, fire: 0.5 }),
  // R-015/R-034: plasma 1, MEGA BEAM 5 of 6 hull; the rest were "no effect".
  ufo: row(ENEMY_HEALTH.ufo, { plasma: 1, mega: 5 }),
  // R-020: 3 minigun rounds; any other player hit that took it down in one stays one-hit (3 of 3).
  samurai: row(ENEMY_HEALTH.samurai, { plasma: 3, mega: 3, bullet: 1, bolt: 3, lightning: 3, rocket: 3 }),
  // R-044: MEGA BEAM destroys (5 of 5); katana excluded (0); the rest were "no effect".
  nuclearPlant: row(ENEMY_HEALTH.nuclearPlant, { mega: 5, blade: 0 }),
  // R-036/R-020: plasma 1, MEGA BEAM 5, Rocket Strike 8 of 15 hull; katana excluded (0).
  mothership: row(ENEMY_HEALTH.mothership, { plasma: 1, mega: 5, rocket: 8, blade: 0 }),
  // R-034: MEGA BEAM neutralises it (full health); a normal shot was "no effect"; katana excluded (0).
  tornado: row(ENEMY_HEALTH.tornado, { mega: 20, blade: 0 })
});

/** The only cells allowed to be zero: the katana against these kinds. */
export const KATANA_EXCLUSIONS = Object.freeze(['nuclearPlant', 'mothership', 'tornado']);
