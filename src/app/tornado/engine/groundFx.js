// @ts-check
import * as THREE from 'three';
import { createGroundScarTexture, createSoftDotTexture } from '../utils/textures.js';

/**
 * ===========================================================================
 * SECTION N — Ground impact spray & permanent ground scars
 * ===========================================================================
 * Two purely cosmetic, ground-level effects layered on top of the vortex's
 * existing motion (Vortex.center, already updated every frame by
 * updateVortexVisuals): the live dust spray at the funnel's foot, and the
 * permanent scorched/cracked scar it leaves behind it. Neither reads nor
 * writes debris/physics/damage state — they only read Vortex.center and
 * Sim.params for positioning and intensity/wind reactivity, mirroring the
 * read-only pattern already used by updateAtmosphere()/updateClouds().
 */

/**
 * One instance per tornado (engine/tornadoes.js): each Outbreak tornado
 * kicks up its own spray and leaves its own scar.
 * @param {Object} ctx
 * @param {Object} [vortex] the tornado's Vortex state; the primary by default
 * @returns {{
 *   GroundSpray: Object,
 *   PathTrack: Object,
 *   initGroundSpray: () => void,
 *   updateGroundSpray: (dt: number) => void,
 *   initPathTrack: () => void,
 *   updatePathTrack: (dt: number) => void,
 *   resetPathTrack: () => void
 * }}
 */
export function createGroundFxSystem(ctx, vortex = ctx.Vortex) {
  const { Sim } = ctx;
  const Vortex = vortex;
  const suffix = Vortex.index ? `_${Vortex.index}` : '';

  /**
   * Dust/debris kicked up where the funnel currently touches the ground.
   * A single Points system (reusing the same soft-dot sprite texture as the
   * funnel's swirl/dust-ring particles) whose *active* particle count, rise
   * height and drift speed all scale with a combined intensity/wind-speed
   * factor, so it stays a faint puff at low intensity and grows into a
   * billowing cloud at EF5 without ever allocating more geometry than the
   * fixed pool below.
   */
  const GroundSpray = {
    points: /** @type {THREE.Points|null} */ (null),
    positions: /** @type {Float32Array|null} */ (null),
    data: /** @type {Float32Array|null} */ (null),
    // Raised from 260: the spray is no longer a uniform puff but a
    // converging sheath (see updateGroundSpray), and a sheath needs enough
    // particles to stay visually continuous with the funnel's own dust skirt
    // rather than breaking up into countable dots.
    maxCount: 460
  };

  /**
   * Allocates the ground-spray particle pool (positions parked at the origin
   * until updateGroundSpray() starts driving them) and adds it to the scene.
   * @returns {void}
   */
  function initGroundSpray() {
    const dotTexture = createSoftDotTexture();
    const count = GroundSpray.maxCount;
    const positions = new Float32Array(count * 3);
    const data = new Float32Array(count * 4); // r, angle, height, rise-speed multiplier
    for (let i = 0; i < count; i++) {
      data[i * 4] = Math.random() * 6;
      data[i * 4 + 1] = Math.random() * Math.PI * 2;
      data[i * 4 + 2] = Math.random() * 4;
      data[i * 4 + 3] = 0.6 + Math.random() * 0.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      color: 0xcbb896,
      size: 1.1,
      map: dotTexture,
      alphaMap: dotTexture,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    const points = new THREE.Points(geometry, material);
    points.name = `groundSpray${suffix}`;
    Sim.three.scene.add(points);

    GroundSpray.points = points;
    GroundSpray.positions = positions;
    GroundSpray.data = data;
  }

  /**
   * Advances and repositions the ground-spray particles at the vortex's
   * current world ground-contact point (Vortex.center). Runs every frame,
   * independent of running state, matching updateVortexVisuals()/
   * updateClouds() — so a storm dialled up before Start already shows a
   * bigger dust puff.
   * @param {number} dt
   * @returns {void}
   */
  function updateGroundSpray(dt) {
    if (!GroundSpray.points) return;
    // Nothing to spray until the funnel has touched down (vortex.js BIRTH).
    GroundSpray.points.visible = Vortex.active && Vortex.groundPresence > 0.001;
    if (!GroundSpray.points.visible) return;
    const p = Sim.params;
    const stormFactor = THREE.MathUtils.clamp(p.intensity * 0.7 + (p.windSpeed / 320) * 0.3, 0, 1);
    const activeCount = Math.max(20, Math.round(GroundSpray.maxCount * (0.12 + stormFactor * 0.88)));
    const maxHeight = 3 + stormFactor * 22;
    const riseSpeed = 2 + stormFactor * 9;
    const spreadRadius = 4.5 + p.radius * Vortex.sizeMul * (0.55 + stormFactor * 0.7);
    // World-space radius of the funnel's ground contact. Vortex.baseRadius
    // and the +0.4 lip are in the tornado group's local space, which
    // updateVortexVisuals scales by p.radius / 14 — mirroring that here is
    // what lets the spray know where the funnel wall actually is.
    const coreRadius = (Vortex.baseRadius + 0.4) * (p.radius / 14) * Vortex.sizeMul;

    const positions = GroundSpray.positions;
    const data = GroundSpray.data;
    const cx = Vortex.center.x;
    const cz = Vortex.center.z;

    for (let i = 0; i < activeCount; i++) {
      let r = data[i * 4];
      const angle = data[i * 4 + 1] + dt * (1.2 + stormFactor * 2.5) * (1 - r / (spreadRadius + 1));
      // Inflow weight: 1 at the core, falling to 0 at the outer fringe.
      // Dust near the funnel is being actively fed into it, so it is dragged
      // inwards and lofted high; dust at the fringe is merely creeping
      // outwards and stays low. The result is a converging cone whose inner
      // wall climbs alongside the funnel's own dust skirt, instead of the
      // old flat dome that expanded uniformly and read as a separate puff
      // sitting underneath the tornado.
      const inflow = 1 - THREE.MathUtils.clamp(r / (coreRadius * 2.6 + 1), 0, 1);
      const localMax = maxHeight * (0.22 + inflow * 0.78);
      let h = data[i * 4 + 2] + dt * riseSpeed * data[i * 4 + 3] * (0.35 + inflow * 0.65);
      if (h > localMax) {
        h = 0;
        // Reseeded near the core rather than anywhere across the spread:
        // particles earn their way outwards through the creep term below, so
        // the population stays concentrated around the contact point and
        // thins towards the fringe. Reseeding uniformly across the full
        // radius instead scatters an even haze over the whole town, which
        // reads as falling snow rather than as dust being torn off the
        // ground at the funnel's base.
        r = Math.random() * spreadRadius * 0.35;
      }
      // Convergence strengthens with height (`lift`) so particles leave the
      // ground spread wide and only tighten onto the funnel wall as they
      // climb — a cone, not a cylinder. Fringe particles (low `inflow`)
      // barely converge at all and just creep outwards along the ground.
      const lift = h / localMax;
      const wallAtH = coreRadius * (1 + lift * 1.8);
      r = THREE.MathUtils.clamp(
        r + (wallAtH - r) * inflow * lift * dt * 1.5 + dt * riseSpeed * 0.14 * (1 - inflow),
        0, spreadRadius
      );
      data[i * 4] = r;
      data[i * 4 + 1] = angle;
      data[i * 4 + 2] = h;
      positions[i * 3] = cx + Math.cos(angle) * r;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = cz + Math.sin(angle) * r;
    }
    GroundSpray.points.geometry.setDrawRange(0, activeCount);
    GroundSpray.points.geometry.attributes.position.needsUpdate = true;
    GroundSpray.points.material.opacity = (0.3 + stormFactor * 0.48) * Vortex.groundPresence;
    GroundSpray.points.material.size = 1.0 + stormFactor * 1.5;
  }

  /**
   * Permanent scorched/cracked ground scar following the tornado's path.
   * Ground-contact points are sampled at a fixed interval (not every frame)
   * from the same Vortex.center used for damage-threshold checks, so the
   * visible scar lines up with where objects along the way actually took
   * damage. Stored as one growing indexed triangle strip in a pre-allocated
   * buffer — no per-sample allocation — with setDrawRange() exposing only the
   * portion built so far.
   *
   * "Permanent" in the sense that matters here: once a sample is written it is
   * never moved, faded or retired, so the scar stays exactly as it was laid
   * down and accumulates over the whole run, only cleared by resetSim(). It is
   * geometry, not a particle effect — nothing about it is per-frame work, and
   * updatePathTrack() touches it a little under three times a second.
   *
   * What makes it read as baked-in ground rather than a dark ribbon laid over
   * it (three things, all costing nothing per frame):
   *  - the scorch/crack texture (createGroundScarTexture), whose alpha eats
   *    ragged bites out of both long edges so the scar has no straight sides;
   *  - a v coordinate advanced by real travelled distance rather than by
   *    sample index, so the texture never stretches or bunches when the
   *    funnel speeds up, slows down or stalls;
   *  - a per-sample vertex colour and width, so a violent EF5 pass burns
   *    darker and wider than a weak one, and each sample's half-width is
   *    jittered so the outline wanders.
   */
  const PathTrack = {
    mesh: /** @type {THREE.Mesh|null} */ (null),
    positions: /** @type {Float32Array|null} */ (null),
    uvs: /** @type {Float32Array|null} */ (null),
    colours: /** @type {Float32Array|null} */ (null),
    indices: /** @type {Uint16Array|null} */ (null),
    points: /** @type {{x:number, z:number, dirX:number, dirZ:number}[]} */ [],
    pointCount: 0,
    // 0.35s apart, this covers 490s of travel -- past the 300s the Duration
    // slider tops out at, so a run can never outlive its own scar.
    maxPoints: 1400,
    sampleTimer: 0,
    sampleInterval: 0.35,
    // Distance travelled along the path so far, in world units: the v texture
    // coordinate is this over SCAR_TILE_LENGTH.
    distance: 0
  };

  // World units of path per tile of the scar texture along v. Roughly two
  // tornado widths, so the cracks in it read at the same scale as the scar.
  const SCAR_TILE_LENGTH = 34;
  // Scar colour tinting the texture, from a weak tornado's churned soil to an
  // EF5's charred black. Multiplied over the texture's own colours, so these
  // darken rather than replace them.
  const SCAR_SOIL = new THREE.Color(0x8a7052);
  const SCAR_CHARRED = new THREE.Color(0x2a2119);

  /**
   * Allocates the path-track ribbon's vertex/index buffers (capped at
   * PathTrack.maxPoints samples) and adds the (initially empty) mesh to the
   * scene.
   * @returns {void}
   */
  function initPathTrack() {
    const maxPoints = PathTrack.maxPoints;
    const positions = new Float32Array(maxPoints * 2 * 3);
    const uvs = new Float32Array(maxPoints * 2 * 2);
    // White until written, so an unwritten vertex would tint nothing rather
    // than (as an unfilled colour attribute would) blacking its triangle out.
    const colours = new Float32Array(maxPoints * 2 * 3).fill(1);
    const indices = new Uint16Array(Math.max(0, maxPoints - 1) * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      map: createGroundScarTexture(),
      vertexColors: true,
      transparent: true,
      // The texture's own alpha is what shapes the scar (ragged edges, gaps
      // between scorch patches); this only takes the whole thing back a touch
      // so the ground still shows through the thinnest parts.
      opacity: 0.92,
      // Sits 0.015 above the ground plane, i.e. over the roads at 0.01 and
      // under the debug grid at 0.02. depthWrite off so overlapping passes of
      // the same scar blend in draw order instead of z-fighting at equal depth.
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `pathTrack${suffix}`;
    Sim.three.scene.add(mesh);

    PathTrack.mesh = mesh;
    PathTrack.positions = positions;
    PathTrack.uvs = uvs;
    PathTrack.colours = colours;
    PathTrack.indices = indices;
  }

  /**
   * Appends one ground-contact sample to the scar ribbon, extruding a quad (as
   * two indexed triangles) perpendicular to the direction of travel between it
   * and the previous sample. No-ops once PathTrack.maxPoints is reached.
   * @param {number} x
   * @param {number} z
   * @param {number} halfWidth
   * @param {number} burn 0..1 how scorched this stretch is (storm strength)
   * @returns {void}
   */
  function addPathPoint(x, z, halfWidth, burn) {
    const idx = PathTrack.pointCount;
    if (idx >= PathTrack.maxPoints) return;

    let dirX = 0;
    let dirZ = 1;
    let travelled = 0;
    if (idx > 0) {
      const prev = PathTrack.points[idx - 1];
      const dx = x - prev.x;
      const dz = z - prev.z;
      const len = Math.hypot(dx, dz);
      travelled = len;
      if (len > 1e-4) {
        dirX = dx / len;
        dirZ = dz / len;
      } else {
        dirX = prev.dirX;
        dirZ = prev.dirZ;
      }
    }
    const perpX = -dirZ;
    const perpZ = dirX;

    // Advanced by distance actually covered, not by sample: the funnel's
    // ground speed varies (and it can stall almost still), and a v stepped per
    // sample would smear the texture over a fast stretch and compress it to
    // nothing over a slow one.
    PathTrack.distance += travelled;
    const v = PathTrack.distance / SCAR_TILE_LENGTH;

    // Each side's half-width jittered independently, so the two edges wander
    // out of step and the scar's outline never looks extruded from a spine.
    const leftWidth = halfWidth * (0.82 + Math.random() * 0.34);
    const rightWidth = halfWidth * (0.82 + Math.random() * 0.34);

    const positions = PathTrack.positions;
    const vBase = idx * 2 * 3;
    positions[vBase] = x + perpX * leftWidth;
    positions[vBase + 1] = 0.015;
    positions[vBase + 2] = z + perpZ * leftWidth;
    positions[vBase + 3] = x - perpX * rightWidth;
    positions[vBase + 4] = 0.015;
    positions[vBase + 5] = z - perpZ * rightWidth;

    const uvs = PathTrack.uvs;
    const uvBase = idx * 2 * 2;
    uvs[uvBase] = 0;
    uvs[uvBase + 1] = v;
    uvs[uvBase + 2] = 1;
    uvs[uvBase + 3] = v;

    const colour = SCAR_SOIL.clone().lerp(SCAR_CHARRED, THREE.MathUtils.clamp(burn, 0, 1))
      // A little per-sample variation so successive quads don't read as a
      // uniform wash even where the storm strength is not changing.
      .multiplyScalar(0.85 + Math.random() * 0.3);
    const colours = PathTrack.colours;
    const cBase = idx * 2 * 3;
    for (const offset of [0, 3]) {
      colours[cBase + offset] = colour.r;
      colours[cBase + offset + 1] = colour.g;
      colours[cBase + offset + 2] = colour.b;
    }

    PathTrack.points.push({ x, z, dirX, dirZ });
    PathTrack.pointCount = idx + 1;

    if (idx > 0) {
      const prevLeft = (idx - 1) * 2;
      const prevRight = prevLeft + 1;
      const curLeft = idx * 2;
      const curRight = curLeft + 1;
      const iBase = (idx - 1) * 6;
      const indices = PathTrack.indices;
      indices[iBase] = prevLeft;
      indices[iBase + 1] = curLeft;
      indices[iBase + 2] = prevRight;
      indices[iBase + 3] = prevRight;
      indices[iBase + 4] = curLeft;
      indices[iBase + 5] = curRight;
      PathTrack.mesh.geometry.index.needsUpdate = true;
      PathTrack.mesh.geometry.setDrawRange(0, (PathTrack.pointCount - 1) * 6);
    }
    PathTrack.mesh.geometry.attributes.position.needsUpdate = true;
    PathTrack.mesh.geometry.attributes.uv.needsUpdate = true;
    PathTrack.mesh.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Samples the vortex's current ground-contact point into the scar at a fixed
   * real-time interval (rather than every frame) while a run is in progress.
   * Width follows the same live tornado radius used elsewhere, and how charred
   * the sample is follows the same intensity/wind storm factor the spray uses
   * — so a wider, stronger EF5 burns a wider, blacker scar than a narrow EF1,
   * and a storm dialled up mid-run darkens from that point on rather than
   * retroactively.
   * @param {number} dt
   * @returns {void}
   */
  function updatePathTrack(dt) {
    if (!Sim.state.running || Sim.state.paused || !Vortex.active) return;
    PathTrack.sampleTimer -= dt;
    if (PathTrack.sampleTimer > 0) return;
    PathTrack.sampleTimer = PathTrack.sampleInterval;
    const p = Sim.params;
    const halfWidth = Math.max(3, p.radius * 0.9 * Vortex.sizeMul);
    const burn = THREE.MathUtils.clamp(p.intensity * 0.7 + (p.windSpeed / 320) * 0.3, 0, 1);
    addPathPoint(Vortex.center.x, Vortex.center.z, halfWidth, burn);
  }

  /**
   * Clears the recorded scar back to empty, called from resetSim() so a fresh
   * run doesn't start with the previous run's scars still on the ground. This
   * is the only thing that ever removes them — within a run they accumulate.
   * @returns {void}
   */
  function resetPathTrack() {
    PathTrack.points = [];
    PathTrack.pointCount = 0;
    PathTrack.sampleTimer = 0;
    PathTrack.distance = 0;
    if (PathTrack.mesh) PathTrack.mesh.geometry.setDrawRange(0, 0);
  }

  return {
    GroundSpray,
    PathTrack,
    initGroundSpray,
    updateGroundSpray,
    initPathTrack,
    updatePathTrack,
    resetPathTrack
  };
}
