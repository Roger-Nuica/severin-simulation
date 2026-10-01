import * as THREE from 'three';
import { IMPACT_MIN_ENERGY, IMPACT_PIECE_ENERGY, IMPACT_DOUBLE_PIECE_ENERGY, IMPACT_CAR_ENERGY, IMPACT_TREE_ENERGY, IMPACT_PERSON_ENERGY, IMPACT_SCORE } from './config.js';

/**
 * ===========================================================================
 * SECTION DM.3 — Impacts
 * ===========================================================================
 * One object hitting another: what it does to a person, a tree, a car or
 * a building.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see damage.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createImpactDamage(ctx, S, api) {
  const { Sim, windForceMagnitudeAt } = ctx;
  const { spawnImpactBurst } = ctx.systems.explosions;

  /**
   * Applies a debris hit to whatever was struck. Called from
   * engine/debrisImpacts.js once per detected collision.
   *
   * Everything here routes through the same functions the wind already uses --
   * detachBuildingPiece, uprootTree, the car damage states, explodePerson --
   * so a building holed by a flying car ends up in exactly the state the wind
   * would have left it in, and feeds the chain-collapse machinery above
   * without needing to know it exists.
   * @param {SimObject} target
   * @param {THREE.Vector3} at world-space point of the hit
   * @param {number} energy 0.5*m*v^2 in simulation units
   * @returns {boolean} whether the debris should be stopped by the hit
   */
  function damageFromImpact(target, at, energy) {
    if (energy < IMPACT_MIN_ENERGY) return false;

    // The elevated highway's own structure (environment/viaduct.js), which
    // owns what a hit does to a pillar or a span.
    if (target.type === 'viaduct') {
      return ctx.systems.viaduct.damageStructure(target, energy);
    }

    if (target.type === 'person') {
      if (energy < IMPACT_PERSON_ENERGY) return false;
      ctx.systems.people.explodePerson(target);
      api.feel('person', at);
      api.addDamageScore(IMPACT_SCORE);
      // Debris carries straight on through: a person stops nothing.
      return false;
    }

    if (target.type === 'car') {
      if (energy < IMPACT_CAR_ENERGY || target.damageState === 'airborne') return false;
      // Same states updateCarDamage drives, so nothing downstream can tell
      // whether the wind or a flying roof panel did it.
      const wasIntact = target.damageState === 'intact';
      target.damageState = energy > IMPACT_DOUBLE_PIECE_ENERGY ? 'airborne' : 'tipped';
      target.mesh.userData.parked = false;
      target.angularVelocity.set(
        (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, 3 + Math.random() * 3
      );
      // Knocked away from the impact rather than away from the tornado.
      const dir = new THREE.Vector3(target.mesh.position.x - at.x, 0, target.mesh.position.z - at.z);
      if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      target.velocity.copy(dir.normalize().multiplyScalar(3)).add(new THREE.Vector3(0, 3.5, 0));
      if (wasIntact) Sim.stats.vehiclesOverturned++;
      api.feel('car', at);
      api.addDamageScore(15);
      spawnImpactBurst(at, 1.1);
      return true;
    }

    if (target.type === 'tree') {
      if (energy < IMPACT_TREE_ENERGY || target.damageState === 'uprooted') return false;
      target.damageState = 'uprooted';
      api.uprootTree(target, target.mesh.getWorldPosition(new THREE.Vector3()));
      Sim.stats.treesUprooted++;
      api.feel('tree', at);
      api.addDamageScore(10);
      return true;
    }

    if (target.type !== 'building' || target.damageState === 'collapsed') return false;

    const root = target.mesh;
    const { roof, walls } = root.userData.pieces;
    // Scaled by how sturdy the building is, rather than one flat figure for
    // everything. Measured while making storm shelters destructible: with a
    // fixed threshold, a bunker with twelve times an ordinary building's wind
    // rating still came apart under three lucky debris hits, so its rating
    // bought it nothing. Ordinary buildings rate 5.5-9.5, so dividing by 8
    // leaves them within a whisker of the old flat value and nothing about
    // normal play changes.
    const pieceEnergy = IMPACT_PIECE_ENERGY * (target.breakThreshold / 8);
    if (energy < pieceEnergy) {
      // Not enough to hole it: a visible scuff and the debris bounces off.
      spawnImpactBurst(at, 0.6);
      api.feel('impact', at);
      api.addDamageScore(IMPACT_SCORE);
      return true;
    }

    // The piece actually hit, rather than an arbitrary one: nearest of those
    // still attached to the impact point.
    const standing = walls.filter(w => !w.userData.lost);
    if (!roof.userData.lost) standing.push(roof);
    standing.sort((a, b) =>
      a.getWorldPosition(new THREE.Vector3()).distanceToSquared(at)
      - b.getWorldPosition(new THREE.Vector3()).distanceToSquared(at));

    const wanted = energy > pieceEnergy * (IMPACT_DOUBLE_PIECE_ENERGY / IMPACT_PIECE_ENERGY) ? 2 : 1;
    let lost = 0;
    for (const piece of standing) {
      if (lost >= wanted) break;
      // Thrown on from where the debris came, not away from the funnel.
      if (!api.detachBuildingPiece(root, piece, at)) continue;
      lost++;
      Sim.stats.buildingPiecesLost++;
      api.addDamageScore(20);
      target.damageState = piece === roof ? 'roofLost' : 'wallLost';
      api.darkenBuildingWindows(target);
    }
    if (walls.reduce((n, w) => n + (w.userData.lost ? 1 : 0), 0) >= 3) {
      // Depth 0: the debris did this, not a neighbour, so it seeds a fresh
      // chain rather than continuing one.
      api.collapseBuilding(target, 0);
    }
    return true;
  }

  return { damageFromImpact };
}
