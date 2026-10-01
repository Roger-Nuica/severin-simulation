import * as THREE from 'three';
import { setChurnOctave } from '../funnelChurn.js';
import { SUB_LEAN_AXIS } from './config.js';

/**
 * ===========================================================================
 * SECTION V.3 — Satellite funnels
 * ===========================================================================
 * The small funnels that spin up round a violent tornado, and their pull on
 * what passes close (switched off: SUB.enabled).
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see vortex.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createSubVortices(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Arms one pooled sub-vortex for a fresh appearance. Everything that varies
   * between siblings is randomised here — lifespan, orbit radius and rate,
   * size, outward lean, spin rate and noise seed — so that even when all
   * three are alive at once they never read as copies of one another.
   * @param {Object} sub a pool entry from Vortex.subVortices
   * @returns {void}
   */
  function spawnSubVortex(sub) {
    sub.active = true;
    sub.age = 0;
    sub.life = S.SUB.lifeMin + Math.random() * (S.SUB.lifeMax - S.SUB.lifeMin);
    sub.angle = Math.random() * Math.PI * 2;
    sub.orbitRate = 0.5 + Math.random() * 0.7;
    // Far enough out that the satellite clears the parent funnel's own wall
    // and reads as a separate circulation being flung around the footprint,
    // rather than a bulge on the main funnel's flank. Widened from the
    // original 6.5-13.5 spread so up to five simultaneous satellites (up from
    // three) have room to sit apart rather than stacking on near-identical
    // orbits.
    sub.orbitRadius = S.Vortex.baseRadius * 1.5 + 2 + Math.random() * 10;
    // Varies the baseline 40% of the main funnel across the 35-50% band --
    // big enough that a sub-vortex reads as a clear secondary funnel rather
    // than a speck near the base.
    sub.sizeMul = 0.85 + Math.random() * 0.4;
    sub.lean = 0.1 + Math.random() * 0.18;
    sub.spinRate = 0.8 + Math.random() * 1.1;
    sub.noiseSeed = Math.random() * 500;
    sub.mesh.visible = true;
  }

  /**
   * Spawns, ages, animates and retires the satellite sub-vortices.
   *
   * Each live sub-vortex does three things at once: it orbits the parent
   * funnel's footprint, it churns with its own noise turbulence, and it
   * breathes through a birth/death envelope. The turbulence deliberately
   * reuses updateFunnelGeometry's approach of rotating the *noise sample
   * points* rather than the mesh — a lathe is a surface of revolution, so
   * spinning the mesh about its own axis is literally invisible, and the only
   * way to see a sub-vortex spin is to spin the pattern displacing it.
   *
   * Cost is bounded by construction: the pool is fixed at SUB.max, inactive
   * entries return immediately, and each mesh carries the same coarse 13 x 21
   * lathe resolution regardless of its on-screen size or SUB.max -- so
   * raising the size/count budget (see SUB above) does not raise the
   * per-vertex noise cost of any individual sub-vortex, only how many of them
   * run the same fixed-cost pass. If profiling ever shows this too expensive,
   * lower SUB.heightSteps/radialSegments first, before lowering size or count.
   * @param {number} dt
   * @param {number} t total elapsed seconds
   * @returns {void}
   */
  function updateSubVortices(dt, t) {
    const p = Sim.params;
    const subs = S.Vortex.subVortices;
    if (!subs.length) return;

    // Frequency and simultaneous count both ramp with intensity, matching how
    // lightning is gated: nothing at all below EF4, a couple of satellites
    // through the EF4 range, and a near-permanent retinue of up to SUB.max
    // (5) by the top of EF5.
    const gate = S.SUB.enabled ? THREE.MathUtils.smoothstep(p.intensity, S.SUB.gateLow, S.SUB.gateHigh) : 0;
    const maxActive = gate > 0 ? 1 + Math.floor(gate * (S.SUB.max - 0.01)) : 0;

    let activeCount = 0;
    for (const sub of subs) if (sub.active) activeCount++;

    S.Vortex.subSpawnTimer -= dt;
    if (gate > 0 && activeCount < maxActive && S.Vortex.subSpawnTimer <= 0) {
      const free = subs.find(s => !s.active);
      if (free) {
        spawnSubVortex(free);
        activeCount++;
      }
      // Randomised rather than fixed so births stay staggered: a constant
      // interval would quickly lock the pool into a rhythm where every slot
      // appears and vanishes together. Tightened from the original 4.5..1.1s
      // range so a freed slot at high intensity refills within roughly a
      // second rather than several, which is what keeps 3-5 satellites
      // reliably active together through a sustained EF4-EF5 run instead of
      // the pool draining back down to one between spawns.
      S.Vortex.subSpawnTimer = THREE.MathUtils.lerp(3.0, 0.6, gate) * (0.5 + Math.random());
    }

    const hScale = p.radius / 14;
    const orbitSpeed = 0.6 + p.rotationSpeed * 0.35;
    const windFactor = p.windSpeed / 120;
    const subTurb = 0.18 + p.intensity * 0.3;

    for (const sub of subs) {
      if (!sub.active) continue;

      sub.age += dt;
      if (sub.age >= sub.life) {
        sub.active = false;
        sub.mesh.visible = false;
        sub.mesh.material.opacity = 0;
        continue;
      }

      // Birth/death envelope. The size envelope never reaches zero at birth
      // so a satellite condenses out of the dust rather than popping in, and
      // the death end shrinks it to a third before it disappears, giving the
      // "roping out and dissipating" read rather than a hard cut.
      const fadeIn = THREE.MathUtils.clamp(sub.age / S.SUB.fadeIn, 0, 1);
      const fadeOut = THREE.MathUtils.clamp((sub.life - sub.age) / S.SUB.fadeOut, 0, 1);
      const envelope = fadeIn * fadeOut;
      const size = sub.sizeMul * (0.45 + 0.55 * fadeIn) * (0.35 + 0.65 * fadeOut);

      // Orbit around the parent's footprint.
      sub.angle += orbitSpeed * sub.orbitRate * dt;
      const localX = Math.cos(sub.angle) * sub.orbitRadius;
      const localZ = Math.sin(sub.angle) * sub.orbitRadius;
      sub.mesh.position.set(localX, 0, localZ);
      sub.mesh.scale.set(size, size, size);

      // Tilt away from the parent axis, which is what sells "flung out of the
      // main circulation" instead of "planted beside it". Rotating +Y about
      // (sin a, 0, -cos a) carries it towards the outward radial direction
      // (cos a, 0, sin a), so a positive lean always tips outward wherever the
      // satellite currently sits on its orbit.
      sub.mesh.quaternion.setFromAxisAngle(
        SUB_LEAN_AXIS.set(Math.sin(sub.angle), 0, -Math.cos(sub.angle)),
        sub.lean * envelope
      );

      sub.mesh.material.opacity = (0.3 + p.intensity * 0.4) * envelope * S.Vortex.groundPresence;

      // Per-vertex turbulence, single octave, on the graphics card
      // (funnelChurn.js). The main funnel needs more because it fills the
      // screen and a lone octave reads as a smooth undulation at that size; a
      // satellite a fifth as large shows the same detail from one octave. The
      // same kind of safety rail as the main funnel's (SUB_CLAMP): outside the
      // range subTurb normally produces, only so a noise peak cannot pinch the
      // lathe through zero and turn it inside out.
      const spin = t * p.rotationSpeed * sub.spinRate + sub.noiseSeed;
      setChurnOctave(sub.churn, 0, Math.cos(spin), Math.sin(spin), subTurb, 0.45, 0.3, t * windFactor * 1.6, sub.noiseSeed);

      // Cached in world space for applySubVortexForce, which runs from the
      // physics pass and has no business walking the scene graph. The group's
      // horizontal scale applies to the orbit offset but not to the mesh's
      // own height, exactly as it does for the parent funnel.
      sub.worldX = S.Vortex.center.x + localX * hScale;
      sub.worldZ = S.Vortex.center.z + localZ * hScale;
      sub.worldHeight = S.Vortex.height * S.SUB.sizeFactor * size;
      sub.forceRadius = S.Vortex.topRadius * S.SUB.sizeFactor * size * hScale * 2.6;
    }

    const subMap = S.Vortex.subBandTexture;
    if (subMap) {
      subMap.offset.x += dt * (0.12 + p.rotationSpeed * 0.08);
      subMap.offset.y -= dt * (0.3 + windFactor * 0.5);
    }
  }

  /**
   * Applies each live sub-vortex's own small local force field to a single
   * object, as a velocity nudge rather than a force: the object's position
   * has already been integrated for this frame by the capture state machine,
   * so the nudge takes effect on the next one.
   *
   * This is the weak, short-range sibling of computeVortexForce — same
   * tangential-plus-inward-plus-lift decomposition, but a linear falloff
   * (cheap, and the field is tiny), a radius of only a couple of satellite
   * widths, and magnitudes an order below the parent's. Its whole job is to
   * make debris passing near a satellite visibly twitch towards it; anything
   * stronger would fight the main circulation for ownership of the object.
   * Objects already orbiting the parent are excluded by the caller, since
   * their motion is kinematic and a velocity nudge would be overwritten.
   * @param {THREE.Vector3} pos world-space position of the object
   * @param {THREE.Vector3} velocity mutated in place
   * @param {number} dt
   * @returns {void}
   */
  function applySubVortexForce(pos, velocity, dt) {
    // No funnel before Start (birth 0), so no satellites tugging at anything:
    // integratePhysics now runs while the town stands by as well.
    if (!S.Vortex.active || !(S.Vortex.birth > 0)) return;
    const subs = S.Vortex.subVortices;
    const intensity = Sim.params.intensity;
    for (const sub of subs) {
      if (!sub.active) continue;
      const dx = pos.x - sub.worldX;
      const dz = pos.z - sub.worldZ;
      const rSq = dx * dx + dz * dz;
      if (rSq > sub.forceRadius * sub.forceRadius) continue;
      const r = Math.sqrt(rSq);
      if (r < 0.01) continue;
      const falloff = (1 - r / sub.forceRadius)
        * THREE.MathUtils.clamp(1 - pos.y / (sub.worldHeight + 1), 0, 1)
        * intensity * S.Vortex.birth * dt;
      const dirX = dx / r;
      const dirZ = dz / r;
      velocity.x += (-dirZ * 9 - dirX * 4) * falloff;
      velocity.z += (dirX * 9 - dirZ * 4) * falloff;
      velocity.y += 3 * falloff;
    }
  }

  return { spawnSubVortex, updateSubVortices, applySubVortexForce };
}
