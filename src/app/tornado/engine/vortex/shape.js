import * as THREE from 'three';
import { setChurnOctave } from '../funnelChurn.js';
import { BIRTH, FUNNEL_HEIGHT_DAMP, WEDGE } from './config.js';

/**
 * ===========================================================================
 * SECTION V.2 — The funnel's shape
 * ===========================================================================
 * Its profile and radius with height, the touchdown's shape, the EF5 wedge,
 * and the numbers the graphics card's churn is given each frame
 * (funnelChurn.js).
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see vortex.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createVortexShape(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Turns the raw 0..1 touchdown progress into what is drawn.
   *
   * Three beats over BIRTH.seconds (tornadoEngine.js):
   *  - 0 .. dropEnd: the collar turns up in the cloud base and a thin rope
   *    lowers out of it, hanging from the top, until it reaches the ground;
   *  - touchdown at dropEnd: the ground skirt and dust ring appear, thrown
   *    out wide by the shock (and the engine fires its bolt, flash and
   *    shake);
   *  - dropEnd .. 1: the rope swells out to full width with a slight
   *    overshoot, so it lands on its size rather than creeping up to it.
   * @param {number} b 0..1
   * @returns {{drop: number, width: number, alpha: number, ground: number, crown: number, shock: number}}
   */
  function birthShape(b) {
    if (b >= 1) return { drop: 1, width: 1, alpha: 1, ground: 1, crown: 1, shock: 0 };
    const smooth = THREE.MathUtils.smootherstep;
    const drop = smooth(b, 0.02, BIRTH.dropEnd);
    const grow = THREE.MathUtils.clamp((b - BIRTH.dropEnd) / (1 - BIRTH.dropEnd), 0, 1);
    // easeOutBack: past 1 and back, which is what makes it read as the
    // storm wrenching itself open rather than a slider being dragged.
    const c1 = 1.35;
    const back = 1 + (c1 + 1) * Math.pow(grow - 1, 3) + c1 * Math.pow(grow - 1, 2);
    const width = THREE.MathUtils.lerp(BIRTH.ropeWidth, 1, back);
    // The touchdown shock: the dust ring thrown out wide the moment the rope
    // lands, then drawn back in to the funnel's own footprint.
    const shockT = THREE.MathUtils.clamp((b - BIRTH.dropEnd) / BIRTH.shockSpan, 0, 1);
    const shock = shockT > 0 && shockT < 1 ? Math.sin(Math.PI * Math.sqrt(shockT)) : 0;
    return {
      drop,
      width,
      alpha: smooth(b, 0, 0.12),
      ground: smooth(b, BIRTH.dropEnd - 0.03, BIRTH.dropEnd + 0.12),
      crown: smooth(b, 0, 0.06),
      shock
    };
  }

  /**
   * The funnel silhouette as a lathe profile: narrow at the base, widening
   * towards the top with a slight hourglass pinch. Shared by the main funnel
   * and the satellite sub-vortices so the two are unmistakably the same kind
   * of object at different scales — a sub-vortex that merely tapered would
   * read as a cone standing next to a tornado rather than a piece of it.
   * @param {number} height
   * @param {number} baseRadius radius at ground level, before the pinch
   * @param {number} topRadius radius at full height, before the pinch
   * @param {number} minRadius floor added at every step, so the profile never
   *   closes to a point and the lathe keeps a hollow core
   * @param {number} steps number of height subdivisions
   * @returns {THREE.Vector2[]}
   */
  function funnelProfile(height, baseRadius, topRadius, minRadius, steps) {
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pinch = 0.55 + 0.45 * Math.sin(t * Math.PI * 0.5);
      const r = THREE.MathUtils.lerp(baseRadius, topRadius, t) * pinch + minRadius;
      points.push(new THREE.Vector2(r, t * height));
    }
    return points;
  }

  /**
   * Radius of the main funnel's (undisplaced) lathe profile at height y --
   * the same curve funnelProfile() samples, as a function, so the skirt can
   * be built to merge exactly into the funnel wall.
   * @param {number} y
   * @returns {number}
   */
  function funnelRadiusAt(y) {
    return coneRadiusAt(y) * wedgeFactorAt(y);
  }

  /**
   * The funnel's radius at height y with no wedge in it: the cone the lathe
   * was actually built as (see funnelProfile).
   * @param {number} y
   * @returns {number}
   */
  function coneRadiusAt(y) {
    const t = THREE.MathUtils.clamp(y / S.Vortex.height, 0, 1);
    const pinch = 0.55 + 0.45 * Math.sin(t * Math.PI * 0.5);
    return THREE.MathUtils.lerp(S.Vortex.baseRadius, S.Vortex.topRadius, t) * pinch + 0.4;
  }

  /**
   * The wedge widening at height y: 1 at rest, and at a full wedge whatever it
   * takes to put this height of the cone out at the column's radius instead
   * (see WEDGE) -- about 6.5x at the contact, 1x at the top. Multiplied onto a
   * radius rather than replacing it, so it composes with the noise
   * displacement, the rope pinch and the group's own scale without any of them
   * having to know about it.
   * @param {number} y unscaled height above the funnel's base
   * @returns {number}
   */
  function wedgeFactorAt(y) {
    if (S.Vortex.wedge <= 0) return 1;
    return 1 + S.Vortex.wedge * wedgeRatioAt(y);
  }

  /**
   * How much height y widens at a full wedge, as a fraction of its radius
   * (see wedgeFactorAt). Depends only on the funnel's rest profile, so it is
   * baked once per vertex for the graphics card's churn (funnelChurn.js).
   * @param {number} y unscaled height above the funnel's base
   * @returns {number}
   */
  function wedgeRatioAt(y) {
    const hT = THREE.MathUtils.clamp(y / S.Vortex.height, 0, 1);
    const column = coneRadiusAt(S.Vortex.height) * THREE.MathUtils.lerp(WEDGE.taper, 1, hT);
    return column / coneRadiusAt(y) - 1;
  }

  /**
   * Mesh scale for the dirt skirt while a wedge is up: the funnel's widening in
   * absolute units rather than as a ratio, since the skirt starts several times
   * wider than the funnel's contact and keeping its *proportion* to it would
   * put a dust bell around the whole map (see WEDGE).
   * @returns {number}
   */
  function wedgeSkirtScale() {
    if (S.Vortex.wedge <= 0) return 1;
    const gain = coneRadiusAt(0) * (wedgeFactorAt(0) - 1);
    return 1 + gain / S.Vortex.skirtBaseRadius;
  }

  /**
   * Perturbs the funnel's lathe geometry per-vertex using 3D simplex noise
   * sampled through a slowly-rotating reference frame. A LatheGeometry is a
   * surface of revolution, so spinning the mesh itself around its own axis
   * is invisible; rotating the *noise sample points* instead makes the
   * turbulent pattern visibly writhe and spin regardless of viewing angle.
   *
   * Three octaves of noise are summed, each at roughly two and a half to
   * three times the spatial frequency of the one before, scrolling faster
   * and rotating in its own frame so none of them can phase-lock with
   * another into a single smooth undulation: a coarse layer for the
   * large-scale writhe, a fine one that makes the edge ragged, and a finest
   * one (Instrucțiunea EE) that frays that ragged edge again at a smaller
   * scale -- detail at several scales at once, like a fractal, rather than
   * one wobble. On top of that, a rope-out envelope (see below) pinches and
   * flares the silhouette at EF4+ intensities.
   *
   * Also churns the inner core and the ground skirt (churnShell), scrolls
   * the band textures for extra perceived motion, and applies the
   * lightning flash to every funnel surface.
   * @param {number} dt
   * @param {number} t total elapsed seconds
   * @returns {void}
   */
  function updateFunnelGeometry(dt, t) {
    const p = Sim.params;
    // Split amplitudes, because the two octaves do different jobs: the
    // coarse one supplies the large-scale writhe and the fine one the
    // ragged, fast-shifting edge detail. Both are damped towards the top
    // (FUNNEL_HEIGHT_DAMP) — the lathe is already five times wider up
    // there than at the contact point, so an undamped fractional
    // displacement that reads as a ragged edge at the base balloons into
    // metre-wide sheets at the top.
    // Roughened further as an EF5 wedge (engine/wedge.js) comes up: at full
    // wedge the wall is several times wider than any ordinary funnel, and
    // the same fractional displacement that read as a ragged edge at a
    // normal scale gets lost across that much more surface. Scoped to
    // Vortex.wedge rather than applied unconditionally, so an ordinary
    // tornado's turbulence is untouched.
    // A funnel still being born churns hard -- condensation boiling down out
    // of the cloud rather than a settled column -- and calms as it grows.
    const wedgeChurn = 1 + S.Vortex.wedge * 0.7 + (1 - S.Vortex.birth) * 1.4;
    const turbCoarse = (0.10 + p.intensity * 0.26) * wedgeChurn;
    const turbFine = (0.05 + p.intensity * 0.17) * wedgeChurn;
    // The finest octave: small, so it frays the edge without blurring the
    // two larger scales.
    const turbFinest = (0.03 + p.intensity * 0.09) * wedgeChurn;
    const windFactor = p.windSpeed / 120;
    const spinAngle = t * p.rotationSpeed * 0.6;
    const cosA = Math.cos(spinAngle);
    const sinA = Math.sin(spinAngle);
    const fineAngle = t * p.rotationSpeed * 1.55;
    const cosB = Math.cos(fineAngle);
    const sinB = Math.sin(fineAngle);
    // Counter-rotating, so it shears against the two layers beneath it.
    const finestAngle = -t * p.rotationSpeed * 2.4;
    const cosC = Math.cos(finestAngle);
    const sinC = Math.sin(finestAngle);

    // Rope-out: a violent tornado does not hold a clean cone, it churns --
    // narrowing to a rope in places and ballooning out in others, with the
    // constriction travelling down the funnel. Two sines of different
    // frequencies multiplied together give exactly that: the fast one is the
    // travelling pinch, the slow one is an envelope that lets the effect
    // swell and subside rather than pulsing metronomically (funnelChurn.js
    // churnAt). Gated on intensity so an EF1 still looks like a tidy little
    // cone and only EF4-5 becomes unstable.
    const ropeGate = THREE.MathUtils.smoothstep(p.intensity, 0.68, 1);
    const invHeight = 1 / S.Vortex.height;

    // The funnel veil: all three octaves, damped with height, the rope-out,
    // and the wedge (per vertex, funnelChurn.js aWedge). Clamped to 0.3..1.6
    // as a safety rail rather than a shaping tool: the bounds sit outside the
    // range the amplitudes normally produce, and exist only so a rare
    // simultaneous peak of the octaves and the rope pinch cannot pinch the
    // funnel through zero (turning it inside out) or blow it out into a sheet.
    const f = S.Vortex.funnelChurn;
    setChurnOctave(f, 0, cosA, sinA, turbCoarse, 0.09, 0.06, t * windFactor * 0.8);
    setChurnOctave(f, 1, cosB, sinB, turbFine, 0.27, 0.2, t * windFactor * 2.2);
    setChurnOctave(f, 2, cosC, sinC, turbFinest, 0.7, 0.5, t * windFactor * 4.5);
    f.uChurnShape.value.set(FUNNEL_HEIGHT_DAMP, invHeight, 0.3, 1.6);
    f.uChurnRope.value.set(ropeGate, t, invHeight, S.Vortex.wedge);

    S.Vortex.funnelMesh.material.opacity = (0.34 + p.intensity * 0.46) * S.Vortex.presence;
    const map = S.Vortex.funnelMesh.material.map;
    if (map) {
      map.offset.x += dt * (0.05 + p.rotationSpeed * 0.03);
      map.offset.y -= dt * (0.15 + windFactor * 0.25);
    }

    // Inner core: follows the funnel's large-scale writhe and rope pinch
    // (same coarse octave and frame), so it stays centred inside the veil
    // rather than drifting through it; no fine octaves, as it is only ever
    // seen through the outer funnel.
    const c = S.Vortex.coreChurn;
    setChurnOctave(c, 0, cosA, sinA, turbCoarse * 0.8, 0.09, 0.06, t * windFactor * 0.8);
    setChurnOctave(c, 1, 1, 0, 0, 0, 0, 0);
    setChurnOctave(c, 2, 1, 0, 0, 0, 0, 0);
    c.uChurnShape.value.set(0, invHeight, 0.3, 1.6);
    c.uChurnRope.value.set(ropeGate, t, invHeight, S.Vortex.wedge);
    S.Vortex.coreMesh.material.opacity = (0.55 + p.intensity * 0.4) * S.Vortex.presence;
    const coreMap = S.Vortex.coreMesh.material.map;
    coreMap.offset.x += dt * (0.1 + p.rotationSpeed * 0.06);
    coreMap.offset.y -= dt * (0.2 + windFactor * 0.3);

    // Ground skirt: faster than the funnel, since it is dirt being ripped
    // off the ground, not condensation. Two octaves, kept gentler than the
    // funnel's: the skirt flares several times wider than the funnel base,
    // so the same fractional displacement there tore its lower edge into
    // hard, angular flaps lying on the ground. Its edge is broken up by the
    // dust ring's particles instead. No rope-out, and its wedge widening is
    // its mesh scale (below).
    const stormFactor = THREE.MathUtils.clamp(p.intensity * 0.7 + (p.windSpeed / 320) * 0.3, 0, 1);
    const skirtAmp = 0.06 + stormFactor * 0.09;
    const k = S.Vortex.skirtChurn;
    setChurnOctave(k, 0, cosB, sinB, skirtAmp, 0.2, 0.25, t * windFactor * 1.6);
    setChurnOctave(k, 1, cosB, sinB, skirtAmp * 0.45, 0.6, 0.7, t * windFactor * 3.5, 40);
    setChurnOctave(k, 2, 1, 0, 0, 0, 0, 0);
    k.uChurnShape.value.set(0, invHeight, 0.3, 1.6);
    k.uChurnRope.value.set(0, t, invHeight, 0);
    // The bell widens with the funnel's contact rather than in proportion to it
    // (see wedgeSkirtScale), and does it through the mesh scale so its own
    // per-vertex churn is untouched.
    const skirtSpread = (0.85 + stormFactor * 0.4) * wedgeSkirtScale() * (S.Vortex.birthSpread || 1);
    S.Vortex.skirtMesh.scale.set(skirtSpread, 0.8 + stormFactor * 0.45, skirtSpread);
    S.Vortex.skirtMesh.material.opacity = (0.45 + stormFactor * 0.4) * S.Vortex.groundPresence;
    const skirtMap = S.Vortex.skirtMesh.material.map;
    skirtMap.offset.x += dt * (0.08 + p.rotationSpeed * 0.05);
    skirtMap.offset.y -= dt * (0.25 + windFactor * 0.35);

    api.applyFlash();
  }

  return { birthShape, funnelProfile, funnelRadiusAt, coneRadiusAt, wedgeFactorAt, wedgeRatioAt, wedgeSkirtScale, updateFunnelGeometry };
}
