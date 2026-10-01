// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { CAPS } from './perf/caps.js';

/**
 * ===========================================================================
 * SECTION BZ — Blizzard (the ice tornado)
 * ===========================================================================
 * A mode, like the Electric Tornado: ❄️ Blizzard in 💥 Disasters switches it
 * on and off. While it is on, every funnel is an ice storm:
 *  - an icy glow in the column and a pale swirl (vortex/look.js, Vortex.ice),
 *    and snow driven round it (one particle pool, on the particle budget);
 *  - within BLIZZARD.reach of a funnel (its capture edge times that),
 *    everything freezes (engine/effects/freeze.js): townspeople become ice
 *    statues (CAPS.batch a tick at most), which shatter into ice debris at
 *    any impact -- and the funnel, catching one, is an impact; the enemies
 *    stand in blocks of ice for BLIZZARD.enemyFreeze seconds; Roger freezes
 *    for BLIZZARD.rogerFreeze;
 *  - the dam's water freezes (flood.js setFrozen): the reservoir ice-white,
 *    and a flood already out stops dead where it is until the thaw;
 *  - the earthquake's lava freezes: every vent and caldera lake is put out
 *    (fissure.js quench) under a crust of ice, and the chasm's lava strips
 *    are iced over with their glow gone (chasm.js setFrozen).
 *
 * Switched off, the water and the chasm thaw; the statues stay ice (they
 * were people) until something breaks them, and the quenched lava stays out.
 */

export const BLIZZARD = {
  reach: 1.7,              // x the funnel's capture edge
  tick: 0.4,               // seconds between two freezing checks
  enemyFreeze: 5,
  rogerFreeze: 3,
  snowMax: 1200,
  snowRate: 420,           // flakes a second, all funnels together
  snowRadius: 2.4,         // x the funnel's radius
  crust: 0xe4f4ff
};

/**
 * @param {Object} ctx
 * @returns {{
 *   setBlizzard: (on: boolean) => void,
 *   active: () => boolean,
 *   initBlizzard: () => void,
 *   updateBlizzard: (dt: number) => void,
 *   resetBlizzard: () => void,
 *   disposeBlizzard: () => void
 * }}
 */
export function createBlizzardSystem(ctx) {
  const { Sim } = ctx;
  let on = false;
  let tick = 0;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let snow = null;
  let snowAlive = false;
  /** @type {THREE.Mesh[]} ice over the lava */
  const crusts = [];
  /** @type {WeakSet<object>} vents and lakes already under their crust */
  let crusted = new WeakSet();
  /** @type {THREE.MeshStandardMaterial|null} */
  let crustMat = null;
  /** @type {THREE.CircleGeometry|null} */
  let discGeo = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (banner) {
      /** @type {HTMLElement} */ (banner.querySelector('.title')).textContent = title;
      /** @type {HTMLElement} */ (banner.querySelector('.sub')).textContent = sub;
      banner.classList.add('visible');
      bannerTimer = 3.2;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /** @returns {void} */
  function syncButton() {
    const button = document.getElementById('btn-blizzard');
    if (!button) return;
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('active', on);
  }

  /**
   * A crust of ice laid over something hot.
   * @param {THREE.Mesh} mesh
   * @returns {void}
   */
  function addCrust(mesh) {
    mesh.name = 'blizzard_ice';
    mesh.renderOrder = 2;
    Sim.three.scene.add(mesh);
    crusts.push(mesh);
  }

  /**
   * The lava: the vents and calderas put out under ice, the chasm iced over.
   * @returns {void}
   */
  function freezeLava() {
    const fissures = ctx.systems.fissures;
    if (fissures && crustMat && discGeo) {
      for (const spot of fissures.hotSpots()) {
        if (!(spot.level > 0)) continue;
        const radius = spot.radius || 2.5;
        // Put out again if it flares (the quake still shaking), but one
        // crust each.
        fissures.quench(spot);
        if (crusted.has(spot)) continue;
        crusted.add(spot);
        const disc = new THREE.Mesh(discGeo, crustMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.set(spot.x, 0.3, spot.z);
        disc.scale.setScalar(radius * 1.2);
        addCrust(disc);
      }
    }
    const chasm = ctx.systems.chasm;
    if (chasm && crustMat) {
      for (const { mesh } of chasm.setFrozen(true)) {
        if (crusts.some(c => c.userData.over === mesh)) continue;
        mesh.updateMatrixWorld(true);
        const ice = new THREE.Mesh(mesh.geometry, crustMat);
        ice.matrixAutoUpdate = false;
        ice.matrix.copy(mesh.matrixWorld);
        ice.matrix.elements[13] += 0.05;
        ice.userData.over = mesh;
        addCrust(ice);
      }
    }
  }

  /**
   * @param {boolean} value
   * @returns {void}
   */
  function setBlizzard(value) {
    if (value === on || !snow) return;
    on = value;
    syncButton();
    if (ctx.systems.flood) ctx.systems.flood.setFrozen(on);
    if (on) {
      tick = 0;
      freezeLava();
      showBanner('BLIZZARD', 'An ice tornado · people turn to ice, the water and the lava freeze');
    } else {
      for (const inst of ctx.tornadoes.instances) inst.Vortex.ice = 0;
      if (ctx.systems.chasm) ctx.systems.chasm.setFrozen(false);
      // The chasm thaws: its ice goes. The vents stay out.
      for (let i = crusts.length - 1; i >= 0; i--) {
        if (!crusts[i].userData.over) continue;
        Sim.three.scene.remove(crusts[i]);
        crusts.splice(i, 1);
      }
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepSnow(dt) {
    if (!snow || !snowAlive) return;
    snow.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < snow.life.length; i++) {
      if (snow.life[i] <= 0) {
        if (snow.sizes[i] !== 0) { snow.colours[i * 4 + 3] = 0; snow.sizes[i] = 0; }
        continue;
      }
      any = true;
      snow.life[i] -= dt;
      const t = 1 - Math.max(0, snow.life[i]) / snow.maxLife[i];
      const v = i * 3;
      snow.positions[v] += snow.velocities[v] * dt;
      snow.positions[v + 1] = Math.max(0.1, snow.positions[v + 1] + snow.velocities[v + 1] * dt);
      snow.positions[v + 2] += snow.velocities[v + 2] * dt;
      snow.colours.set([0.93, 0.97, 1, 0.85 * Math.min(1, t * 5) * (1 - t)], i * 4);
      snow.sizes[i] = 0.5 + snow.seed[i] * 0.7;
    }
    markPoolDirty(snow);
    snowAlive = any;
  }

  /**
   * Snow driven round each funnel.
   * @param {number} dt
   * @returns {void}
   */
  function emitSnow(dt) {
    if (!snow) return;
    const vortices = ctx.tornadoes.activeVortices;
    if (!vortices.length) return;
    let n = Math.min(Math.round(BLIZZARD.snowRate * dt + Math.random()), ctx.systems.caps.particleRoom());
    const R = Sim.params.radius;
    while (n-- > 0) {
      const v = vortices[n % vortices.length];
      const i = snow.next;
      snow.next = (snow.next + 1) % snow.life.length;
      const life = 1.5 + Math.random() * 1.2;
      snow.life[i] = life;
      snow.maxLife[i] = life;
      snow.seed[i] = Math.random();
      const a = Math.random() * Math.PI * 2;
      const r = (0.4 + Math.random()) * R * (v.sizeMul || 1) * BLIZZARD.snowRadius * 0.6;
      snow.positions.set([v.center.x + Math.cos(a) * r, 1 + Math.random() * 30, v.center.z + Math.sin(a) * r], i * 3);
      const spin = 18 + Math.random() * 10;
      snow.velocities.set([-Math.sin(a) * spin, -3, Math.cos(a) * spin], i * 3);
    }
    snowAlive = true;
  }

  /**
   * What freezes near each funnel.
   * @returns {void}
   */
  function freezeTick() {
    const freeze = ctx.systems.freeze;
    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    const edge = Sim.params.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor;
    let turned = 0;
    for (const v of ctx.tornadoes.activeVortices) {
      if (!(v.birth > 0.5) || v.neutralized) continue;
      const reach = edge * (v.sizeMul || 1) * BLIZZARD.reach;
      const { x, z } = v.center;
      ctx.systems.area.forEachInRadius({ x, z, radius: reach, targets: ['person'] }, (hit) => {
        if (turned < CAPS.batch && freeze.makeStatue(hit.target)) turned++;
      });
      for (const kind of ctx.systems.enemies.kinds()) {
        for (const e of kind.list()) {
          const q = kind.position(e);
          if (Math.hypot(q.x - x, q.z - z) < reach) freeze.freezeEnemy(e, kind, BLIZZARD.enemyFreeze);
        }
      }
      if (roger && Math.hypot(roger.x - x, roger.z - z) < reach) freeze.freezeRoger(BLIZZARD.rogerFreeze);
    }
    // Lava that has come up since (a quake during the Blizzard) freezes too.
    freezeLava();
  }

  /** @returns {void} */
  function initBlizzard() {
    snow = createParticlePool(Sim.three.scene, BLIZZARD.snowMax, createSoftDotTexture(), THREE.NormalBlending, 'blizzard_snow');
    ctx.systems.caps.trackPool(snow);
    crustMat = new THREE.MeshStandardMaterial({
      color: BLIZZARD.crust, roughness: 0.1, metalness: 0.05, emissive: 0x1b3c52,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide
    });
    discGeo = new THREE.CircleGeometry(1, 24);
    banner = document.createElement('div');
    banner.className = 'electric-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    const button = document.getElementById('btn-blizzard');
    if (button) button.addEventListener('click', () => setBlizzard(!on), { signal: ctx.signal });
    syncButton();
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateBlizzard(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (dt <= 0) return;
    stepSnow(dt);
    if (!on) return;
    for (const inst of ctx.tornadoes.instances) inst.Vortex.ice = 1;
    // The ice puts a burning funnel out (engine/firenado.js).
    if (ctx.systems.firenado && ctx.systems.firenado.burning()) ctx.systems.firenado.quench();
    emitSnow(dt);
    tick -= dt;
    if (tick <= 0) {
      tick = BLIZZARD.tick;
      freezeTick();
    }
  }

  /** @returns {void} */
  function resetBlizzard() {
    setBlizzard(false);
    for (const c of crusts) Sim.three.scene.remove(c);
    crusts.length = 0;
    crusted = new WeakSet();
    if (snow) {
      snow.life.fill(0);
      snow.colours.fill(0);
      snow.sizes.fill(0);
      markPoolDirty(snow);
    }
    snowAlive = false;
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeBlizzard() {
    for (const c of crusts) Sim.three.scene.remove(c);
    crusts.length = 0;
    if (snow) disposeParticlePool(Sim.three.scene, snow);
    snow = null;
    if (crustMat) crustMat.dispose();
    if (discGeo) discGeo.dispose();
    crustMat = null;
    discGeo = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return { setBlizzard, active: () => on, initBlizzard, updateBlizzard, resetBlizzard, disposeBlizzard };
}
