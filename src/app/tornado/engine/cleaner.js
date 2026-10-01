// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { CHARACTERS } from './scale.js';

/**
 * ===========================================================================
 * SECTION CS — Captain Spotless (a random event)
 * ===========================================================================
 * An original character: a giant made of light, gleaming white and gold,
 * who strides across the town in a straight line with a wave of clean
 * light around his feet, CS.radius metres across. Everything the wave
 * touches is made spotless:
 *  - the debris lying about or flying is gone (debris.releaseDebris);
 *  - the fires in it are put out (buildingFire.douse);
 *  - the ice statues and the rubble of the storm he passes are left alone
 *    (they are the town's own), but the enemies are not: every enemy in the
 *    wave is disintegrated molecularly -- a burst of sparkling motes, and
 *    it is gone (the shared register, engine/enemies.js; its 'cleanse' hit
 *    is dealt as the strongest there is).
 * And a blinding glare as he comes: a white wash over the screen (CSS)
 * that fades as he passes, and a light pooled where he walks.
 *
 * A random event: once a run, CS.randomAfter seconds into it (panel test:
 * ✨ Captain Spotless). He takes CS.seconds to cross, then fades out.
 */

export const CS = {
  // A giant of light, over the tallest block (engine/scale.js CHARACTERS).
  height: CHARACTERS.spotless.height,
  radius: 22,
  seconds: 16,
  randomAfter: [120, 260],
  motesMax: 700
};

/**
 * @param {Object} ctx
 * @returns {{
 *   start: () => boolean,
 *   active: () => boolean,
 *   initCleaner: () => void,
 *   updateCleaner: (dt: number) => void,
 *   resetCleaner: () => void,
 *   disposeCleaner: () => void
 * }}
 */
export function createCleanerSystem(ctx) {
  const { Sim } = ctx;
  /** @type {{t: number, from: THREE.Vector3, to: THREE.Vector3, cleaned: number}|null} */
  let walk = null;
  /** @type {THREE.Group|null} */
  let giant = null;
  /** @type {THREE.Mesh|null} */
  let wave = null;
  /** @type {THREE.Object3D[]} */
  let legs = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let motes = null;
  let motesAlive = false;
  /** @type {HTMLDivElement|null} */
  let glare = null;
  let randomAt = -1;
  let doneThisRun = false;
  let runTime = 0;
  /** @type {THREE.Material[]} */
  const materials = [];
  const scratch = new THREE.Vector3();

  /** @returns {THREE.Group} */
  function build() {
    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.4) });
    const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.9) });
    materials.push(light, gold);
    const g = new THREE.Group();
    g.name = 'captain_spotless';
    const k = CS.height / 10;
    const rig = new THREE.Group();
    rig.scale.setScalar(k);
    g.add(rig);
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} m
     * @param {THREE.Object3D} parent
     * @param {number[]} p
     * @returns {THREE.Mesh}
     */
    const add = (geo, m, parent, p) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(p[0], p[1], p[2]);
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.CapsuleGeometry(1.1, 2.2, 6, 12), light, rig, [0, 6, 0]);
    add(new THREE.SphereGeometry(0.75, 16, 12), light, rig, [0, 8.4, 0]);
    add(new THREE.TorusGeometry(1.05, 0.08, 8, 24), gold, rig, [0, 9.4, 0]).rotation.x = Math.PI / 2; // a halo of gold
    add(new THREE.BoxGeometry(2.3, 0.25, 1.3), gold, rig, [0, 4.6, 0]); // a belt
    for (const side of [-1, 1]) {
      const arm = add(new THREE.CapsuleGeometry(0.35, 2.4, 4, 8), light, rig, [side * 1.55, 6.2, 0]);
      arm.rotation.z = side * 0.25;
    }
    legs = [-0.55, 0.55].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 4.4, 0);
      rig.add(pivot);
      add(new THREE.CapsuleGeometry(0.45, 3.2, 4, 8), light, pivot, [0, -2.2, 0]);
      return pivot;
    });
    return g;
  }

  /**
   * @param {THREE.Vector3} at
   * @param {number} n
   * @returns {void}
   */
  function sparkle(at, n) {
    if (!motes) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = motes.next;
      motes.next = (motes.next + 1) % motes.life.length;
      const life = 0.9 + Math.random() * 0.8;
      motes.life[i] = life;
      motes.maxLife[i] = life;
      motes.seed[i] = Math.random();
      motes.positions.set([at.x + (Math.random() - 0.5) * 2, at.y + Math.random() * 2, at.z + (Math.random() - 0.5) * 2], i * 3);
      motes.velocities.set([(Math.random() - 0.5) * 5, 2 + Math.random() * 6, (Math.random() - 0.5) * 5], i * 3);
    }
    if (count > 0) motesAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepMotes(dt) {
    if (!motes || !motesAlive) return;
    motes.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < motes.life.length; i++) {
      if (motes.life[i] <= 0) {
        if (motes.sizes[i] !== 0) { motes.colours[i * 4 + 3] = 0; motes.sizes[i] = 0; }
        continue;
      }
      any = true;
      motes.life[i] -= dt;
      const t = 1 - Math.max(0, motes.life[i]) / motes.maxLife[i];
      const v = i * 3;
      motes.positions[v] += motes.velocities[v] * dt;
      motes.positions[v + 1] += motes.velocities[v + 1] * dt;
      motes.positions[v + 2] += motes.velocities[v + 2] * dt;
      const tw = 0.6 + 0.4 * Math.sin((t + motes.seed[i]) * 30);
      motes.colours.set([2, 1.9, 1.4, (1 - t) * tw], i * 4);
      motes.sizes[i] = 0.5 + motes.seed[i] * 0.6;
    }
    markPoolDirty(motes);
    motesAlive = any;
  }

  /** @returns {boolean} */
  function start() {
    if (walk || !giant || !wave) return false;
    // A straight line across the town, through its middle.
    const a = Math.random() * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(a) * 140, 0, Math.sin(a) * 140);
    const to = from.clone().multiplyScalar(-1);
    walk = { t: 0, from, to, cleaned: 0 };
    giant.visible = wave.visible = true;
    giant.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    if (glare) glare.classList.add('visible');
    ctx.events.emit('announce', { title: 'CAPTAIN SPOTLESS', sub: 'Everything he touches comes up spotless · enemies included' });
    ctx.systems.creatureSounds.play('chime', { x: from.x, y: 20, z: from.z }, { size: 6 });
    doneThisRun = true;
    return true;
  }

  /**
   * The wave: what it cleans at (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function clean(x, z) {
    if (!walk) return;
    const sys = ctx.systems;
    // Debris, lying or flying.
    for (const obj of Sim.objects.slice()) {
      if (!obj.pooled) continue;
      const p = obj.position;
      if (Math.hypot(p.x - x, p.z - z) < CS.radius) {
        sparkle(p, 3);
        sys.debris.releaseDebris(obj);
        walk.cleaned++;
      }
    }
    // Fires.
    walk.cleaned += sys.buildingFire.douse(x, z, CS.radius);
    // Enemies: molecular disintegration.
    /** @type {{e: any, kind: any}[]} */
    const found = [];
    sys.area.forEachInRadius({ x, z, radius: CS.radius, targets: ['enemy'] }, (hit) => found.push({ e: hit.target, kind: hit.enemyKind }));
    for (const { e, kind } of found) {
      const p = kind.position(e);
      sparkle(scratch.set(p.x, 1.5, p.z), 40);
      sys.creatureSounds.play('sparkle', scratch);
      sys.enemies.setState(e, 'disintegrated');
      sys.enemies.hit(e, kind, { type: 'plasma', mega: true, at: { x: p.x, z: p.z } });
      const root = e.root || (e.rig && e.rig.root);
      if (root) root.visible = false;
      walk.cleaned++;
    }
  }

  /** @returns {void} */
  function initCleaner() {
    giant = build();
    giant.visible = false;
    Sim.three.scene.add(giant);
    const waveMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 1.6, 1.2), transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    materials.push(waveMat);
    wave = new THREE.Mesh(new THREE.RingGeometry(CS.radius * 0.6, CS.radius, 48, 1), waveMat);
    wave.rotation.x = -Math.PI / 2;
    wave.name = 'spotless_wave';
    wave.visible = false;
    Sim.three.scene.add(wave);
    motes = createParticlePool(Sim.three.scene, CS.motesMax, createSoftDotTexture(), THREE.AdditiveBlending, 'spotless_motes');
    ctx.systems.caps.trackPool(motes);
    glare = document.createElement('div');
    glare.className = 'spotless-glare';
    bannerHost(ctx.container).appendChild(glare);
    const button = document.getElementById('btn-spotless');
    if (button) {
      button.addEventListener('click', () => {
        // Called in from the panel: the camera glides over to him.
        if (start()) ctx.systems.camera.glideTo(() => (giant && walk ? giant.position : null), CHARACTERS.spotless.height);
      }, { signal: ctx.signal });
    }
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateCleaner(dt) {
    if (dt <= 0) return;
    stepMotes(dt);
    if (Sim.state.running && !walk && !doneThisRun) {
      runTime += dt;
      if (randomAt < 0) randomAt = CS.randomAfter[0] + Math.random() * (CS.randomAfter[1] - CS.randomAfter[0]);
      if (runTime > randomAt) start();
    }
    if (!walk || !giant || !wave) return;
    walk.t += dt / CS.seconds;
    const u = Math.min(1, walk.t);
    giant.position.lerpVectors(walk.from, walk.to, u);
    const before = Math.min(1, walk.t - dt / CS.seconds) * 40;
    const stride = u * 40;
    // His sounds (sound/creatures.js): a held shimmer of light round him, and
    // a soft, huge footfall each half stride.
    const sounds = ctx.systems.creatureSounds;
    sounds.loop('spotless', scratch.set(giant.position.x, 15, giant.position.z), 0.9);
    if (Math.floor(before / Math.PI) !== Math.floor(stride / Math.PI)) sounds.play('stomp', giant.position, { size: 6, gain: 0.5, shake: 0.15 });
    legs[0].rotation.x = Math.sin(stride) * 0.4;
    legs[1].rotation.x = -Math.sin(stride) * 0.4;
    wave.position.set(giant.position.x, 0.3, giant.position.z);
    wave.rotation.z += dt * 1.5;
    /** @type {THREE.MeshBasicMaterial} */ (wave.material).opacity = 0.35 + 0.15 * Math.sin(walk.t * 60);
    clean(giant.position.x, giant.position.z);
    if (Math.random() < dt * 30) sparkle(scratch.set(giant.position.x + (Math.random() - 0.5) * CS.radius, 0.5, giant.position.z + (Math.random() - 0.5) * CS.radius), 4);
    ctx.systems.lightPool.requestLight({ x: giant.position.x, y: 12, z: giant.position.z, colour: 0xfff4d6, intensity: 9, distance: 90, priority: 6 });
    // The glare: blinding as he comes on, fading as he goes.
    if (glare) glare.style.opacity = String(Math.max(0, 0.75 * (1 - u * 1.4)));
    if (u >= 1) {
      giant.visible = wave.visible = false;
      if (glare) glare.classList.remove('visible');
      ctx.systems.damage.addDamageScore(1000);
      ctx.events.emit('notice', { text: `✨ SPOTLESS · ${walk.cleaned} things cleaned` });
      walk = null;
    }
  }

  /** @returns {void} */
  function resetCleaner() {
    walk = null;
    if (giant) giant.visible = false;
    if (wave) wave.visible = false;
    if (glare) glare.classList.remove('visible');
    doneThisRun = false;
    randomAt = -1;
    runTime = 0;
    if (motes) {
      motes.life.fill(0);
      motes.colours.fill(0);
      motes.sizes.fill(0);
      markPoolDirty(motes);
    }
    motesAlive = false;
  }

  /** @returns {void} */
  function disposeCleaner() {
    for (const obj of [giant, wave]) {
      if (!obj) continue;
      Sim.three.scene.remove(obj);
      obj.traverse((/** @type {any} */ o) => { if (o.geometry) o.geometry.dispose(); });
    }
    giant = wave = null;
    for (const m of materials) m.dispose();
    materials.length = 0;
    if (motes) disposeParticlePool(Sim.three.scene, motes);
    motes = null;
    if (glare && glare.parentNode) glare.parentNode.removeChild(glare);
    glare = null;
  }

  return { start, active: () => !!walk, initCleaner, updateCleaner, resetCleaner, disposeCleaner };
}
