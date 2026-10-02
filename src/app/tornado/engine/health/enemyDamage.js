// @ts-check

/**
 * ===========================================================================
 * SECTION HP.2 -- Table damage for one hit on one registry enemy
 * ===========================================================================
 * The pure half of the "hurt enemy" helper that engine/enemies.js `hit`
 * composes. Decision D1: every weapon hurts every enemy; the old immunities
 * became weaknesses. A weapon an owner never answered to (not in its
 * `accepts`) now chips the enemy by its table value, and when the health
 * accumulated across every weapon reaches 0 the owner's `defeat` adapter
 * takes it down through that owner's normal kill path (which scores once).
 * Weapons an owner already answered to keep their exact behaviour: they
 * still reach the owner's `damage` handler, and also count toward health.
 *
 * The black hole is not here: it consumes outright (`consume`). The
 * 'freeze', 'gravity' and 'cleanse' kinds have no weapon column and do no
 * table damage. Nothing here allocates.
 */
import { ENEMY_HEALTH, WEAPON_VS_ENEMY } from './damageTable.js';

/**
 * The weapon column a hit falls in, or null for a kind of damage with none.
 * `plasma` with `mega` is the MEGA BEAM; `bullet` is the minigun, `bolt` the
 * railgun and lightning. The rocket's blast reaches registry enemies as the
 * MEGA BEAM, EMP and fire hits it already sends (spaceship/rocket.js, left
 * as it was); only a samurai is hit with the blast itself, 'blast', which
 * is the rocket column.
 * @param {{type: string, mega?: boolean}} hit
 * @returns {string|null}
 */
export const weaponColumn = (hit) => {
  switch (hit.type) {
    case 'plasma': return hit.mega ? 'mega' : 'plasma';
    // The Rocket Strike's blast on a samurai (spaceship/samurai.js hitSamurai).
    case 'blast': return 'rocket';
    case 'bullet':
    case 'bolt':
    case 'fire':
    case 'blade':
    case 'emp':
    // A car thrown by telekinesis (player/telekinesis.js).
    case 'throw':
      return hit.type;
    default:
      return null;
  }
};

/**
 * Health damage of one hit on one kind of enemy, from the central table.
 * @param {string} kind The registry kind name (a `WEAPON_VS_ENEMY` key).
 * @param {{type: string, mega?: boolean}} hit
 * @returns {number} 0 when the kind is not in the table or the hit has no column.
 */
export const tableDamage = (kind, hit) => {
  const column = weaponColumn(hit);
  const row = /** @type {Record<string, Record<string, number>>} */ (WEAPON_VS_ENEMY)[kind];
  return column && row ? row[column] : 0;
};

/**
 * Full health of one kind of enemy.
 * @param {string} kind The registry kind name.
 * @returns {number} 0 when the kind has no health in the table.
 */
export const fullHealth = (kind) => /** @type {Record<string, number>} */ (ENEMY_HEALTH)[kind] || 0;

/**
 * Health left after one hit, rounded to three decimals (the table's own
 * precision) so fifty chips of 0.6 on 30 health reach exactly 0.
 * @param {number} current Health before the hit.
 * @param {number} damage Table damage of the hit.
 * @returns {number} The health after it (may be below 0).
 */
export const healthAfter = (current, damage) => Math.round((current - damage) * 1000) / 1000;

/**
 * The table row of an alien ship in the air, from the name its sights target
 * carries (`aliens.shipTargets`, `mothership.shipTarget`).
 * @param {string} name 'UFO' or 'MOTHERSHIP' (a hunter ship is a registry kind and has none).
 * @returns {string|null} The `WEAPON_VS_ENEMY` key, or null for any other name.
 */
export const shipKindOf = (name) => (name === 'UFO' ? 'ufo' : name === 'MOTHERSHIP' ? 'mothership' : null);

/**
 * One hit on a target that is not a registry kind (the nuclear plant, the
 * mothership, a tornado): the health after it, and whether it is spent. The
 * katana row is 0, so a blade hit leaves the health as it was.
 * @param {string} kind The `WEAPON_VS_ENEMY` key ('nuclearPlant', 'mothership', 'tornado').
 * @param {number} current Health before the hit.
 * @param {{type: string, mega?: boolean}} hit
 * @returns {{health: number, spent: boolean}} `spent` when health is 0 or less.
 */
export const chipTarget = (kind, current, hit) => {
  const health = healthAfter(current, tableDamage(kind, hit));
  return { health, spent: health <= 0 };
};

/**
 * The one health value of two merged funnels (Fujiwhara, R-004/R-006): the
 * survivor keeps the lower of the two, so a merge never heals a funnel and
 * never counts it twice.
 * @param {number} survivor Health of the funnel that stays.
 * @param {number} absorbed Health of the funnel that is retired.
 * @returns {number}
 */
export const mergedHealth = (survivor, absorbed) => Math.min(survivor, absorbed);
