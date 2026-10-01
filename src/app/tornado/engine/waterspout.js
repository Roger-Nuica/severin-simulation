// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { createShortNoiseBuffer } from './sound/thunder.js';
import { soundRandom } from './sound/random.js';
import { createSharks } from './waterspout/sharks.js';

/**
 * ===========================================================================
 * SECTION WS — Waterspout
 * ===========================================================================
 * A tornado over water: the lake behind the dam (flood.js's reservoir) is
 * the only water there is, so that is where it happens -- no new ocean.
 *
 * 🌊 Waterspout (in 💥 Disasters), or at random once an Outbreak (two or
 * more funnels) is under way: a spinning column of spray rises off the lake
 * and wanders across it for WS.seconds.
 *  - The lake answers: rings of waves racing out from its foot (a
 *    displaced ring of the lake surface round it) and the whole reservoir
 *    sloshing.
 *  - Spray and mist: a skirt of spray at the foot, mist carried up the
 *    column and blown off it (one particle pool on the budget).
 *  - Sharks: every few seconds it pulls a shark out of the lake and flings
 *    it over the town (waterspout/sharks.js, the Sharkspout).
 *  - Boats: WS.boats small boats ride the lake; one the spout reaches is
 *    lifted, spun up the column, thrown out and broken, and sinks.
 *  - It no longer breaks the dam: the flood starts only from its own
 *    button (or Doomsday).
 *  - Sound: a whirling roar over the slap of the waves, procedural, louder
 *    the nearer the camera.
 * A Reset takes it away and puts the boats back.
 */

export const WS = {
  seconds: 45,
  speed: 7,                 // m/s across the lake
  height: 110,              // up into the cloud base
  footRadius: 4,
  topRadius: 11,            // a thin rope, not a funnel: it read as a solid trumpet at 22
  seekTurn: 0.7,            // rad/s it bends towards the nearest boat still afloat
  boatReach: 14,            // metres: a boat this close is taken
  boats: 5,
  waveRadius: 45,
  sprayMax: 1100,
  outbreakDelay: [20, 60],  // seconds after the Outbreak starts
  colour: 0xdceef7
};

/**
 * @param {Object} ctx
 * @returns {{
 *   spawn: () => boolean,
 *   state: () => ({x: number, z: number, left: number, boatsLeft: number}|null),
 *   initWaterspout: () => void,
 *   updateWaterspout: (dt: number, rawDt: number) => void,
 *   resetWaterspout: () => void,
 *   disposeWaterspout: () => void
 * }}
 */
export function createWaterspoutSystem(ctx) {
  const { Sim } = ctx;
  /** @type {{x: number, z: number, heading: number, left: number, t: number}|null} */
  let spout = null;
  // The sharks it throws at the town (waterspout/sharks.js).
  const sharks = createSharks(ctx);
  /**
   * A shark's landing: a burst of the spout's own spray.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} n
   * @returns {void}
   */
  const splash = (x, y, z, n) => emit(x, y, z, n, 9, 7);
  /** @type {THREE.Group|null} */
  let column = null;
  /** @type {THREE.Mesh[]} */
  let layers = [];
  /** @type {THREE.Mesh|null} */
  let waves = null;
  /** @type {Float32Array|null} */
  let waveBase = null;
  /**
   * @typedef {Object} Boat
   * @property {THREE.Group} mesh
   * @property {number} x
   * @property {number} z
   * @property {'afloat'|'taken'|'thrown'|'sunk'} state
   * @property {number} t
   * @property {THREE.Vector3} vel
   * @property {number} angle round the column while taken
   */
  /** @type {Boat[]} */
  let boats = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let spray = null;
  let sprayAlive = false;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  let outbreakTimer = -1;
  let spawnedThisRun = false;
  /** @type {{bus: GainNode, roar: GainNode, surf: GainNode, surfFilter: BiquadFilterNode, sources: AudioBufferSourceNode[]}|null} */
  let sound = null;
  const scratch = new THREE.Vector3();
  /** @type {THREE.Mesh|null} flood.js's lake */
  let reservoir = null;
  let halfLength = 75;
  /** @type {THREE.Material[]} */
  const materials = [];

  /**
   * The lake, from flood.js's own numbers: its surface, its extent.
   * @returns {{y: number, x0: number, x1: number, z0: number, z1: number, damX: number}|null}
   */
  function lake() {
    const flood = ctx.systems.flood;
    const wall = flood && flood.damWall ? flood.damWall() : null;
    // Found once (flood.js builds it at init and keeps it).
    if (!reservoir) {
      reservoir = /** @type {THREE.Mesh|null} */ (Sim.three.scene.getObjectByName('flood_reservoir') || null);
      if (reservoir) {
        reservoir.geometry.computeBoundingBox();
        halfLength = /** @type {THREE.Box3} */ (reservoir.geometry.boundingBox).max.x;
      }
    }
    if (!wall || !reservoir || !reservoir.visible) return null;
    const p = reservoir.position;
    return { y: p.y, x0: p.x - halfLength + 12, x1: wall.x - 6, z0: -wall.halfWidth + 12, z1: wall.halfWidth - 12, damX: wall.x };
  }

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
   * A small boat: a hull, a cabin, a mast.
   * @param {THREE.Material} hullMat
   * @param {THREE.Material} cabinMat
   * @returns {THREE.Group}
   */
  function buildBoat(hullMat, cabinMat) {
    const g = new THREE.Group();
    g.name = 'lake_boat';
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 6), hullMat);
    hull.position.y = 0.3;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 4), hullMat);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, 0.3, 4);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 2), cabinMat);
    cabin.position.set(0, 1.3, -0.6);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 5), cabinMat);
    mast.position.set(0, 3, 1);
    g.add(hull, bow, cabin, mast);
    return g;
  }

  /** @returns {void} the boats back on the lake */
  function placeBoats() {
    const L = lake();
    for (const b of boats) {
      b.state = 'afloat';
      b.t = Math.random() * 10;
      if (L) {
        b.x = L.x0 + Math.random() * (L.x1 - L.x0 - 20);
        b.z = L.z0 + Math.random() * (L.z1 - L.z0);
      }
      b.mesh.visible = !!L;
      b.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
      b.mesh.scale.setScalar(1);
    }
  }

  /** @returns {boolean} */
  function spawn() {
    const L = lake();
    if (spout || !L || !column) return false;
    spout = {
      x: L.x0 + (L.x1 - L.x0) * (0.25 + Math.random() * 0.3),
      z: L.z0 + (L.z1 - L.z0) * (0.3 + Math.random() * 0.4),
      heading: Math.random() * Math.PI * 2, left: WS.seconds, t: 0
    };
    column.visible = true;
    if (waves) waves.visible = true;
    if (button) button.disabled = true;
    showBanner('WATERSPOUT!', 'A tornado over the lake · the boats are in its path');
    return true;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} n
   * @param {number} up m/s
   * @param {number} out m/s
   * @returns {void}
   */
  function emit(x, y, z, n, up, out) {
    if (!spray) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = spray.next;
      spray.next = (spray.next + 1) % spray.life.length;
      const life = 1.2 + Math.random() * 1.2;
      spray.life[i] = life;
      spray.maxLife[i] = life;
      spray.seed[i] = Math.random();
      const a = Math.random() * Math.PI * 2;
      const r = WS.footRadius * (0.6 + Math.random() * 0.8);
      spray.positions.set([x + Math.cos(a) * r, y + Math.random() * 2, z + Math.sin(a) * r], i * 3);
      // Round the column (tangent) and out, and up.
      spray.velocities.set([-Math.sin(a) * 12 + Math.cos(a) * out, up * (0.6 + Math.random() * 0.8), Math.cos(a) * 12 + Math.sin(a) * out], i * 3);
    }
    if (count > 0) sprayAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepSpray(dt) {
    if (!spray || !sprayAlive) return;
    spray.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < spray.life.length; i++) {
      if (spray.life[i] <= 0) {
        if (spray.sizes[i] !== 0) { spray.colours[i * 4 + 3] = 0; spray.sizes[i] = 0; }
        continue;
      }
      any = true;
      spray.life[i] -= dt;
      const t = 1 - Math.max(0, spray.life[i]) / spray.maxLife[i];
      const v = i * 3;
      spray.velocities[v + 1] -= 2 * dt;
      spray.positions[v] += spray.velocities[v] * dt;
      spray.positions[v + 1] += spray.velocities[v + 1] * dt;
      spray.positions[v + 2] += spray.velocities[v + 2] * dt;
      spray.colours.set([0.88, 0.94, 1, 0.5 * Math.min(1, t * 5) * (1 - t)], i * 4);
      spray.sizes[i] = 1.5 + t * 6 * (0.6 + spray.seed[i]);
    }
    markPoolDirty(spray);
    sprayAlive = any;
  }

  /**
   * The whirl and the waves, built once there is a running AudioContext.
   * @returns {void}
   */
  function ensureSound() {
    if (sound) return;
    const SoundSystem = ctx.SoundSystem;
    const actx = SoundSystem && SoundSystem.context;
    if (!actx || actx.state !== 'running' || !SoundSystem.effectsGain) return;
    const buffer = createShortNoiseBuffer(actx, 2);
    const bus = actx.createGain();
    bus.gain.value = 0;
    bus.connect(SoundSystem.effectsGain);
    /**
     * @param {BiquadFilterType} type
     * @param {number} f
     * @param {number} q
     * @returns {{gain: GainNode, filter: BiquadFilterNode, source: AudioBufferSourceNode}}
     */
    const layer = (type, f, q) => {
      const source = actx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = actx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = f;
      filter.Q.value = q;
      const gain = actx.createGain();
      source.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      source.start(0, soundRandom() * buffer.duration);
      return { gain, filter, source };
    };
    const roar = layer('bandpass', 420, 0.7);
    const surf = layer('lowpass', 700, 0.5);
    roar.gain.gain.value = 0.9;
    surf.gain.gain.value = 0.6;
    sound = { bus, roar: roar.gain, surf: surf.gain, surfFilter: surf.filter, sources: [roar.source, surf.source] };
  }

  /**
   * @param {number} level 0..1
   * @param {number} time
   * @returns {void}
   */
  function updateSound(level, time) {
    if (level > 0) ensureSound();
    if (!sound) return;
    const now = sound.bus.context.currentTime;
    sound.bus.gain.setTargetAtTime(level * 0.5, now, 0.2);
    // The waves: a slow swell and break.
    const swell = 0.5 + 0.5 * Math.sin(time * 1.3);
    sound.surf.gain.setTargetAtTime(0.3 + 0.5 * swell, now, 0.15);
    sound.surfFilter.frequency.setTargetAtTime(400 + 900 * swell, now, 0.15);
  }

  /** @returns {void} */
  function releaseSound() {
    if (!sound) return;
    try {
      const now = sound.bus.context.currentTime;
      sound.bus.gain.setTargetAtTime(0, now, 0.05);
      for (const s of sound.sources) s.stop(now + 0.3);
    } catch {
      // The context is already closed.
    }
    sound = null;
  }

  /** @returns {void} */
  function initWaterspout() {
    const mat = (/** @type {number} */ opacity) => {
      const m = new THREE.MeshBasicMaterial({ color: WS.colour, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      materials.push(m);
      return m;
    };
    column = new THREE.Group();
    column.name = 'waterspout';
    column.visible = false;
    layers = [];
    for (const [scale, opacity] of [[1, 0.12], [0.7, 0.18], [0.4, 0.3]]) {
      const profile = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        profile.push(new THREE.Vector2((WS.footRadius + (WS.topRadius - WS.footRadius) * t * t) * scale, t * WS.height));
      }
      const layer = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), mat(opacity));
      column.add(layer);
      layers.push(layer);
    }
    Sim.three.scene.add(column);
    // The waves: a ring of lake surface, displaced per frame.
    const ringGeo = new THREE.RingGeometry(WS.footRadius, WS.waveRadius, 48, 10);
    ringGeo.rotateX(-Math.PI / 2);
    waveBase = Float32Array.from(/** @type {Float32Array} */ (ringGeo.attributes.position.array));
    waves = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x2a6f8a, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.85 }));
    materials.push(/** @type {THREE.Material} */ (waves.material));
    waves.name = 'waterspout_waves';
    waves.visible = false;
    Sim.three.scene.add(waves);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.5 });
    materials.push(hullMat, cabinMat);
    boats = [];
    for (let i = 0; i < WS.boats; i++) {
      const mesh = buildBoat(hullMat, cabinMat);
      Sim.three.scene.add(mesh);
      boats.push({ mesh, x: 0, z: 0, state: 'afloat', t: 0, vel: new THREE.Vector3(), angle: 0 });
    }
    spray = createParticlePool(Sim.three.scene, WS.sprayMax, createSoftDotTexture(), THREE.NormalBlending, 'waterspout_spray');
    ctx.systems.caps.trackPool(spray);
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-waterspout'));
    if (button) button.addEventListener('click', () => { spawn(); }, { signal: ctx.signal });
    placeBoats();
    sharks.init();
  }

  /**
   * The boats: bobbing, taken, thrown, sunk.
   * @param {number} dt
   * @param {number} y the lake's surface
   * @returns {void}
   */
  function updateBoats(dt, y) {
    for (const b of boats) {
      if (!b.mesh.visible && b.state !== 'afloat') continue;
      b.t += dt;
      if (b.state === 'afloat') {
        const d = spout ? Math.hypot(b.x - spout.x, b.z - spout.z) : Infinity;
        const rough = spout ? Math.max(0, 1 - d / WS.waveRadius) : 0;
        b.mesh.position.set(b.x, y + 0.2 + Math.sin(b.t * 2) * (0.15 + rough * 0.9), b.z);
        b.mesh.rotation.z = Math.sin(b.t * 1.3) * (0.05 + rough * 0.3);
        b.mesh.rotation.x = Math.sin(b.t * 1.7) * (0.04 + rough * 0.25);
        if (spout && d < WS.boatReach) {
          b.state = 'taken';
          b.t = 0;
          b.angle = Math.atan2(b.z - spout.z, b.x - spout.x);
          showBanner('BOAT TAKEN!', 'The waterspout has a boat');
        }
      } else if (b.state === 'taken' && spout) {
        // Round and up the column.
        b.angle += dt * 3;
        const r = WS.footRadius + b.t * 4;
        b.mesh.position.set(spout.x + Math.cos(b.angle) * r, y + b.t * 14, spout.z + Math.sin(b.angle) * r);
        b.mesh.rotation.x += dt * 4;
        b.mesh.rotation.y += dt * 6;
        if (b.t > 2.5) {
          b.state = 'thrown';
          b.t = 0;
          b.vel.set(Math.cos(b.angle) * 25, 8, Math.sin(b.angle) * 25);
        }
      } else if (b.state === 'thrown' || (b.state === 'taken' && !spout)) {
        if (b.state === 'taken') { b.state = 'thrown'; b.vel.set(0, 0, 0); }
        b.vel.y -= 14 * dt;
        b.mesh.position.addScaledVector(b.vel, dt);
        b.mesh.rotation.z += dt * 5;
        if (b.mesh.position.y <= y) {
          // Broken on the water: a splash, and it goes under.
          b.state = 'sunk';
          b.t = 0;
          ctx.systems.explosions.spawnImpactBurst(scratch.set(b.mesh.position.x, y + 1, b.mesh.position.z), 0.6);
          emit(b.mesh.position.x, y, b.mesh.position.z, 60, 10, 10);
          ctx.systems.damage.addDamageScore(300);
        }
      } else if (b.state === 'sunk') {
        b.mesh.position.y -= dt * 1.5;
        b.mesh.rotation.x += dt * 0.6;
        if (b.t > 3) b.mesh.visible = false;
      }
    }
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @param {number} rawDt real seconds, for the sound
   * @returns {void}
   */
  function updateWaterspout(dt, rawDt) {
    if (bannerTimer > 0) {
      bannerTimer -= rawDt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    // At random in an Outbreak: once a run, a while after it starts.
    if (dt > 0 && !spout && !spawnedThisRun && Sim.state.running && ctx.tornadoes.count() >= 2) {
      if (outbreakTimer < 0) outbreakTimer = WS.outbreakDelay[0] + Math.random() * (WS.outbreakDelay[1] - WS.outbreakDelay[0]);
      outbreakTimer -= dt;
      if (outbreakTimer <= 0 && spawn()) spawnedThisRun = true;
    }
    const L = lake();
    if (dt > 0) stepSpray(dt);
    if (L && dt > 0) {
      updateBoats(dt, L.y);
      sharks.update(dt, spout, L.y, splash);
    }
    if (!spout || !column || !L) {
      updateSound(0, 0);
      return;
    }
    const s = spout;
    if (dt > 0) {
      s.t += dt;
      s.left -= dt;
      // Wandering across the lake, turned back at its shores.
      s.heading += (Math.sin(s.t * 0.7) * 0.6 + (Math.random() - 0.5)) * dt;
      // Drawn to the boats: it bends towards the nearest one still afloat.
      let target = null;
      let best = Infinity;
      for (const b of boats) {
        if (b.state !== 'afloat') continue;
        const d = Math.hypot(b.x - s.x, b.z - s.z);
        if (d < best) { best = d; target = b; }
      }
      if (target) {
        const want = Math.atan2(target.z - s.z, target.x - s.x);
        const turn = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading));
        s.heading += THREE.MathUtils.clamp(turn, -WS.seekTurn * dt, WS.seekTurn * dt);
      }
      s.x += Math.cos(s.heading) * WS.speed * dt;
      s.z += Math.sin(s.heading) * WS.speed * dt;
      if (s.x < L.x0 || s.x > L.x1 || s.z < L.z0 || s.z > L.z1) {
        s.heading = Math.atan2((L.z0 + L.z1) / 2 - s.z, (L.x0 + L.x1) / 2 - s.x) + (Math.random() - 0.5);
        s.x = THREE.MathUtils.clamp(s.x, L.x0, L.x1);
        s.z = THREE.MathUtils.clamp(s.z, L.z0, L.z1);
      }
      emit(s.x, L.y, s.z, Math.round(120 * dt + Math.random()), 4, 3);
      emit(s.x, L.y + WS.height * Math.random() * 0.6, s.z, Math.round(40 * dt + Math.random()), 6, 8);
    }
    column.position.set(s.x, L.y, s.z);
    const fade = Math.min(1, s.t / 2, Math.max(0, s.left) / 2);
    column.scale.set(1, Math.max(0.01, fade), 1);
    layers.forEach((layer, i) => { layer.rotation.y += dt * (2 + i * 1.5); });
    // The waves: rings racing out from its foot.
    if (waves && waveBase) {
      waves.position.set(s.x, L.y + 0.15, s.z);
      const pos = /** @type {THREE.BufferAttribute} */ (waves.geometry.attributes.position);
      for (let i = 0; i < pos.count; i++) {
        const x = waveBase[i * 3];
        const z = waveBase[i * 3 + 2];
        const r = Math.hypot(x, z);
        const edge = 1 - r / WS.waveRadius;
        pos.setY(i, Math.sin(r * 0.5 - s.t * 6) * 1.2 * edge * fade);
      }
      pos.needsUpdate = true;
      waves.geometry.computeVertexNormals();
    }
    // The whole lake sloshing.
    const res = reservoir;
    if (res) res.rotation.y = Math.sin(s.t * 0.8) * 0.004 * fade;
    const cam = Sim.three.camera.position;
    const near = Math.max(0, 1 - Math.hypot(cam.x - s.x, cam.z - s.z) / 250);
    updateSound(near * fade, s.t);
    if (s.left <= 0) {
      spout = null;
      column.visible = false;
      if (waves) waves.visible = false;
      if (res) res.rotation.y = 0;
      if (button) button.disabled = false;
      updateSound(0, 0);
    }
  }

  /** @returns {void} */
  function resetWaterspout() {
    spout = null;
    if (reservoir) reservoir.rotation.y = 0;
    if (column) column.visible = false;
    if (waves) waves.visible = false;
    if (button) button.disabled = false;
    outbreakTimer = -1;
    spawnedThisRun = false;
    if (spray) {
      spray.life.fill(0);
      spray.colours.fill(0);
      spray.sizes.fill(0);
      markPoolDirty(spray);
    }
    sprayAlive = false;
    if (sound) sound.bus.gain.setTargetAtTime(0, sound.bus.context.currentTime, 0.05);
    placeBoats();
    sharks.clear();
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeWaterspout() {
    releaseSound();
    sharks.release();
    for (const obj of [column, waves, ...boats.map(b => b.mesh)]) {
      if (!obj) continue;
      Sim.three.scene.remove(obj);
      obj.traverse((/** @type {any} */ o) => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const m of materials) m.dispose();
    materials.length = 0;
    boats = [];
    column = null;
    waves = null;
    if (spray) disposeParticlePool(Sim.three.scene, spray);
    spray = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
  }

  return {
    spawn,
    state: () => (spout ? { x: spout.x, z: spout.z, left: spout.left, boatsLeft: boats.filter(b => b.state === 'afloat').length } : null),
    initWaterspout, updateWaterspout, resetWaterspout, disposeWaterspout
  };
}
