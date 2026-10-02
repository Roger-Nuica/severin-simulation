// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { createFireTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { STORM } from './scale.js';

/**
 * ===========================================================================
 * SECTION VO — The volcano in the earthquake's fissure
 * ===========================================================================
 * 🌋 Volcano (in 💥 Disasters): over the earthquake's caldera, if there is
 * one (engine/fissure.js), otherwise on open ground out towards the edge of
 * town with a quake to go with it, the lava builds a cone. It grows where
 * you can watch it, over VOLCANO.growSeconds, to VOLCANO.height metres: dark
 * rock streaked with glowing lava, a burning crater at the top. Whatever
 * stands where it rises comes down (damage.shockBuilding), and the crowd
 * keeps away from it (hazards.js); Roger cannot walk into it.
 *
 * Once it is half grown it erupts for VOLCANO.eruptSeconds: lava bombs
 * thrown out of the crater, each a glowing rock trailing smoke on a
 * ballistic arc of its own to somewhere in the town round it (buildings
 * preferred). Where one lands: a burst, the building it hits and those
 * round it set alight (buildingFire, which spreads from there), people
 * beside it killed, and Roger too if he is under it. Then it sleeps; the
 * button wakes it again. A Reset takes it away.
 *
 * The Blizzard (engine/blizzard.js) freezes it: no bombs, the crater dark
 * under ice, until the Blizzard ends.
 *
 * Cost: one mesh for the cone, one for the crater, at most VOLCANO.maxBombs
 * bomb meshes (made once, reused) and one smoke/fire particle pool on the
 * particle budget.
 */

export const VOLCANO = {
  // Over the real-size town's tallest blocks (engine/scale.js STORM).
  height: STORM.volcano.height,
  baseRadius: STORM.volcano.baseRadius,
  craterRadius: 6,
  growSeconds: 22,
  eruptSeconds: 60,
  bombEvery: [0.5, 1.2],
  maxBombs: 10,
  bombRange: [35, 150],     // metres from the crater, on the ground
  bombFlight: [2.2, 3.6],   // seconds in the air
  bombSize: 1.4,
  igniteRadius: 9,
  killRadius: 4,
  spawnRing: 105,           // where it rises with no caldera
  trailMax: 700,
  rock: 0x2b2522,
  lava: new THREE.Color(2.6, 0.9, 0.2)
};

/**
 * @param {Object} ctx
 * @returns {{
 *   erupt: () => boolean,
 *   solids: () => {x: number, z: number, hw: number, hd: number}[],
 *   state: () => ({x: number, z: number, grow: number, erupting: boolean, frozen: boolean, bombs: number}|null),
 *   initVolcano: () => void,
 *   updateVolcano: (dt: number) => void,
 *   resetVolcano: () => void,
 *   disposeVolcano: () => void
 * }}
 */
export function createVolcanoSystem(ctx) {
  const { Sim } = ctx;
  /**
   * @typedef {Object} Bomb
   * @property {THREE.Mesh} mesh
   * @property {THREE.Vector3} from
   * @property {THREE.Vector3} to
   * @property {number} t 0..1 through its flight; >= 1 idle
   * @property {number} seconds
   * @property {number} arc peak height above the straight line
   */
  /** @type {{x: number, z: number, grow: number, erupt: number, next: number, hazard: Object|null, shaken: Set<SimObject>}|null} */
  let site = null;
  /** @type {THREE.Mesh|null} */
  let cone = null;
  /** @type {THREE.Mesh|null} */
  let crater = null;
  /** @type {THREE.MeshStandardMaterial|null} */
  let coneMat = null;
  /** @type {THREE.MeshBasicMaterial|null} */
  let craterMat = null;
  /** @type {THREE.CanvasTexture|null} */
  let streaks = null;
  /** @type {Bomb[]} */
  const bombs = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let trail = null;
  let trailAlive = false;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  const scratch = new THREE.Vector3();

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
      bannerTimer = 3.5;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /**
   * Lava rivulets down the flanks: bright streaks from the top, fading out
   * towards the foot (the cone's uv.y runs foot to top).
   * @returns {THREE.CanvasTexture}
   */
  function createStreaks() {
    const w = 256;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      let x = Math.random() * w;
      const length = h * (0.4 + Math.random() * 0.55);
      for (let y = 0; y < length; y += 2) {
        x += (Math.random() - 0.5) * 3;
        const a = 1 - y / length;
        g.fillStyle = `rgba(255, ${Math.round(140 * a + 60)}, 40, ${a})`;
        g.fillRect(x, y, 2 + a * 3, 3);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /**
   * Where it rises: the newest caldera, or open ground at the edge.
   * @returns {{x: number, z: number, fromCaldera: boolean}}
   */
  function pickSite() {
    const fissures = ctx.systems.fissures;
    const spots = fissures ? fissures.hotSpots() : [];
    for (let i = spots.length - 1; i >= 0; i--) {
      if (spots[i].caldera) return { x: spots[i].x, z: spots[i].z, fromCaldera: true };
    }
    const a = Math.random() * Math.PI * 2;
    return { x: Math.sin(a) * VOLCANO.spawnRing, z: Math.cos(a) * VOLCANO.spawnRing, fromCaldera: false };
  }

  /**
   * The button: a new volcano, or the sleeping one erupting again.
   * @returns {boolean}
   */
  function erupt() {
    if (!cone || !crater) return false;
    if (site && site.erupt > 0) return false;
    if (!site) {
      const at = pickSite();
      site = {
        x: at.x, z: at.z, grow: 0, erupt: 0, next: 0, shaken: new Set(),
        hazard: ctx.systems.hazards.addHazard({ x: at.x, z: at.z, radius: VOLCANO.baseRadius + 12, kind: 'volcano' })
      };
      cone.position.set(at.x, 0, at.z);
      crater.position.set(at.x, 0, at.z);
      cone.visible = crater.visible = true;
      // No caldera to rise from: the ground shakes as it comes up.
      if (!at.fromCaldera) {
        const quake = document.getElementById('btn-earthquake');
        if (quake) quake.click();
      }
      showBanner('VOLCANO!', 'The lava is building a cone · lava bombs will set the town alight');
    } else {
      showBanner('ERUPTION!', 'The volcano wakes · lava bombs incoming');
    }
    site.erupt = VOLCANO.eruptSeconds;
    site.next = 0;
    if (button) button.disabled = true;
    return true;
  }

  /** @returns {boolean} whether the Blizzard has it frozen */
  function frozen() {
    return !!(ctx.systems.blizzard && ctx.systems.blizzard.active());
  }

  /**
   * One bomb out of the crater, at a building if there is one in range.
   * @returns {void}
   */
  function throwBomb() {
    if (!site) return;
    const b = bombs.find(v => v.t >= 1);
    if (!b) return;
    const [lo, hi] = VOLCANO.bombRange;
    let tx = 0;
    let tz = 0;
    const candidates = ctx.Environment.buildings.filter(bd => {
      if (bd.damageState === 'collapsed') return false;
      const d = Math.hypot(bd.mesh.position.x - site.x, bd.mesh.position.z - site.z);
      return d > lo && d < hi;
    });
    if (candidates.length && Math.random() < 0.75) {
      const bd = candidates[Math.floor(Math.random() * candidates.length)];
      tx = bd.mesh.position.x + (Math.random() - 0.5) * 6;
      tz = bd.mesh.position.z + (Math.random() - 0.5) * 6;
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = lo + Math.random() * (hi - lo);
      tx = site.x + Math.sin(a) * r;
      tz = site.z + Math.cos(a) * r;
    }
    const height = VOLCANO.height * site.grow;
    b.from.set(site.x, height, site.z);
    b.to.set(tx, 0.5, tz);
    b.seconds = VOLCANO.bombFlight[0] + Math.random() * (VOLCANO.bombFlight[1] - VOLCANO.bombFlight[0]);
    b.arc = 25 + Math.random() * 30;
    b.t = 0;
    b.mesh.visible = true;
    ctx.systems.explosions.spawnImpactBurst(scratch.set(site.x, height + 2, site.z), 1);
  }

  /**
   * Where a bomb comes down.
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function land(at) {
    const sys = ctx.systems;
    sys.explosions.spawnImpactBurst(scratch.set(at.x, 1, at.z), 1.8);
    sys.gamefeel.event('gas', scratch);
    sys.buildingFire.igniteNear(at.x, at.z, VOLCANO.igniteRadius);
    /** @type {SimObject[]} */
    const people = [];
    sys.area.forEachInRadius({ x: at.x, z: at.z, radius: VOLCANO.killRadius, targets: ['person'] }, (hit) => people.push(hit.target));
    for (const person of people) sys.people.explodePerson(person);
    const roger = sys.heroMode && sys.heroMode.rogerTarget();
    if (roger && Math.hypot(roger.x - at.x, roger.z - at.z) < VOLCANO.killRadius * 0.8) {
      sys.health.damagePlayer({
        source: 'lavaBomb', instantKill: true, title: 'LAVA BOMB', sub: 'A lava bomb came down on Roger',
        position: { x: at.x, y: 0, z: at.z }
      });
    }
  }

  /**
   * @param {THREE.Vector3} at
   * @param {number} n
   * @param {boolean} fire flames rather than smoke
   * @returns {void}
   */
  function puff(at, n, fire) {
    if (!trail) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = trail.next;
      trail.next = (trail.next + 1) % trail.life.length;
      const life = fire ? 0.5 + Math.random() * 0.4 : 1.6 + Math.random();
      trail.life[i] = life;
      trail.maxLife[i] = life;
      trail.seed[i] = fire ? -1 - Math.random() : Math.random();
      trail.positions.set([at.x + (Math.random() - 0.5), at.y + (Math.random() - 0.5), at.z + (Math.random() - 0.5)], i * 3);
      trail.velocities.set([(Math.random() - 0.5) * 2, fire ? 4 : 1.5, (Math.random() - 0.5) * 2], i * 3);
    }
    if (count > 0) trailAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepTrail(dt) {
    if (!trail || !trailAlive) return;
    trail.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < trail.life.length; i++) {
      if (trail.life[i] <= 0) {
        if (trail.sizes[i] !== 0) { trail.colours[i * 4 + 3] = 0; trail.sizes[i] = 0; }
        continue;
      }
      any = true;
      trail.life[i] -= dt;
      const t = 1 - Math.max(0, trail.life[i]) / trail.maxLife[i];
      const v = i * 3;
      trail.positions[v] += trail.velocities[v] * dt;
      trail.positions[v + 1] += trail.velocities[v + 1] * dt;
      trail.positions[v + 2] += trail.velocities[v + 2] * dt;
      if (trail.seed[i] < 0) {
        trail.colours.set([2.2, 0.9 - t * 0.6, 0.2, (1 - t) * 0.9], i * 4);
        trail.sizes[i] = 2.2 * (1 - t * 0.5);
      } else {
        trail.colours.set([0.22, 0.2, 0.19, 0.55 * Math.min(1, t * 4) * (1 - t)], i * 4);
        trail.sizes[i] = 2 + t * 5;
      }
    }
    markPoolDirty(trail);
    trailAlive = any;
  }

  /** @returns {void} */
  function initVolcano() {
    streaks = createStreaks();
    const profile = [
      new THREE.Vector2(0.001, 0.02),
      new THREE.Vector2(VOLCANO.baseRadius, 0.02),
      new THREE.Vector2(VOLCANO.baseRadius * 0.62, VOLCANO.height * 0.35),
      new THREE.Vector2(VOLCANO.baseRadius * 0.34, VOLCANO.height * 0.78),
      new THREE.Vector2(VOLCANO.craterRadius * 1.3, VOLCANO.height),
      new THREE.Vector2(VOLCANO.craterRadius, VOLCANO.height * 0.96)
    ];
    coneMat = new THREE.MeshStandardMaterial({
      color: VOLCANO.rock, roughness: 0.95, emissive: 0xffffff, emissiveMap: streaks, emissiveIntensity: 1.4, flatShading: true
    });
    cone = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), coneMat);
    cone.name = 'volcano_cone';
    cone.castShadow = true;
    cone.receiveShadow = true;
    cone.visible = false;
    craterMat = new THREE.MeshBasicMaterial({ color: VOLCANO.lava.clone() });
    crater = new THREE.Mesh(new THREE.CircleGeometry(VOLCANO.craterRadius, 20), craterMat);
    crater.rotation.x = -Math.PI / 2;
    crater.name = 'volcano_crater';
    crater.visible = false;
    Sim.three.scene.add(cone, crater);
    const bombGeo = new THREE.DodecahedronGeometry(VOLCANO.bombSize, 0);
    const bombMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.8, 0.2) });
    for (let i = 0; i < VOLCANO.maxBombs; i++) {
      const mesh = new THREE.Mesh(bombGeo, bombMat);
      mesh.visible = false;
      mesh.name = 'lava_bomb';
      Sim.three.scene.add(mesh);
      bombs.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, seconds: 3, arc: 30 });
    }
    // Flames (seed < 0) and smoke in one pool: the fire texture reads as
    // soft smoke when it is dark and dim.
    trail = createParticlePool(Sim.three.scene, VOLCANO.trailMax, createFireTexture(), THREE.NormalBlending, 'volcano_trail');
    ctx.systems.caps.trackPool(trail);
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-volcano'));
    if (button) button.addEventListener('click', () => { erupt(); }, { signal: ctx.signal });
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateVolcano(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (dt <= 0) return;
    stepTrail(dt);
    if (!site || !cone || !crater || !coneMat || !craterMat) return;
    const cold = frozen();
    // Growing: the cone rises out of the ground, and what stands there falls.
    if (site.grow < 1) {
      site.grow = Math.min(1, site.grow + dt / VOLCANO.growSeconds);
      const g = THREE.MathUtils.smoothstep(site.grow, 0, 1);
      cone.scale.set(0.35 + 0.65 * g, Math.max(0.01, g), 0.35 + 0.65 * g);
      const reach = VOLCANO.baseRadius * (0.35 + 0.65 * g);
      for (const b of ctx.Environment.buildings) {
        if (site.shaken.has(b) || b.damageState === 'collapsed') continue;
        const q = b.mesh.position;
        if (Math.hypot(q.x - site.x, q.z - site.z) < reach) {
          site.shaken.add(b);
          ctx.systems.damage.shockBuilding(b, 12, scratch.set(site.x, 2, site.z));
        }
      }
      if (Math.random() < dt * 3) ctx.systems.gamefeel.addShake(0.2, 0.3);
    }
    crater.position.y = VOLCANO.height * 0.96 * cone.scale.y + 0.05;
    crater.scale.setScalar(cone.scale.x);
    // Glow: the lava, unless the Blizzard has frozen it.
    const pulse = 0.85 + 0.15 * Math.sin(ctx.now() * 3);
    coneMat.emissiveIntensity = cold ? 0 : 1.4 * pulse;
    if (cold) craterMat.color.setHex(0xdff2ff);
    else craterMat.color.copy(VOLCANO.lava).multiplyScalar(pulse);
    if (!cold) {
      ctx.systems.lightPool.requestLight({
        x: site.x, y: crater.position.y + 6, z: site.z, colour: 0xff6a1a,
        intensity: 6 * site.grow, distance: 120, priority: 5
      });
      // Smoke off the crater, always; flames while it erupts.
      if (Math.random() < dt * 12) puff(scratch.set(site.x, crater.position.y + 2, site.z), 2, site.erupt > 0);
    }
    // Erupting.
    if (site.erupt > 0) {
      site.erupt -= dt;
      if (site.erupt <= 0) {
        if (button) button.disabled = false;
        showBanner('The volcano sleeps', 'Press 🌋 Volcano again to wake it');
      } else if (!cold && site.grow > 0.5) {
        site.next -= dt;
        if (site.next <= 0) {
          const [lo, hi] = VOLCANO.bombEvery;
          site.next = lo + Math.random() * (hi - lo);
          throwBomb();
        }
      }
    }
    // The bombs in the air.
    for (const b of bombs) {
      if (b.t >= 1) continue;
      b.t = Math.min(1, b.t + dt / b.seconds);
      b.mesh.position.lerpVectors(b.from, b.to, b.t);
      b.mesh.position.y += Math.sin(b.t * Math.PI) * b.arc;
      b.mesh.rotation.x += dt * 5;
      b.mesh.rotation.z += dt * 3;
      if (Math.random() < dt * 30) puff(b.mesh.position, 1, Math.random() < 0.5);
      if (b.t >= 1) {
        b.mesh.visible = false;
        land(b.to);
      }
    }
  }

  /**
   * For Roger's movement (hero/movement.js): the cone is solid.
   * @returns {{x: number, z: number, hw: number, hd: number}[]}
   */
  function solids() {
    if (!site || !cone) return [];
    const r = VOLCANO.baseRadius * cone.scale.x * 0.7;
    return [{ x: site.x, z: site.z, hw: r, hd: r }];
  }

  /** @returns {void} */
  function resetVolcano() {
    if (site && site.hazard) ctx.systems.hazards.removeHazard(site.hazard);
    site = null;
    if (cone) cone.visible = false;
    if (crater) crater.visible = false;
    for (const b of bombs) {
      b.t = 1;
      b.mesh.visible = false;
    }
    if (trail) {
      trail.life.fill(0);
      trail.colours.fill(0);
      trail.sizes.fill(0);
      markPoolDirty(trail);
    }
    trailAlive = false;
    if (button) button.disabled = false;
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeVolcano() {
    resetVolcano();
    for (const m of [cone, crater]) if (m) { Sim.three.scene.remove(m); m.geometry.dispose(); }
    if (bombs.length) {
      bombs[0].mesh.geometry.dispose();
      /** @type {THREE.Material} */ (bombs[0].mesh.material).dispose();
    }
    for (const b of bombs) Sim.three.scene.remove(b.mesh);
    bombs.length = 0;
    for (const m of [coneMat, craterMat]) if (m) m.dispose();
    if (streaks) streaks.dispose();
    if (trail) disposeParticlePool(Sim.three.scene, trail);
    cone = crater = null;
    coneMat = null;
    craterMat = null;
    streaks = null;
    trail = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
  }

  return {
    erupt, solids,
    state: () => (site ? { x: site.x, z: site.z, grow: site.grow, erupting: site.erupt > 0, frozen: frozen(), bombs: bombs.filter(b => b.t < 1).length } : null),
    initVolcano, updateVolcano, resetVolcano, disposeVolcano
  };
}
