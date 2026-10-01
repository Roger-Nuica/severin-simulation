// @ts-check
import * as THREE from 'three';
import { createFireTexture, createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';
import { GAS } from './gasMains/config.js';
/** @typedef {import('./gasMains/config.js').Segment} Segment */
/** @typedef {import('./gasMains/config.js').Main} Main */
import { createGasNetwork } from './gasMains/network.js';
import { createGasFire } from './gasMains/fire.js';

/**
 * ===========================================================================
 * SECTION Y — Buried gas mains
 * ===========================================================================
 * A low-pressure gas network under the streets, and what happens when
 * something opens one up.
 *
 * Every other disaster in this scene destroys a *radius*: a blast, a crater,
 * a shock wave, a funnel. This one destroys a *route*. The mains follow the
 * road grid, so the fire travels down the middle of a street, turns at the
 * junctions it reaches, and lights the buildings either side of it as it
 * goes. Nothing else here moves through the town along the town's own lines,
 * which is the entire reason it exists.
 *
 * The model is deliberately a graph rather than a fluid:
 *
 *  - six mains, one under each straight street (the same grid the utility
 *    poles and the crowd's walking routes use, so the fire runs where the
 *    player already reads the streets as being);
 *  - each main is a row of fixed-length segments, and a segment is `sealed`,
 *    `venting` (gas out, not yet lit), `burning`, or `spent`;
 *  - a burning segment hands the flame to its neighbours after a fixed
 *    interval, which *is* the front speed -- segment length over interval --
 *    with no front object to keep track of;
 *  - where two mains cross, the junction segment hands the flame sideways as
 *    well, so the fire branches at the crossroads and both new fronts then
 *    run outwards on their own.
 *
 * A segment that has burnt stays `spent` and keeps its scar for the rest of
 * the run: the streets the fire has been down are visibly charred, which is
 * the readable record of where it went. It also means the front cannot
 * double back through ground it has already burnt, so a main burns end to
 * end once and then it is over.
 *
 * Ruptures come from whatever tears the ground up: a fissure opening across
 * a street (engine/fissure.js), a meteor crater (engine/meteors.js), the
 * chemical works or the tanker going off, an arc off the electric funnel --
 * and the panel's own button, so it can be seen on demand. Everything comes
 * in through `ruptureAt`, which does not care which of those it was.
 */

/*
 * Split by job across engine/gasMains/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js   tunables
 *   network.js  the pipes under the streets, ruptures and the fire running along them
 *   fire.js     jets, smoke, their light and the hazard they are
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initGasMains: () => void,
 *   updateGasMains: (dt: number) => void,
 *   ruptureAt: (x: number, z: number, radius: number, options?: {ignite?: boolean, announce?: boolean}) => number,
 *   ruptureRandom: () => void,
 *   burningCount: () => number,
 *   resetGasMains: () => void,
 *   disposeGasMains: () => void
 * }}
 */
export function createGasMainsSystem(ctx) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {Main[]} */
    mains: [],
    /** @type {Segment[]} */
    segments: [],
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {THREE.InstancedMesh|null} */
    seams: null,
    /** @type {THREE.InstancedBufferAttribute|null} */
    heatAttr: null,
    /** @type {THREE.InstancedBufferAttribute|null} */
    scarAttr: null,
    /** @type {THREE.ShaderMaterial|null} */
    seamMaterial: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    jets: null,
    /** @type {import('./particlePool.js').ParticlePool|null} */
    smoke: null,
    /** @type {HTMLDivElement|null} */
    banner: null,

    bannerTimer: 0,

    time: 0,

    seamDirty: false,

    jetsAlive: 0,

    smokeAlive: 0,

    scratch: new THREE.Color(),

    scratchVec: new THREE.Vector3()
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createGasNetwork(ctx, S, api),
    createGasFire(ctx, S, api),
    { showBanner }
  );

  /** @returns {void} */
  function initGasMains() {
    S.group = new THREE.Group();
    S.group.name = 'gas_mains';
    Sim.three.scene.add(S.group);

    api.buildNetwork();
    api.buildSeams();

    S.jets = createParticlePool(
      Sim.three.scene, GAS.jetMax, createFireTexture(), THREE.AdditiveBlending, 'gas_jets'
    );
    S.smoke = createParticlePool(
      Sim.three.scene, GAS.smokeMax, createSoftDotTexture(), THREE.NormalBlending, 'gas_smoke'
    );

    if (!S.banner) {
      S.banner = document.createElement('div');
      S.banner.className = 'gas-banner';
      S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(S.banner);
    }
    const button = document.getElementById('btn-gas');
    if (button) button.addEventListener('click', () => api.ruptureRandom(), { signal: ctx.signal });
  }

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
    S.bannerTimer = GAS.bannerSeconds;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateGasMains(dt) {
    if (!S.group) return;
    S.time += dt;
    if (S.bannerTimer > 0) {
      S.bannerTimer -= dt;
      if (S.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }

    let live = 0;
    for (const segment of S.segments) {
      if (segment.state === 'sealed' || segment.state === 'spent') continue;
      live++;

      if (segment.state === 'venting') {
        segment.timer -= dt;
        S.jets.accumulator += GAS.ventRate * dt;
        while (S.jets.accumulator >= 1) {
          S.jets.accumulator -= 1;
          api.spawnJet(segment, 'vent');
        }
        // Whatever is in the air over an open main finds a spark eventually.
        if (segment.timer <= 0) api.lightSegment(segment, segment.pressure);
        continue;
      }

      // Burning.
      segment.timer -= dt;
      const remaining = segment.timer;
      // Up fast, then down over the last fadeSeconds as the gas runs out.
      const heat = Math.min(
        THREE.MathUtils.smoothstep(segment.burn - remaining, 0, 0.35),
        THREE.MathUtils.smoothstep(remaining, 0, GAS.fadeSeconds)
      );
      if (heat !== segment.heat) S.seamDirty = true;
      segment.heat = heat;
      if (segment.scar < 1) {
        segment.scar = Math.min(1, segment.scar + dt * 0.8);
        S.seamDirty = true;
      }

      if (!segment.passed) {
        segment.spread -= dt;
        if (segment.spread <= 0) api.passFlame(segment);
      }

      S.jets.accumulator += GAS.jetRate * heat * dt;
      if (segment.manhole) S.jets.accumulator += GAS.columnRate * heat * dt;
      while (S.jets.accumulator >= 1) {
        S.jets.accumulator -= 1;
        api.spawnJet(segment, segment.manhole && Math.random() < 0.55 ? 'column' : 'jet');
      }
      S.smoke.accumulator += GAS.smokeRate * heat * dt;
      while (S.smoke.accumulator >= 1) {
        S.smoke.accumulator -= 1;
        api.spawnSmoke(segment);
      }

      if (remaining <= 0) {
        segment.state = 'spent';
        segment.heat = 0;
        S.seamDirty = true;
      }
    }

    if (live) {
      api.requestLights();
      api.updateHazards();
    } else if (S.mains.some(m => m.hazard)) {
      api.updateHazards();
    }

    if (S.seamDirty) {
      for (let i = 0; i < S.segments.length; i++) {
        S.heatAttr.array[i] = S.segments[i].heat;
        S.scarAttr.array[i] = S.segments[i].scar;
      }
      S.heatAttr.needsUpdate = true;
      S.scarAttr.needsUpdate = true;
      S.seamDirty = false;
    }
    S.seamMaterial.uniforms.uTime.value = S.time;

    if (live || S.jetsAlive) {
      api.updateJets(dt);
      markPoolDirty(S.jets);
    }
    if (live || S.smokeAlive) {
      api.updateSmoke(dt);
      markPoolDirty(S.smoke);
    }
    if (live || S.jetsAlive || S.smokeAlive) {
      const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
      S.jets.points.material.uniforms.uScale.value = scale;
      S.smoke.points.material.uniforms.uScale.value = scale;
    }
  }

  /**
   * Seals the network and scrubs the streets, from resetSim().
   * @returns {void}
   */
  function resetGasMains() {
    for (const segment of S.segments) {
      segment.state = 'sealed';
      segment.timer = 0;
      segment.spread = 0;
      segment.pressure = 0;
      segment.passed = false;
      segment.heat = 0;
      segment.scar = 0;
    }
    for (const main of S.mains) {
      if (main.hazard) {
        ctx.systems.hazards.removeHazard(main.hazard);
        main.hazard = null;
      }
    }
    if (S.heatAttr) {
      S.heatAttr.array.fill(0);
      S.scarAttr.array.fill(0);
      S.heatAttr.needsUpdate = true;
      S.scarAttr.needsUpdate = true;
    }
    for (const pool of [S.jets, S.smoke]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      markPoolDirty(pool);
    }
    S.jetsAlive = 0;
    S.smokeAlive = 0;
    if (S.banner) S.banner.classList.remove('visible');
    S.bannerTimer = 0;
  }

  /** @returns {void} */
  function disposeGasMains() {
    if (!S.group) return;
    if (S.seams) {
      S.seams.geometry.dispose();
      S.seams.dispose();
    }
    if (S.seamMaterial) S.seamMaterial.dispose();
    if (S.jets) disposeParticlePool(Sim.three.scene, S.jets);
    if (S.smoke) disposeParticlePool(Sim.three.scene, S.smoke);
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    Sim.three.scene.remove(S.group);
    S.group = null;
    S.seams = null;
    S.seamMaterial = null;
    S.heatAttr = null;
    S.scarAttr = null;
    S.jets = null;
    S.smoke = null;
    S.banner = null;
    S.mains.length = 0;
    S.segments.length = 0;
  }

  return {
    initGasMains, updateGasMains, ruptureAt: api.ruptureAt, ruptureRandom: api.ruptureRandom, burningCount: api.burningCount,
    resetGasMains, disposeGasMains
  };
}
