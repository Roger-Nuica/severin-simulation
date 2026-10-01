import * as THREE from 'three';
import { DEBRIS_KIND_DEFS } from '../debris.js';

/**
 * ===========================================================================
 * SECTION DM.1 — Trees
 * ===========================================================================
 * A tree swaying in the wind, flattened by a blast, uprooted and thrown;
 * and cars tipped over.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see damage.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createTreeDamage(ctx, S, api) {
  const { Sim, windForceMagnitudeAt } = ctx;
  const { spawnImpactBurst } = ctx.systems.explosions;
  const { spawnDebris } = ctx.systems.debris;

  /**
   * Lays a tree flat along a bearing, still rooted.
   *
   * Not the same thing as uprooting it: an uprooted tree is airborne and in
   * the debris system's hands, tumbling wherever the wind takes it. This one
   * is snapped where it stands and stays there, pointing the way the blast
   * went (engine/meteors.js). A hundred of them all lying on the same bearing
   * is the only readable signature of an airburst -- there is no crater to
   * look at, so the *pattern on the ground* has to be the evidence.
   * @param {SimObject} obj
   * @param {number} dirX unit vector, the way the blast was travelling
   * @param {number} dirZ
   * @returns {boolean} whether this one went over
   */
  function flattenTree(obj, dirX, dirZ) {
    if (obj.damageState !== 'intact' || !obj.mesh || !obj.mesh.parent) return false;
    obj.damageState = 'flattened';
    // Rooted and intact-looking to physics, so it is left exactly where it
    // fell rather than being given gravity and sinking through the ground.
    obj.rooted = true;
    // Horizontal, perpendicular to the blast: rotating about it sends the
    // crown of the tree away from the centre (the same construction
    // engine/topple.js uses for a building).
    const axis = new THREE.Vector3(dirZ, 0, -dirX).normalize();
    // Not quite flat, and not all at the same angle: a stand of trees that
    // all went over at exactly ninety degrees reads as a texture rather than
    // as damage.
    obj.mesh.quaternion.setFromAxisAngle(axis, 1.35 + Math.random() * 0.22);
    Sim.stats.treesUprooted++;
    api.addDamageScore(15);
    return true;
  }

  /**
   * @param {SimObject} obj
   * @returns {void}
   */
  function updateTreeDamage(obj) {
    if (obj.damageState === 'uprooted' || obj.damageState === 'flattened') return;
    // Scratch: this runs for every tree every frame (performance pass).
    const worldPos = obj.mesh.getWorldPosition(S.damageScratchA);
    const groundPos = S.damageScratchB.copy(worldPos);
    worldPos.y = 3;
    const mag = windForceMagnitudeAt(worldPos);

    if (obj.damageState === 'intact' && mag > obj.breakThreshold * 0.5) {
      obj.damageState = 'swaying';
    }
    if (obj.damageState === 'swaying') {
      const sway = Math.min(mag / obj.breakThreshold, 1) * 0.25;
      obj.mesh.rotation.z = Math.sin(ctx.now() * 10 + obj.id) * sway;
      if (mag > obj.breakThreshold) {
        obj.damageState = 'uprooted';
        const at = groundPos.clone();
        uprootTree(obj, at);
        Sim.stats.treesUprooted++;
        api.feel('tree', at);
        api.addDamageScore(10);
      }
    }
  }

  /**
   * Tears a tree out of the ground and hands it, whole, to the capture state
   * machine, so it tumbles around the funnel as a recognisable tree.
   *
   * This previously swapped the tree's own trunk-and-canopy Group for a
   * pooled 'treeTrunk' debris instance, converting the tree to a capped,
   * recyclable pool object like every other fragment. That was tidy
   * bookkeeping but it looked wrong: the pooled stub is a bare 2.4m brown
   * cylinder with no canopy, visually identical to a branch and invisible
   * against the dust, so an uprooting read as the tree flashing and
   * vanishing rather than being carried off. Measured at EF5, no trunk stub
   * was airborne at all while three whole trees -- the ones that happened to
   * hit the old saturation fallback -- were orbiting at 9-16m. In other
   * words the fallback path was the one that looked right.
   *
   * Keeping the Group costs nothing: those meshes already exist and are
   * already in the scene whether the tree is standing or flying, so no draw
   * call is added, and it frees the pool slot the conversion used to consume.
   * A tree can only ever be uprooted once, so nothing accumulates without
   * bound.
   * @param {SimObject} obj
   * @param {THREE.Vector3} groundPos world-space position at the tree's base
   * @returns {void}
   */
  function uprootTree(obj, groundPos) {
    // Raised off the ground a little so the burst reads as the root ball
    // tearing out, not as something detonating under the turf.
    spawnImpactBurst(new THREE.Vector3(groundPos.x, groundPos.y + 0.8, groundPos.z), 1.15);

    const dir = api.awayFromTornado(groundPos);
    const vel = dir.multiplyScalar(3).add(new THREE.Vector3(0, 4, 0));

    obj.rooted = false;
    obj.velocity.copy(vel);
    // A standing tree resists the wind (liftEligible 0.4); one already torn
    // loose does not -- its canopy is a sail and its roots no longer anchor
    // it. Raised to 0.85 so liftDifficulty() lands at 0.7-1.4, which is
    // deliberately the same band the pooled treeTrunk stub used to occupy:
    // trees now fly exactly as readily as the stubs that replaced them did,
    // so only the appearance changes, not how often a tree gets airborne.
    obj.liftEligible = 0.85;
    // Same reasoning, and the more important half of it. `drag` here is pure
    // velocity damping -- "how much this resists being moved" -- so the
    // standing tree's 1.4 is right for something anchored by roots and wrong
    // for something already tumbling. Left at 1.4, an uprooted tree creeps
    // inward at only ~0.5 m/s, about the speed the funnel wanders away at,
    // so it never crosses into the lift radius: measured at EF5, all 56
    // uprooted trees were still sitting at ground level, at radii of 37-84m
    // against a 25.5m lift radius. 0.6 is exactly what spawnDebris() gave
    // the pooled stub, which did reach orbit.
    obj.drag = 0.6;
    // Without this the tree sails around bolt upright, because createTree
    // leaves angularVelocity at zero and nothing else ever sets it.
    obj.angularVelocity.set(
      (Math.random() - 0.5) * 3.5, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3.5
    );

    // The tree survives intact, so the treeTrunk pool is now free for what it
    // is actually good at: snapped-off trunk shrapnel thrown clear as the
    // tree comes out. spawnDebris() returning null under pool pressure is
    // harmless here -- the tree itself is already airborne either way.
    const def = DEBRIS_KIND_DEFS.treeTrunk;
    const shards = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < shards; i++) {
      const scatter = new THREE.Vector3(
        (Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6
      );
      const mass = def.massMin + Math.random() * (def.massMax - def.massMin);
      spawnDebris(groundPos, scatter, mass, Sim.params.debrisSize * 0.9, 'treeTrunk');
    }
  }

  /**
   * @param {SimObject} obj
   * @returns {void}
   */
  function updateCarDamage(obj) {
    if (obj.damageState === 'airborne') return;
    // Scratch: every car, every frame (performance pass); cloned below in
    // the rare branch that keeps it.
    const worldPos = S.damageScratchA.copy(obj.mesh.position);
    worldPos.y = 1;
    const mag = windForceMagnitudeAt(worldPos);

    if (obj.damageState === 'intact' && mag > obj.breakThreshold) {
      const at = worldPos.clone();
      obj.damageState = 'tipped';
      obj.mesh.userData.parked = false;
      obj.angularVelocity.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, 3 + Math.random() * 2);
      const dir = api.awayFromTornado(at);
      obj.velocity.copy(dir.multiplyScalar(2)).add(new THREE.Vector3(0, 3, 0));
      Sim.stats.vehiclesOverturned++;
      api.feel('car', at);
      api.addDamageScore(15);
    } else if (obj.damageState === 'tipped' && mag > obj.breakThreshold * 1.6) {
      obj.damageState = 'airborne';
    }
  }

  return { flattenTree, updateTreeDamage, uprootTree, updateCarDamage };
}
