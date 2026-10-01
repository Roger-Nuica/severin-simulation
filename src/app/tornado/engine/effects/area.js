// @ts-check
/**
 * ===========================================================================
 * SECTION AE — Effects in an area
 * ===========================================================================
 * "Everything within this radius" (or the whole map), in one place, for the
 * effects that reach many things at once: the EMP beam, the black hole, the
 * nuclear wave, the Blizzard, Mr. Proper. What is in reach:
 *   'enemy'     every registered enemy (engine/enemies.js)
 *   'person'    the townspeople
 *   'building'  the buildings
 *   'object'    everything else under physics: cars, trees, debris
 * The player is left out unless asked for (excludePlayer, on by default):
 * the hero's own abilities never touch the hero.
 *
 * Distances are on the ground (x, z). radius Infinity is the whole map.
 */

/**
 * @typedef {'enemy'|'person'|'building'|'object'} AreaTarget
 * @typedef {{kind: AreaTarget, target: any, enemyKind?: import('../enemies.js').EnemyKind, x: number, z: number, d: number}} AreaHit
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   forEachInRadius: (opts: {x?: number, z?: number, radius?: number, excludePlayer?: boolean, targets?: AreaTarget[]}, visit: (hit: AreaHit) => void) => number,
 *   hitEnemiesInRadius: (opts: {x?: number, z?: number, radius?: number}, hit: import('../enemies.js').Hit) => number
 * }}
 */
export function createAreaEffects(ctx) {
  const { Sim } = ctx;
  const ALL = /** @type {AreaTarget[]} */ (['enemy', 'person', 'building', 'object']);

  /**
   * Calls visit for everything of the given kinds within radius of (x, z).
   * @param {{x?: number, z?: number, radius?: number, excludePlayer?: boolean, targets?: AreaTarget[]}} opts
   * @param {(hit: AreaHit) => void} visit
   * @returns {number} how many were visited
   */
  function forEachInRadius(opts, visit) {
    const x = opts.x || 0;
    const z = opts.z || 0;
    const radius = opts.radius === undefined ? Infinity : opts.radius;
    const excludePlayer = opts.excludePlayer !== false;
    const targets = opts.targets || ALL;
    const r2 = radius * radius;
    let n = 0;
    /**
     * @param {AreaTarget} kind
     * @param {any} target
     * @param {number} px
     * @param {number} pz
     * @param {any} [enemyKind]
     * @returns {void}
     */
    const consider = (kind, target, px, pz, enemyKind) => {
      const dx = px - x;
      const dz = pz - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) return;
      n++;
      visit({ kind, target, enemyKind, x: px, z: pz, d: Math.sqrt(d2) });
    };
    if (targets.includes('enemy') && ctx.systems.enemies) {
      ctx.systems.enemies.each((e, kind) => {
        const p = kind.position(e);
        consider('enemy', e, p.x, p.z, kind);
      });
    }
    const env = ctx.Environment;
    if (targets.includes('person') && env) {
      for (const person of env.people.slice()) {
        if (!person.mesh || !person.mesh.parent) continue;
        if (excludePlayer && person.heroName) continue;
        consider('person', person, person.mesh.position.x, person.mesh.position.z);
      }
    }
    if (targets.includes('building') && env) {
      for (const building of env.buildings) {
        if (!building.mesh) continue;
        consider('building', building, building.mesh.position.x, building.mesh.position.z);
      }
    }
    if (targets.includes('object')) {
      for (const obj of Sim.objects.slice()) {
        if (obj.type === 'person' || obj.type === 'building') continue;
        const pos = obj.pooled ? obj.position : obj.mesh && obj.mesh.position;
        if (!pos) continue;
        if (excludePlayer && obj.mesh && obj.mesh.userData && obj.mesh.userData.heroDriving) continue;
        consider('object', obj, pos.x, pos.z);
      }
    }
    return n;
  }

  /**
   * One hit on every enemy in the radius that answers to it.
   * @param {{x?: number, z?: number, radius?: number}} opts
   * @param {import('../enemies.js').Hit} hit
   * @returns {number} how many were stopped
   */
  function hitEnemiesInRadius(opts, hit) {
    let stopped = 0;
    const found = [];
    forEachInRadius({ ...opts, targets: ['enemy'] }, (h) => found.push(h));
    // Collected first: a hit may take an enemy out of its owner's list.
    for (const h of found) if (ctx.systems.enemies.hit(h.target, h.enemyKind, hit)) stopped++;
    return stopped;
  }

  return { forEachInRadius, hitEnemiesInRadius };
}
