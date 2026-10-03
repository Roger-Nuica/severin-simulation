// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';
import { createAurora } from './solarStorm/aurora.js';

/**
 * ===========================================================================
 * SECTION SS — Solar storm
 * ===========================================================================
 * A disaster tile (btn-solar): a coronal mass ejection hits the Earth. It
 * does not knock anything over. It switches the town off.
 *
 * Phases:
 *  - 'flare' (SOLAR.flareSeconds): the flare goes off -- a white-gold flash
 *    and a rising sweep of sound -- and the banner counts down to the
 *    impact while the town browns out: windows and streetlamps flicker,
 *    the radio crackles;
 *  - 'storm': the impact. The aurora unrolls down the sky from the top
 *    (solarStorm/aurora.js) and the blackout crosses the town as a front
 *    from one side to the other (SOLAR.sweepSeconds): the poles it passes
 *    arc in turn (powerLines.surgeAt, sparks and bolts that set nothing
 *    alight), the windows behind it go dark pane by pane (the window
 *    shader's uOutage, buildings.js), the streetlamps die one by one, the
 *    mains hum winds down with a clunk. Every engine stops: the cars on
 *    the viaduct, the train, the tanker, the chase car and Roger's own car
 *    coast to a halt and will not go (stalled()). The machines lock up as
 *    the front reaches them -- the Terminators, Roger's pursuers and the
 *    cyber T-Rex frozen in place and twitching, throwing sparks; the alien
 *    ships sag in the air with their lights stuttering and hold their fire,
 *    the hunters too, and the mothership's beam cuts out (jamAt, read by
 *    each owner). Then the storm comes in surges every few seconds: the
 *    aurora flares, more poles arc, the machines lock up again, and the
 *    picture itself glitches (post.js Post.glitch) along with Roger's HUD
 *    and the minimap -- the camera is electronics too. Halfway through,
 *    the great surge: the aurora goes straight overhead into a corona;
 *  - 'restore' (SOLAR.restoreSeconds): the aurora fades, and the power
 *    comes back the way it went, a second front across the town: lamps
 *    stuttering back on, windows filling in, the hum winding back up, the
 *    machines rebooting (the Terminators' boot sound).
 *
 * Roger's side (player/emp.js): while the storm is on, his EMP is
 * amplified (SOLAR.amplify) -- a wider pulse, and it runs down the power
 * lines: every pole near him fires in turn, nearest first, each one an EMP
 * of its own (chainEmp). The town's grid becomes his weapon.
 *
 * The sound is sound/solarStorm.js: the natural radio a real geomagnetic
 * storm makes (whistlers, the dawn chorus), static, the grid.
 *
 * The storm hurts nobody by itself: what it does to the machines is a
 * stall ('frozen' through the enemy register, refreshed every frame while
 * jammed), not damage, and its arcs set nothing on fire.
 */

export const SOLAR = {
  flareSeconds: 5,
  // The blackout front crossing the town, and the way back.
  sweepSeconds: 3.8,
  sweepFrom: -150,
  sweepTo: 150,
  stormSeconds: [30, 36],
  restoreSeconds: 4.5,
  // Machines locked up as the front reaches them on impact.
  impactJam: 4.5,
  // Surges after that.
  surgeEvery: [5, 8.5],
  surgeSeconds: [1.8, 2.8],
  surgePoles: 3,
  // The great surge, with the corona: at this fraction of the storm.
  greatAt: 0.45,
  greatSeconds: 5,
  // Poles the impact front arcs as it crosses.
  sweepPoles: 9,
  poleReach: 18,
  // Post.glitch at full jam, in bursts (glitchBursts of the frames), and
  // the faint interference under them.
  glitch: 0.65,
  glitchBursts: 0.3,
  glitchFloor: 0.12,
  machines: ['terminator', 'pursuer', 'trex'],
  // Roger's EMP during the storm (player/emp.js).
  amplify: { radiusScale: 1.8, chainRadius: 80, chainPoles: 12, chainDelay: 0.08, poleRadius: 11 },
  sparks: { max: 260, rate: 7, life: [0.3, 0.8], speed: 7, size: 1.3 },
  score: 500,
  bannerSeconds: 3.6
};

const SPARK_HOT = new THREE.Color(0.7, 1.4, 1.2);
const SPARK_COOL = new THREE.Color(0.25, 0.9, 0.6);

/**
 * @typedef {'idle'|'flare'|'storm'|'restore'} SolarPhase
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initSolarStorm: () => void,
 *   updateSolarStorm: (dt: number) => void,
 *   triggerSolarStorm: () => void,
 *   active: () => boolean,
 *   stalled: () => boolean,
 *   jamAt: (x: number, z: number) => number,
 *   amplified: () => boolean,
 *   chainEmp: (x: number, z: number) => number,
 *   resetSolarStorm: () => void,
 *   disposeSolarStorm: () => void
 * }}
 */
export function createSolarStormSystem(ctx) {
  const { Sim, container } = ctx;
  const aurora = createAurora(ctx);

  const state = {
    /** @type {SolarPhase} */
    phase: 'idle',
    age: 0,
    duration: 0,
    dirX: 1,
    dirZ: 0,
    // How far the blackout has reached along (dirX, dirZ), and how far the
    // power has come back behind it.
    outFront: -1e4,
    backFront: -1e4,
    jam: 0,
    surge: 0,
    surgeLeft: 0,
    surgeTimer: 0,
    great: false,
    corona: 0,
    countdown: 0,
    bannerTimer: 0,
    flicker: 1,
    whistle: 0,
    chorus: 0,
    crackle: 0,
    sweepPoles: 0
  };
  /** @type {{x: number, z: number, at: number}[]} poles still to fire in an amplified EMP */
  let chain = [];
  let chainTime = 0;
  let chainHits = 0;
  let chainPoles = 0;
  /** @type {{x: number, z: number, out: boolean, flicker: number}[]} */
  let lamps = [];
  /** @type {THREE.InstancedMesh|null} the lamp mesh `lamps` was read from */
  let lampMesh = null;
  /** @type {Map<any, {obj: THREE.Object3D, off: number, at: {x: number, z: number}}>} machines locked up now */
  const twitching = new Map();
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let sparks = null;
  let sparksAlive = 0;
  let sparkAccumulator = 0;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const scratch = new THREE.Vector3();
  const colour = new THREE.Color();

  /**
   * @param {ReadonlyArray<number>} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initSolarStorm() {
    aurora.initAurora();
    sparks = createParticlePool(Sim.three.scene, SOLAR.sparks.max, createSoftDotTexture(), THREE.AdditiveBlending, 'solarStorm_sparks');
    banner = document.createElement('div');
    banner.className = 'downburst-banner solar';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);
    const button = document.getElementById('btn-solar');
    if (button) button.addEventListener('click', () => triggerSolarStorm(), { signal: ctx.signal });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {boolean} [alert]
   * @returns {void}
   */
  function showBanner(title, sub, alert = false) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.toggle('alert', alert);
    banner.classList.add('visible');
    state.bannerTimer = SOLAR.bannerSeconds;
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function setButtonActive(on) {
    const button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-solar'));
    if (!button) return;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.disabled = on;
  }

  /**
   * The flare goes off. Ignored while a storm is already on.
   * @returns {void}
   */
  function triggerSolarStorm() {
    if (state.phase !== 'idle') return;
    const angle = Math.random() * Math.PI * 2;
    Object.assign(state, {
      phase: 'flare',
      age: 0,
      duration: between(SOLAR.stormSeconds),
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      outFront: -1e4,
      backFront: -1e4,
      jam: 0,
      surge: 0,
      surgeLeft: 0,
      surgeTimer: between(SOLAR.surgeEvery) + SOLAR.sweepSeconds + SOLAR.impactJam,
      great: false,
      corona: 0,
      countdown: -1,
      flicker: 1,
      whistle: 1.2,
      chorus: 2.5,
      crackle: 0,
      sweepPoles: 0
    });
    chain = [];
    setButtonActive(true);
    const at = scratch.set(-state.dirX * 200, 120, -state.dirZ * 200);
    ctx.systems.lightning.flashScreen(at, 0.9, '#fff1c4');
    ctx.systems.solarStormSound.playFlare();
    showBanner('☀️ SOLAR FLARE · X9', `Coronal mass ejection inbound · impact in ${SOLAR.flareSeconds} s`, true);
    ctx.events.emit('notice', { text: '☀️ X-class flare · the grid is about to go' });
  }

  /**
   * Along the sweep: where a point is on the axis the fronts travel.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function along(x, z) {
    return x * state.dirX + z * state.dirZ;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether the power is off there right now
   */
  function outAt(x, z) {
    const a = along(x, z);
    return a < state.outFront && a > state.backFront;
  }

  /**
   * How locked up a machine at (x, z) is right now, 0..1: the storm's
   * jam, where the blackout has reached. Read by the ships' owners
   * (aliens.js, aliens/waves.js, mothership.js).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function jamAt(x, z) {
    if (state.jam <= 0.001 || state.phase !== 'storm') return 0;
    return outAt(x, z) ? state.jam : 0;
  }

  /** @returns {boolean} whether a storm is under way, flare to restore */
  function active() {
    return state.phase !== 'idle';
  }

  /**
   * Whether engines will not run: from the impact until halfway through the
   * power coming back. Read by everything that drives (the viaduct traffic,
   * the train, the tanker, the chase car, Roger's car).
   * @returns {boolean}
   */
  function stalled() {
    return state.phase === 'storm' || (state.phase === 'restore' && state.age < SOLAR.restoreSeconds * 0.5);
  }

  /** @returns {boolean} whether Roger's EMP is amplified (player/emp.js) */
  function amplified() {
    return state.phase === 'storm';
  }

  /**
   * Roger's EMP, amplified: the poles near him fire one after another,
   * nearest first, each an EMP of its own.
   * @param {number} x
   * @param {number} z
   * @returns {number} how many poles it will run through
   */
  function chainEmp(x, z) {
    const lines = ctx.systems.powerLines;
    if (!lines) return 0;
    const A = SOLAR.amplify;
    const near = lines.standingPoles()
      .map(p => ({ x: p.x, z: p.z, d: Math.hypot(p.x - x, p.z - z) }))
      .filter(p => p.d <= A.chainRadius)
      .sort((a, b) => a.d - b.d)
      .slice(0, A.chainPoles);
    chainTime = 0;
    chainHits = 0;
    chainPoles = 0;
    chain = near.map((p, i) => ({ x: p.x, z: p.z, at: (i + 1) * A.chainDelay }));
    return chain.length;
  }

  /**
   * The amplified EMP's poles going off on their schedule.
   * @param {number} dt
   * @returns {void}
   */
  function updateChain(dt) {
    if (!chain.length) return;
    chainTime += dt;
    const A = SOLAR.amplify;
    while (chain.length && chain[0].at <= chainTime) {
      const p = chain.shift();
      const arc = ctx.systems.powerLines.surgeAt(p.x, p.z, 1.5);
      if (!arc) continue;
      chainPoles++;
      chainHits += ctx.systems.area.hitEnemiesInRadius({ x: p.x, z: p.z, radius: A.poleRadius }, { type: 'emp', at: { x: p.x, z: p.z } });
      ctx.systems.lightning.flashScreen(arc, 0.25, '#8fffd0');
    }
    if (!chain.length && chainPoles) {
      ctx.events.emit('notice', { text: `⚡ GRID EMP · ${chainPoles} poles · ${chainHits} knocked out` });
      ctx.systems.damage.addDamageScore(chainPoles * 20);
    }
  }

  /**
   * The impact: the aurora comes down, the blackout starts across town.
   * @returns {void}
   */
  function impact() {
    state.phase = 'storm';
    state.age = 0;
    state.flicker = 1;
    ctx.systems.solarStormSound.playPowerDown();
    ctx.systems.solarStormSound.playStatic(1);
    ctx.systems.gamefeel.event('gas', scratch.set(0, 0, 0));
    showBanner('🌌 GEOMAGNETIC STORM · G5', 'Blackout · engines dead · the machines are down · your EMP runs through the grid', false);
    ctx.systems.damage.addDamageScore(SOLAR.score);
  }

  /**
   * A surge: the aurora flares, poles arc, the machines lock up again.
   * @param {number} seconds
   * @returns {void}
   */
  function surge(seconds) {
    state.surgeLeft = seconds;
    const lines = ctx.systems.powerLines;
    if (lines) {
      for (let i = 0; i < SOLAR.surgePoles; i++) {
        lines.surgeAt((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, SOLAR.poleReach * 1.5);
      }
    }
    ctx.systems.solarStormSound.playStatic(0.8);
    ctx.systems.solarStormSound.playWhistler(1);
  }

  /**
   * The front crossing town on impact: the poles it reaches arc, a few of
   * them, spread along its way.
   * @returns {void}
   */
  function sweepArcs() {
    const u = Math.min(1, state.age / SOLAR.sweepSeconds);
    const due = Math.floor(u * SOLAR.sweepPoles);
    const lines = ctx.systems.powerLines;
    while (state.sweepPoles < due) {
      state.sweepPoles++;
      if (!lines) continue;
      // A point on the front, somewhere across it.
      const a = state.outFront;
      const across = (Math.random() - 0.5) * 180;
      lines.surgeAt(state.dirX * a - state.dirZ * across, state.dirZ * a + state.dirX * across, SOLAR.poleReach);
    }
  }

  /**
   * Reads the streetlamps' positions once (they are built with the town
   * decor, roadsDecor.js) and gives the lamp and pool meshes their
   * per-lamp colours.
   * @returns {boolean} whether there are lamps
   */
  function ensureLamps() {
    const decor = ctx.Environment && ctx.Environment.decorMeshes;
    const mesh = decor && decor.streetlightLamp;
    if (!mesh) return false;
    if (mesh === lampMesh) return true;
    lampMesh = mesh;
    lamps = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      scratch.setFromMatrixPosition(m);
      lamps.push({ x: scratch.x, z: scratch.z, out: false, flicker: 0 });
    }
    return true;
  }

  /**
   * One lamp's brightness, 0..1, into both meshes.
   * @param {number} i
   * @param {number} k
   * @returns {void}
   */
  function setLamp(i, k) {
    const decor = ctx.Environment.decorMeshes;
    colour.setScalar(k);
    decor.streetlightLamp.setColorAt(i, colour);
    if (decor.streetlightPool) decor.streetlightPool.setColorAt(i, colour);
  }

  /** @returns {void} */
  function markLamps() {
    const decor = ctx.Environment.decorMeshes;
    if (decor.streetlightLamp.instanceColor) decor.streetlightLamp.instanceColor.needsUpdate = true;
    if (decor.streetlightPool && decor.streetlightPool.instanceColor) decor.streetlightPool.instanceColor.needsUpdate = true;
  }

  /**
   * Per frame: each lamp on or off by where the fronts are, stuttering for
   * a moment as it comes back; all of them browning out with the flicker
   * during the flare.
   * @param {number} dt
   * @returns {void}
   */
  function updateLamps(dt) {
    if (!ensureLamps()) return;
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      const out = outAt(lamp.x, lamp.z);
      if (lamp.out && !out) lamp.flicker = 0.5 + Math.random() * 0.5;
      lamp.out = out;
      let k = out ? 0 : state.flicker;
      if (!out && lamp.flicker > 0) {
        lamp.flicker -= dt;
        k = Math.random() < 0.5 ? 0.15 : 1;
      }
      setLamp(i, k);
    }
    markLamps();
  }

  /** @returns {void} every lamp back to full, and forgotten */
  function restoreLamps() {
    if (lampMesh && ctx.Environment.decorMeshes.streetlightLamp === lampMesh) {
      for (let i = 0; i < lamps.length; i++) setLamp(i, 1);
      markLamps();
    }
    for (const lamp of lamps) {
      lamp.out = false;
      lamp.flicker = 0;
    }
  }

  /**
   * The windows' shader, the far town and the brown-out flicker.
   * @returns {void}
   */
  function applyGrid() {
    const win = ctx.systems.buildings.windowUniforms;
    win.uOutage.value.set(state.dirX, state.dirZ, state.outFront, state.backFront);
    win.uFlicker.value = state.flicker;
    const backdrop = /** @type {any} */ (Sim.three.scene.getObjectByName('backdrop_blocks'));
    if (backdrop) {
      const daylight = ctx.DayNight ? ctx.DayNight.daylight : 0;
      const u = (state.outFront - SOLAR.sweepFrom) / (SOLAR.sweepTo - SOLAR.sweepFrom);
      const back = state.backFront < -1e3 ? 0 : (state.backFront - SOLAR.sweepFrom) / (SOLAR.sweepTo - SOLAR.sweepFrom);
      const lit = 1 - THREE.MathUtils.clamp(u, 0, 1) + THREE.MathUtils.clamp(back, 0, 1);
      backdrop.material.emissiveIntensity = (1 - daylight) * THREE.MathUtils.clamp(lit, 0, 1) * state.flicker;
    }
  }

  /**
   * The machines the jam has reached: held where they stand ('frozen',
   * refreshed while it lasts), twitching, sparking. Those it lets go
   * reboot.
   * @param {number} dt
   * @returns {void}
   */
  function updateMachines(dt) {
    const enemies = ctx.systems.enemies;
    const holding = state.jam > 0.4 && state.phase === 'storm';
    /** @type {Set<any>} */
    const seen = new Set();
    if (holding) {
      for (const kind of enemies.kinds()) {
        if (!SOLAR.machines.includes(kind.kind)) continue;
        for (const e of kind.list()) {
          const p = kind.position(e);
          if (!p || !outAt(p.x, p.z)) continue;
          enemies.setState(e, 'frozen', 0.3);
          seen.add(e);
          let t = twitching.get(e);
          if (!t) {
            const obj = (kind.object && kind.object(e)) || e.root || (e.rig && e.rig.root);
            if (!obj) continue;
            t = { obj, off: 0, at: p };
            twitching.set(e, t);
          }
          t.at = p;
          const off = (Math.random() - 0.5) * 0.18 * state.jam;
          t.obj.rotation.y += off - t.off;
          t.off = off;
          const top = kind.hitbox ? kind.hitbox(e).top : 3;
          emitSparks(p.x, top * (0.6 + Math.random() * 0.35), p.z, dt);
        }
      }
    }
    let booted = 0;
    for (const [e, t] of twitching) {
      if (seen.has(e)) continue;
      t.obj.rotation.y -= t.off;
      twitching.delete(e);
      if (booted++ < 3) ctx.systems.creatureSounds.play('boot', t.at, { size: 1.1, pitch: 0.85 + Math.random() * 0.2 });
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} dt
   * @returns {void}
   */
  function emitSparks(x, y, z, dt) {
    if (!sparks) return;
    sparkAccumulator += SOLAR.sparks.rate * dt;
    const p = sparks;
    while (sparkAccumulator >= 1) {
      sparkAccumulator -= 1;
      const i = p.next;
      p.next = (p.next + 1) % SOLAR.sparks.max;
      p.positions[i * 3] = x + (Math.random() - 0.5) * 1.2;
      p.positions[i * 3 + 1] = y;
      p.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 1.2;
      p.velocities[i * 3] = (Math.random() - 0.5) * SOLAR.sparks.speed;
      p.velocities[i * 3 + 1] = Math.random() * SOLAR.sparks.speed * 0.6;
      p.velocities[i * 3 + 2] = (Math.random() - 0.5) * SOLAR.sparks.speed;
      p.life[i] = p.maxLife[i] = between(SOLAR.sparks.life);
      p.seed[i] = Math.random();
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSparks(dt) {
    const p = sparks;
    if (!p) return;
    if (sparksAlive === 0 && sparkAccumulator === 0 && twitching.size === 0) return;
    sparksAlive = 0;
    for (let i = 0; i < SOLAR.sparks.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      sparksAlive++;
      p.velocities[i * 3 + 1] -= 14 * dt;
      p.positions[i * 3] += p.velocities[i * 3] * dt;
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt;
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      colour.copy(SPARK_HOT).lerp(SPARK_COOL, u);
      p.colours[i * 4] = colour.r;
      p.colours[i * 4 + 1] = colour.g;
      p.colours[i * 4 + 2] = colour.b;
      p.colours[i * 4 + 3] = 1 - u;
      p.sizes[i] = SOLAR.sparks.size * (0.6 + 0.6 * p.seed[i]) * (1 - 0.5 * u);
    }
    if (sparksAlive === 0) sparkAccumulator = 0;
    markPoolDirty(p);
    p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
  }

  /**
   * The natural radio: whistlers and the dawn chorus at their own random
   * intervals, more of both in a surge.
   * @param {number} dt
   * @param {number} level
   * @returns {void}
   */
  function updateRadio(dt, level) {
    const sound = ctx.systems.solarStormSound;
    state.whistle -= dt * (1 + 2 * state.surge);
    if (state.whistle <= 0) {
      state.whistle = 1.4 + Math.random() * 2.8;
      sound.playWhistler(level);
    }
    state.chorus -= dt * (1 + state.surge);
    if (state.chorus <= 0) {
      state.chorus = 2.5 + Math.random() * 4;
      sound.playChorus(level);
    }
  }

  /**
   * Per frame, not while paused.
   * @param {number} dt
   * @returns {void}
   */
  function updateSolarStorm(dt) {
    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    updateSparks(dt);
    updateChain(dt);
    if (state.phase === 'idle') return;
    state.age += dt;
    const sound = ctx.systems.solarStormSound;

    let level = 0;
    let drop = 0;
    if (state.phase === 'flare') {
      // The countdown, and the town browning out harder as it comes.
      const left = Math.ceil(SOLAR.flareSeconds - state.age);
      if (left !== state.countdown && left > 0) {
        state.countdown = left;
        showBanner('☀️ SOLAR FLARE · X9', `Coronal mass ejection inbound · impact in ${left} s`, true);
      }
      const u = state.age / SOLAR.flareSeconds;
      state.flicker = Math.random() < 0.08 + 0.3 * u ? 0.25 + Math.random() * 0.4 : 1;
      state.crackle -= dt;
      if (state.crackle <= 0) {
        state.crackle = 0.9 - 0.6 * u;
        sound.playStatic(0.3 + 0.6 * u);
      }
      if (state.age >= SOLAR.flareSeconds) impact();
    } else if (state.phase === 'storm') {
      const sweep = Math.min(1, state.age / SOLAR.sweepSeconds);
      state.outFront = sweep >= 1 ? 1e4 : THREE.MathUtils.lerp(SOLAR.sweepFrom, SOLAR.sweepTo, sweep * sweep * (3 - 2 * sweep));
      if (sweep < 1) sweepArcs();
      drop = Math.min(1, state.age / 2.4);
      level = Math.min(1, state.age / 1.5);
      // Surges, and the great one with the corona.
      if (!state.great && state.age >= state.duration * SOLAR.greatAt) {
        state.great = true;
        surge(SOLAR.greatSeconds);
        showBanner('🌌 THE GREAT SURGE', 'The aurora is straight overhead', true);
        ctx.systems.lightning.flashScreen(scratch.set(Sim.three.camera.position.x, 200, Sim.three.camera.position.z), 0.5, '#9dffcf');
      }
      state.surgeTimer -= dt;
      if (state.surgeTimer <= 0) {
        state.surgeTimer = between(SOLAR.surgeEvery);
        surge(between(SOLAR.surgeSeconds));
      }
      if (state.surgeLeft > 0) state.surgeLeft -= dt;
      const coronaWant = state.great && state.surgeLeft > 0 && state.age < state.duration * SOLAR.greatAt + SOLAR.greatSeconds ? 1 : 0;
      state.corona += (coronaWant - state.corona) * Math.min(1, dt * 1.2);
      if (state.age >= state.duration) {
        state.phase = 'restore';
        state.age = 0;
        state.backFront = SOLAR.sweepFrom;
        state.outFront = 1e4;
        sound.playPowerUp();
        showBanner('💡 POWER RESTORED', 'The grid is coming back up');
      }
    } else if (state.phase === 'restore') {
      const u = Math.min(1, state.age / SOLAR.restoreSeconds);
      const back = Math.min(1, u / 0.8);
      state.backFront = back >= 1 ? 1e4 : THREE.MathUtils.lerp(SOLAR.sweepFrom, SOLAR.sweepTo, back * back * (3 - 2 * back));
      level = 1 - u;
      drop = 1;
      state.corona = Math.max(0, state.corona - dt);
      if (u >= 1) {
        end();
        return;
      }
    }

    // The jam: on while the impact front is fresh and in every surge.
    const jamWant = state.phase === 'storm' && (state.age < SOLAR.sweepSeconds + SOLAR.impactJam || state.surgeLeft > 0) ? 1 : 0;
    state.jam += (jamWant - state.jam) * Math.min(1, dt * (jamWant > state.jam ? 6 : 2));
    state.surge += ((state.surgeLeft > 0 ? 1 : 0) - state.surge) * Math.min(1, dt * 3);

    applyGrid();
    updateLamps(dt);
    updateMachines(dt);
    aurora.updateAurora(dt, level, drop, state.surge, state.corona);
    if (state.phase !== 'flare') updateRadio(dt, level);
    sound.updateSolarSound(level);

    // The picture and the HUD glitch with the jam.
    const burst = Math.random() < SOLAR.glitchBursts ? 1 : SOLAR.glitchFloor;
    const glitch = state.phase === 'storm' ? state.jam * SOLAR.glitch * burst : 0;
    ctx.systems.post.Post.glitch = glitch;
    if (container) container.classList.toggle('solar-glitch', glitch > 0.25);
  }

  /** @returns {void} back to normal, the town lit again */
  function end() {
    state.phase = 'idle';
    state.age = 0;
    state.jam = 0;
    state.surge = 0;
    state.surgeLeft = 0;
    state.corona = 0;
    state.flicker = 1;
    state.outFront = -1e4;
    state.backFront = -1e4;
    applyGrid();
    restoreLamps();
    updateMachines(0);
    aurora.hideAurora();
    ctx.systems.post.Post.glitch = 0;
    if (container) container.classList.remove('solar-glitch');
    ctx.systems.solarStormSound.fadeOutSolarSound();
    setButtonActive(false);
  }

  /** @returns {void} */
  function resetSolarStorm() {
    for (const t of twitching.values()) t.obj.rotation.y -= t.off;
    twitching.clear();
    end();
    chain = [];
    state.bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
    sparksAlive = 0;
    sparkAccumulator = 0;
    if (sparks) {
      sparks.life.fill(0);
      sparks.colours.fill(0);
      sparks.sizes.fill(0);
      markPoolDirty(sparks);
    }
  }

  /** @returns {void} */
  function disposeSolarStorm() {
    aurora.disposeAurora();
    if (sparks) disposeParticlePool(Sim.three.scene, sparks);
    sparks = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    if (container) container.classList.remove('solar-glitch');
    ctx.systems.solarStormSound.disposeSolarSound();
    lamps = [];
    lampMesh = null;
  }

  return {
    initSolarStorm, updateSolarStorm, triggerSolarStorm, active, stalled, jamAt, amplified, chainEmp,
    resetSolarStorm, disposeSolarStorm
  };
}
