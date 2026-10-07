import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { installChurn } from './funnelChurn.js';
import { createFunnelBandTexture, createSoftDotTexture } from '../utils/textures.js';
import { BIRTH, SUB_CLAMP, FUNNEL_HEIGHT_STEPS, FUNNEL_RADIAL_SEGMENTS, CORE, SKIRT, FLASH, FUNNEL_LOOK, SWIRL, CROWN, WANDER, MONSTER, START_SEPARATION, START_SEED_ATTEMPTS, REMOTE_MONSTER_AT } from './vortex/config.js';
import { createVortexLook } from './vortex/look.js';
import { createVortexShape } from './vortex/shape.js';
import { createSubVortices } from './vortex/subVortices.js';
import { createVortexParticles } from './vortex/particles.js';
import { fullHealth } from './health/enemyDamage.js';
export { BIRTH } from './vortex/config.js';

/**
 * ===========================================================================
 * SECTION C — Vortex system: visuals
 * ===========================================================================
 */

/*
 * Split by job across engine/vortex/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js       every tunable
 *   look.js         the funnel's materials, shading and glows
 *   shape.js        its profile, the wedge, and the churn's numbers
 *   subVortices.js  the satellite funnels
 * and this file: building a funnel, where it goes, and the frame, with
 * the shared state S and the modules' functions in `api`.
 */

/**
 * Builds one tornado. Called once per tornado the simulator can show (see
 * engine/tornadoes.js): every call has its own state, meshes, particles,
 * sub-vortex pool and wander path, and nothing in here is shared between
 * instances.
 * @param {Object} ctx
 * @param {{index?: number, detail?: number}} [options]
 *   index: 0 is the primary tornado -- published as ctx.Vortex and always
 *   active; the others start hidden and inactive until an Outbreak.
 *   detail: 0..1 scale on particle counts and the sub-vortex pool, so the
 *   extra tornadoes of an Outbreak can be cheaper than the primary.
 * @returns {{
 *   Vortex: Object,
 *   initVortex: () => void,
 *   setActive: (on: boolean, others: Object[]) => void,
 *   setRemote: (remote: Object|null) => void,
 *   updateFunnelGeometry: (dt: number, t: number) => void,
 *   updateSubVortices: (dt: number, t: number) => void,
 *   applySubVortexForce: (pos: THREE.Vector3, velocity: THREE.Vector3, dt: number) => void,
 *   updateVortexVisuals: (dt: number, t: number) => void,
 *   onLightningStrike: (end: THREE.Vector3, power: number) => void,
 *   funnelRadiusAt: (y: number) => number,
 *   clearMergeState: () => void
 * }}
 */
export function createVortexSystem(ctx, { index = 0, detail = 1 } = {}) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S. Filled in the order it was declared, since
  // later values are made from earlier ones.
  const S = { index, detail };
  S.primary = S.index === 0;

  /**
   * Satellite sub-vortex tuning. A violent tornado frequently breaks its
   * single circulation into several smaller ones that orbit the parent's
   * footprint — the "multi-vortex" structure responsible for the narrow
   * streaks of extreme damage inside an otherwise uniform swathe. These
   * constants describe that structure relative to the main funnel so a
   * change to Vortex.height/topRadius carries through automatically.
   */
  S.SUB = {
    // Switched off for now, on request: at EF4 and up these satellites came
    // and went round the funnel every few seconds, glowing like fire when it
    // burned, and read as a stray mini fire tornado popping in from nowhere.
    // Nothing is removed; true brings them back.
    enabled: false,
    max: Math.max(1, Math.round(5 * S.detail)), // hard cap on simultaneous sub-vortices
    sizeFactor: 0.4,        // baseline fraction of the main funnel's radius/height (combines
                             // with spawnSubVortex's per-instance sizeMul for an overall ~35-50% band)
    heightSteps: 12,        // lathe resolution; deliberately coarser than the main funnel's 28...
    radialSegments: 20,     // ...and 48 -- kept low even at the larger size budget below, since
                             // segment count (not scale) is what the per-vertex noise pass costs
    // EF4 starts at intensity 4/6 = 0.667 (see setStat('s-intensity', ...) in ui.js), so gateLow
    // sits just below that: a default EF4 run (intensity 0.75) already has satellites, and by the
    // EF4/EF5 boundary (0.833) the pool is nearly saturated rather than only reaching full count
    // at the very top of the intensity slider.
    gateLow: 0.62,           // intensity at which sub-vortices first appear at all
    gateHigh: 0.95,          // intensity at which they are continuous and at full count
    lifeMin: 3,             // seconds
    lifeMax: 8,
    fadeIn: 0.6,            // seconds of grow/fade at birth
    fadeOut: 1.2            // seconds of shrink/fade at death
  };
  S.emissiveScratch = new THREE.Color();
  S.Vortex = {
    index: S.index,
    // Whether this tornado is in play: the primary always is; the others
    // only during an Outbreak (see setActive).
    active: S.primary,
    center: new THREE.Vector3(0, 0, 0),
    wanderSeed: Math.random() * 1000,
    // Accumulated wander phase and its speed multiplier -- see the wander
    // block in updateVortexVisuals for why the phase is integrated via dt
    // rather than derived from elapsed time directly. wanderSpeedMul is set
    // by Chase Mode's difficulty ramp (engine/chase/drive.js) and left at
    // its default of 1 (a no-op) everywhere else.
    wanderPhaseX: 0,
    wanderPhaseZ: 0,
    // Faster, smaller meander layered on the town-crossing path, and the
    // phase of the slow surge that makes the pace lurch (see WANDER).
    meanderPhaseX: 0,
    meanderPhaseZ: 0,
    surgePhase: 0,
    wanderSpeedMul: 1,
    // A point the tornado is hunting towards, overriding its wander path
    // while set (engine/hunt.js). null means it wanders as it always did.
    huntTarget: /** @type {{x: number, z: number}|null} */ (null),
    // A point the player is steering towards (engine/possess.js), overriding
    // both the wander path and a hunt while set -- see the priority order in
    // updateVortexVisuals's wander block below. null means nobody is driving.
    controlTarget: /** @type {{x: number, z: number}|null} */ (null),
    // Extra multiplier on the ground-speed cap the wander block chases its
    // target at (see WANDER.maxSpeedBase/maxSpeedIntensity below), written by
    // engine/possess.js while it is active and left at 1 (a no-op) otherwise
    // -- direct control is meant to feel snappier than the AI's own pace.
    controlSpeedMul: 1,
    // Whether center has been placed yet; the first frame snaps to the
    // wander target instead of travelling there from the origin.
    wanderPlaced: false,
    height: 46,
    baseRadius: 3,
    topRadius: 16,
    group: /** @type {THREE.Group|null} */ (null),
    funnelMesh: /** @type {THREE.Mesh|null} */ (null),
    coreMesh: /** @type {THREE.Mesh|null} */ (null),
    skirtMesh: /** @type {THREE.Mesh|null} */ (null),
    // The three shells' churn uniforms (funnelChurn.js), set every frame by
    // updateFunnelGeometry.
    funnelChurn: /** @type {import('./funnelChurn.js').ChurnUniforms|null} */ (null),
    coreChurn: /** @type {import('./funnelChurn.js').ChurnUniforms|null} */ (null),
    skirtChurn: /** @type {import('./funnelChurn.js').ChurnUniforms|null} */ (null),
    // Rest radius of the skirt bell where it meets the ground, measured off the
    // profile initVortex builds it from and read back by wedgeSkirtScale.
    skirtBaseRadius: 1,
    // Lightning flash on the funnel surface (see onLightningStrike): the
    // current 0..1 brightness, and the peak and time (s) it fades from.
    flash: 0,
    flashPeak: 0,
    flashTime: -1e9,
    // 0..1 Firenado burn on the funnel surface, written each frame by
    // engine/firenado.js and applied with the lightning flash (applyFlash).
    fire: 0,
    // Rim-light strength on the main funnel (see FUNNEL_LOOK), shared by
    // reference with its shader.
    rim: { value: FUNNEL_LOOK.rimNight },
    noise: /** @type {SimplexNoise|null} */ (null),
    particles: /** @type {THREE.Points|null} */ (null),
    // Per swirl particle: radial fraction, angle, height, rise multiplier,
    // wobble phase, base alpha (see SWIRL).
    particleData: /** @type {Float32Array|null} */ (null),
    crown: /** @type {THREE.Points|null} */ (null),
    crownData: /** @type {Float32Array|null} */ (null),
    particleCount: Math.round(4200 * S.detail),
    particleCapacity: Math.round(4200 * S.detail * MONSTER.particleMul),
    dustRing: /** @type {THREE.Points|null} */ (null),
    dustRingData: /** @type {Float32Array|null} */ (null),
    // Raised from 900 alongside the solid skirt mesh: the base now reads as
    // a debris cloud, and the extra particles are what break up its edge.
    dustCount: Math.round(1300 * S.detail),
    dustCapacity: Math.round(1300 * S.detail * MONSTER.dustMul),
    // Height of the ground dust skirt. Taller than the old flat 2.5m band so
    // the skirt actually overlaps the lower funnel instead of hugging the turf
    // beneath it (see the dust boil-up in updateVortexVisuals).
    dustTop: 7,
    // Per-height rope-out multipliers, rebuilt each frame in
    // updateFunnelGeometry. One entry per lathe height step rather than one
    // per vertex: every vertex at a given height shares the same pinch/flare,
    // so this turns ~1400 sine pairs per frame into 29.
    // Fixed-size pool of satellite sub-vortices (see SUB above and
    // updateSubVortices). Allocated once at init and recycled, so spawning
    // one costs nothing but a handful of field writes — no geometry,
    // material or texture is created while the simulation runs.
    subVortices: /** @type {Object[]} */ ([]),
    subSpawnTimer: 0,
    subBandTexture: /** @type {THREE.Texture|null} */ (null),
    // Fujiwhara merge state, written by engine/fujiwhara.js and at rest
    // (a no-op) otherwise. sizeMul scales the funnel and its capture reach
    // (forces.js, physics.js) past the Radius slider; fade takes a funnel
    // being absorbed down to nothing; agitation (0..1) and leanX/leanZ
    // (radians) are the binary orbit's extra churn and tilt; pinned hands
    // the ground position to the merge instead of the wander path; monster
    // draws the extra particles allocated for a merged survivor.
    sizeMul: 1,
    // Health (health/damageTable.js): chipped by Roger's weapons other than the
    // katana, 0 neutralises it like a MEGA BEAM; a Fujiwhara merge keeps one value.
    health: fullHealth('tornado'),
    // 0..1 wedge blend, written by engine/wedge.js and 0 (a no-op) otherwise:
    // how far the funnel's silhouette has been squared off into a wedge (see
    // WEDGE and wedgeFactorAt). Independent of sizeMul, which is how *big*
    // the funnel is rather than what shape it holds.
    wedge: 0,
    fade: 1,
    // 0..1 touchdown ("birth") progress, advanced by tornadoEngine.js from
    // the moment a run starts (see BIRTH, top of this file): 0 is no tornado at all --
    // the calm town before Start -- and 1 is the fully grown funnel. Read by
    // forces.js and physics.js as well, so a funnel still roping down out of
    // the cloud cannot already be lifting cars.
    birth: 0,
    // What birth actually shows this frame, derived in updateVortexVisuals:
    // opacity for the parts hanging off the cloud (funnel, core, crown,
    // swirl) and for the ground-hugging ones, which only appear once the rope
    // has touched down.
    presence: 0,
    groundPresence: 0,
    // How far the dust ring and skirt are held out past the funnel's own
    // footprint while it is being born (1 once it is grown).
    birthSpread: 1,
    // 0..1 Electric Tornado charge, written by engine/electricStorm.js while
    // the mode is on: a cold blue glow from inside the column (applyFlash).
    electric: 0,
    // 0..1 Blizzard (engine/blizzard.js): an icy glow and a pale swirl.
    ice: 0,
    agitation: 0,
    leanX: 0,
    leanZ: 0,
    pinned: false,
    monster: false,
    // Co-op guest only (net/system.js, net/funnelMirror.js): the host's funnel
    // as this screen draws it ({x, z, radius, birth, sizeMul, fade, leanX,
    // leanZ}), or null, which is every funnel of a single-player run and of the
    // host. While set, updateVortexVisuals draws from it instead of wandering,
    // and `birth` (what every gameplay reader sees) stays 0, so the force
    // field, capture, damage and hero daze find no tornado here: it is a
    // picture of the host's.
    remote: /** @type {null|{x: number, z: number, radius: number, birth: number, sizeMul: number, fade: number, leanX: number, leanZ: number}} */ (null)
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createVortexLook(ctx, S, api),
    createVortexShape(ctx, S, api),
    createSubVortices(ctx, S, api),
    createVortexParticles(ctx, S, api),
    { spawnFraction }
  );

  if (S.primary) ctx.Vortex = S.Vortex;

  /**
   * A new swirl particle's radial fraction: spread across the funnel,
   * weighted towards the shell (sqrt of a uniform) so the core stays thin.
   * @returns {number}
   */
  function spawnFraction() {
    return SWIRL.fractionMin + (SWIRL.fractionMax - SWIRL.fractionMin) * Math.sqrt(Math.random());
  }

  /** @returns {void} */
  function initVortex() {
    const group = new THREE.Group();
    group.name = S.primary ? 'tornado' : `tornado_${S.index}`;
    group.visible = S.Vortex.active;

    // Resolution is high enough (see FUNNEL_HEIGHT_STEPS) that the per-vertex
    // noise turbulence applied in updateFunnelGeometry() reads as organic
    // motion rather than faceting, down to the finest octave.
    const segments = FUNNEL_HEIGHT_STEPS;
    const points = api.funnelProfile(S.Vortex.height, S.Vortex.baseRadius, S.Vortex.topRadius, 0.4, segments);
    const funnelGeo = new THREE.LatheGeometry(points, FUNNEL_RADIAL_SEGMENTS);

    // A real funnel is condensed, dirt-stained and near-opaque where it
    // scours the ground, and thins to a translucent wisp as it stretches up
    // into the wall cloud; a single uniform material opacity cannot express
    // that, so the alpha channel carries the density ramp and the RGB
    // channels carry a warm dust tint that fades out above the contact zone.
    api.bakeFunnelDensity(funnelGeo, S.Vortex.height);

    const bandTexture = createFunnelBandTexture();
    const funnelMat = new THREE.MeshStandardMaterial({
      // White, because the funnel's actual colouring now comes from the
      // per-vertex tint above — material.color multiplies it, so anything
      // other than white would double-darken the profile.
      color: 0xffffff,
      vertexColors: true,
      map: bandTexture,
      alphaMap: bandTexture,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 1,
      blending: THREE.NormalBlending,
      // Lit up by nearby lightning (see onLightningStrike).
      emissive: new THREE.Color(FLASH.colour),
      emissiveIntensity: 0
    });

    // Dense inner core: a narrower, darker, more opaque column, seen through
    // the translucent outer funnel so the tornado has depth and mass rather
    // than reading as a hollow shell. All three shells (core, funnel, skirt)
    // share the group's origin, so the renderer's back-to-front sort ties on
    // them and falls back to creation order: core first, then the funnel
    // veiled over it, then the skirt over the funnel's base.
    const coreGeo = new THREE.LatheGeometry(
      api.funnelProfile(
        S.Vortex.height * 0.96, S.Vortex.baseRadius * CORE.baseRadiusFactor,
        S.Vortex.topRadius * CORE.topRadiusFactor, 0.25, CORE.heightSteps
      ),
      CORE.radialSegments
    );
    api.bakeShellGradient(coreGeo, S.Vortex.height, CORE.groundTint, CORE.upperTint, hT => (1 - 0.55 * hT) * (1 - THREE.MathUtils.smoothstep(hT, 0.55, 0.92)));
    const coreMesh = new THREE.Mesh(coreGeo, api.createShellMaterial(bandTexture));
    coreMesh.name = 'tornadoCore';
    group.add(coreMesh);

    api.applyFunnelLook(funnelMat, S.Vortex.rim);
    api.applyFunnelLook(coreMesh.material, null);
    const funnelMesh = new THREE.Mesh(funnelGeo, funnelMat);
    funnelMesh.name = 'tornadoFunnel';
    group.add(funnelMesh);

    // Ground debris skirt: a squat bell of dirt, a good deal wider than the
    // funnel at the ground and closing onto the funnel wall by SKIRT.top, so
    // the base reads wider and messier than the funnel body above it.
    const skirtPoints = [];
    for (let i = 0; i <= SKIRT.heightSteps; i++) {
      const u = i / SKIRT.heightSteps;
      const y = u * SKIRT.top;
      skirtPoints.push(new THREE.Vector2(api.coneRadiusAt(y) * 1.06 + SKIRT.flare * Math.pow(1 - u, 1.7), y));
    }
    // Kept for wedgeSkirtScale: how wide the bell rests at the ground, which is
    // what the wedge's absolute widening has to be measured against.
    S.Vortex.skirtBaseRadius = skirtPoints[0].x;
    const skirtGeo = new THREE.LatheGeometry(skirtPoints, SKIRT.radialSegments);
    api.bakeShellGradient(skirtGeo, SKIRT.top, SKIRT.groundTint, SKIRT.upperTint, hT => Math.pow(1 - hT, 0.8));
    const skirtMat = api.createShellMaterial(bandTexture);
    // Streaked by the band texture's colour but not cut up by it as an
    // alpha mask the way the funnel veil is: the skirt is solid churned
    // dirt, and with the mask it read as a faint wisp against the ground.
    skirtMat.alphaMap = null;
    api.applyFunnelLook(skirtMat, null);
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.name = 'tornadoSkirt';
    group.add(skirtMesh);

    const dotTexture = createSoftDotTexture();

    // Debris/dust swirling within the funnel volume (see SWIRL). Allocated
    // at monster capacity; only particleCount of them are drawn normally.
    const count = S.Vortex.particleCapacity;
    const positions = new Float32Array(count * 3);
    const data = new Float32Array(count * 6);
    const colours = new Float32Array(count * 4);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      data[i * 6] = spawnFraction();
      data[i * 6 + 1] = Math.random() * Math.PI * 2;
      data[i * 6 + 2] = Math.random() * S.Vortex.height;
      data[i * 6 + 3] = 0.55 + Math.random() * 0.9;
      data[i * 6 + 4] = Math.random() * Math.PI * 2;
      data[i * 6 + 5] = 0.3 + Math.random() * 0.7;
      // Brightness varies per particle; alpha is rewritten every frame.
      const shade = 0.55 + Math.random() * 0.45;
      colours[i * 4] = SWIRL.tint.r * shade;
      colours[i * 4 + 1] = SWIRL.tint.g * shade;
      colours[i * 4 + 2] = SWIRL.tint.b * shade;
      sizes[i] = 0.45 + Math.pow(Math.random(), 2) * 1.6;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colours, 4));
    particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const particleMat = new THREE.PointsMaterial({
      color: 0xffffff,
      vertexColors: true,
      size: SWIRL.size,
      map: dotTexture,
      alphaMap: dotTexture,
      transparent: true,
      opacity: SWIRL.opacity,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    api.applyFunnelLook(particleMat, null, true);
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.name = 'particleSwirl';
    group.add(particles);

    // Wall-cloud collar (see CROWN): static puff layout in the group's
    // frame, turned slowly as a whole; alpha per puff fades towards its
    // outer edge and its underside so it wisps into the funnel and the sky.
    const crownPos = new Float32Array(CROWN.count * 3);
    const crownColours = new Float32Array(CROWN.count * 4);
    const crownSizes = new Float32Array(CROWN.count);
    const crownData = new Float32Array(CROWN.count);
    for (let i = 0; i < CROWN.count; i++) {
      const u = Math.random();
      const radial = THREE.MathUtils.lerp(CROWN.radiusRange[0], CROWN.radiusRange[1], Math.sqrt(u));
      const angle = Math.random() * Math.PI * 2;
      const hU = Math.random();
      const h = THREE.MathUtils.lerp(CROWN.heightRange[0], CROWN.heightRange[1], hU);
      // Wider higher up: a cloud base spreading out over the funnel.
      const r = radial * S.Vortex.topRadius * (0.55 + 0.6 * hU);
      crownPos[i * 3] = Math.cos(angle) * r;
      crownPos[i * 3 + 1] = h;
      crownPos[i * 3 + 2] = Math.sin(angle) * r;
      const edge = 1 - THREE.MathUtils.smoothstep(radial, 1.2, CROWN.radiusRange[1]);
      const underside = THREE.MathUtils.smoothstep(hU, 0, 0.35);
      crownData[i] = (0.35 + 0.65 * Math.random()) * edge * underside;
      // White: the material colour carries the cloud tint (see the update).
      crownColours[i * 4] = 1;
      crownColours[i * 4 + 1] = 1;
      crownColours[i * 4 + 2] = 1;
      crownColours[i * 4 + 3] = crownData[i];
      crownSizes[i] = 0.6 + Math.random() * 0.9;
    }
    const crownGeo = new THREE.BufferGeometry();
    crownGeo.setAttribute('position', new THREE.BufferAttribute(crownPos, 3));
    crownGeo.setAttribute('color', new THREE.BufferAttribute(crownColours, 4));
    crownGeo.setAttribute('aSize', new THREE.BufferAttribute(crownSizes, 1));
    const crownMat = new THREE.PointsMaterial({
      color: 0xffffff,
      vertexColors: true,
      size: CROWN.size,
      map: dotTexture,
      alphaMap: dotTexture,
      transparent: true,
      opacity: CROWN.opacity,
      depthWrite: false
    });
    api.applyFunnelLook(crownMat, null, true);
    const crown = new THREE.Points(crownGeo, crownMat);
    crown.name = 'tornadoCrown';
    // Tinted just before each draw rather than in updateVortexVisuals,
    // which does not run while the simulation is paused: switching to Day
    // Mode while paused otherwise left the collar in its night colour, dark
    // grey smoke against the blue sky.
    crown.onBeforeRender = api.tintCrown;
    group.add(crown);
    S.Vortex.crown = crown;
    S.Vortex.crownData = crownData;

    // Ground-level dust skirt ring. Driven by the same per-particle
    // angle/height integration as the main swirl (see updateVortexVisuals),
    // rather than relying on rotating the Points object itself.
    const dustCount = S.Vortex.dustCapacity;
    const dustPos = new Float32Array(dustCount * 3);
    const dustData = new Float32Array(dustCount * 3); // r, angle, height
    for (let i = 0; i < dustCount; i++) {
      const r = S.Vortex.baseRadius + Math.random() * S.Vortex.topRadius * 1.7;
      const angle = Math.random() * Math.PI * 2;
      const h = Math.random() * S.Vortex.dustTop;
      dustData[i * 3] = r;
      dustData[i * 3 + 1] = angle;
      dustData[i * 3 + 2] = h;
      dustPos[i * 3] = Math.cos(angle) * r;
      dustPos[i * 3 + 1] = h;
      dustPos[i * 3 + 2] = Math.sin(angle) * r;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xb9a887,
      size: 0.8,
      map: dotTexture,
      alphaMap: dotTexture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    const dustRing = new THREE.Points(dustGeo, dustMat);
    dustRing.name = 'dustRing';
    group.add(dustRing);

    // --- Satellite sub-vortex pool -----------------------------------------
    // Every sub-vortex is a child of the tornado group, which means it
    // inherits the funnel's ground position and its (scale, 1, scale)
    // horizontal scaling for free: orbit radii below are therefore expressed
    // in the same unscaled local units as Vortex.baseRadius/topRadius and
    // automatically track the "Tornado Radius" slider.
    //
    // The band texture is cloned rather than shared so the sub-vortices can
    // scroll their bands faster than the parent (a small funnel spins up
    // quicker); a clone shares the underlying image source, so this costs one
    // extra sampler rather than a second texture upload. All three meshes
    // share that one clone but need individual materials, because their
    // opacities differ as each fades independently through its own lifecycle.
    const subHeight = S.Vortex.height * S.SUB.sizeFactor;
    const subBandTexture = bandTexture.clone();
    subBandTexture.needsUpdate = true;
    const subPoints = api.funnelProfile(
      subHeight,
      S.Vortex.baseRadius * S.SUB.sizeFactor,
      S.Vortex.topRadius * S.SUB.sizeFactor,
      0.4 * S.SUB.sizeFactor,
      S.SUB.heightSteps
    );
    for (let i = 0; i < S.SUB.max; i++) {
      const geo = new THREE.LatheGeometry(subPoints, S.SUB.radialSegments);
      api.bakeFunnelDensity(geo, subHeight);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        map: subBandTexture,
        alphaMap: subBandTexture,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        roughness: 1,
        blending: THREE.NormalBlending,
        emissive: new THREE.Color(FLASH.colour),
        emissiveIntensity: 0
      });
      api.applyFunnelLook(mat, null);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `subVortex${i}`;
      const churn = installChurn(mesh);
      churn.uChurnShape.value.set(0, 0, SUB_CLAMP[0], SUB_CLAMP[1]);
      mesh.visible = false;
      group.add(mesh);
      S.Vortex.subVortices.push({
        mesh,
        churn,
        active: false,
        age: 0,
        life: 0,
        angle: 0,          // position around the main funnel's footprint, radians
        orbitRate: 1,      // per-instance multiplier on the shared orbital speed
        orbitRadius: 0,    // local units from the main axis
        sizeMul: 1,        // per-instance size variation on top of SUB.sizeFactor
        lean: 0,           // radians of outward tilt, for the "flung out" look
        spinRate: 1,       // per-instance multiplier on the noise frame's spin
        noiseSeed: 0,      // keeps two simultaneous sub-vortices from writhing identically
        worldX: 0,         // cached each frame for applySubVortexForce
        worldZ: 0,
        worldHeight: 0,
        forceRadius: 0
      });
    }

    Sim.three.scene.add(group);

    S.Vortex.group = group;
    S.Vortex.funnelMesh = funnelMesh;
    // The churn of all three shells, on the graphics card (funnelChurn.js).
    // The dirt skirt is widened by its own mesh scale in a wedge, not per
    // height (see wedgeSkirtScale).
    S.Vortex.funnelChurn = installChurn(funnelMesh, api.wedgeRatioAt);
    S.Vortex.coreChurn = installChurn(coreMesh, api.wedgeRatioAt);
    S.Vortex.skirtChurn = installChurn(skirtMesh);
    S.Vortex.coreMesh = coreMesh;
    S.Vortex.skirtMesh = skirtMesh;
    S.Vortex.noise = new SimplexNoise();
    S.Vortex.particles = particles;
    S.Vortex.particleData = data;
    S.Vortex.dustRing = dustRing;
    S.Vortex.dustRingData = dustData;
    S.Vortex.subBandTexture = subBandTexture;
  }

  /**
   * The wander path's current target point for a given seed (see the
   * wander block in updateVortexVisuals).
   * @param {number} seed
   * @returns {{x: number, z: number}}
   */
  function wanderTarget(seed) {
    return {
      x: Math.sin(S.Vortex.wanderPhaseX + seed) * WANDER.radius
        + Math.sin(S.Vortex.meanderPhaseX + seed * 2.3) * WANDER.meanderRadius,
      z: Math.cos(S.Vortex.wanderPhaseZ + seed * 1.7) * WANDER.radius
        + Math.cos(S.Vortex.meanderPhaseZ + seed * 0.7) * WANDER.meanderRadius
    };
  }

  /**
   * Brings an Outbreak tornado into play, or takes it out. On the way in
   * it gets a fresh wander path whose starting point is at least
   * START_SEPARATION from every tornado already running (the best of a
   * few random seeds), and snaps there; its sub-vortices and flash start
   * clean. On the way out it is simply hidden.
   * @param {boolean} on
   * @param {Object[]} others Vortex states of the tornadoes already active
   * @returns {void}
   */
  function setActive(on, others) {
    if (S.primary) return;
    // The guest's mirror owns a remote funnel's presence (setRemote, tornadoes.js syncRemote).
    if (S.Vortex.remote) return;
    S.Vortex.active = on;
    if (S.Vortex.group) S.Vortex.group.visible = on;
    clearMergeState();
    if (!on) return;
    let bestSeed = S.Vortex.wanderSeed;
    let bestGap = -1;
    for (let attempt = 0; attempt < START_SEED_ATTEMPTS; attempt++) {
      const seed = Math.random() * 1000;
      const target = wanderTarget(seed);
      let gap = Infinity;
      for (const other of others) {
        if (other === S.Vortex) continue;
        gap = Math.min(gap, Math.hypot(target.x - other.center.x, target.z - other.center.z));
      }
      if (gap > bestGap) { bestGap = gap; bestSeed = seed; }
      if (gap >= START_SEPARATION) break;
    }
    S.Vortex.wanderSeed = bestSeed;
    // Placed now rather than on its first update, so a tornado switched on
    // straight after this one (setCount) keeps its distance from where
    // this one really starts.
    const start = wanderTarget(bestSeed);
    S.Vortex.center.set(start.x, 0, start.z);
    S.Vortex.wanderPlaced = true;
    if (S.Vortex.group) S.Vortex.group.position.copy(S.Vortex.center);
    S.Vortex.flashPeak = 0;
    for (const sub of S.Vortex.subVortices) {
      sub.active = false;
      sub.mesh.visible = false;
    }
  }

  /**
   * Hands this funnel to the co-op guest's mirror, or takes it back. While
   * `remote` is set the funnel is drawn from it (updateVortexVisuals) and does
   * nothing else: `birth` is held at 0, so nothing in the guest's own town feels
   * it. Either way it ends hidden with a clean merge state; the primary then
   * goes back to its own wander path, an Outbreak extra stays switched off until
   * setActive. The caller (tornadoes.js setRemote) rebuilds the active set.
   * @param {null|{x: number, z: number, radius: number, birth: number, sizeMul: number, fade: number, leanX: number, leanZ: number}} remote
   * @returns {void}
   */
  function setRemote(remote) {
    S.Vortex.remote = remote;
    S.Vortex.birth = 0;
    S.Vortex.wanderPlaced = false;
    clearMergeState();
    if (!S.primary) {
      S.Vortex.active = false;
      if (S.Vortex.group) S.Vortex.group.visible = false;
    }
    S.Vortex.flashPeak = 0;
    for (const sub of S.Vortex.subVortices) {
      sub.active = false;
      sub.mesh.visible = false;
    }
  }

  /**
   * Puts every Fujiwhara merge field back to rest: normal size and particle
   * count, fully visible, upright, back on its wander path.
   * @returns {void}
   */
  function clearMergeState() {
    S.Vortex.sizeMul = 1;
    S.Vortex.huntTarget = null;
    S.Vortex.fade = 1;
    S.Vortex.agitation = 0;
    S.Vortex.leanX = 0;
    S.Vortex.leanZ = 0;
    S.Vortex.pinned = false;
    S.Vortex.monster = false;
  }

  /**
   * Advances the vortex's visual state: slow positional wander, funnel spin,
   * particle swirl, and geometric scaling driven by live parameters.
   * @param {number} dt
   * @param {number} t total elapsed seconds
   * @returns {void}
   */
  function updateVortexVisuals(dt, t) {
    const p = Sim.params;

    // Ground wander. The target point follows two layers of offset sine
    // waves (cheap noise stand-in): a wide town-crossing Lissajous path and a
    // faster, smaller meander on top of it, so the heading keeps changing.
    // Phases are accumulated incrementally (dt * rate) rather than derived
    // from t, so the rate can change frame to frame -- with intensity, the
    // surge, or Chase Mode's wanderSpeedMul ramp (engine/chase/drive.js) --
    // without the position ever snapping.
    S.Vortex.surgePhase += dt * WANDER.surgeRate;
    const surge = WANDER.surgeBase
      + WANDER.surgeSwing * Math.sin(S.Vortex.surgePhase + S.Vortex.wanderSeed)
      + WANDER.surgeFlicker * Math.sin(S.Vortex.surgePhase * 2.71 + S.Vortex.wanderSeed * 0.3);
    const rate = (WANDER.rateBase + WANDER.rateIntensity * p.intensity) * surge * S.Vortex.wanderSpeedMul;
    S.Vortex.wanderPhaseX += dt * 0.05 * rate;
    S.Vortex.wanderPhaseZ += dt * 0.037 * rate;
    S.Vortex.meanderPhaseX += dt * 0.23 * rate;
    S.Vortex.meanderPhaseZ += dt * 0.19 * rate;
    // Hunting (engine/hunt.js) and Possess mode (engine/possess.js) both
    // replace the wander target rather than the movement: the funnel still
    // crosses the ground at the same capped speed and with the same inertia,
    // it is just steering somewhere deliberate. Possess wins the priority --
    // hunt.js checks Possess.active itself and stops writing huntTarget while
    // it is on, but this order is the belt-and-braces backstop.
    const wander = S.Vortex.controlTarget || S.Vortex.huntTarget || wanderTarget(S.Vortex.wanderSeed);
    const wx = wander.x;
    const wz = wander.z;
    // The funnel chases that target at a capped ground speed. Where the
    // two sine layers momentarily line up, the target briefly outruns
    // anything drivable; the cap keeps the funnel beatable by the chase car
    // (CHASE_TUNE.maxSpeed, now 34) and it catches up once the target slows.
    const remote = S.Vortex.remote;
    if (remote) {
      // The host's funnel (co-op guest): the mirror has placed it already.
      S.Vortex.center.set(remote.x, 0, remote.z);
      S.Vortex.wanderPlaced = true;
    } else if (S.Vortex.pinned) {
      // A Fujiwhara merge is steering this funnel (engine/fujiwhara.js),
      // which has already placed center; the wander phases above keep
      // advancing so the path picks up again smoothly afterwards.
    } else if (!S.Vortex.wanderPlaced) {
      S.Vortex.center.set(wx, 0, wz);
      S.Vortex.wanderPlaced = true;
    } else {
      const toX = wx - S.Vortex.center.x;
      const toZ = wz - S.Vortex.center.z;
      const gap = Math.hypot(toX, toZ);
      const maxStep = (WANDER.maxSpeedBase + WANDER.maxSpeedIntensity * p.intensity)
        * S.Vortex.controlSpeedMul * dt;
      const k = gap > maxStep ? maxStep / gap : 1;
      S.Vortex.center.set(S.Vortex.center.x + toX * k, 0, S.Vortex.center.z + toZ * k);
    }
    if (remote) {
      S.Vortex.sizeMul = remote.sizeMul;
      S.Vortex.fade = remote.fade;
      S.Vortex.leanX = remote.leanX;
      S.Vortex.leanZ = remote.leanZ;
      S.Vortex.monster = remote.sizeMul >= REMOTE_MONSTER_AT;
    }
    S.Vortex.group.position.copy(S.Vortex.center);

    // sizeMul and fade are 1 outside a Fujiwhara merge. A merged monster
    // grows taller as well as wider, by half as much; a funnel being
    // absorbed thins to nothing without shortening.
    //
    // On top of that, the touchdown (see BIRTH and birthShape): a thread of
    // condensation lowering out of the cloud with its top held at the cloud
    // base, then -- once it has touched the ground -- swelling out to its
    // full width, overshooting a little and settling.
    const birthNow = remote ? remote.birth : S.Vortex.birth;
    const birth = api.birthShape(birthNow);
    S.Vortex.presence = S.Vortex.fade * birth.alpha;
    S.Vortex.groundPresence = S.Vortex.fade * birth.ground;
    S.Vortex.group.visible = S.Vortex.active && birthNow > 0.001;
    const scale = ((remote ? remote.radius : p.radius) / 14) * S.Vortex.sizeMul * (0.15 + 0.85 * S.Vortex.fade) * birth.width;
    const fullHeight = 1 + (S.Vortex.sizeMul - 1) * 0.5;
    const heightScale = Math.max(0.001, fullHeight * birth.drop);
    S.Vortex.group.scale.set(scale, heightScale, scale);
    // Hung from the top: whatever of the column has not come down yet is
    // still up inside the cloud, not missing from the bottom.
    S.Vortex.group.position.y = S.Vortex.height * (fullHeight - heightScale);
    S.Vortex.group.rotation.set(S.Vortex.leanX, 0, S.Vortex.leanZ);
    // The dust ring and skirt are the ground's reaction, not part of the
    // rope, so they do not shrink to its width: they are held about half as
    // wide as a grown funnel's while it swells, and thrown out wide by the
    // touchdown shock.
    const groundSpread = (1 + birth.shock * BIRTH.shockSpread) * (0.5 + 0.5 / birth.width);
    S.Vortex.birthSpread = groundSpread;
    S.Vortex.dustRing.scale.set(groundSpread, 1, groundSpread);
    S.Vortex.particleCount = S.Vortex.monster ? S.Vortex.particleCapacity : Math.round(S.Vortex.particleCapacity / MONSTER.particleMul);
    S.Vortex.dustCount = S.Vortex.monster ? S.Vortex.dustCapacity : Math.round(S.Vortex.dustCapacity / MONSTER.dustMul);
    S.Vortex.particles.geometry.setDrawRange(0, S.Vortex.particleCount);
    S.Vortex.dustRing.geometry.setDrawRange(0, S.Vortex.dustCount);
    S.Vortex.particles.material.opacity = SWIRL.opacity * S.Vortex.presence;
    // The wall-cloud collar is the first thing to show: the cloud base
    // starting to turn before anything has come down out of it.
    S.Vortex.crown.material.opacity = CROWN.opacity * S.Vortex.fade * birth.crown;

    // The funnel's surface churn (noise on every vertex of the funnel, core
    // and skirt, and their normals) was half the CPU of a frame (measured,
    // performance pass), per tornado, even redrawn only 30 times a second. It
    // is worked out on the graphics card now (funnelChurn.js); this only
    // hands it this frame's numbers, so it runs every frame again.
    api.updateFunnelGeometry(dt, t);
    api.updateSubVortices(dt, t);

    api.updateSwirl(dt, t);

    // Wall-cloud collar: turns slowly with the vortex (its tint is set per
    // draw, see tintCrown).
    S.Vortex.crown.rotation.y += dt * CROWN.spin * p.rotationSpeed;

    api.updateDustRing(dt);

    // The skirt thickens with the storm for the same reason the funnel's
    // opacity does — a violent tornado lofts far more dirt than a weak one.
    const stormFactor = THREE.MathUtils.clamp(p.intensity * 0.7 + (p.windSpeed / 320) * 0.3, 0, 1);
    S.Vortex.dustRing.material.opacity = (0.4 + stormFactor * 0.35) * S.Vortex.groundPresence;
    S.Vortex.dustRing.material.size = 0.8 + stormFactor * 0.9;
  }

  return {
    Vortex: S.Vortex,
    initVortex,
    setActive,
    setRemote,
    updateFunnelGeometry: api.updateFunnelGeometry,
    updateSubVortices: api.updateSubVortices,
    applySubVortexForce: api.applySubVortexForce,
    updateVortexVisuals,
    onLightningStrike: api.onLightningStrike,
    funnelRadiusAt: api.funnelRadiusAt,
    clearMergeState
  };
}
