// @ts-check
import * as THREE from 'three';
import { LIGHTING } from './lightingTuning.js';

/**
 * ===========================================================================
 * SECTION L — Lightning & thunder
 * ===========================================================================
 * A self-contained addition: strikes are placed and scaled purely by
 * reading Sim.params.intensity/Vortex.center (never writing to them), and
 * thunder taps into SoundSystem.masterGain/.muted/.volume so it shares the
 * exact same mute/volume control as the wind and rumble layers — but this
 * section owns its own light, meshes, DOM overlay and audio nodes, and
 * doesn't alter any existing funnel/debris/sound code above.
 */

/**
 * A THREE.Curve over a polyline with sharp corners preserved (unlike
 * CatmullRomCurve3, which would smooth the very jaggedness that makes a
 * midpoint-displaced path read as a lightning bolt). Used only to feed
 * TubeGeometry a continuous parametrisation of buildBoltPath()'s points.
 */
class PolylineCurve extends THREE.Curve {
  /** @param {THREE.Vector3[]} points */
  constructor(points) {
    super();
    this.points = points;
  }
  /**
   * @param {number} t
   * @param {THREE.Vector3} [target]
   * @returns {THREE.Vector3}
   */
  getPoint(t, target = new THREE.Vector3()) {
    const segments = this.points.length - 1;
    const scaled = THREE.MathUtils.clamp(t, 0, 1) * segments;
    const i = Math.min(Math.floor(scaled), segments - 1);
    return target.copy(this.points[i]).lerp(this.points[i + 1], scaled - i);
  }
}

// Warm storm lightning rather than the cool blue-white it used to be: a
// yellow-white channel with an amber halo, and a flash tinted to match so
// the light it throws on the town agrees with the bolt that cast it.
const LIGHTNING_CORE_COLOUR = 0xfff6d0;
const LIGHTNING_GLOW_COLOUR = 0xffb43c;
const LIGHTNING_FLASH_COLOUR = 0xffe9a8;
const LIGHTNING_OVERLAY_CSS = '#fff3cf';
// HDR multipliers so the bolt crosses post.js's bloom threshold. The core is
// the white-hot channel and goes far over; the additive amber shell is
// lifted just enough that its overlap with the core blooms but its thin
// outer edge does not.
const LIGHTNING_CORE_HDR = 4;
// Flash-light intensity treated as a "full" flash (its peak spans 220-1120),
// and how hard exposure dips at a full flash: 1 / (1 + dip) of normal.
const LIGHTNING_FLASH_NORMALISE = 900;
const FLASH_EXPOSURE_DIP = 0.9;
const LIGHTNING_GLOW_HDR = 1.8;

// How many strikes at the start of a run deliberately target a person (see
// Lightning.scriptedStrikesRemaining / pickScriptedTarget). After this
// many, targeting reverts to the existing fully-random ground/funnel picks.
const SCRIPTED_STRIKE_COUNT = 10;
// A random (phase-2) strike lands on a person too if its computed ground
// point happens to fall within this many world units of one -- see
// findPrimaryNear. Small enough that it stays a rare coincidence rather than
// turning every strike into a people-hunt.
const PEOPLE_STRIKE_RADIUS = 4;
// A primary target (a person) counts as "within the storm's reach" inside
// this many world units of the funnel, or a multiple of its radius when
// that is larger. With nobody in reach, rare targets (the chase car) get
// their higher chance of being aimed at -- see pickRareTarget.
const PRIMARY_STRIKE_RANGE = 60;

/**
 * @param {Object} ctx
 * @returns {{
 *   Lightning: Object,
 *   initLightning: () => void,
 *   updateLightning: (dt: number) => void,
 *   disposeBolt: (boltMesh: THREE.Group) => void,
 *   resetLightningStrikes: () => void,
 *   flashScreen: (at: THREE.Vector3, power: number, tint?: string) => void,
 *   strikeAt: (end: THREE.Vector3, power: number, rail?: boolean) => void
 * }}
 */
export function createLightningSystem(ctx) {
  const { Sim, container } = ctx;
  const { playThunder } = ctx.systems.thunder;

  const Lightning = {
    flashLight: /** @type {THREE.PointLight|null} */ (null),
    boltGroup: /** @type {THREE.Group|null} */ (null),
    bolts: /** @type {{mesh:THREE.Group, life:number, maxLife:number}[]} */ ([]),
    overlay: /** @type {HTMLDivElement|null} */ (null),
    pendingThunder: /** @type {{delay:number, power:number, muffle:number}[]} */ ([]),
    activeAudioNodes: /** @type {AudioScheduledSourceNode[]} */ ([]),
    timeToNextStrike: 3 + Math.random() * 4,
    timeToNextCloudFlash: 1 + Math.random() * 2,
    // Seconds until each queued follow-up strike of a cluster.
    restrikes: /** @type {number[]} */ ([]),
    flashTimer: 0,
    flashRail: false,
    flashDuration: 0.001,
    flashPeak: 0,
    overlayPeak: 0,
    shake: { timer: 0, duration: 0, magnitude: 0 },
    // Phase 1 (scripted): decrements once per strike that actually lands on
    // a deliberately-picked person; once it reaches 0, targeting is phase 2
    // (fully random) for the rest of the run. See triggerLightningStrike.
    scriptedStrikesRemaining: SCRIPTED_STRIKE_COUNT
  };

  ctx.Lightning = Lightning;

  /** @returns {void} */
  function initLightning() {
    const light = new THREE.PointLight(LIGHTNING_FLASH_COLOUR, 0, 0, 1.15);
    light.name = 'lightningFlashLight';
    light.position.set(0, 80, 0);
    Sim.three.scene.add(light);

    const group = new THREE.Group();
    group.name = 'lightningBolts';
    Sim.three.scene.add(group);

    // A full-viewport 'screen'-blended overlay is a much simpler way to get
    // a brightness/exposure flash than wiring up postprocessing for this one
    // effect — it brightens what's already rendered without needing an
    // EffectComposer pass, and 'screen' blending keeps it from ever fully
    // washing the scene out white, matching the "restrained, not neon" brief.
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = LIGHTNING_OVERLAY_CSS;
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.mixBlendMode = 'screen';
    overlay.style.zIndex = '9998';
    container.appendChild(overlay);

    Lightning.flashLight = light;
    Lightning.boltGroup = group;
    Lightning.overlay = overlay;
  }

  /**
   * Recursive midpoint displacement: offsets each segment's midpoint
   * sideways by a random amount that shrinks every recursion, which is what
   * gives a bolt jitter at every scale instead of one single kink.
   * @param {THREE.Vector3} start
   * @param {THREE.Vector3} end
   * @param {number} displacement initial sideways jitter, in world units
   * @param {number} depth recursion depth (more = more jagged detail)
   * @returns {THREE.Vector3[]}
   */
  function buildBoltPath(start, end, displacement, depth) {
    if (depth <= 0) return [start, end];
    const mid = start.clone().lerp(end, 0.5);
    const dir = end.clone().sub(start);
    const helper = Math.abs(dir.y) < dir.length() * 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const perp = new THREE.Vector3().crossVectors(dir, helper).normalize();
    mid.addScaledVector(perp, (Math.random() - 0.5) * 2 * displacement);
    const left = buildBoltPath(start, mid, displacement * 0.55, depth - 1);
    const right = buildBoltPath(mid, end, displacement * 0.55, depth - 1);
    return [...left, ...right.slice(1)];
  }

  /**
   * @param {THREE.Vector3[]} points
   * @param {number} radius
   * @returns {THREE.Group}
   */
  function createBoltMesh(points, radius, rail = false) {
    const curve = new PolylineCurve(points);
    // The bolt is two nested tubes: an opaque yellow-white core, and a much
    // wider additive amber shell around it. The shell is what gives the bolt
    // real presence at the distances these strike from -- a bare core tube,
    // however wide, still reads as a hard-edged drawn line rather than
    // something incandescent. Additive is correct here specifically because
    // overlapping it with the core drives the centre toward white, which is
    // how a hot channel with a cooler halo actually looks.
    const group = new THREE.Group();
    group.name = 'lightningBolt';

    const coreGeo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 6, false);
    const coreMat = new THREE.MeshBasicMaterial({
      color: LIGHTNING_CORE_COLOUR, transparent: true, opacity: 1, depthWrite: false, fog: false
    });
    // The railgun's bolt keeps a saturated yellow core: it does not clip to
    // white and swallow the ring (lightingTuning.js).
    if (rail) coreMat.color.setHex(0xffc21a).multiplyScalar(LIGHTING.railgunCoreHdr);
    else coreMat.color.multiplyScalar(LIGHTNING_CORE_HDR);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.name = 'lightningBolt_core';
    group.add(core);

    const glowGeo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius * (rail ? 2.7 * LIGHTING.railgunGlowScale : 2.7), 6, false);
    const glowMat = new THREE.MeshBasicMaterial({
      color: LIGHTNING_GLOW_COLOUR, transparent: true, opacity: rail ? 0.3 * LIGHTING.railgunGlowOpacity : 0.3, depthWrite: false,
      fog: false, blending: THREE.AdditiveBlending
    });
    glowMat.color.multiplyScalar(rail ? 1 : LIGHTNING_GLOW_HDR);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'lightningBolt_glow';
    group.add(glow);

    // Recorded so updateLightning can fade both layers from one place without
    // caring how many meshes a bolt happens to be made of.
    group.userData.layers = [
      { material: coreMat, baseOpacity: 1 },
      { material: glowMat, baseOpacity: glowMat.opacity }
    ];
    return group;
  }

  /**
   * Spawns the main bolt mesh plus, for stronger strikes, one or two short
   * forking branches off it — a single clean line reads as a laser, not
   * lightning, so a bit of branching sells the shape at a glance.
   * @param {THREE.Vector3} start
   * @param {THREE.Vector3} end
   * @param {number} power 0..1
   * @returns {void}
   */
  /**
   * Releases a bolt's geometry and materials. A bolt is a Group of two tube
   * meshes now rather than a single mesh, so this walks it rather than
   * touching .geometry/.material directly.
   * @param {THREE.Group} boltMesh
   * @returns {void}
   */
  function disposeBolt(boltMesh) {
    boltMesh.traverse((object) => {
      const child = /** @type {THREE.Mesh<THREE.BufferGeometry, THREE.Material>} */ (object);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  function spawnBolt(start, end, power, rail = false) {
    // Bigger displacement and one more subdivision level than before (2^6
    // segments rather than 2^5), so the channel visibly zig-zags instead of
    // reading as a slightly wobbly straight line.
    // Displacement grows with the channel's length: bolts now leave a real
    // cloud rather than a point straight overhead, so many run long and on a
    // slant, and a fixed 6 left those reading as ruled lines.
    const mainPoints = buildBoltPath(start, end, Math.max(6, start.distanceTo(end) * 0.07), 6);
    const mainLife = 0.18 + power * 0.12;
    // Roughly four times the old radius. The old 0.09-0.14 tube was about
    // three screen pixels wide from the default camera distance, which is why
    // it read as a thin scratch; this lands in the 10-20px range.
    const mainMesh = createBoltMesh(mainPoints, 0.3 + power * 0.5, rail);
    Lightning.boltGroup.add(mainMesh);
    Lightning.bolts.push({ mesh: mainMesh, life: mainLife, maxLife: mainLife });

    const branchCount = power > 0.6 ? 4 : power > 0.3 ? 2 : 1;
    for (let i = 0; i < branchCount; i++) {
      const t = 0.3 + Math.random() * 0.4;
      const idx = Math.min(mainPoints.length - 2, Math.floor(t * mainPoints.length));
      const branchStart = mainPoints[idx];
      const branchEnd = branchStart.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 14, -6 - Math.random() * 10, (Math.random() - 0.5) * 14
      ));
      const branchPoints = buildBoltPath(branchStart, branchEnd, 3.5, 4);
      const branchLife = 0.12 + power * 0.1;
      const branchMesh = createBoltMesh(branchPoints, 0.14 + power * 0.22, rail);
      Lightning.boltGroup.add(branchMesh);
      Lightning.bolts.push({ mesh: branchMesh, life: branchLife, maxLife: branchLife });
    }
  }

  /**
   * @typedef {Object} StrikeChoice
   * @property {import('./strikeTargets.js').StrikeProvider} provider
   * @property {SimObject} target
   */

  /**
   * Every primary (people) candidate from every registered provider.
   * @returns {StrikeChoice[]}
   */
  function primaryCandidates() {
    return ctx.systems.strikeTargets.providersByPriority('primary')
      .flatMap(provider => provider.candidates().map(target => ({ provider, target })));
  }

  /**
   * @param {SimObject} target
   * @param {number} radius
   * @returns {boolean} whether the target is within `radius` of the funnel
   */
  function nearFunnel(target, radius) {
    const { x, z } = target.mesh.position;
    const centre = ctx.tornadoes.nearest(x, z).center;
    const dx = x - centre.x;
    const dz = z - centre.z;
    return dx * dx + dz * dz < radius * radius;
  }

  /**
   * Picks a primary target to deliberately strike for one of the run's first
   * SCRIPTED_STRIKE_COUNT bolts. Prefers one already near the tornado's
   * current footprint (a generous multiple of its own radius) so a scripted
   * strike reads as "the storm targeting someone in its path" rather than a
   * bolt arcing clear across town to whoever happens to be picked; falls
   * back to any candidate if nobody currently qualifies as "near".
   * @param {StrikeChoice[]} primaries
   * @returns {StrikeChoice|null} null if there are no primary candidates at all
   */
  function pickScriptedTarget(primaries) {
    if (!primaries.length) return null;
    const nearRadius = Sim.params.radius * 3;
    const near = primaries.filter(c => nearFunnel(c.target, nearRadius));
    const pool = near.length ? near : primaries;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * After the scripted phase, rolls each rare provider's own per-strike
   * chance (higher when no primary target is within the storm's reach) and
   * returns one of its candidates if the roll succeeds. The scripted phase
   * counts as over when its strikes are spent, or when there are no primary
   * targets at all to spend them on.
   * @param {StrikeChoice[]} primaries
   * @returns {StrikeChoice|null}
   */
  function pickRareTarget(primaries) {
    if (Lightning.scriptedStrikesRemaining > 0 && primaries.length) return null;
    const reach = Math.max(PRIMARY_STRIKE_RANGE, Sim.params.radius * 3);
    const primaryInRange = primaries.some(c => nearFunnel(c.target, reach));
    for (const provider of ctx.systems.strikeTargets.providersByPriority('rare')) {
      const candidates = provider.candidates();
      if (!candidates.length || !provider.chance) continue;
      if (Math.random() < provider.chance(primaryInRange)) {
        return { provider, target: candidates[Math.floor(Math.random() * candidates.length)] };
      }
    }
    return null;
  }

  /**
   * Finds the nearest primary target within `maxDist` (ground-plane
   * distance) of a point, if any -- so a phase-2 (fully random) strike can
   * still incidentally hit whoever it happens to land next to, per
   * requirement 3 of Instrucțiunea W ("in either phase"). Rare targets are
   * never hit this way.
   * @param {StrikeChoice[]} primaries
   * @param {number} x
   * @param {number} z
   * @param {number} maxDist
   * @returns {StrikeChoice|null}
   */
  function findPrimaryNear(primaries, x, z, maxDist) {
    let best = null;
    let bestDistSq = maxDist * maxDist;
    for (const choice of primaries) {
      const dx = choice.target.mesh.position.x - x;
      const dz = choice.target.mesh.position.z - z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) { bestDistSq = distSq; best = choice; }
    }
    return best;
  }

  /**
   * Picks where and how strongly the next strike lands, spawns its bolt(s)
   * and flash, and queues the delayed thunderclap that goes with it.
   *
   * Targets come from the strike-target registry (strikeTargets.js), and
   * targeting is two-phase (Instrucțiunea W): while
   * Lightning.scriptedStrikesRemaining is above zero, the strike deliberately
   * targets a primary target (a person, see pickScriptedTarget), which its
   * provider then destroys once the bolt lands. Once the count reaches zero
   * -- or if there are no primary targets at all, in which case the count is
   * left untouched rather than being spent on nothing -- a rare target (the
   * chase car) may be aimed at on its provider's own small chance
   * (pickRareTarget); otherwise targeting is the pre-existing fully-random
   * ground/funnel behaviour below, occasionally targeting near/inside the
   * funnel itself for drama (that chance, like everything else here, rises
   * with intensity), and even then a strike landing near enough to a person
   * still hits them (findPrimaryNear).
   * @returns {void}
   */
  function triggerLightningStrike() {
    const p = Sim.params;

    const primaries = primaryCandidates();
    const scripted = Lightning.scriptedStrikesRemaining > 0 ? pickScriptedTarget(primaries) : null;
    const aimed = scripted || pickRareTarget(primaries);

    let targetX, targetZ, endY, strikesFunnel;
    if (aimed) {
      targetX = aimed.target.mesh.position.x;
      targetZ = aimed.target.mesh.position.z;
      endY = aimed.target.mesh.position.y + aimed.provider.strikeHeight;
      strikesFunnel = false;
    } else {
      const funnelStrikeChance = 0.15 + p.intensity * 0.5;
      strikesFunnel = Math.random() < funnelStrikeChance;
      if (strikesFunnel) {
        // Any of an Outbreak's funnels can draw the bolt.
        const funnels = ctx.tornadoes.activeVortices;
        const Vortex = funnels[Math.floor(Math.random() * funnels.length)];
        const jitterR = Vortex.topRadius * (0.3 + Math.random() * 0.6);
        const jitterAngle = Math.random() * Math.PI * 2;
        targetX = Vortex.center.x + Math.cos(jitterAngle) * jitterR;
        targetZ = Vortex.center.z + Math.sin(jitterAngle) * jitterR;
        endY = Vortex.height * (0.15 + Math.random() * 0.45);
      } else {
        // Anywhere from the middle of town out to the fields around it, so
        // strikes land all over rather than in one ring.
        const townRadius = 10 + Math.pow(Math.random(), 0.8) * 170;
        const townAngle = Math.random() * Math.PI * 2;
        targetX = Math.cos(townAngle) * townRadius;
        targetZ = Math.sin(townAngle) * townRadius;
        endY = 0;
      }
    }

    const end = new THREE.Vector3(targetX, endY, targetZ);
    const start = boltOrigin(end);

    const distance = Sim.three.camera.position.distanceTo(end);
    const proximity = 1 - THREE.MathUtils.clamp(distance / 220, 0, 1);
    const power = THREE.MathUtils.clamp(
      p.intensity * 0.55 + proximity * 0.45 + (strikesFunnel ? 0.1 : 0), 0, 1
    );
    const muffle = 1 - proximity;

    spawnBolt(start, end, power);
    // Light shafts fanning down from the bolt (weather.js). Looked up
    // lazily: the weather system is constructed after this one.
    ctx.systems.weather.onLightningStrike(start, end, power);
    // ...and a flash on the funnel's surface when the bolt lands near it.
    for (const tornado of ctx.tornadoes.active) tornado.onLightningStrike(end, power);

    // Resolve the hit *after* the bolt is placed (its endpoint was already
    // derived from the target's position above, so removing or moving it
    // now doesn't affect where the bolt visually lands). An aimed strike
    // always hits its target; an unaimed one only hits a primary target it
    // happens to land within PEOPLE_STRIKE_RADIUS of.
    const struck = aimed || findPrimaryNear(primaries, end.x, end.z, PEOPLE_STRIKE_RADIUS);
    if (struck) {
      struck.provider.onStruck(struck.target);
      if (scripted) Lightning.scriptedStrikesRemaining--;
    }

    lightUp(end, power, distance, muffle);
  }

  /**
   * Where a bolt landing at `end` comes out of the sky: the underside of a
   * real cloud above it (clouds.js pickBoltOrigin), so every bolt visibly
   * leaves the storm deck instead of starting in clear air. Falls back to
   * the old fixed band only if there is no cloud to use at all.
   * @param {THREE.Vector3} end
   * @returns {THREE.Vector3}
   */
  function boltOrigin(end) {
    const start = new THREE.Vector3();
    const clouds = ctx.systems.clouds;
    if (clouds && clouds.pickBoltOrigin(end.x, end.z, start)) return start;
    return start.set(
      end.x + (Math.random() - 0.5) * 20,
      95 + Math.random() * 30,
      end.z + (Math.random() - 0.5) * 20
    );
  }

  /**
   * A bolt from the cloud onto a chosen point, outside the random strike
   * schedule -- the tornado touching down (tornadoEngine.js) calls one onto
   * the spot. Presentation only: it hits nobody.
   * @param {THREE.Vector3} end
   * @param {number} power 0..1
   * @returns {void}
   */
  function strikeAt(end, power, rail = false) {
    if (!Lightning.boltGroup) return;
    const start = boltOrigin(end);
    const distance = Sim.three.camera.position.distanceTo(end);
    const proximity = 1 - THREE.MathUtils.clamp(distance / 220, 0, 1);
    spawnBolt(start, end, power, rail);
    ctx.systems.weather.onLightningStrike(start, end, power);
    lightUp(end, power, distance, 1 - proximity, rail);
  }

  /**
   * Flash, shake and queued thunder for a bolt that has just landed.
   * @param {THREE.Vector3} end
   * @param {number} power 0..1
   * @param {number} distance from the camera
   * @param {number} muffle 0..1
   * @returns {void}
   */
  function lightUp(end, power, distance, muffle, rail = false) {
    if (Lightning.overlay) Lightning.overlay.style.background = LIGHTNING_OVERLAY_CSS;
    Lightning.flashLight.position.set(end.x, Math.max(end.y, 4) + 12, end.z);
    // The railgun's flash is a short spike on a limited light, not the storm's
    // room-filling one (lightingTuning.js).
    Lightning.flashRail = rail;
    Lightning.flashPeak = (220 + power * 900) * (rail ? LIGHTING.railgunLightIntensity : 1);
    Lightning.flashDuration = rail ? LIGHTING.railgunFlashSeconds : 0.12 + power * 0.14;
    Lightning.flashTimer = Lightning.flashDuration;
    // Trimmed from 0.05 + power * 0.3 to hold total screen brightness roughly
    // where it was now that strikes are about twice as frequent: the brief
    // asks for strong discrete flashes, not a strobe washing out the scene.
    Lightning.overlayPeak = (0.04 + power * 0.22) * (rail ? LIGHTING.railgunLightIntensity : 1);

    // Only close, strong strikes are worth shaking the camera for — keeps
    // the effect an occasional punctuation mark rather than constant jitter.
    if (power > 0.55) {
      Lightning.shake.duration = 0.15 + power * 0.15;
      Lightning.shake.timer = Lightning.shake.duration;
      Lightning.shake.magnitude = (power - 0.55) * 0.6;
    }

    // Distance stands in for "how far the sound has to travel": closer
    // strikes get a short delay and a sharp/loud crack, farther ones a
    // longer delay and a more muffled rumble (see playThunder's `muffle`).
    const delay = 0.15 + distance / 80 + Math.random() * 0.3;
    Lightning.pendingThunder.push({ delay, power, muffle });
  }

  /**
   * Lightning that never reaches the ground: a flicker lighting up the
   * storm cloud from inside, and about half the time a crawler -- a bolt
   * running sideways along the cloud base from one puff to another. Most of
   * the lightning in a real storm is this, and it is what makes the sky feel
   * alive between the ground strikes rather than dark until the next one.
   * @returns {void}
   */
  function cloudFlash() {
    const clouds = ctx.systems.clouds;
    if (!clouds) return;
    const from = clouds.randomCloudPoint(new THREE.Vector3());
    if (!from) return;
    const power = 0.15 + Math.random() * 0.3;
    if (Math.random() < 0.55) {
      const to = new THREE.Vector3();
      const reach = 40 + Math.random() * 70;
      const angle = Math.random() * Math.PI * 2;
      if (clouds.pickBoltOrigin(from.x + Math.cos(angle) * reach, from.z + Math.sin(angle) * reach, to)) {
        from.y -= 3;
        if (from.distanceTo(to) > 12) spawnBolt(from, to, power * 0.7);
      }
    }
    const peak = 120 + power * 380;
    if (!(Lightning.flashTimer > 0 && Lightning.flashPeak > peak)) {
      if (Lightning.overlay) Lightning.overlay.style.background = LIGHTNING_OVERLAY_CSS;
      Lightning.flashLight.position.set(from.x, from.y - 6, from.z);
      Lightning.flashRail = false;
      Lightning.flashPeak = peak;
      Lightning.flashDuration = 0.1 + power * 0.25;
      Lightning.flashTimer = Lightning.flashDuration;
      Lightning.overlayPeak = 0.01 + power * 0.05;
    }
    const distance = Sim.three.camera.position.distanceTo(from);
    Lightning.pendingThunder.push({
      delay: 0.4 + distance / 80 + Math.random() * 0.6, power: power * 0.6, muffle: 0.85
    });
  }

  /**
   * Per-frame driver for lightning + thunder: advances the strike countdown
   * (whose rate scales with intensity), fades the active flash light/overlay/
   * bolts, ticks the queued delayed thunderclaps, and applies the brief
   * post-controls camera shake. Runs every frame regardless of running
   * state (matching updateAtmosphere/updateSoundSystem), so a storm dialled
   * up before pressing Start already shows occasional idle flashes.
   * @param {number} dt
   * @returns {void}
   */
  /**
   * Throws the storm flash -- the flash light plus the full-viewport screen
   * overlay -- from somewhere other than a lightning strike. The detonations
   * (the chemical works, a meteor) and the electric tornado's discharges all
   * want the same white-out this section already owns, and the alternative
   * was each of them growing an overlay element and exposure dip of its own.
   *
   * Reuses the strike machinery wholesale: updateLightning() below is what
   * fades the flash and dips post exposure, and it does not care what set the
   * timer. The overlay's tint is a per-flash argument because the electric
   * tornado's discharges are blue-white where the storm's own bolts are amber.
   * @param {THREE.Vector3} at
   * @param {number} power 0..1
   * @param {string} [tint] CSS colour for the screen overlay
   * @returns {void}
   */
  function flashScreen(at, power, tint = LIGHTNING_OVERLAY_CSS) {
    const p = THREE.MathUtils.clamp(power, 0, 1);
    const peak = 220 + p * 900;
    // Never cut a brighter flash short with a dimmer one.
    if (Lightning.flashTimer > 0 && Lightning.flashPeak > peak) return;
    Lightning.flashLight.position.set(at.x, Math.max(at.y, 4) + 12, at.z);
    Lightning.flashRail = false;
    Lightning.flashPeak = peak;
    Lightning.flashDuration = 0.12 + p * 0.14;
    Lightning.flashTimer = Lightning.flashDuration;
    Lightning.overlayPeak = 0.04 + p * 0.22;
    if (Lightning.overlay) Lightning.overlay.style.background = tint;
  }

  function updateLightning(dt) {
    const p = Sim.params;

    // A clear-sky day (Day Mode, engine/dayNight.js) has no thunderstorm:
    // no new strikes at all while it is selected. Anything already lit
    // fades out below as usual. Standing by (Sim.state.stormRamp at rest,
    // see context.js) is the same kind of gate: without it, a strike could
    // explode a bystander or set a building alight before the player has
    // even pressed Start, which is exactly the opposite of "peace" until
    // then. The countdown itself is frozen rather than merely skipping the
    // trigger, so a run does not open with a strike already overdue.
    const daytime = !!(ctx.DayNight && ctx.DayNight.day);
    const calm = Sim.state.stormRamp <= 0;
    if (!daytime && !calm) Lightning.timeToNextStrike -= dt;
    if (!daytime && !calm && Lightning.timeToNextStrike <= 0) {
      triggerLightningStrike();
      // Raised again, on request for more of it: ~1.6/s at the EF4 default
      // (0.75) and ~2.5/s at EF5, still a strike every couple of seconds on a
      // calm setting. The spacing is far more irregular than it was
      // (0.15..1.85 of the mean rather than 0.4..1.6), so the storm has lulls
      // and flurries instead of a beat.
      const rate = 0.25 + Math.pow(p.intensity, 1.6) * 2.2;
      Lightning.timeToNextStrike = (1 / rate) * (0.15 + Math.random() * 1.7);
      // Real storms strike in clusters: now and then another one or two
      // follow within a fraction of a second, somewhere else.
      if (Math.random() < 0.3) {
        const extra = Math.random() < 0.4 ? 2 : 1;
        for (let k = 0; k < extra; k++) Lightning.restrikes.push(0.06 + Math.random() * 0.3 * (k + 1));
      }
    }
    for (let i = Lightning.restrikes.length - 1; i >= 0; i--) {
      Lightning.restrikes[i] -= dt;
      if (Lightning.restrikes[i] > 0) continue;
      Lightning.restrikes.splice(i, 1);
      if (!daytime && !calm) triggerLightningStrike();
    }
    // Flickers inside the cloud and crawlers along its base, on their own,
    // looser schedule.
    if (!daytime && !calm) {
      Lightning.timeToNextCloudFlash -= dt;
      if (Lightning.timeToNextCloudFlash <= 0) {
        cloudFlash();
        const rate = 0.5 + p.intensity * 1.6;
        Lightning.timeToNextCloudFlash = (1 / rate) * (0.2 + Math.random() * 1.6);
      }
    }

    if (Lightning.flashTimer > 0) {
      Lightning.flashTimer = Math.max(0, Lightning.flashTimer - dt);
      const tNorm = 1 - Lightning.flashTimer / Lightning.flashDuration;
      const flicker = 0.7 + 0.3 * Math.sin(tNorm * 40);
      Lightning.flashLight.distance = Lightning.flashRail ? LIGHTING.railgunLightDistance : 0;
      Lightning.flashLight.intensity = Lightning.flashPeak * (1 - tNorm) * flicker;
      if (Lightning.overlay) {
        Lightning.overlay.style.opacity = String(Lightning.overlayPeak * Math.pow(1 - tNorm, 1.5));
      }
    } else {
      Lightning.flashLight.intensity = 0;
      if (Lightning.overlay) Lightning.overlay.style.opacity = '0';
    }

    // Exposure dip while the flash is lit (post.js). The flash is many
    // additive layers -- flash light, overlay, bolt bloom, sky and cloud
    // glow, funnel glow, light shafts -- and a close, strong strike stacked
    // them into a frame washed near-white. Scaling exposure down in step
    // with the flash keeps it a bright flash rather than a blowout.
    const flashLevel = Lightning.flashLight.intensity / LIGHTNING_FLASH_NORMALISE;
    ctx.systems.post.Post.exposureScale = 1 / (1 + FLASH_EXPOSURE_DIP * flashLevel);

    for (let i = Lightning.bolts.length - 1; i >= 0; i--) {
      const bolt = Lightning.bolts[i];
      bolt.life -= dt;
      if (bolt.life <= 0) {
        Lightning.boltGroup.remove(bolt.mesh);
        disposeBolt(bolt.mesh);
        Lightning.bolts.splice(i, 1);
      } else {
        // Both layers fade together, each from its own base opacity, so the
        // amber halo never outlives the core it is supposed to surround.
        const fade = Math.pow(bolt.life / bolt.maxLife, 0.6);
        for (const layer of bolt.mesh.userData.layers) {
          layer.material.opacity = layer.baseOpacity * fade;
        }
      }
    }

    for (let i = Lightning.pendingThunder.length - 1; i >= 0; i--) {
      const pending = Lightning.pendingThunder[i];
      pending.delay -= dt;
      if (pending.delay <= 0) {
        playThunder(pending.power, pending.muffle);
        Lightning.pendingThunder.splice(i, 1);
      }
    }

    // Applied after Sim.three.controls.update() already ran this frame (see
    // animate()), so this offset is what actually reaches the renderer;
    // OrbitControls recomputes position from its own internal state next
    // frame regardless, so the jitter never accumulates.
    if (Lightning.shake.timer > 0) {
      Lightning.shake.timer = Math.max(0, Lightning.shake.timer - dt);
      const mag = Lightning.shake.magnitude * (Lightning.shake.timer / Lightning.shake.duration);
      Sim.three.camera.position.x += (Math.random() - 0.5) * mag;
      Sim.three.camera.position.y += (Math.random() - 0.5) * mag * 0.6;
      Sim.three.camera.position.z += (Math.random() - 0.5) * mag;
    }
  }

  /**
   * Re-arms the scripted-strike counter, called from resetSim() so a fresh
   * run's freshly-regenerated people (see resetEnvironment) get their own
   * phase-1 scripted intro rather than inheriting the previous run's
   * already-exhausted count.
   * @returns {void}
   */
  function resetLightningStrikes() {
    Lightning.scriptedStrikesRemaining = SCRIPTED_STRIKE_COUNT;
    Lightning.restrikes.length = 0;
  }

  return {
    Lightning, initLightning, updateLightning, disposeBolt, resetLightningStrikes, flashScreen, strikeAt
  };
}
