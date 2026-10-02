// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { bannerHost } from '../utils/banners.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createPlantCharger } from './nuclear/charger.js';
import { createMutationQueue } from './nuclear/mutation.js';
import { createTrefoilTexture, createWallTexture } from './nuclear/textures.js';
import { createNuclearPanel } from './nuclear/panel.js';
import { chipTarget } from './health/enemyDamage.js';

/**
 * ===========================================================================
 * SECTION AM — The nuclear power plants
 * ===========================================================================
 * Two of them, on request, out on opposite corners of town (NUCLEAR.sites):
 * two hyperboloid cooling towers breathing steam, a domed reactor, a turbine
 * hall with the radiation sign on it and a banded stack with a red light.
 *
 * They are hard to destroy, and only by four things:
 *  - the mothership: its beam (every pass after its first runs straight at
 *    the nearest plant still standing), or the ship itself coming down on
 *    one (mothership.js, hitArea);
 *  - the alien ships, five hits (NUCLEAR.hull): the landing ship shoots at
 *    the nearest plant from where it hangs, and the red hunters make for one
 *    and shoot it from a stand-off before they go back to hunting people
 *    (aliens.js). While a plant stands, the ships go for it;
 *  - Roger's mega beam (heroMode.js; a normal shot only sparks off the
 *    containment);
 *  - the Electric Tornado (electricStorm.js): a funnel in electric mode that
 *    runs straight into one.
 * Nothing else touches them -- not the storm, not the tankers or the
 * chemical works, not the other plant going up.
 *
 * Destroyed, a plant goes critical for NUCLEAR.criticalSeconds (the reactor
 * glowing green, sirens of light, the ground shaking) and then goes up in the
 * biggest explosion in the game (explosions/megaBlast.js NUCLEAR_BLAST: a
 * white-out, a fireball dome, a pressure wave that crosses the whole map and
 * a mushroom cloud that stands over the town for most of a minute). Out of
 * it comes the green EMP: a ring of green light, a wall of it, travelling
 * out across the entire map (NUCLEAR.emp) -- and every person it passes is
 * struck by a green bolt and, over two seconds, turns into one of the aliens,
 * in a sombrero (aliens.js mutate), who then goes through town after
 * everyone left. Anyone the ring passes while in the air is turned when they
 * come down. It also knocks out the power lines and the Terminators as it
 * goes. Roger is not changed (he is the hero); the blast itself will kill
 * him if he is close.
 *
 * The mass mutation goes in batches (nuclear/mutation.js): the ring queues
 * the people it reaches and at most CAPS.batch are turned a frame.
 *
 * While a plant stands, Roger can plug in at its charging terminal for a
 * full recharge of his energy (nuclear/charger.js).
 *
 * The site is left a green-glowing crater. Both come back with a Reset.
 */

// The cooling towers, in the plant's own frame.
const TOWER_X = [-11, 11];
const TOWER_Z = -9;

const NUCLEAR = {
  // Opposite corners of town: inside the people's range (128), clear of the
  // town grid (+-88 by +-66), the streets, the railway (z 33), the viaduct
  // (z -52), the chemical works (66, -74), the dam (x -148) and the four
  // parked tankers.
  sites: [
    { name: 'NUCLEAR PLANT ONE', x: -100, z: 100 },
    { name: 'NUCLEAR PLANT TWO', x: 102, z: -104 }
  ],
  radius: 24,              // of the site, for anything that hits it
  clearRadius: 30,         // trees and parked cars taken off the site
  hull: 5,                 // alien ship hits it takes
  // The model.
  towerHeight: 34,
  towerBase: 9,
  towerWaist: 5.6,
  towerWaistAt: 0.72,      // of the height
  concrete: 0xd3cfc6,
  dome: 0xe9e5dd,
  hall: 0x8d98a3,
  steamPerTower: 5,       // was 9: each sprite is a draw call (performance pass); bigger to make up
  steamSize: [11, 34],    // a puff's size, new and at the top (was 8 to 34)
  steamRise: 5,            // world units/sec
  steamLife: 7,
  // Going up.
  criticalSeconds: 1.8,
  score: 30000,
  // The green EMP out of the blast.
  emp: {
    speed: 55,             // world units/sec: slow enough to watch it come
    radius: 640,           // past every corner of the map from either site
    height: 55,
    echoes: [0.9, 1.8],    // fainter rings after the first, seconds behind
    colour: new THREE.Color(0.3, 2.6, 0.55)
  },
  bannerSeconds: 4,
  // How far the green ring has to go to have crossed the whole town from
  // either site (the far corner of the people's +-128 square), for the
  // "ALL HUMANS ARE ALIENS NOW" message.
  townReach: 330
};

/**
 * The blast itself (explosions/megaBlast.js): the biggest in the game --
 * bigger than the mothership crash in every term. Its kill radius is small
 * next to its reach on purpose: the town is meant to live long enough to be
 * turned by the green EMP.
 * @type {import('./explosions/megaBlast.js').MegaBlastConfig}
 */
const NUCLEAR_BLAST = {
  core: 60,
  ringCount: 16,
  ringRadius: 58,
  ringStrength: 50,
  satellites: 70,
  satelliteSpread: 320,
  satelliteInterval: 0.035,
  satelliteStrength: [28, 50],
  shockSpeed: 190,
  radius: 480,
  throwForce: 150,
  buildingShock: 14,
  fireRadius: 300,
  killRadius: 55,
  throwPeople: false,
  mushroom: {
    rise: 380, riseSeconds: 7, stem: 14, cap: 110, linger: 25, fade: 10,
    fire: new THREE.Color(2.6, 1.3, 0.35), smoke: 0x4d4b45, skirt: 0x55664a
  },
  ringColour: new THREE.Color(2.6, 2.3, 1.3),
  flash: { colour: '#ffffff', peak: 0.97, hold: 0.6, seconds: 3.6 },
  event: 'nuke',
  heroKill: { title: 'VAPORISED', sub: 'Roger was too close to the reactor', source: 'nuke' }
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initNuclear: () => void,
 *   updateNuclear: (dt: number) => void,
 *   nearestIntact: (x: number, z: number) => Object|null,
 *   shipHit: (plant: Object, at: THREE.Vector3) => void,
 *   megaHit: (plant: Object) => void,
 *   chipPlant: (plant: Object, hit: {type: string}) => boolean,
 *   chipAt: (x: number, z: number, radius: number, hit: {type: string}) => void,
 *   hitArea: (x: number, z: number, radius: number, cause: string) => void,
 *   aimTargets: () => {x: number, z: number, radius: number, top: number, plant: Object}[],
 *   markers: () => {plants: {x: number, z: number, standing: boolean}[], rings: {x: number, z: number, radius: number}[]},
 *   meltdown: (index: number) => void,
 *   terminalNear: (x: number, z: number) => {x: number, z: number}|null,
 *   resetNuclear: () => void,
 *   disposeNuclear: () => void
 * }}
 */
export function createNuclearSystem(ctx) {
  const { Sim } = ctx;

  /** @type {Object[]} one per site */
  let plants = [];
  /** @type {Object[]} the green EMP rings going out */
  let rings = [];
  // People the ring reached, turned a batch a frame (nuclear/mutation.js).
  const mutations = createMutationQueue(ctx);
  // The charging terminals (nuclear/charger.js).
  const charger = createPlantCharger(ctx);
  // The panel's 🔌 Plug In and ☢️ Meltdown (nuclear/panel.js).
  const panel = createNuclearPanel(ctx, {
    standing: () => plants.filter(p => p.phase === 'standing'),
    meltdownAt: (plant) => meltdownPlant(plant, 'a test'),
    terminalNear: (x, z) => terminalNear(x, z)
  });
  /** @type {Object|null} shared geometry, materials and textures */
  let kit = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  // The town is built (and rebuilt on a Reset) after this system's init and
  // reset run, so the sites are cleared on the first frame after either.
  let sitesCleared = false;
  const scratch = new THREE.Vector3();

  // ---------------------------------------------------------------------
  // The model
  // ---------------------------------------------------------------------

  /** @returns {Object} */
  function buildKit() {
    const h = NUCLEAR.towerHeight;
    const y0 = h * NUCLEAR.towerWaistAt;
    const a = NUCLEAR.towerWaist;
    // A hyperboloid: r(y) = a * sqrt(1 + ((y - y0) / c)^2), with c set so the
    // foot is towerBase across.
    const c = y0 / Math.sqrt((NUCLEAR.towerBase / a) ** 2 - 1);
    const profile = [];
    for (let i = 0; i <= 24; i++) {
      const y = (i / 24) * h;
      profile.push(new THREE.Vector2(a * Math.sqrt(1 + ((y - y0) / c) ** 2), y));
    }
    const pad = new THREE.PlaneGeometry(52, 48);
    pad.rotateX(-Math.PI / 2);
    const steam = createSoftDotTexture();
    const trefoil = createTrefoilTexture();
    const wall = createWallTexture();
    const empRing = new THREE.RingGeometry(0.985, 1, 160);
    empRing.rotateX(-Math.PI / 2);
    const empWall = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    empWall.translate(0, 0.5, 0);
    const crater = new THREE.CircleGeometry(NUCLEAR.radius * 1.7, 40);
    crater.rotateX(-Math.PI / 2);
    // Both towers and their rims in one geometry, drawn once (they share a
    // material and never move apart): four draw calls down to one per plant
    // (performance pass).
    const towerParts = [];
    for (const tx of TOWER_X) {
      towerParts.push(new THREE.LatheGeometry(profile, 36).translate(tx, 0, TOWER_Z));
      towerParts.push(new THREE.TorusGeometry(profile[24].x, 0.35, 6, 36)
        .rotateX(Math.PI / 2).translate(tx, NUCLEAR.towerHeight, TOWER_Z));
    }
    const towers = mergeGeometries(towerParts);
    for (const geo of towerParts) geo.dispose();
    return {
      towers,
      reactor: new THREE.CylinderGeometry(6.2, 6.2, 11, 28),
      dome: new THREE.SphereGeometry(6.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      hall: new THREE.BoxGeometry(12, 8, 9),
      stack: new THREE.CylinderGeometry(0.6, 0.9, 28, 12),
      band: new THREE.CylinderGeometry(0.95, 0.95, 1.2, 12),
      beacon: new THREE.SphereGeometry(0.5, 10, 8),
      sign: new THREE.PlaneGeometry(4.4, 4.4),
      pad,
      crater,
      empRing,
      empWall,
      steam,
      trefoil,
      wall,
      concreteMat: new THREE.MeshStandardMaterial({ color: NUCLEAR.concrete, roughness: 0.92, side: THREE.DoubleSide }),
      padMat: new THREE.MeshStandardMaterial({
        color: 0x8f8d88, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      }),
      hallMat: new THREE.MeshStandardMaterial({ color: NUCLEAR.hall, roughness: 0.5, metalness: 0.4 }),
      whiteMat: new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }),
      redMat: new THREE.MeshStandardMaterial({ color: 0xc8241c, roughness: 0.6 }),
      signMat: new THREE.MeshBasicMaterial({ map: trefoil })
    };
  }

  /**
   * One plant, its group turned to face the middle of town.
   * @param {{name: string, x: number, z: number}} site
   * @returns {Object}
   */
  function buildPlant(site) {
    const group = new THREE.Group();
    group.name = 'nuclear_plant';
    group.position.set(site.x, 0, site.z);
    // Local +z towards the middle of town.
    group.rotation.y = Math.atan2(-site.x, -site.z);
    /**
     * @param {THREE.BufferGeometry} geometry
     * @param {THREE.Material} material
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const pad = part(kit.pad, kit.padMat, 0, 0.03, 0);
    pad.castShadow = false;
    part(kit.towers, kit.concreteMat, 0, 0, 0);
    const towers = TOWER_X.map(tx => new THREE.Vector3(tx, NUCLEAR.towerHeight, TOWER_Z));
    // The reactor: its own material, so its glow is its own.
    const domeMat = new THREE.MeshStandardMaterial({ color: NUCLEAR.dome, roughness: 0.55, emissive: 0x000000 });
    part(kit.reactor, domeMat, -7, 5.5, 10);
    part(kit.dome, domeMat, -7, 11, 10);
    part(kit.hall, kit.hallMat, 9, 4, 10);
    const sign = part(kit.sign, kit.signMat, 9, 5, 14.56);
    sign.castShadow = false;
    part(kit.stack, kit.whiteMat, 0, 14, 3);
    for (const y of [20, 23.5, 27]) part(kit.band, kit.redMat, 0, y, 3).castShadow = false;
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) });
    const beacon = part(kit.beacon, beaconMat, 0, 28.4, 3);
    beacon.castShadow = false;

    // Steam off the towers: a few soft sprites each, rising and spreading.
    const steamMat = new THREE.SpriteMaterial({ map: kit.steam, color: 0xf4f4f2, transparent: true, depthWrite: false, opacity: 0 });
    const puffs = [];
    for (const top of towers) {
      for (let i = 0; i < NUCLEAR.steamPerTower; i++) {
        const sprite = new THREE.Sprite(steamMat.clone());
        sprite.position.copy(top);
        group.add(sprite);
        puffs.push({ sprite, from: top, age: (i / NUCLEAR.steamPerTower) * NUCLEAR.steamLife, drift: Math.random() * Math.PI * 2 });
      }
    }
    steamMat.dispose();

    // Left behind after it goes: a burnt, green-glowing crater.
    const craterMat = new THREE.MeshStandardMaterial({
      color: 0x14130f, roughness: 1, emissive: new THREE.Color(0.1, 0.9, 0.2), emissiveIntensity: 0.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    const crater = new THREE.Mesh(kit.crater, craterMat);
    crater.position.set(site.x, 0.026, site.z);
    crater.visible = false;
    crater.name = 'nuclear_crater';
    Sim.three.scene.add(group, crater);

    // Where the aliens aim: the top of the reactor dome, in the world.
    group.updateMatrixWorld(true);
    const aim = new THREE.Vector3(-7, 15, 10).applyMatrix4(group.matrixWorld);
    const terminal = charger.build(group);
    /**
     * @param {number} lx
     * @param {number} lz
     * @returns {{x: number, z: number}}
     */
    const world = (lx, lz) => {
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(group.matrixWorld);
      return { x: v.x, z: v.z };
    };
    const parts = [
      { ...world(-11, -9), radius: 8, top: NUCLEAR.towerHeight },
      { ...world(11, -9), radius: 8, top: NUCLEAR.towerHeight },
      { ...world(-7, 10), radius: 6.5, top: 17 },
      { ...world(9, 10), radius: 7, top: 8 },
      { ...world(0, 3), radius: 1.2, top: 28 }
    ];
    return {
      name: site.name, x: site.x, z: site.z, radius: NUCLEAR.radius, aim, parts,
      group, crater, craterMat, domeMat, beaconMat, puffs, terminal,
      /** @type {'standing'|'critical'|'gone'} */
      phase: 'standing', hull: NUCLEAR.hull, timer: 0, cause: ''
    };
  }

  /**
   * Trees and parked cars off the sites, so nothing grows through a tower.
   * @returns {void}
   */
  function clearSites() {
    const env = ctx.Environment;
    if (!env) return;
    for (const list of [env.trees, env.cars]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const obj = list[i];
        const p = obj.mesh && obj.mesh.position;
        if (!p || !NUCLEAR.sites.some(s => Math.hypot(p.x - s.x, p.z - s.z) < NUCLEAR.clearRadius)) continue;
        obj.mesh.removeFromParent();
        list.splice(i, 1);
        const at = Sim.objects.indexOf(obj);
        if (at !== -1) Sim.objects.splice(at, 1);
      }
    }
  }

  /** @returns {void} */
  function initNuclear() {
    kit = buildKit();
    charger.init();
    plants = NUCLEAR.sites.map(buildPlant);
    sitesCleared = false;
    // For the black hole (engine/effects/consumables.js): dissolved, with
    // no meltdown -- it is not blown up, it is gone.
    ctx.systems.consumables.register({
      kind: 'nuclearPlant',
      list: () => plants.filter(p => p.phase === 'standing'),
      position: (p) => p.group.position,
      object: (p) => p.group,
      size: () => 60,
      big: true,
      consume: (p) => {
        p.phase = 'gone';
        p.group.visible = false;
      }
    });
    banner = document.createElement('div');
    banner.className = 'downburst-banner alert';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    panel.wire();
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {number} [seconds]
   * @returns {void}
   */
  function showBanner(title, sub, seconds = NUCLEAR.bannerSeconds) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    bannerTimer = seconds;
  }

  // ---------------------------------------------------------------------
  // Hits
  // ---------------------------------------------------------------------

  /**
   * The nearest plant still standing, for the alien ships and the
   * mothership to go for.
   * @param {number} x
   * @param {number} z
   * @returns {Object|null}
   */
  function nearestIntact(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const plant of plants) {
      if (plant.phase !== 'standing') continue;
      const d = Math.hypot(plant.x - x, plant.z - z);
      if (d < bestD) {
        bestD = d;
        best = plant;
      }
    }
    return best;
  }

  /**
   * An alien ship's ray into it: one of NUCLEAR.hull.
   * @param {Object} plant
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function shipHit(plant, at) {
    if (plant.phase !== 'standing') return;
    plant.hull--;
    ctx.systems.explosions.spawnImpactBurst(at, 3.2);
    ctx.systems.cues.playLargeExplosion({ gain: 0.8 });
    if (plant.hull <= 0) {
      meltdownPlant(plant, 'the alien ships');
      return;
    }
    showBanner(`${plant.name} HIT`, `The aliens are shooting the reactor · containment ${Math.ceil(plant.hull)}/${NUCLEAR.hull}`);
  }

  /**
   * Roger's mega beam on it (heroMode.js): straight through the containment.
   * @param {Object} plant
   * @returns {void}
   */
  function megaHit(plant) {
    meltdownPlant(plant, 'Roger\'s mega beam');
  }

  /**
   * Any of Roger's weapons but the MEGA BEAM and the katana on the reactor
   * (D3, health/damageTable.js): a chip of the containment, quiet, with no
   * burst. It shares the hull the alien ships' five hits take, so the two add
   * up; at 0 it goes critical like any other breach. The katana's cell is 0.
   * @param {Object} plant
   * @param {{type: string}} hit
   * @returns {boolean} whether it brought the containment down
   */
  function chipPlant(plant, hit) {
    if (plant.phase !== 'standing') return false;
    const left = chipTarget('nuclearPlant', plant.hull, hit);
    plant.hull = left.health;
    if (!left.spent) return false;
    meltdownPlant(plant, 'Roger\'s weapons');
    return true;
  }

  /**
   * `chipPlant` for every plant whose site is within `radius` of (x, z): the
   * fire gun's cone and a railgun bolt.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {{type: string}} hit
   * @returns {void}
   */
  function chipAt(x, z, radius, hit) {
    for (const plant of plants) {
      if (plant.phase === 'standing' && Math.hypot(plant.x - x, plant.z - z) < radius + plant.radius) chipPlant(plant, hit);
    }
  }

  /**
   * The mothership's beam or the mothership itself (mothership.js), or a
   * mega beam's blast: any plant whose site is inside `radius` of (x, z).
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {string} cause
   * @returns {void}
   */
  function hitArea(x, z, radius, cause) {
    for (const plant of plants) {
      if (plant.phase === 'standing' && Math.hypot(plant.x - x, plant.z - z) < radius + plant.radius) {
        meltdownPlant(plant, cause === 'mothership' ? 'the mothership' : cause);
      }
    }
  }

  /**
   * For Roger's sights (heroMode.js traceAim): each building of every plant
   * still standing, as an upright cylinder.
   * @returns {{x: number, z: number, radius: number, top: number, plant: Object}[]}
   */
  function aimTargets() {
    const out = [];
    for (const plant of plants) {
      if (plant.phase !== 'standing') continue;
      for (const part of plant.parts) out.push({ ...part, plant });
    }
    return out;
  }

  /**
   * Past saving: it goes critical, and then it goes.
   * @param {Object} plant
   * @param {string} cause
   * @returns {void}
   */
  function meltdownPlant(plant, cause) {
    if (plant.phase !== 'standing') return;
    plant.phase = 'critical';
    plant.timer = 0;
    plant.cause = cause;
    panel.sync();
    showBanner('MELTDOWN!', `${plant.name} is going critical · hit by ${cause} · GET CLEAR`);
    ctx.systems.lightning.flashScreen(scratch.set(plant.x, 10, plant.z), 0.5, '#7dff8f');
  }

  /**
   * By index, for a panel button or a test.
   * @param {number} index
   * @returns {void}
   */
  function meltdown(index) {
    if (plants[index]) meltdownPlant(plants[index], 'a test');
  }

  /**
   * The bang, the site gone, and the green EMP on its way out.
   * @param {Object} plant
   * @returns {void}
   */
  function blowUp(plant) {
    plant.phase = 'gone';
    panel.sync();
    plant.group.visible = false;
    plant.crater.visible = true;
    const at = new THREE.Vector3(plant.x, 2, plant.z);
    ctx.systems.megaBlast.detonate(at, NUCLEAR_BLAST);
    ctx.systems.damage.addDamageScore(NUCLEAR.score);
    showBanner('NUCLEAR EXPLOSION', `${plant.name} destroyed by ${plant.cause} · +${NUCLEAR.score} · the green EMP is coming`);
    ctx.events.emit('announce', { title: 'NUCLEAR EXPLOSION', sub: 'The green EMP turns people into aliens' });
    const wallMat = new THREE.MeshBasicMaterial({
      map: kit.wall, color: NUCLEAR.emp.colour, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: NUCLEAR.emp.colour, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const meshes = [];
    for (let i = 0; i <= NUCLEAR.emp.echoes.length; i++) {
      const wall = new THREE.Mesh(kit.empWall, i === 0 ? wallMat : wallMat.clone());
      const ring = new THREE.Mesh(kit.empRing, i === 0 ? ringMat : ringMat.clone());
      wall.frustumCulled = ring.frustumCulled = false;
      wall.position.set(plant.x, 0, plant.z);
      ring.position.set(plant.x, 0.9, plant.z);
      wall.visible = ring.visible = false;
      Sim.three.scene.add(wall, ring);
      meshes.push({ wall, ring, delay: i === 0 ? 0 : NUCLEAR.emp.echoes[i - 1] });
    }
    rings.push({ x: plant.x, z: plant.z, radius: 0, timer: 0, meshes, cameraHit: false, announced: false });
    if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(1);
  }

  // ---------------------------------------------------------------------
  // The green EMP
  // ---------------------------------------------------------------------

  /**
   * One ring's front passing from `previous` to its radius now: everyone it
   * reaches is turned (aliens.js mutate), or turned on landing.
   * @param {Object} ring
   * @param {number} previous
   * @returns {void}
   */
  function sweep(ring, previous) {
    for (const person of ctx.Environment.people.slice()) {
      if (!person.mesh || !person.mesh.parent || person.abducted || person.electrocuted) continue;
      const p = person.mesh.position;
      const d = Math.hypot(p.x - ring.x, p.z - ring.z);
      if (d <= previous || d > ring.radius) continue;
      mutations.add(person);
    }
    // The grid and the machines go down with it.
    if (ctx.systems.terminator) ctx.systems.terminator.empSweep(ring.x, ring.z, ring.radius);
    const lines = ctx.systems.powerLines;
    if (lines && ring.radius < 200) {
      const a = Math.random() * Math.PI * 2;
      lines.faultAt(ring.x + Math.cos(a) * ring.radius, ring.z + Math.sin(a) * ring.radius, 20);
    }
    // The ring going past the camera: a green flash over everything.
    const cam = Sim.three.camera.position;
    const dc = Math.hypot(cam.x - ring.x, cam.z - ring.z);
    if (!ring.cameraHit && dc > previous && dc <= ring.radius) {
      ring.cameraHit = true;
      ctx.systems.lightning.flashScreen(scratch.set(cam.x, 4, cam.z), 1, '#3dff66');
      if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(1);
    }
  }

  /**
   * @param {Object} ring
   * @param {number} dt
   * @returns {boolean} whether it has gone past the edge of everything
   */
  function updateRing(ring, dt) {
    ring.timer += dt;
    const previous = ring.radius;
    ring.radius = Math.min(NUCLEAR.emp.radius, ring.timer * NUCLEAR.emp.speed);
    if (ring.radius > previous) sweep(ring, previous);
    // Past the far edge of the town: say so, on request.
    if (!ring.announced && ring.radius >= NUCLEAR.townReach) {
      ring.announced = true;
      showBanner('ALL HUMANS ARE ALIENS NOW', `${ctx.systems.aliens ? ctx.systems.aliens.mutatedCount() : 0} people turned · new arrivals still come every 30 s -- armed from minute 2`, 6);
    }
    let alive = false;
    ring.meshes.forEach((m, i) => {
      const r = (ring.timer - m.delay) * NUCLEAR.emp.speed;
      const through = r / NUCLEAR.emp.radius;
      if (r <= 0.5 || through >= 1) {
        m.wall.visible = m.ring.visible = false;
        if (through < 1) alive = true;
        return;
      }
      alive = true;
      const k = (i === 0 ? 1 : 0.45) * Math.min(1, r / 20) * (1 - through * through);
      const pulse = 0.85 + 0.15 * Math.sin(ring.timer * 23 + i);
      m.wall.visible = m.ring.visible = true;
      m.wall.scale.set(r, NUCLEAR.emp.height * (i === 0 ? 1 : 0.7), r);
      m.ring.scale.setScalar(r);
      m.wall.material.opacity = 0.75 * k * pulse;
      m.ring.material.opacity = k * pulse;
    });
    return !alive;
  }

  /**
   * @param {Object} ring
   * @returns {void}
   */
  function removeRing(ring) {
    for (const m of ring.meshes) {
      Sim.three.scene.remove(m.wall, m.ring);
      m.wall.material.dispose();
      m.ring.material.dispose();
    }
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * @param {Object} plant
   * @param {number} dt
   * @returns {void}
   */
  function updatePlant(plant, dt) {
    plant.timer += dt;
    const t = plant.timer;
    if (plant.phase === 'gone') {
      plant.craterMat.emissiveIntensity = 0.55 + 0.25 * Math.sin(t * 2.3);
      return;
    }
    // The stack's red light, blinking.
    plant.beaconMat.color.setRGB(Math.sin(t * 3.4) > 0.2 ? 3 : 0.25, 0.15, 0.08);
    // Steam, rising, spreading and thinning.
    for (const puff of plant.puffs) {
      puff.age += dt;
      if (puff.age > NUCLEAR.steamLife) {
        puff.age -= NUCLEAR.steamLife;
        puff.drift = Math.random() * Math.PI * 2;
      }
      const u = puff.age / NUCLEAR.steamLife;
      const rise = puff.age * NUCLEAR.steamRise;
      puff.sprite.position.set(
        puff.from.x + Math.cos(puff.drift) * rise * 0.35,
        puff.from.y + 1 + rise,
        puff.from.z + Math.sin(puff.drift) * rise * 0.35
      );
      puff.sprite.scale.setScalar(NUCLEAR.steamSize[0] + u * (NUCLEAR.steamSize[1] - NUCLEAR.steamSize[0]));
      puff.sprite.material.opacity = 0.55 * Math.min(1, u * 6) * (1 - u);
    }
    // The reactor showing its wounds: a green glow that grows with each hit.
    const hurt = 1 - plant.hull / NUCLEAR.hull;
    if (plant.phase === 'standing') {
      plant.domeMat.emissive.setRGB(0.05 * hurt, 0.9 * hurt * (0.8 + 0.2 * Math.sin(t * 6)), 0.15 * hurt);
      if (hurt > 0 && Math.random() < dt * 4 * hurt) {
        ctx.systems.explosions.spawnImpactBurst(scratch.copy(plant.aim).add(new THREE.Vector3((Math.random() - 0.5) * 8, -2, (Math.random() - 0.5) * 8)), 0.8);
      }
    }
    // Critical: the whole site pulsing green, the ground shaking, and then it goes.
    if (plant.phase === 'critical') {
      const pulse = 0.5 + 0.5 * Math.sin(t * (10 + t * 18));
      plant.domeMat.emissive.setRGB(0.2 * pulse, 3.5 * pulse + 0.5, 0.6 * pulse);
      plant.group.position.x = plant.x + (Math.random() - 0.5) * 0.4 * t;
      plant.group.position.z = plant.z + (Math.random() - 0.5) * 0.4 * t;
      if (Math.random() < dt * 8) {
        ctx.systems.explosions.spawnImpactBurst(scratch.copy(plant.aim).add(new THREE.Vector3((Math.random() - 0.5) * 30, Math.random() * 10 - 8, (Math.random() - 0.5) * 30)), 2);
      }
      if (ctx.systems.gamefeel && Math.random() < dt * 6) ctx.systems.gamefeel.addShake(0.4 * t, 0.2);
      if (t >= NUCLEAR.criticalSeconds) {
        plant.group.position.set(plant.x, 0, plant.z);
        blowUp(plant);
      }
    }
  }

  /**
   * The Electric Tornado (electricStorm.js) running into a plant.
   * @returns {void}
   */
  function checkElectricFunnels() {
    const storm = ctx.systems.electricStorm;
    if (!storm || !storm.isActive() || !Sim.state.running) return;
    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.neutralized || !(Vortex.birth > 0.5)) continue;
      const reach = Sim.params.radius * (Vortex.sizeMul || 1) * 0.8;
      for (const plant of plants) {
        if (plant.phase !== 'standing') continue;
        if (Math.hypot(plant.x - Vortex.center.x, plant.z - Vortex.center.z) < reach + plant.radius * 0.6) {
          meltdownPlant(plant, 'the Electric Tornado');
        }
      }
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateNuclear(dt) {
    if (!kit) return;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (dt <= 0) return;
    if (!sitesCleared) {
      clearSites();
      sitesCleared = true;
    }
    checkElectricFunnels();
    for (const plant of plants) updatePlant(plant, dt);
    rings = rings.filter((ring) => {
      if (!updateRing(ring, dt)) return true;
      removeRing(ring);
      return false;
    });
    // A batch of those it reached turned (those in the air once down).
    mutations.update();
    charger.update(plants, dt);
  }

  /**
   * Where to stand to plug in at the plant nearest (x, z) still standing
   * (for the panel's test button).
   * @param {number} x
   * @param {number} z
   * @returns {{x: number, z: number}|null}
   */
  function terminalNear(x, z) {
    const terminal = charger.nearest(plants, x, z);
    return terminal ? { x: terminal.at.x, z: terminal.at.z } : null;
  }

  /**
   * For the minimap: the plants, and the green rings going out.
   * @returns {{plants: {x: number, z: number, standing: boolean}[], rings: {x: number, z: number, radius: number}[]}}
   */
  function markers() {
    return {
      plants: plants.map(p => ({ x: p.x, z: p.z, standing: p.phase !== 'gone' })),
      rings: rings.filter(r => r.radius < NUCLEAR.emp.radius).map(r => ({ x: r.x, z: r.z, radius: r.radius }))
    };
  }

  /**
   * @param {Object} plant
   * @returns {void}
   */
  function removePlant(plant) {
    Sim.three.scene.remove(plant.group, plant.crater);
    charger.release(plant.terminal);
    for (const puff of plant.puffs) puff.sprite.material.dispose();
    plant.domeMat.dispose();
    plant.beaconMat.dispose();
    plant.craterMat.dispose();
  }

  /** @returns {void} */
  function resetNuclear() {
    for (const ring of rings) removeRing(ring);
    rings = [];
    mutations.clear();
    charger.clear();
    for (const plant of plants) removePlant(plant);
    plants = kit ? NUCLEAR.sites.map(buildPlant) : [];
    // The fresh town, built after this, has fresh trees and cars on the sites.
    sitesCleared = false;
    panel.sync();
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeNuclear() {
    for (const ring of rings) removeRing(ring);
    rings = [];
    mutations.clear();
    for (const plant of plants) removePlant(plant);
    plants = [];
    charger.dispose();
    if (kit) {
      for (const item of Object.values(kit)) if (item && item.dispose) item.dispose();
    }
    kit = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return {
    initNuclear, updateNuclear, nearestIntact, shipHit, megaHit, chipPlant, chipAt, hitArea, aimTargets, markers, meltdown, terminalNear,
    resetNuclear, disposeNuclear
  };
}
