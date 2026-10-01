// @ts-check
import * as THREE from 'three';
import { SWIRL, MONSTER } from './config.js';

/**
 * ===========================================================================
 * SECTION V.4 — The funnel's particles
 * ===========================================================================
 * The debris swirling inside the funnel and the dust ring boiling up round
 * its foot, both integrated per particle on the CPU each frame (moved out of
 * vortex.js updateVortexVisuals unchanged, apart from the swirl's per-frame
 * constants being worked out once instead of per particle).
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see vortex.js)
 * @param {Object} api every module's functions, by name
 * @returns {{updateSwirl: (dt: number, t: number) => void, updateDustRing: (dt: number) => void}}
 */
export function createVortexParticles(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * The swirl: angle, height and radial fraction per particle.
   * @param {number} dt
   * @param {number} t
   * @returns {void}
   */
  function updateSwirl(dt, t) {
    const p = Sim.params;
  const positions = S.Vortex.particles.geometry.attributes.position.array;
  const colours = S.Vortex.particles.geometry.attributes.color.array;
  const data = S.Vortex.particleData;
  const swirl = 1.5 + p.rotationSpeed * 2.2;
  const rise = 2 + p.windSpeed * 0.035;
  // Everything below that is the same for every particle, worked out once
  // (the loop runs for thousands of them a frame; updateVortexVisuals was
  // 5% of a heavy run's CPU). Same arithmetic in the same order as
  // funnelRadiusAt, so the particles land exactly where they did.
  // Wedge (engine/wedge.js) shares the same extra breathing a Fujiwhara
  // merge's agitation already drives, rather than getting a second knob:
  // both are "this funnel is bigger and angrier than an ordinary one".
  const chaos = S.Vortex.agitation + S.Vortex.wedge + (1 - S.Vortex.birth) * 1.5;
  const wobble = SWIRL.wobble * (1 + MONSTER.wobbleBoost * chaos);
  const breatheT = t * (1.3 + 2 * chaos);
  const height = S.Vortex.height;
  const baseR = S.Vortex.baseRadius;
  const topR = S.Vortex.topRadius;
  const wedged = S.Vortex.wedge > 0;
  const count = S.Vortex.particleCount;
  const smoothstep = THREE.MathUtils.smoothstep;
  const [coreLo, coreHi] = SWIRL.coreFade;
  const [topLo, topHi] = SWIRL.topFade;
  for (let i = 0; i < count; i++) {
    const o = i * 6;
    let f = data[o];
    let h = data[o + 2] + rise * data[o + 3] * dt;
    if (h > height) {
      h = 0;
      f = api.spawnFraction();
    }
    // Faster near the axis, as in a real vortex core; a small random walk
    // outwards/inwards keeps the spread churning.
    const angle = data[o + 1] + swirl * dt * (1.1 - 0.55 * f);
    f = THREE.MathUtils.clamp(f + (Math.random() - 0.5) * 0.02, SWIRL.fractionMin * 0.5, SWIRL.fractionMax);
    data[o] = f;
    data[o + 1] = angle;
    data[o + 2] = h;
    const breathe = 1 + wobble * Math.sin(breatheT + data[o + 4] + h * 0.15);
    // funnelRadiusAt(h), inlined: the cone, then the wedge if there is one.
    const u = h / height;
    const ct = u < 0 ? 0 : (u > 1 ? 1 : u);
    const cone = ((1 - ct) * baseR + ct * topR) * (0.55 + 0.45 * Math.sin(ct * Math.PI * 0.5)) + 0.4;
    const r = f * (wedged ? cone * api.wedgeFactorAt(h) : cone) * breathe;
    const i3 = i * 3;
    positions[i3] = Math.cos(angle) * r;
    positions[i3 + 1] = h;
    positions[i3 + 2] = Math.sin(angle) * r;
    colours[i * 4 + 3] = data[o + 5]
      * smoothstep(f, coreLo, coreHi)
      * (1 - smoothstep(u, topLo, topHi))
      * smoothstep(h, 0, 2);
  }
  S.Vortex.particles.geometry.attributes.color.needsUpdate = true;
  S.Vortex.particles.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * The ground dust ring.
   * @param {number} dt
   * @returns {void}
   */
  function updateDustRing(dt) {
    const p = Sim.params;
  // Ground dust ring: per-particle angle/height integration, matching the
  // main swirl's approach, instead of rotating the Points object (which is
  // as visually inert here as it is for the rotationally-symmetric funnel).
  //
  // Rather than wobbling in place at a fixed 2.5m as it used to, dust now
  // boils upwards and is drawn inwards towards the funnel wall as it
  // climbs, then reseeds wide at ground level. That convergence is what
  // welds the skirt onto the funnel's base: at any given height the dust
  // sits at roughly the radius the funnel surface itself occupies, so the
  // two read as one continuous structure instead of a column standing in
  // a separate flat disc.
  const dustPositions = S.Vortex.dustRing.geometry.attributes.position.array;
  const dustData = S.Vortex.dustRingData;
  const dustSwirl = 1.0 + p.rotationSpeed * 1.8;
  const dustOuter = S.Vortex.topRadius * 1.7;
  const dustTop = S.Vortex.dustTop;
  const dustRise = 0.8 + p.windSpeed * 0.008;
  const wallFlare = (S.Vortex.topRadius - S.Vortex.baseRadius) * 0.35;
  for (let i = 0; i < S.Vortex.dustCount; i++) {
    let r = dustData[i * 3];
    let angle = dustData[i * 3 + 1] + dustSwirl * dt * (1 - r / (dustOuter + 1));
    let h = dustData[i * 3 + 2] + dustRise * dt;
    if (h > dustTop) {
      h = 0;
      r = S.Vortex.baseRadius + Math.random() * (dustOuter - S.Vortex.baseRadius);
    }
    const lift = h / dustTop;
    const wall = S.Vortex.baseRadius + 0.4 + lift * wallFlare;
    r = THREE.MathUtils.clamp(
      r + (wall - r) * lift * dt * 1.6 + (Math.random() - 0.5) * 0.08, 0, dustOuter
    );
    dustData[i * 3] = r;
    dustData[i * 3 + 1] = angle;
    dustData[i * 3 + 2] = h;
    dustPositions[i * 3] = Math.cos(angle) * r;
    dustPositions[i * 3 + 1] = h;
    dustPositions[i * 3 + 2] = Math.sin(angle) * r;
  }
  S.Vortex.dustRing.geometry.attributes.position.needsUpdate = true;
  }

  return { updateSwirl, updateDustRing };
}
