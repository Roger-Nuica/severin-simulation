// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION C — Vortex force field
 * ===========================================================================
 */

// How much of a Fujiwhara monster's extra size becomes extra pulling power
// (see computeVortexForce). Deliberately sub-linear: at the merge's sizeMul
// of 2.4 this gives ~1.9x the tangential, inward and lifting force, which
// reads as overwhelming without launching the town past the map edge.
const MONSTER_FORCE_GAIN = 0.65;

/**
 * @param {Object} ctx
 * @returns {{
 *   computeVortexForce: (pos: THREE.Vector3, mass: number, liftEligible: number, vortex?: Object) => THREE.Vector3,
 *   windForceMagnitudeAt: (pos: THREE.Vector3) => number
 * }}
 */
export function createForcesSystem(ctx) {
  const { Sim } = ctx;

  // For windForceMagnitudeAt, which reads the force and drops it.
  const windScratch = new THREE.Vector3();

  /**
   * @param {number} edge0 outer edge (value at/ beyond => 0)
   * @param {number} edge1 inner edge (value at/ below => 1)
   * @param {number} x
   * @returns {number}
   */
  function smoothstep(edge0, edge1, x) {
    const t = THREE.MathUtils.clamp((edge0 - x) / (edge0 - edge1), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * Computes the force the vortex exerts on a point mass at world position `pos`.
   * Strongest in the annular "wall" region, weak in the calm eye and outside
   * the influence radius, fading with height above the funnel top.
   * @param {THREE.Vector3} pos world-space position of the object
   * @param {number} mass
   * @param {number} liftEligible 0..1 multiplier on upward lift susceptibility
   * @param {Object} [vortex] the tornado whose field this is; by default the
   *   nearest active one (engine/tornadoes.js). Outbreak tornadoes' fields
   *   reach only ~1.8x the radius and they start 70+ apart, so the nearest
   *   one is the only one that matters at any point.
   * @param {THREE.Vector3} [out] written and returned instead of a new
   *   vector: it is called for every airborne object every frame, and the
   *   allocation per call was steady garbage for the collector (performance
   *   pass). Callers that keep the result pass their own.
   * @returns {THREE.Vector3} force vector (not yet divided by mass)
   */
  function computeVortexForce(pos, mass, liftEligible, vortex, out) {
    const result = out || new THREE.Vector3();
    const p = Sim.params;
    const Vortex = vortex || ctx.tornadoes.nearest(pos.x, pos.z);
    const dx = pos.x - Vortex.center.x;
    const dz = pos.z - Vortex.center.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    const h = Math.max(pos.y, 0);

    // The outer edge of the force field is deliberately wider than the
    // funnel's own visible radius: ambient debris spawns in a ring around
    // the tornado (see spawnAmbientDebris), so a cutoff exactly at p.radius
    // left almost everything just outside the field with literally zero
    // horizontal pull, unable to ever drift closer. Extending the capture
    // radius gives a gradual, "getting sucked in" build-up on approach
    // instead of an all-or-nothing wall. The strongest-pull inner zone
    // (eyeRadius) still tracks the actual tornado radius, unchanged.
    // sizeMul: a Fujiwhara-merged monster reaches further (engine/fujiwhara.js).
    const captureRadius = p.radius * 1.8 * Vortex.sizeMul;
    const eyeRadius = p.radius * 0.3 * Vortex.sizeMul;
    const radialFalloff = smoothstep(captureRadius, eyeRadius, r);
    const heightFalloff = THREE.MathUtils.clamp(1 - h / (Vortex.height * 1.5), 0, 1);
    // birth (vortex.js BIRTH): a rope still lowering out of the cloud, or
    // no tornado at all before Start, pulls on nothing.
    const influence = radialFalloff * heightFalloff * Vortex.birth;

    if (influence <= 0.001) {
      return result.set(0, -9.8 * mass, 0);
    }

    // Below this radius there is no well-defined horizontal direction (the
    // object is essentially on the axis), but that must NOT mean "no force":
    // the previous behaviour bailed out to pure gravity for r < 0.001, which
    // is exactly the "stuck at the centre" bug — near the core the object
    // should feel the field's strongest, most consistent vertical lift, not
    // the weakest. Horizontal direction degrades gracefully to zero instead.
    const rSafe = Math.max(r, 0.001);
    const nearCore = r < eyeRadius;
    const radialDirX = nearCore ? 0 : dx / rSafe;
    const radialDirZ = nearCore ? 0 : dz / rSafe;
    const tangentDirX = -radialDirZ;
    const tangentDirZ = radialDirX;

    // A merged monster does not just reach further (captureRadius above), it
    // pulls harder inside that reach. Without this the survivor of a
    // Fujiwhara merge was a wider funnel of exactly ordinary strength, which
    // is what made the endgame tornado read as scenery rather than as a
    // threat. Sub-linear in sizeMul so a 2.4x monster is ~1.9x as strong
    // rather than 2.4x, which would fling the whole town out of the map.
    const monsterGain = 1 + (Vortex.sizeMul - 1) * MONSTER_FORCE_GAIN;

    const tangentialGain = 9.0 * monsterGain;
    const inwardGain = 3.0 * monsterGain;
    // Boosted 4x from the original 4.0: debris pool masses go up to 5kg
    // (roofPiece/rock), and Fup below is a genuine Newton-scale force
    // divided by mass exactly once (by the caller) — at the old gain,
    // heavier kinds could never generate enough lift to outrun the
    // -9.8*mass*0.15 gravity term a few lines down, leaving them
    // permanently stuck sliding/trembling instead of ever rising.
    const upwardGain = 16.0 * monsterGain;
    const windFactor = p.windSpeed / 120;

    const Ft = p.rotationSpeed * p.intensity * influence * tangentialGain * windFactor;
    // Fin/Fup used to also be divided by mass (or sqrt(mass)) right here,
    // *in addition to* the caller's own force/mass -> acceleration division
    // in updateCaptureState's 'rising' branch. That double division crushed
    // lift for anything heavier than ~1kg (effectively 1/mass^2) while
    // wildly over-amplifying it for anything lighter, which is why light
    // debris flung around at 100+ m/s while medium/heavy debris never
    // budged. Ft and coreMinLift below were never divided by mass here in
    // the first place, so removing it from Fin/Fup makes all components of
    // this "force vector, not yet divided by mass" (per this function's own
    // contract) consistent with a single, correct division downstream.
    const Fin = -windFactor * p.intensity * influence * inwardGain;
    let Fup = windFactor * p.intensity * influence * upwardGain * liftEligible;

    // Minimum lift floor near the core: as r -> 0, coreBoost -> 1, guaranteeing
    // a strong, consistent upward force at/near the axis regardless of how
    // Fup above happens to evaluate, so nothing can end up "stuck" at the
    // centre with an effectively zero net force.
    const coreBoost = smoothstep(eyeRadius, 0, r);
    const coreMinLift = windFactor * p.intensity * upwardGain * liftEligible * 0.75 * coreBoost;
    Fup = Math.max(Fup, coreMinLift);

    const force = result.set(
      tangentDirX * Ft + radialDirX * Fin,
      Fup,
      tangentDirZ * Ft + radialDirZ * Fin
    );
    // Reduced from 0.15: with Fup now a properly-scaled, undivided force,
    // even this smaller residual gravity fraction is enough to keep light
    // debris from floating indefinitely, without re-introducing the wall
    // heavier debris used to hit.
    force.y += -9.8 * mass * 0.08; // reduced gravity influence while inside the field, for airborne feel
    return force;
  }

  /**
   * Magnitude of the wind force the vortex would exert at a position, used for
   * damage-threshold comparisons. Independent of an object's own mass/lift.
   * @param {THREE.Vector3} pos
   * @returns {number}
   */
  function windForceMagnitudeAt(pos) {
    // Read and dropped at once, so one scratch vector does.
    const f = computeVortexForce(pos, 1, 1, undefined, windScratch);
    return Math.sqrt(f.x * f.x + f.z * f.z + Math.max(f.y, 0) ** 2);
  }

  // Published so physics.js/damage.js (and anywhere else already reading
  // these off ctx rather than the systems registry) can find them.
  ctx.computeVortexForce = computeVortexForce;
  ctx.windForceMagnitudeAt = windForceMagnitudeAt;

  return { computeVortexForce, windForceMagnitudeAt };
}
