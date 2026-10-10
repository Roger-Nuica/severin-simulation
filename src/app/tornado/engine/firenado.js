import * as THREE from 'three';
import { createFireTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { createGroundFireSystem } from './groundFire.js';
import { bannerHost } from '../utils/banners.js';
import { easeStrength, fireStarted } from './net/firenadoFx.js';

/**
 * ===========================================================================
 * SECTION F — Firenado
 * ===========================================================================
 * The run's "boss phase": the tornado itself catches fire for
 * FIRENADO.duration seconds. Two things set it alight, and nothing else:
 *  - the Ignite button;
 *  - the funnel passing through a big fire (FIRENADO.bigFire buildings
 *    alight within FIRENADO.fireReach of its centre) -- which is how a fuel
 *    station or a tanker going up next to it still lights it, through the
 *    fires they start rather than by calling this directly.
 * Never without a tornado on the ground: the flames are drawn on the
 * funnel's shape, so with no funnel they were a free-standing "flame
 * tornado" that drifted about and faded -- what shooting a tanker in Hero
 * Mode (no storm) used to produce. A funnel that leaves (the run ends, it
 * lifts) puts the fire out.
 *
 *  - Flames swirl up through the whole funnel, following its shape
 *    (a pooled additive particle system with the explosions' fire texture).
 *  - The funnel shell, core and skirt glow amber and the swirl particles warm
 *    (vortex.js reads Vortex.fire in applyFlash).
 *  - A flickering orange light at the base throws firelight on the town.
 *    It is created at start-up at zero intensity and never removed: adding
 *    or removing a light changes the scene's light count, which makes
 *    three.js recompile every lit material's shader on the spot.
 *  - A fire roar fades in on its own sound bus (sound/fire.js).
 *  - Flame tongues lick outward and up from the funnel's surface, so its
 *    silhouette is ragged with flame peaks, and embers break off the
 *    surface and drift away.
 *  - The funnel leaves a trail of lingering ground fires
 *    (engine/groundFire.js).
 *  - Objects swept up while it burns trail sparks.
 *  - Damage scored in the window counts FIRENADO.damageMultiplier times
 *    (damage.js addDamageScore).
 *  - A banner announces the start and the end.
 *
 * Once per run: a second station going up later in the same run only makes
 * its own explosion. resetSim() re-arms it.
 */

const FIRENADO = {
  duration: 13,
  fadeIn: 1.5,
  fadeOut: 2.5,
  damageMultiplier: 1.5,
  lightColour: 0xff7a2a,
  lightPeak: 520,
  lightDistance: 110,
  lightDecay: 1.6,
  lightHeight: 7,
  bannerSeconds: 2.8,
  // "A big fire": this many buildings alight within fireReach of the
  // funnel's centre, looked for every fireCheck seconds.
  bigFire: 3,
  fireReach: 30,
  fireCheck: 0.5,
  // The funnel has to be this much there (Vortex.presence) to burn.
  presence: 0.35
};

const FLAMES = {
  max: 1200,
  rate: 680,               // per second at full burn
  life: [1.6, 2.6],
  rise: [13, 22],          // units per second up the funnel
  swirl: [2.2, 4.2],       // radians per second around the axis
  fraction: [0.05, 0.9],   // of the funnel radius at a flame's height
  coreBias: 1.6,           // > 1 packs flames towards the axis
  size: 3.8,
  hot: new THREE.Color(1.0, 0.86, 0.42),
  warm: new THREE.Color(1.0, 0.46, 0.12),
  ember: new THREE.Color(0.62, 0.13, 0.05)
};

// Tongues of flame on the funnel's surface: each is a short chain of
// particles leaning outward and up from a point on the shell, shrinking
// towards its tip, so seen edge-on the funnel's outline is jagged with
// flame peaks. A tongue flares up and dies back over its short life.
const TONGUES = {
  count: 110,
  segments: 5,
  life: [0.35, 0.8],
  length: [3.5, 8],        // tip height above the root at full flare
  lean: [0.5, 1.4],        // outward reach of the tip, of the local radius x 0.25
  heightRange: [0.02, 0.85], // of the funnel height
  rootFraction: 0.97,      // of the funnel radius at the root
  size: 4.2,
  swirlRate: 0.35          // follows the funnel's spin, radians per second
};

// Embers torn off the funnel surface, flung out and drifting away.
const EMBERS = {
  max: 320,
  rate: 90,                // per second at full burn
  life: [1.4, 3.2],
  outward: [3, 9],
  tangential: [2, 6],
  up: [1, 4.5],
  drag: 0.6,               // per second
  size: 1.1,
  colour: new THREE.Color(1.0, 0.62, 0.2)
};

const SPARKS = {
  max: 240,
  perObjectRate: 9,        // per second per burning object
  maxBurning: 16,          // objects that trail sparks at once
  life: [0.5, 0.9],
  size: 0.9,
  colour: new THREE.Color(1.0, 0.55, 0.18)
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initFirenado: () => void,
 *   updateFirenado: (dt: number) => void,
 *   ignite: (manual?: boolean) => void,
 *   quench: () => void,
 *   damageMultiplier: () => number,
 *   groundContactAt: (x: number, z: number) => boolean,
 *   groundFireState: () => {slot: number, x: number, z: number, level: number}[],
 *   mirrorGroundFire: (rows: Map<number, number[]>) => void,
 *   replicaState: () => number|null,
 *   mirror: (row: ReadonlyArray<number>|undefined) => void,
 *   burning: () => boolean,
 *   resetFirenado: () => void,
 *   disposeFirenado: () => void
 * }}
 */
export function createFirenadoSystem(ctx) {
  const { Sim, Vortex, container } = ctx;

  const state = {
    /** @type {'idle'|'burning'|'done'} */
    phase: 'idle',
    age: 0,
    strength: 0,
    time: 0,
    bannerTimer: 0,
    fireCheck: 0
  };
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let flames = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let sparks = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let tongues = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let embers = null;
  // Per-tongue state: angle round the axis, root height, age, lifetime,
  // flare length and lean, all indexed by tongue.
  const tongue = {
    angle: new Float32Array(TONGUES.count),
    root: new Float32Array(TONGUES.count),
    age: new Float32Array(TONGUES.count),
    life: new Float32Array(TONGUES.count),
    length: new Float32Array(TONGUES.count),
    lean: new Float32Array(TONGUES.count)
  };
  const groundFire = createGroundFireSystem(ctx);
  // Co-op guest: the host's fire envelope (`firenado` row). It only sets how strongly the fire is drawn; nothing is ignited, multiplied or scored here (R-053).
  const replica = { sent: 0, strength: 0 };
  const peerView = () => !!(ctx.systems.net && ctx.systems.net.isPeerView());
  /** @type {THREE.Object3D|null} */
  let light = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const scratch = new THREE.Color();
  let flamesAlive = 0;
  let sparksAlive = 0;
  let embersAlive = 0;
  let tonguesShowing = false;

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initFirenado() {
    const scene = Sim.three.scene;
    flames = createParticlePool(scene, FLAMES.max, createFireTexture(), THREE.AdditiveBlending, 'firenado_flames');
    sparks = createParticlePool(scene, SPARKS.max, createFireTexture(), THREE.AdditiveBlending, 'firenado_sparks');
    tongues = createParticlePool(scene, TONGUES.count * TONGUES.segments, createFireTexture(), THREE.AdditiveBlending, 'firenado_tongues');
    embers = createParticlePool(scene, EMBERS.max, createFireTexture(), THREE.AdditiveBlending, 'firenado_embers');
    groundFire.initGroundFire();
    light = ctx.systems.lightPool.createLight(FIRENADO.lightColour, 0, FIRENADO.lightDistance, FIRENADO.lightDecay);
    light.name = 'firenado_light';
    scene.add(light);

    banner = document.createElement('div');
    banner.className = 'firenado-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);

    const igniteButton = document.getElementById('btn-ignite');
    if (igniteButton) igniteButton.addEventListener('click', () => ignite(true), { signal: ctx.signal });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    state.bannerTimer = FIRENADO.bannerSeconds;
  }

  /**
   * Whether there is a tornado on the ground to set alight.
   * @returns {boolean}
   */
  function funnelThere() {
    return !!(Sim.state.running && Vortex.active && Vortex.presence >= FIRENADO.presence);
  }

  /**
   * Sets the tornado alight. The organic trigger (the funnel through a big
   * fire) only counts once per run; the manual Ignite button works whenever
   * the tornado is not already burning. Never with no tornado there.
   * @param {boolean} [manual]
   * @returns {void}
   */
  function ignite(manual = false) {
    // Co-op guest: the host's fire is drawn from its row, never lit here.
    if (peerView()) return;
    if (state.phase === 'burning') return;
    // No fire in an ice tornado (engine/blizzard.js).
    if (ctx.systems.blizzard && ctx.systems.blizzard.active()) return;
    if (!manual && state.phase === 'done') return;
    if (!funnelThere()) {
      if (manual) ctx.events.emit('notice', { text: '🔥 IGNITE · no tornado on the ground to set alight' });
      return;
    }
    state.phase = 'burning';
    state.age = 0;
    showBanner('FIRENADO!', manual
      ? `Ignited · damage ×${FIRENADO.damageMultiplier}`
      : `The funnel caught the fire · damage ×${FIRENADO.damageMultiplier}`);
  }

  /**
   * The funnel passing through a big fire catches it.
   * @param {number} dt
   * @returns {void}
   */
  function lookForFire(dt) {
    state.fireCheck -= dt;
    if (state.fireCheck > 0) return;
    state.fireCheck = FIRENADO.fireCheck;
    if (peerView() || state.phase !== 'idle' || !funnelThere() || !ctx.systems.buildingFire) return;
    const { x, z } = Vortex.center;
    let n = 0;
    for (const b of ctx.systems.buildingFire.burning()) {
      if (b.mesh && Math.hypot(b.mesh.position.x - x, b.mesh.position.z - z) < FIRENADO.fireReach) n++;
    }
    if (n >= FIRENADO.bigFire) ignite(false);
  }

  /** @returns {number} damage multiplier in effect right now */
  function damageMultiplier() {
    return state.phase === 'burning' ? FIRENADO.damageMultiplier : 1;
  }

  /**
   * Whether the funnel is currently a column of fire. Read by damage.js, which
   * lights buildings that collapse inside one (see buildingFire.js).
   * @returns {boolean}
   */
  function burning() {
    return state.phase === 'burning';
  }

  /**
   * One flame, started low in the funnel.
   * @param {number} i pool slot
   * @returns {void}
   */
  function spawnFlame(i) {
    const p = flames;
    p.life[i] = p.maxLife[i] = between(FLAMES.life);
    p.seed[i] = Math.random();
    // velocities hold the flame's funnel-relative state:
    // angle, radial fraction, rise speed. Height lives in positions.y.
    p.velocities[i * 3] = Math.random() * Math.PI * 2;
    p.velocities[i * 3 + 1] = FLAMES.fraction[0]
      + Math.pow(Math.random(), FLAMES.coreBias) * (FLAMES.fraction[1] - FLAMES.fraction[0]);
    p.velocities[i * 3 + 2] = between(FLAMES.rise);
    p.positions[i * 3 + 1] = Math.random() * 5;
  }

  /**
   * Advances the flames up and round the funnel.
   * @param {number} dt
   * @returns {void}
   */
  function updateFlames(dt) {
    const p = flames;
    if (state.strength > 0) {
      p.accumulator += FLAMES.rate * state.strength * dt;
      while (p.accumulator >= 1) {
        p.accumulator -= 1;
        spawnFlame(p.next);
        p.next = (p.next + 1) % FLAMES.max;
      }
    }
    const scaleX = Vortex.group.scale.x;
    const cx = Vortex.center.x;
    const cz = Vortex.center.z;
    const radiusAt = ctx.systems.vortex.funnelRadiusAt;
    const topOut = Vortex.height * 0.95;
    flamesAlive = 0;
    for (let i = 0; i < FLAMES.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      const h = p.positions[i * 3 + 1] + p.velocities[i * 3 + 2] * dt;
      if (p.life[i] <= 0 || h > topOut) {
        p.life[i] = 0;
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      flamesAlive++;
      const seed = p.seed[i];
      const angle = p.velocities[i * 3] + (FLAMES.swirl[0] + seed * (FLAMES.swirl[1] - FLAMES.swirl[0])) * dt;
      p.velocities[i * 3] = angle;
      const r = p.velocities[i * 3 + 1] * radiusAt(h) * scaleX * (1 + 0.18 * Math.sin(state.time * 3 + seed * 20));
      p.positions[i * 3] = cx + Math.cos(angle) * r;
      p.positions[i * 3 + 1] = h;
      p.positions[i * 3 + 2] = cz + Math.sin(angle) * r;

      // Hot yellow at birth, orange through the middle, dull red embers
      // as it dies; bright in the middle of its life, faded at both ends.
      const u = 1 - p.life[i] / p.maxLife[i];
      const c = u < 0.4
        ? scratch.copy(FLAMES.hot).lerp(FLAMES.warm, u / 0.4)
        : scratch.copy(FLAMES.warm).lerp(FLAMES.ember, (u - 0.4) / 0.6);
      p.colours[i * 4] = c.r;
      p.colours[i * 4 + 1] = c.g;
      p.colours[i * 4 + 2] = c.b;
      p.colours[i * 4 + 3] = Math.pow(Math.sin(Math.PI * u), 0.7) * 0.85 * (0.4 + 0.6 * state.strength);
      p.sizes[i] = FLAMES.size * (0.7 + 0.6 * seed) * (1 - 0.5 * u);
    }
  }

  /**
   * Starts a tongue at a fresh random spot on the funnel's surface.
   * @param {number} t tongue index
   * @returns {void}
   */
  function spawnTongue(t) {
    tongue.angle[t] = Math.random() * Math.PI * 2;
    tongue.root[t] = between(TONGUES.heightRange) * Vortex.height;
    tongue.age[t] = 0;
    tongue.life[t] = between(TONGUES.life);
    tongue.length[t] = between(TONGUES.length);
    tongue.lean[t] = between(TONGUES.lean);
  }

  /**
   * Flares and re-seeds the tongues and lays out their particles. While
   * the fire is out, dying tongues are not replaced.
   * @param {number} dt
   * @returns {void}
   */
  function updateTongues(dt) {
    const p = tongues;
    const segs = TONGUES.segments;
    const scaleX = Vortex.group.scale.x;
    const cx = Vortex.center.x;
    const cz = Vortex.center.z;
    const radiusAt = ctx.systems.vortex.funnelRadiusAt;
    tonguesShowing = false;
    for (let t = 0; t < TONGUES.count; t++) {
      tongue.age[t] += dt;
      if (tongue.age[t] >= tongue.life[t]) {
        if (state.strength > 0) spawnTongue(t);
        else tongue.life[t] = 0;
      }
      const u = tongue.life[t] > 0 ? tongue.age[t] / tongue.life[t] : 1;
      // Quick flare up, slower die-back.
      const flare = u >= 1 ? 0 : Math.sin(Math.PI * Math.pow(u, 0.6));
      const level = flare * state.strength;
      if (level > 0.01) tonguesShowing = true;
      tongue.angle[t] += TONGUES.swirlRate * dt;
      const angle = tongue.angle[t];
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rootR = radiusAt(tongue.root[t]) * scaleX;
      for (let k = 0; k < segs; k++) {
        const i = t * segs + k;
        const f = k / (segs - 1);               // 0 at the root, 1 at the tip
        const h = tongue.root[t] + f * tongue.length[t] * flare;
        // Leans out along a curve, so the tip hooks outward and up.
        const r = rootR * TONGUES.rootFraction + f * f * tongue.lean[t] * rootR * 0.25 * flare;
        p.positions[i * 3] = cx + cos * r;
        p.positions[i * 3 + 1] = h;
        p.positions[i * 3 + 2] = cz + sin * r;
        const c = scratch.copy(FLAMES.hot).lerp(FLAMES.warm, f);
        p.colours[i * 4] = c.r;
        p.colours[i * 4 + 1] = c.g;
        p.colours[i * 4 + 2] = c.b;
        p.colours[i * 4 + 3] = level * (0.95 - 0.45 * f);
        p.sizes[i] = level > 0.01 ? TONGUES.size * (1 - 0.7 * f) * (0.6 + 0.4 * flare) : 0;
      }
    }
  }

  /**
   * Embers breaking off the funnel's surface and drifting away.
   * @param {number} dt
   * @returns {void}
   */
  function updateEmbers(dt) {
    const p = embers;
    if (state.strength > 0) {
      const scaleX = Vortex.group.scale.x;
      const radiusAt = ctx.systems.vortex.funnelRadiusAt;
      p.accumulator += EMBERS.rate * state.strength * dt;
      while (p.accumulator >= 1) {
        p.accumulator -= 1;
        const i = p.next;
        p.next = (p.next + 1) % EMBERS.max;
        const angle = Math.random() * Math.PI * 2;
        const h = Math.random() * Vortex.height * 0.85;
        const r = radiusAt(h) * scaleX;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const out = between(EMBERS.outward);
        const tan = between(EMBERS.tangential);
        p.positions[i * 3] = Vortex.center.x + cos * r;
        p.positions[i * 3 + 1] = h;
        p.positions[i * 3 + 2] = Vortex.center.z + sin * r;
        // Outward plus along the swirl (counter-clockwise seen from above).
        p.velocities[i * 3] = cos * out - sin * tan;
        p.velocities[i * 3 + 1] = between(EMBERS.up);
        p.velocities[i * 3 + 2] = sin * out + cos * tan;
        p.life[i] = p.maxLife[i] = between(EMBERS.life);
        p.seed[i] = Math.random();
      }
    }
    const damping = Math.exp(-EMBERS.drag * dt);
    embersAlive = 0;
    for (let i = 0; i < EMBERS.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      embersAlive++;
      p.velocities[i * 3] *= damping;
      p.velocities[i * 3 + 2] *= damping;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      // Each ember twinkles at its own rate as it cools.
      const twinkle = 0.65 + 0.35 * Math.sin(state.time * (14 + 18 * p.seed[i]) + p.seed[i] * 30);
      p.colours[i * 4] = EMBERS.colour.r;
      p.colours[i * 4 + 1] = EMBERS.colour.g * (1 - 0.6 * u);
      p.colours[i * 4 + 2] = EMBERS.colour.b * (1 - u);
      p.colours[i * 4 + 3] = (1 - u) * twinkle;
      p.sizes[i] = EMBERS.size * (0.6 + 0.8 * p.seed[i]) * (1 - 0.5 * u);
    }
  }

  /**
   * Sparks trailing objects the vortex is carrying while it burns.
   * @param {number} dt
   * @returns {void}
   */
  function updateSparks(dt) {
    const p = sparks;
    if (state.strength > 0.2) {
      let burning = 0;
      for (const obj of Sim.objects) {
        if (burning >= SPARKS.maxBurning) break;
        if (obj.captureState !== 'rising' && obj.captureState !== 'orbiting') continue;
        burning++;
        if (Math.random() >= SPARKS.perObjectRate * state.strength * dt) continue;
        const i = p.next;
        p.next = (p.next + 1) % SPARKS.max;
        // Pooled debris has no mesh of its own (it is drawn instanced) and
        // keeps its position on the object, as in physics.js.
        const pos = obj.pooled ? obj.position : obj.mesh.position;
        if (!pos) continue;
        p.positions[i * 3] = pos.x;
        p.positions[i * 3 + 1] = pos.y;
        p.positions[i * 3 + 2] = pos.z;
        p.velocities[i * 3] = (Math.random() - 0.5) * 3;
        p.velocities[i * 3 + 1] = 1.5 + Math.random() * 2.5;
        p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
        p.life[i] = p.maxLife[i] = between(SPARKS.life);
        p.seed[i] = Math.random();
      }
    }
    sparksAlive = 0;
    for (let i = 0; i < SPARKS.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      sparksAlive++;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      p.colours[i * 4] = SPARKS.colour.r;
      p.colours[i * 4 + 1] = SPARKS.colour.g * (1 - 0.5 * u);
      p.colours[i * 4 + 2] = SPARKS.colour.b * (1 - u);
      p.colours[i * 4 + 3] = (1 - u) * 0.9;
      p.sizes[i] = SPARKS.size * (0.6 + 0.8 * p.seed[i]) * (1 - 0.6 * u);
    }
  }

  /**
   * Per frame (not while paused): the event's envelope and everything it
   * drives.
   * @param {number} dt
   * @returns {void}
   */
  function updateFirenado(dt) {
    if (!flames) return;
    state.time += dt;
    lookForFire(dt);
    // The funnel gone (the run over, or it lifted): the fire goes with it.
    if (state.phase === 'burning' && !funnelThere()) quench();
    if (state.phase === 'burning') {
      state.age += dt;
      if (state.age >= FIRENADO.duration) {
        state.phase = 'done';
        showBanner('Firenado burned out', 'The fire has blown itself out');
      }
    }
    const a = state.age;
    if (peerView()) {
      // Co-op guest: the host's envelope, eased, on this screen's own funnel.
      const before = replica.strength;
      replica.strength = Vortex.active ? easeStrength(before, replica.sent, dt) : 0;
      if (fireStarted(before, replica.strength)) showBanner('FIRENADO!', 'The funnel is on fire');
      state.strength = replica.strength;
    } else {
      state.strength = state.phase === 'burning'
        ? THREE.MathUtils.smoothstep(a, 0, FIRENADO.fadeIn)
          * (1 - THREE.MathUtils.smoothstep(a, FIRENADO.duration - FIRENADO.fadeOut, FIRENADO.duration))
          * Math.min(1, Vortex.presence)
        : 0;
    }

    // Firelight flicker: two quick sines and a little noise, never a clean
    // pulse.
    const flicker = 0.78 + 0.12 * Math.sin(state.time * 17) + 0.07 * Math.sin(state.time * 29 + 1.3)
      + 0.06 * Math.random();
    Vortex.fire = state.strength * flicker;
    light.intensity = FIRENADO.lightPeak * state.strength * flicker;
    light.position.set(Vortex.center.x, FIRENADO.lightHeight, Vortex.center.z);

    if (state.strength > 0 || flamesAlive > 0) {
      updateFlames(dt);
      markPoolDirty(flames);
    }
    if (state.strength > 0 || sparksAlive > 0) {
      updateSparks(dt);
      markPoolDirty(sparks);
    }
    if (state.strength > 0 || tonguesShowing) {
      updateTongues(dt);
      markPoolDirty(tongues);
    }
    if (state.strength > 0 || embersAlive > 0) {
      updateEmbers(dt);
      markPoolDirty(embers);
    }
    if (state.strength > 0 || groundFire.isBurning()) groundFire.updateGroundFire(dt, state.strength);
    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    for (const p of [flames, sparks, tongues, embers]) p.points.material.uniforms.uScale.value = scale;

    ctx.systems.fireSound.updateFireSound(state.strength, dt);

    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
  }

  /**
   * Puts everything out and re-arms the event for the next run.
   * @returns {void}
   */
  function resetFirenado() {
    replica.sent = 0;
    replica.strength = 0;
    state.phase = 'idle';
    state.age = 0;
    state.strength = 0;
    state.bannerTimer = 0;
    state.fireCheck = 0;
    Vortex.fire = 0;
    if (light) light.intensity = 0;
    tongue.life.fill(0);
    tongue.age.fill(0);
    for (const p of [flames, sparks, tongues, embers]) {
      if (!p) continue;
      p.life.fill(0);
      p.colours.fill(0);
      p.sizes.fill(0);
      p.accumulator = 0;
      markPoolDirty(p);
    }
    flamesAlive = 0;
    sparksAlive = 0;
    embersAlive = 0;
    tonguesShowing = false;
    groundFire.resetGroundFire();
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeFirenado() {
    const scene = Sim.three.scene;
    if (flames) disposeParticlePool(scene, flames);
    if (sparks) disposeParticlePool(scene, sparks);
    if (tongues) disposeParticlePool(scene, tongues);
    if (embers) disposeParticlePool(scene, embers);
    groundFire.disposeGroundFire();
    if (light) scene.remove(light);
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    ctx.systems.fireSound.disposeFireSound();
    flames = null;
    sparks = null;
    tongues = null;
    embers = null;
    light = null;
    banner = null;
  }

  /**
   * The Blizzard putting the fire out: it fades out now rather than at the
   * end of its burn.
   * @returns {void}
   */
  function quench() {
    if (state.phase !== 'burning') return;
    state.age = Math.max(state.age, FIRENADO.duration - FIRENADO.fadeOut);
  }

  /**
   * Whether a point stands in the ground fire this funnel lit.
   * @param {number} x World x.
   * @param {number} z World z.
   * @returns {boolean} True when a patch covers the point.
   */
  const groundContactAt = (x, z) => groundFire.contactAt(x, z);

  /** @returns {{slot: number, x: number, z: number, level: number}[]} the ground fire's patches, read-only (the co-op host's `fires` rows) */
  const groundFireState = () => groundFire.replicaState();

  /**
   * Co-op guest: draws the host's ground fires from the `fires` rows.
   * @param {Map<number, number[]>} rows
   * @returns {void}
   */
  const mirrorGroundFire = (rows) => groundFire.mirror(rows);

  /**
   * The fire's envelope as a plain number for a snapshot's `firenado` row,
   * read-only; null when the funnel is not burning (or on the guest).
   * @returns {number|null}
   */
  function replicaState() {
    return state.phase === 'burning' && state.strength > 0 && !peerView() ? state.strength : null;
  }

  /**
   * Co-op guest: the host's `firenado` row (undefined when the host sends
   * none). It only sets the strength the flames, tongues, embers, glow, light
   * and roar are drawn at in updateFirenado; the phase never changes, so
   * burning() and damageMultiplier() report nothing.
   * @param {ReadonlyArray<number>|undefined} row
   * @returns {void}
   */
  function mirror(row) {
    replica.sent = row ? row[1] : 0;
  }

  return { initFirenado, updateFirenado, ignite, quench, damageMultiplier, groundContactAt, groundFireState, mirrorGroundFire, replicaState, mirror, burning, resetFirenado, disposeFirenado };
}
