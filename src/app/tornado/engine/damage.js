import * as THREE from 'three';
import { IMPACT_MIN_ENERGY } from './damage/config.js';
import { createTreeDamage } from './damage/trees.js';
import { createBuildingDamage } from './damage/buildings.js';
import { createImpactDamage } from './damage/impact.js';

/**
 * ===========================================================================
 * SECTION G — Damage / state machine
 * ===========================================================================
 */

/*
 * Split by job across engine/damage/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js     tunables
 *   trees.js      trees swaying, flattened, uprooted
 *   buildings.js  shocks, pieces torn off, collapse and chain collapse
 *   impact.js     one thing hitting another
 * and this file: the frame, the score, reset, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   updateDamage: (dt: number) => void,
 *   resetDamage: () => void,
 *   damageFromImpact: (target: SimObject, at: THREE.Vector3, energy: number) => boolean,
 *   collapseBuilding: (obj: SimObject, depth: number) => void,
 *   addDamageScore: (points: number) => void,
 *   shockBuilding: (building: SimObject, shock: number, origin: THREE.Vector3) => void,
 *   IMPACT_MIN_ENERGY: number
 * }}
 */
export function createDamageSystem(ctx) {
  const { Sim, windForceMagnitudeAt } = ctx;
  const { spawnImpactBurst } = ctx.systems.explosions;
  const { spawnDebris } = ctx.systems.debris;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
    // Scratch vectors for the per-frame damage checks (updateTreeDamage,
    // updateCarDamage, updateBuildingDamage): they ran for every tree, car and
    // building wall every frame, and allocated a vector or two each time.
    damageScratchA: new THREE.Vector3(),

    damageScratchB: new THREE.Vector3(),
  
    /**
     * Shocks queued by collapses and not yet resolved (see the chain-reaction
     * block above). Plain array: at most a handful are ever in flight, since one
     * collapse queues one entry per neighbour within reach.
     * @type {{building: SimObject, delay: number, shock: number, depth: number,
     *         origin: THREE.Vector3}[]}
     */
    pendingShocks: []
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createTreeDamage(ctx, S, api),
    createBuildingDamage(ctx, S, api),
    createImpactDamage(ctx, S, api),
    { awayFromTornado, addDamageScore, feel }
  );

  /**
   * Horizontal unit vector pointing away from the nearest active tornado
   * (engine/tornadoes.js), the way wreckage is thrown.
   * @param {THREE.Vector3} pos
   * @returns {THREE.Vector3}
   */
  function awayFromTornado(pos) {
    const centre = ctx.tornadoes.nearest(pos.x, pos.z).center;
    return new THREE.Vector3(pos.x - centre.x, 0, pos.z - centre.z).normalize();
  }

  /**
   * Adds to the run's damage score, scaled by the Firenado's damage
   * multiplier while it burns (engine/firenado.js) and by the current combo
   * multiplier (engine/gamefeel.js). Every scoring event in this file goes
   * through here, so both multipliers cover all of them -- which is why the
   * combo is applied here rather than by running a second score alongside
   * the real one.
   * @param {number} points
   * @returns {void}
   */
  function addDamageScore(points) {
    const firenado = ctx.systems.firenado;
    const gamefeel = ctx.systems.gamefeel;
    Sim.stats.damageScore += Math.round(
      points
      * (firenado ? firenado.damageMultiplier() : 1)
      * (gamefeel ? gamefeel.comboMultiplier() : 1)
    );
  }

  /**
   * Reports a destruction event to the game-feel layer (combo, shake, slow
   * motion). Presentation only -- nothing in the simulation reads it back.
   * Called immediately *before* the matching addDamageScore(), so the event
   * that extends a chain is itself scored at the chain's new multiplier.
   * @param {string} kind see EVENTS in engine/gamefeel.js
   * @param {THREE.Vector3} [at]
   * @returns {void}
   */
  function feel(kind, at) {
    ctx.systems.gamefeel.event(kind, at);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateDamage(dt) {
    for (const obj of Sim.objects) {
      if (obj.type === 'tree') api.updateTreeDamage(obj);
      else if (obj.type === 'car') api.updateCarDamage(obj);
      // Storm shelters (environment/shelters.js) used to be skipped here
      // entirely, which made four buildings in the town literally
      // indestructible -- visibly so, since they kept every window lit while
      // the street around them was flattened. They are damageable now, just
      // built far tougher than anything else (see markShelter), so they are
      // the last thing standing rather than the one thing that cannot fall.
      else if (obj.type === 'building') api.updateBuildingDamage(obj);
    }
    api.updatePendingShocks(dt);
  }

  /**
   * Clears the chain-reaction queue, called from resetSim(): the buildings a
   * queued shock points at are thrown away and replaced by resetEnvironment(),
   * and resolving a shock against one of those would topple a building that is
   * no longer in the scene.
   * @returns {void}
   */
  function resetDamage() {
    S.pendingShocks = [];
  }

  return {
    updateDamage, updatePendingShocks: api.updatePendingShocks, resetDamage, damageFromImpact: api.damageFromImpact, collapseBuilding: api.collapseBuilding,
    addDamageScore, shockBuilding: api.shockBuilding, flattenTree: api.flattenTree, IMPACT_MIN_ENERGY
  };
}
