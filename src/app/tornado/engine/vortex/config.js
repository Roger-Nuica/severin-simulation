import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION V.0 — The funnel's tunables
 * ===========================================================================
 * Every number a tornado's funnel is tuned by: its birth, its mesh, the
 * core, the dirt skirt, the swirl and dust, the satellite funnels, the
 * lightning flash and the fire and electric glows.
 */

/**
 * The touchdown: there is no tornado at all before Start, and pressing it
 * brings one down out of the cloud and grows it to full size over `seconds`
 * (tornadoEngine.js advances Vortex.birth; birthShape() below turns it into
 * what is drawn).
 */
export const BIRTH = {
  seconds: 5,
  // Fraction of the birth spent lowering the rope to the ground. The rest is
  // the funnel swelling out to its full width.
  dropEnd: 0.32,
  // Width of the rope as it comes down, as a fraction of the full funnel.
  ropeWidth: 0.07,
  // How long (as a fraction of the birth) the touchdown shock throws the
  // dust ring out wide, and how wide: a multiple of its normal spread.
  shockSpan: 0.22,
  shockSpread: 2.6,
  // Seconds to wither back up if the storm stands down without a Reset
  // (e.g. Possess mode switched off before Start was ever pressed).
  retractSeconds: 1.2
};

/**
 * Funnel mesh resolution. Raised from 28 x 48 when the third (finest)
 * turbulence octave went in: that octave's wavelength is only a couple of
 * units, and on the coarser lathe it aliased into flat facets instead of
 * reading as ragged detail. About 2.1x the vertices; measured cost below.
 */
// How much the funnel's churn is damped towards the top, as a fraction of
// the displacement at the ground (see updateFunnelGeometry).
export const FUNNEL_HEIGHT_DAMP = 0.4;
// The sub-vortices' churn safety rail (see updateSubVortices).
export const SUB_CLAMP = [0.35, 1.7];
export const FUNNEL_HEIGHT_STEPS = 40;
export const FUNNEL_RADIAL_SEGMENTS = 64;

/**
 * The dense inner core column (see initVortex): a narrower, darker lathe
 * inside the translucent funnel, so the tornado reads as having mass.
 */
export const CORE = {
  heightSteps: 16,
  radialSegments: 24,
  baseRadiusFactor: 0.62,  // of Vortex.baseRadius
  topRadiusFactor: 0.42,   // of Vortex.topRadius
  groundTint: 0x2a241e,
  upperTint: 0x3a4048
};

/**
 * The ground debris skirt (see initVortex): a squat, churning bell of
 * dirt around the funnel's base, wider and denser than the funnel above
 * it, fading into the funnel wall by SKIRT.top.
 */
export const SKIRT = {
  top: 11,                 // world units (unscaled) at which it has fully merged into the funnel
  heightSteps: 12,
  radialSegments: 64,
  flare: 6,                // extra radius at ground level beyond the funnel's own
  groundTint: 0xb39b78,
  upperTint: 0xc4b89e
};

/**
 * Lightning flash on the funnel (see onLightningStrike): strikes within
 * FLASH.reach of the funnel light its surface briefly, via emissive.
 */
export const FLASH = {
  reach: 80,               // world units from the funnel's axis
  decay: 7,                // 1/s exponential fade
  colour: 0xc9d8ff,
  // Emissive intensity at a full, point-blank flash. Lowered from 1.9:
  // the whole funnel glowing HDR-white was one of the larger layers of
  // the near-white blowout on close strikes (Instrucțiunea HH).
  gain: 1.1
};

/**
 * Keeping the funnel readable against the storm (Instrucțiunea HH).
 * The scene's night fog swallowed it: at EF5 density a funnel 190 units
 * away kept about 3% of its own colour and was indistinguishable from
 * the fog-coloured sky, while the clouds (which ignore the scene fog)
 * stayed crisp. Funnel surfaces therefore see the fog at a fraction of
 * its density -- the funnel is a huge, dense column, and real ones do
 * stay visible through rain further than the houses in front of them.
 * A cool fresnel rim on the main funnel separates its silhouette from a
 * similarly coloured sky at night; by day the darker funnel tone
 * (dayNight.js) already does that.
 */
export const FUNNEL_LOOK = {
  fogScale: 0.45,
  rimColour: new THREE.Color(0xa9bdd8),
  rimNight: 0.45,          // rim brightness at night; dayNight.js fades it out by day
  rimPower: 2.4,
  rimAlpha: 0.35           // extra opacity at the silhouette edge
};

/**
 * The debris swirl inside the funnel (Instrucțiunea LL). It used to
 * respawn within the base radius and barely drift outwards, which left a
 * tight, uniform, bright-white beam up the axis that read as a separate
 * object from the grey shell around it. Particles now live at a fraction
 * of the funnel's own radius -- spread across it, denser towards the
 * shell and faint at the very core -- each with its own size, brightness
 * and rise speed, tinted to the shell's warm grey.
 */
export const SWIRL = {
  tint: new THREE.Color(0xc4bdb1),
  opacity: 0.6,
  size: 0.75,
  fractionMin: 0.08,       // of the funnel radius at a particle's height
  fractionMax: 0.95,
  wobble: 0.16,            // radial breathing, as a fraction of radius
  coreFade: [0.12, 0.5],   // fraction range over which particles fade in from the axis
  topFade: [0.78, 1.0]     // height fraction range over which they fade out at the top
};

/**
 * A lowering "wall cloud" collar of large soft puffs around the funnel's
 * top (Instrucțiunea LL), so it dissolves up into a cloud base instead of
 * ending in a flat rim with open sky above it. Coloured from the low cloud
 * layer's live belly colour, so it matches the sky night and day.
 */
export const CROWN = {
  // Many large, faint, overlapping puffs rather than fewer opaque ones:
  // against a bright day sky individual puffs read as dark blobs.
  count: 380,
  heightRange: [36, 70],
  radiusRange: [0.45, 2.3],  // of Vortex.topRadius
  size: 15,
  opacity: 0.38,
  spin: 0.08                 // rad/s at rotation speed 1
};

/**
 * Firenado burn on the funnel (engine/firenado.js): an amber emissive
 * glow and a warm tint on the swirl particles, added on top of the
 * lightning flash in applyFlash.
 */
export const FIRE_GLOW = {
  // Amber rather than red-orange: a strong red-orange glow over the pale
  // shell mixed to salmon pink rather than reading as fire.
  colour: new THREE.Color(0xff8a22),
  gain: 1.25,
  swirlTint: new THREE.Color(0xffb35c)
};
// The Electric Tornado's glow (Vortex.electric, see applyFlash).
export const ELECTRIC_GLOW = {
  colour: new THREE.Color(0x2f7dff),
  gain: 0.55,
  swirlTint: new THREE.Color(0x9fd4ff)
};
// The Blizzard (engine/blizzard.js): an icy white-blue glow and a pale swirl.
export const ICE_GLOW = {
  colour: new THREE.Color(0x9fdcff),
  gain: 0.45,
  swirlTint: new THREE.Color(0xe8f6ff)
};
export const WHITE = new THREE.Color(0xffffff);

/** Scratch vector reused by updateSubVortices' lean calculation, so the
 *  per-frame loop never allocates. */
export const SUB_LEAN_AXIS = new THREE.Vector3();

/**
 * Ground-wander tuning (see updateVortexVisuals). Ground speed, simulated
 * over 4 seeds x 20 minutes: median 6.3 / 8.8 / 10.1 units/s at intensity
 * 0.3 / 0.75 / 1.0 (was 2.4 at any intensity), with surges up to the cap
 * (13.1 / 16.3 / 18.0).
 */
export const WANDER = {
  radius: 52,            // town-crossing path; + meanderRadius stays within the built-up +-88
  meanderRadius: 10,
  rateBase: 2.1,         // phase-rate multiplier at intensity 0...
  rateIntensity: 2.3,    // ...plus this much more at intensity 1
  surgeRate: 0.23,       // rad/s of the slow speed-up/slow-down cycle
  surgeBase: 0.85,
  surgeSwing: 0.25,
  surgeFlicker: 0.12,
  // Ground-speed cap, units/s: at intensity 0 this is maxSpeedBase, rising
  // to maxSpeedBase + maxSpeedIntensity at intensity 1. Both raised x1.5
  // (was 11/7, so 0..18) on request for a faster-moving storm; this now
  // tops out at 27, past the chase car's own 22 (CHASE_TUNE.maxSpeed in
  // chase/car.js), so an EF5-intensity sandbox tornado can outrun the chase
  // car at full tilt where it previously could not quite catch it. Chase
  // Mode's own difficulty ramp (chase/drive.js) does not necessarily reach
  // intensity 1, so this may or may not actually bite there -- flagged
  // rather than silently left for whoever tunes that balance next.
  maxSpeedBase: 16.5,
  maxSpeedIntensity: 10.5
};

/**
 * What a Fujiwhara merge (engine/fujiwhara.js) makes of the surviving
 * funnel: wider and taller than the Radius slider's maximum allows, with
 * more swirl and dust particles than any single tornado gets. The extra
 * particle buffers are allocated up front for every instance (a merge can
 * leave any of them standing) and simply not drawn until then.
 */
export const MONSTER = {
  particleMul: 1.6,
  dustMul: 1.5,
  wobbleBoost: 2.5         // extra swirl breathing at full agitation
};

/**
 * What an EF5 wedge (engine/wedge.js) makes of the funnel's silhouette.
 * Scale alone is not a wedge: multiplying a cone by four gives a very large
 * cone, still standing on a narrow point, and the thing that makes a wedge
 * read as a wedge is that it has no point -- it is as wide where it meets
 * the ground as it is anywhere else, a moving wall rather than a funnel.
 *
 * So the shape is filled in rather than scaled: wedgeFactorAt() blends every
 * height of the profile from the cone's own radius towards the radius of a
 * straight column, which is why the widening is enormous at the contact (six
 * and a half times, where the cone is at its narrowest) and nothing at all
 * at the top (where the cone is already that wide). `taper` leaves the column
 * slightly narrower at the ground than aloft, since a wedge still leans out
 * as it rises -- it is a wall, not a pipe.
 *
 * Applied to the funnel, the dense core and the swirl particles, so every
 * part of the tornado agrees about where its wall is -- including the systems
 * that ask for that wall by name (the Firenado's flames, the Lavanado's rock,
 * the ground fire's spread). The dirt skirt is the exception: it is not a
 * scaled copy of the funnel profile but a much wider bell built around it, so
 * multiplying it by the funnel's ratio would put a dust cloud five times the
 * size of the town around the base. It widens by the funnel's *absolute*
 * gain instead, through its own mesh scale (see wedgeSkirtScale).
 */
export const WEDGE = {
  taper: 0.82
};

// Outbreak tornadoes start at least this far (world units) from every
// other active one, so they read as separate storms from the outset.
export const START_SEPARATION = 70;
export const START_SEED_ATTEMPTS = 40;

// Co-op guest: a remote funnel (vortex.js `remote`) at or past this size draws
// the full "monster" particle budget (the host's merge or wedge sets it there).
export const REMOTE_MONSTER_AT = 1.3;
