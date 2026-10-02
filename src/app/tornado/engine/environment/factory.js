// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../../utils/banners.js';
import { FACTORY, GRAVITY } from './factory/config.js';
/** @typedef {import('./factory/config.js').Barrel} Barrel */
import { createFactoryModel } from './factory/model.js';
import { createFactoryBlast } from './factory/blast.js';

/**
 * ===========================================================================
 * SECTION D.10 — Chemical works
 * ===========================================================================
 * A factory with a yard of fifty barrels stacked behind it, which cooks off
 * forty seconds into a run.
 *
 * The point of having fifty barrels is that they do not all go at once. The
 * first one lights and the fire spreads through the yard barrel to barrel, the
 * nearest unlit one catching next, so the stack pops its way across the yard
 * over a couple of seconds in a ragged chain -- each one a small burst
 * throwing that barrel into the air -- and only when the yard has been worked
 * through do the factory's own storage tanks go, in the single blast the whole
 * build-up is for.
 *
 * That final blast was first built at half the tornado's scale -- strength 3.5
 * against the fuel tanker's 7 -- and for fifty barrels of build-up it landed
 * as a pop. It is now the largest scripted event in the game, and a sequence
 * rather than a single burst: the two storage tanks go one after the other,
 * then the works itself does at the burst system's ceiling, with satellite
 * detonations walking outward, a fire column climbing out of the site, and a
 * pressure wave that *travels* at shockSpeed -- so buildings fall in order of
 * distance rather than all on the frame of the bang.
 *
 * The barrels are one InstancedMesh and are moved by this module rather than
 * being fifty entries in Sim.objects: fifty more objects in the physics loop
 * to model something that exists to be destroyed once is a poor trade, and the
 * ballistics of a barrel tumbling out of a fire are three lines. They are
 * still destructible by the storm -- a funnel crossing the yard sets the chain
 * off early, which is the interesting interaction to have -- and by anything
 * else violent enough that reaches the site: the mothership's beam, a
 * meteor, a crashing ship, lightning, the tanker's blast
 * (engine/explosives.js, through site and ignite).
 */

/*
 * Split by job across engine/environment/factory/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js  tunables
 *   model.js   the shed, the tank yard, the barrels and the warning markers
 *   blast.js   igniting, the barrels going one by one, the tank, the blast
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initFactory: () => void,
 *   updateFactory: (dt: number) => void,
 *   ignite: () => void,
 *   site: () => {x: number, z: number, radius: number},
 *   resetFactory: () => void,
 *   disposeFactory: () => void
 * }}
 */
export function createFactorySystem(ctx) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
    // Scratch, reused every frame rather than allocated (performance pass).
    waveDir: new THREE.Vector3(),
  
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {THREE.InstancedMesh|null} */
    barrelMesh: null,
    /** @type {THREE.Object3D|null} */
    shed: null,
    /** @type {Barrel[]} */
    barrels: [],
    /** @type {THREE.Material[]} */
    materials: [],
    /** @type {HTMLDivElement|null} */
    banner: null,
    /** @type {THREE.Object3D|null} */
    markers: null,
    /** @type {THREE.Mesh|null} */
    flare: null,
    /** @type {THREE.Mesh|null} */
    beacon: null,
    /** @type {THREE.Object3D|null} */
    flareLight: null,
    /** @type {THREE.Object3D|null} */
    floodLight: null,
    /** @type {THREE.Mesh|null} */
    shockRing: null,
    /** @type {THREE.Texture|null} */
    scorchTexture: null,

    dummy: new THREE.Object3D(),

    state: {
      /** @type {'idle'|'chain'|'tanks'|'blast'|'done'} */
      phase: 'idle',
      timer: 0,
      nextPop: 0,
      lit: 0,
      bannerTimer: 0,
      // The detonation sequence.
      tanksBlown: 0,
      satellitesFired: 0,
      nextSatellite: 0,
      nextPuff: 0,
      // The travelling pressure wave: how far it has reached, and what it has
      // already passed over.
      shockRadius: 0,
      shockDone: new Set(),
      markerPhase: Math.random() * 10
    }
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createFactoryModel(ctx, S, api),
    createFactoryBlast(ctx, S, api),
    { between, showBanner }
  );

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
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
    S.state.bannerTimer = FACTORY.bannerSeconds;
  }

  /** @returns {void} */
  function initFactory() {
    S.group = new THREE.Group();
    S.group.name = 'factory';
    Sim.three.scene.add(S.group);
    api.buildShed();
    api.buildMarkers();
    api.buildYard();

    // The pressure wave's ring, built once and rescaled while it travels.
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
    });
    S.materials.push(ringMat);
    S.shockRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), ringMat);
    S.shockRing.rotation.x = -Math.PI / 2;
    S.shockRing.visible = false;
    S.shockRing.name = 'factory_shockwave';
    S.group.add(S.shockRing);

    S.state.phase = 'idle';
    S.state.timer = 0;
    S.state.lit = 0;

    if (!S.banner) {
      S.banner = document.createElement('div');
      S.banner.className = 'factory-banner';
      S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(S.banner);
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateFactory(dt) {
    if (!S.group) return;

    if (S.state.bannerTimer > 0) {
      S.state.bannerTimer -= dt;
      if (S.state.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }

    // The fuse, or the storm getting there first.
    if (S.state.phase === 'idle') {
      if (Sim.state.running && Sim.state.elapsed >= FACTORY.fuse) api.ignite();
      else {
        const vortex = ctx.tornadoes.nearest(FACTORY.x, FACTORY.z);
        const edge = Sim.params.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor * vortex.sizeMul;
        if (Sim.state.running
          && Math.hypot(FACTORY.x - vortex.center.x, FACTORY.z - vortex.center.z) < edge) api.ignite();
      }
    }

    if (S.state.phase === 'chain') {
      S.state.nextPop -= dt;
      while (S.state.nextPop <= 0) {
        const barrel = api.nextBarrel();
        if (!barrel) {
          S.state.phase = 'tanks';
          S.state.timer = 0;
          S.state.tanksBlown = 0;
          break;
        }
        api.popBarrel(barrel);
        S.state.nextPop += between(FACTORY.chainInterval);
      }
    } else if (S.state.phase === 'tanks') {
      S.state.timer += dt;
      // The two tanks go one after the other, then the works itself.
      while (S.state.tanksBlown < 2
        && S.state.timer >= FACTORY.tankDelay + S.state.tanksBlown * FACTORY.tankStagger) {
        api.blowTank(S.state.tanksBlown);
        S.state.tanksBlown++;
      }
      if (S.state.tanksBlown >= 2
        && S.state.timer >= FACTORY.tankDelay + FACTORY.tankStagger + FACTORY.blastDelay) {
        api.detonate();
      }
    } else if (S.state.phase === 'blast') {
      S.state.timer += dt;
      api.updateBlast(dt);
    }

    api.updateMarkers(dt);

    // Barrels in the air, on plain ballistics -- they are scenery being
    // destroyed, not simulated objects (see the note at the top).
    let moving = false;
    for (const b of S.barrels) {
      if (b.state !== 'flying') continue;
      moving = true;
      b.vel.y -= GRAVITY * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.rot.x += b.spin.x * dt;
      b.rot.y += b.spin.y * dt;
      b.rot.z += b.spin.z * dt;
      if (b.pos.y <= FACTORY.barrelRadius) {
        b.pos.y = FACTORY.barrelRadius;
        b.vel.multiplyScalar(0.35);
        b.vel.y = Math.abs(b.vel.y) * 0.4;
        b.spin.multiplyScalar(0.5);
        if (b.vel.lengthSq() < 0.6) {
          b.vel.set(0, 0, 0);
          b.spin.set(0, 0, 0);
        }
      }
    }
    if (moving) api.writeBarrels();
  }

  /** @returns {void} */
  function resetFactory() {
    S.state.phase = 'idle';
    S.state.timer = 0;
    S.state.lit = 0;
    S.state.nextPop = 0;
    S.state.tanksBlown = 0;
    S.state.shockRadius = 0;
    S.state.shockDone.clear();
    if (S.shed) S.shed.visible = true;
    if (S.markers) S.markers.visible = true;
    if (S.floodLight) S.floodLight.intensity = FACTORY.floodLight;
    if (S.shockRing) S.shockRing.visible = false;
    // The burn the last detonation left goes with the run that made it.
    for (const child of [...S.group.children]) {
      if (child.name === 'factory_scorch') {
        S.group.remove(child);
        child.geometry.dispose();
      }
    }
    // Re-stack the yard where it was.
    api.disposeYard();
    api.buildYard();
  }

  /** @returns {void} */
  function disposeFactory() {
    if (!S.group) return;
    S.group.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const mat of S.materials) mat.dispose();
    S.materials.length = 0;
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    if (S.flareLight) Sim.three.scene.remove(S.flareLight);
    if (S.floodLight) Sim.three.scene.remove(S.floodLight);
    if (S.scorchTexture) S.scorchTexture.dispose();
    Sim.three.scene.remove(S.group);
    S.group = null;
    S.shed = null;
    S.markers = null;
    S.flare = null;
    S.beacon = null;
    S.flareLight = null;
    S.floodLight = null;
    S.shockRing = null;
    S.scorchTexture = null;
    S.barrelMesh = null;
    S.banner = null;
    S.barrels = [];
  }

  /**
   * Where the works stands, and how far out from its middle it reaches (the
   * shed and the yard), for anything that can set it off from outside
   * (engine/explosives.js).
   * @returns {{x: number, z: number, radius: number}}
   */
  function site() {
    return { x: FACTORY.x, z: FACTORY.z, radius: Math.max(FACTORY.shedWidth, FACTORY.yardWidth) * 0.7 };
  }

  return { initFactory, updateFactory, ignite: api.ignite, site, resetFactory, disposeFactory };
}
