import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';
import { ELECTRIC, ARC_VERTEX, ARC_FRAGMENT } from './electricStorm/config.js';
import { createElectricStrikes } from './electricStorm/strikes.js';
import { createElectricGlow } from './electricStorm/glow.js';
import { createElectricEmp } from './electricStorm/emp.js';

/**
 * ===========================================================================
 * SECTION W — Electric tornado
 * ===========================================================================
 * A mode rather than an event: switched on from the panel, it stays on, and
 * every funnel in play becomes an electrical storm wrapped around a tornado.
 *
 * Five things are running at once, and they are deliberately different kinds
 * of thing rather than five versions of "draw a bolt":
 *
 *  - **the sheath**: arcs crawling up the outside of the funnel, following
 *    its actual lathe profile so they hug the cone rather than floating
 *    around it, and re-struck several times a second;
 *  - **ground strikes**: arcs out of the funnel wall into the town, aimed at
 *    real targets -- buildings, trees, people -- and doing real damage
 *    through the routes the rest of the simulation already uses. This is what
 *    makes the mode a weapon rather than a paint job;
 *  - **chain lightning**: a strike that lands on a building jumps from there
 *    to its nearest neighbour, and from that one to the next, so the current
 *    walks through the street it hits;
 *  - **ball lightning**: a handful of plasma orbs in orbit around the column,
 *    each of which occasionally lets go into the ground beneath it;
 *  - **the EMP**: every few seconds the column discharges a ring that travels
 *    outward across the whole map, faulting every power line it crosses,
 *    shocking buildings and lighting fires as it goes -- and electrocuting
 *    people in the open that it passes over (see electrocute), with the odds
 *    falling off the further out the ring has got. The ring is also drawn on
 *    the minimap (ui/minimap.js, through empRing()).
 *
 * Cost is the reason it is built the way it is. Every arc on screen -- sheath,
 * strike, chain, orb discharge -- lives in one mesh of camera-facing ribbons
 * with a fixed vertex budget, rebuilt each frame from whichever arcs are
 * still alive, so the entire storm is a single draw call no matter how much
 * is happening. The rest is a few veined cones, one ring, one Points and one
 * light, plus a blue glow on the funnel's own surface (vortex.js applyFlash).
 */

/*
 * Split by job across engine/electricStorm/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js   every tunable
 *   strikes.js  the funnel's lightning: bolts, forks, targets, hits
 *   glow.js     orbs, motes, shells, sparks and the arcs' geometry
 *   emp.js      EMP waves and electrocution
 * and this file: set-up, the switch, the frame, reset and dispose, with the
 * shared state S and the modules' functions in `api`.
 */

/**
 * @typedef {Object} Arc
 * @property {THREE.Vector3[]} base the path the arc was struck along
 * @property {THREE.Vector3[]} points the displaced path actually drawn
 * @property {THREE.Vector3[]} offsets per-point unit bearing for the writhe
 * @property {number} phase
 * @property {number} amp
 * @property {number} age
 * @property {number} life
 * @property {number} maxLife
 * @property {number} gain brightness multiplier
 * @property {boolean} halo whether glow sprites are sampled along it
 * @property {number} hot 0..1, how far towards white a fresh arc starts
 * @property {number} width ribbon width at the arc's origin, world units
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initElectricStorm: () => void,
 *   updateElectricStorm: (dt: number) => void,
 *   setElectric: (on: boolean) => void,
 *   isActive: () => boolean,
 *   empRing: () => ({x: number, z: number, radius: number, strength: number}|null),
 *   resetElectricStorm: () => void,
 *   disposeElectricStorm: () => void
 * }}
 */
export function createElectricStormSystem(ctx) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {THREE.Mesh|null} */
    arcMesh: null,
    /** @type {Float32Array|null} */
    arcPositions: null,
    /** @type {Float32Array|null} */
    arcColours: null,
    /** @type {Float32Array|null} */
    arcEdges: null,
    // Per-point ribbon half-width vectors for the arc being written, reused
    // every frame (writeArcs).
    /** @type {THREE.Vector3[]} */
    sides: [],
    /** @type {Arc[]} */
    arcs: [],
    /** @type {import('./particlePool.js').ParticlePool|null} */
    glow: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    sparks: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    motes: null,
    /** @type {{mesh: THREE.Mesh, frac: number, spin: number, angle: number}[]} */
    shells: [],
    /** @type {THREE.Mesh|null} */
    ring: null,
    /** @type {THREE.Points|null} */
    orbs: null,
    /** @type {Object[]} */
    orbData: [],
    /** @type {THREE.Object3D|null} */
    light: null,
    /** @type {HTMLDivElement|null} */
    banner: null,
    /** @type {THREE.Material[]} */
    materials: [],
    /** @type {THREE.Texture|null} */
    orbTexture: null,

    state: {
      active: false,
      sheathTimer: 0,
      filamentTimer: 0,
      crackleAccumulator: 0,
      strikeTimer: 0,
      crownTimer: 0,
      empTimer: ELECTRIC.empInterval,
      bannerTimer: 0,
      // Brightness of the column's own glow, 0..1, kicked up by each discharge
      // and decaying between them.
      charge: 0,
      // The travelling EMP.
      empActive: false,
      empRadius: 0,
      /** @type {Set<Object>} */
      empDone: new Set(),
      empKills: 0
    },
    /**
     * People being electrocuted: convulsing, then charred and falling.
     * @type {{person: Object, timer: number, materials: THREE.MeshStandardMaterial[], x: number, z: number, charred?: boolean}[]}
     */
    jolts: [],

    scratchA: new THREE.Vector3(),

    scratchB: new THREE.Vector3(),

    scratchColour: new THREE.Color()
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createElectricStrikes(ctx, S, api),
    createElectricGlow(ctx, S, api),
    createElectricEmp(ctx, S, api),
    { between, funnelShape, showBanner }
  );

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * The funnel's world geometry, which is not simply Vortex.height and
   * Vortex.topRadius: updateVortexVisuals scales the whole group by the
   * radius slider, the Fujiwhara size multiplier and the merge fade, and
   * scales height separately again. An arc drawn from the unscaled numbers
   * sits inside a big funnel and outside a small one.
   * @param {Object} instance a tornado registry instance
   * @returns {{center: THREE.Vector3, height: number, radiusAt: (y: number) => number}}
   */
  function funnelShape(instance) {
    const v = instance.Vortex;
    // Read straight off the funnel group's transform rather than re-derived
    // from the same inputs, so it also follows the touchdown growth
    // (vortex.js BIRTH) and anything else that comes to scale it.
    const horizontal = v.group.scale.x;
    const vertical = v.group.scale.y;
    return {
      center: v.center,
      height: v.height * vertical,
      radiusAt: (y) => instance.funnelRadiusAt(y / vertical) * horizontal
    };
  }

  // ---------------------------------------------------------------------
  // Assembly
  // ---------------------------------------------------------------------

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!S.banner) return;
    S.banner.querySelector('.title').textContent = title;
    S.banner.querySelector('.sub').textContent = sub;
    S.banner.classList.add('visible');
    S.state.bannerTimer = ELECTRIC.bannerSeconds;
  }

  /** @returns {void} */
  function initElectricStorm() {
    S.group = new THREE.Group();
    S.group.name = 'electricStorm';
    Sim.three.scene.add(S.group);

    // The one buffer every arc in the system writes into: two triangles per
    // segment of every arc, as camera-facing ribbons (see writeArcs).
    const vertexBudget = ELECTRIC.maxSegments * 6;
    S.arcPositions = new Float32Array(vertexBudget * 3);
    S.arcColours = new Float32Array(vertexBudget * 3);
    S.arcEdges = new Float32Array(vertexBudget);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(S.arcPositions, 3));
    geo.setAttribute('aColour', new THREE.BufferAttribute(S.arcColours, 3));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(S.arcEdges, 1));
    geo.setDrawRange(0, 0);
    const arcMat = new THREE.ShaderMaterial({
      vertexShader: ARC_VERTEX,
      fragmentShader: ARC_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    S.materials.push(arcMat);
    S.arcMesh = new THREE.Mesh(geo, arcMat);
    S.arcMesh.name = 'electric_arcs';
    S.arcMesh.frustumCulled = false;
    S.arcMesh.visible = false;
    S.group.add(S.arcMesh);

    // The interior is built from pieces rather than one surface; see the
    // note by ELECTRIC.filamentCount.
    api.buildShells();

    const ringMat = new THREE.MeshBasicMaterial({
      color: ELECTRIC.ringColour,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    S.materials.push(ringMat);
    S.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64), ringMat);
    S.ring.rotation.x = -Math.PI / 2;
    S.ring.name = 'electric_emp';
    S.ring.visible = false;
    S.group.add(S.ring);

    api.buildOrbs();

    // The halo around every channel, and the sparks thrown where they land.
    S.glow = createParticlePool(
      Sim.three.scene, ELECTRIC.glowMax, createSoftDotTexture(), THREE.AdditiveBlending, 'electric_glow'
    );
    S.sparks = createParticlePool(
      Sim.three.scene, ELECTRIC.sparkMax, createSoftDotTexture(), THREE.AdditiveBlending, 'electric_sparks'
    );
    S.motes = createParticlePool(
      Sim.three.scene, ELECTRIC.moteMax, createSoftDotTexture(), THREE.AdditiveBlending, 'electric_motes'
    );
    S.glow.points.visible = false;
    S.motes.points.visible = false;

    S.light = ctx.systems.lightPool.createLight(ELECTRIC.lightColour, 0, ELECTRIC.lightDistance, 2);
    S.light.name = 'electric_light';
    Sim.three.scene.add(S.light);

    if (!S.banner) {
      S.banner = document.createElement('div');
      S.banner.className = 'electric-banner';
      S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(S.banner);
    }

    const button = document.getElementById('btn-electric');
    if (button) button.addEventListener('click', () => setElectric(!S.state.active), { signal: ctx.signal });
  }

  /**
   * Keeps the panel button showing what the mode is actually doing. Owned by
   * setElectric rather than by the click handler, because the arc storm is also
   * switched on by the Doomsday script (engine/doomsday.js) and a mode that is
   * on with its button looking off is worse than no button at all.
   * @returns {void}
   */
  function syncButton() {
    const button = document.getElementById('btn-electric');
    if (!button) return;
    button.setAttribute('aria-pressed', String(S.state.active));
    button.classList.toggle('active', S.state.active);
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function setElectric(on) {
    // A click reaching an instance that has already been disposed (its
    // button listener outlives it, e.g. React's dev-mode double mount) has
    // nothing left to switch.
    if (!S.group) return;
    if (on === S.state.active) return;
    S.state.active = on;
    syncButton();
    S.arcMesh.visible = on;
    S.orbs.visible = on;
    S.glow.points.visible = on;
    S.motes.points.visible = on;
    for (const shell of S.shells) shell.mesh.visible = on;
    if (on) {
      S.state.empTimer = 3.5;
      S.state.charge = 1;
      showBanner('ELECTRIC TORNADO', 'The column is live');
    } else {
      for (const instance of ctx.tornadoes.instances) instance.Vortex.electric = 0;
      S.arcs.length = 0;
      S.state.empActive = false;
      S.state.charge = 0;
      S.ring.visible = false;
      S.light.intensity = 0;
      S.arcMesh.geometry.setDrawRange(0, 0);
      for (const pool of [S.glow, S.motes]) {
        pool.life.fill(0);
        pool.sizes.fill(0);
        pool.colours.fill(0);
        markPoolDirty(pool);
      }
    }
  }

  /** @returns {boolean} */
  function isActive() {
    return S.state.active;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateElectricStorm(dt) {
    if (!S.group) return;

    if (S.state.bannerTimer > 0) {
      S.state.bannerTimer -= dt;
      if (S.state.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }
    // Sparks already in the air outlive the mode being switched off, and so
    // does anyone already being electrocuted.
    api.updateSparks(dt);
    api.updateJolts(dt);
    if (!S.state.active) return;

    const instances = ctx.tornadoes.active;
    if (!instances.length) return;
    const lead = instances[0];

    // Nothing to electrify until the funnel has come down out of the cloud
    // (vortex.js BIRTH) -- before Start there is no tornado at all, and a
    // storm of arcs round an empty patch of air is exactly the wrong read.
    const born = lead.Vortex.groundPresence;
    S.orbs.visible = born > 0.05;
    if (!S.orbs.visible) {
      for (const shell of S.shells) shell.mesh.material.uniforms.uCharge.value = 0;
      S.light.intensity = 0;
      api.writeArcs(dt);
      return;
    }

    // The column glows between discharges and flares on each one -- the
    // funnel's own surface too (vortex.js applyFlash).
    S.state.charge = Math.max(0.25, S.state.charge - dt * 1.1);
    for (const instance of instances) instance.Vortex.electric = (0.45 + S.state.charge * 0.55) * born;

    // Arcs are struck against every funnel in play, so an Outbreak of three
    // electric tornadoes is three electrical storms rather than one.
    S.state.sheathTimer -= dt;
    while (S.state.sheathTimer <= 0) {
      for (const instance of instances) {
        for (let i = 0; i < ELECTRIC.sheathCount; i++) api.strikeSheath(instance);
      }
      S.state.sheathTimer += between(ELECTRIC.sheathInterval);
    }

    S.state.filamentTimer -= dt;
    while (S.state.filamentTimer <= 0) {
      for (const instance of instances) {
        for (let i = 0; i < ELECTRIC.filamentCount; i++) api.strikeFilament(instance);
      }
      S.state.filamentTimer += between(ELECTRIC.filamentInterval);
    }

    S.state.crackleAccumulator += ELECTRIC.crackleRate * instances.length * dt;
    while (S.state.crackleAccumulator >= 1) {
      S.state.crackleAccumulator -= 1;
      api.strikeCrackle(instances[Math.floor(Math.random() * instances.length)]);
    }

    S.motes.accumulator += ELECTRIC.moteRate * dt;
    while (S.motes.accumulator >= 1) {
      S.motes.accumulator -= 1;
      api.spawnMote(lead);
    }

    S.state.crownTimer -= dt;
    while (S.state.crownTimer <= 0) {
      api.strikeCrown(instances[Math.floor(Math.random() * instances.length)]);
      S.state.crownTimer += between(ELECTRIC.crownInterval);
    }

    // Ground strikes only once a run is under way: a tornado standing still
    // on the start screen should not be levelling the town before Start.
    if (Sim.state.running) {
      S.state.strikeTimer -= dt;
      while (S.state.strikeTimer <= 0) {
        api.strikeGround(instances[Math.floor(Math.random() * instances.length)]);
        S.state.strikeTimer += between(ELECTRIC.strikeInterval);
      }

      S.state.empTimer -= dt;
      if (S.state.empTimer <= 0 && !S.state.empActive) {
        S.state.empTimer = ELECTRIC.empInterval;
        api.fireEMP(lead);
      }
    }
    if (S.state.empActive) api.updateEMP(dt);

    api.updateOrbs(dt, lead);

    // The charged column, sized to the lead funnel.
    const shape = funnelShape(lead);
    const topRadius = shape.radiusAt(shape.height);
    for (const shell of S.shells) {
      shell.angle += shell.spin * dt;
      shell.mesh.position.set(shape.center.x, shape.height / 2, shape.center.z);
      shell.mesh.rotation.y = shell.angle;
      shell.mesh.scale.set(topRadius * shell.frac, shape.height, topRadius * shell.frac);
      shell.mesh.material.uniforms.uTime.value += dt;
      shell.mesh.material.uniforms.uCharge.value = (0.45 + S.state.charge * 0.55) * born;
    }
    api.updateMotes(dt, lead);

    S.light.position.set(shape.center.x, shape.height * 0.35, shape.center.z);
    S.light.intensity = ELECTRIC.lightPeak * (0.25 + S.state.charge * 0.75);

    api.writeArcs(dt);
  }

  /** @returns {void} */
  function resetElectricStorm() {
    S.arcs.length = 0;
    S.state.empActive = false;
    S.state.empRadius = 0;
    S.state.empDone.clear();
    S.state.empTimer = ELECTRIC.empInterval;
    // The town is regenerated by the reset; these bodies belong to the old one.
    S.jolts.length = 0;
    S.state.charge = S.state.active ? 1 : 0;
    if (S.ring) S.ring.visible = false;
    if (S.arcMesh) S.arcMesh.geometry.setDrawRange(0, 0);
    for (const pool of [S.glow, S.sparks, S.motes]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      markPoolDirty(pool);
    }
  }

  /** @returns {void} */
  function disposeElectricStorm() {
    if (!S.group) return;
    S.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const mat of S.materials) mat.dispose();
    S.materials.length = 0;
    if (S.orbTexture) S.orbTexture.dispose();
    if (S.glow) disposeParticlePool(Sim.three.scene, S.glow);
    if (S.sparks) disposeParticlePool(Sim.three.scene, S.sparks);
    if (S.motes) disposeParticlePool(Sim.three.scene, S.motes);
    if (S.light) Sim.three.scene.remove(S.light);
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    Sim.three.scene.remove(S.group);
    S.group = null;
    S.arcMesh = null;
    S.arcPositions = null;
    S.arcColours = null;
    S.shells = [];
    S.ring = null;
    S.orbs = null;
    S.glow = null;
    S.sparks = null;
    S.motes = null;
    S.orbData = [];
    S.light = null;
    S.banner = null;
    S.orbTexture = null;
    S.arcs.length = 0;
  }

  return {
    initElectricStorm,
    updateElectricStorm,
    setElectric,
    isActive,
    surfaceArc: api.surfaceArc,
    empRing: api.empRing,
    // Called by the lightning strikes the player calls down too
    // (engine/strikeTargeting.js).
    electrocute: api.electrocute,
    resetElectricStorm,
    disposeElectricStorm
  };
}
