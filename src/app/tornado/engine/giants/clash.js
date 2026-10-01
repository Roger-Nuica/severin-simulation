// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../../utils/banners.js';
import { createSoftDotTexture } from '../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';

/**
 * ===========================================================================
 * SECTION GC — Yeti against T-Rex: the stalemate
 * ===========================================================================
 * Whenever a cyber Yeti (yeti.js) and a cyber T-Rex (trex.js) are both in
 * town, they go for each other -- at once, if they came in together --
 * and it always ends the same way: a stalemate.
 *
 *  - Closing: each walks at the other (foe), stopping CLASH.standoff apart,
 *    face to face.
 *  - The clash: the T-Rex breathes fire, the Yeti fires the cold gun, and
 *    the two meet in the middle, between the mouth and the muzzle (wall):
 *    each giant stops its own beam there, so neither passes the meeting
 *    point. Where they meet: steam billowing up, sparks of fire and ice,
 *    every so often an ice-and-fire burst with a crack, a light flickering
 *    orange and blue, and the hiss and crackle of it, the pressure in it
 *    rising to the end (sound/creatures.js, placed at the meeting point).
 *  - It lasts exactly CLASH.seconds (15) from the moment both beams are on.
 *    Then both stop and break off, and from then on they hunt Roger (or,
 *    outside Hero Mode, what they went for before). That pair never takes
 *    it up again (`settled`): the flag holds the two of them, so a new
 *    Yeti or T-Rex called in later starts a stalemate of its own.
 *
 * Neither hurts the other. Roger can still hurt either while it lasts; one
 * of them falling ends it.
 *
 * Each giant reports where its beam leaves from, and whether it is firing,
 * every frame (report); this runs after both.
 *
 * Cost: two particle pools on the shared budget (caps.particleRoom before
 * every emission), one pooled light request, and the procedural sound.
 */

export const CLASH = {
  standoff: 92,            // metres between the two of them, face to face
  seconds: 15,
  steamMax: 600,
  steamRate: 150,          // puffs a second
  sparkMax: 500,
  sparkRate: 260,
  burstEvery: [0.3, 0.75], // seconds between two ice-and-fire bursts
  heard: 220,              // metres: how far the clash is heard, fading
  bannerSeconds: 3.5
};

const FIRE = new THREE.Color(2.4, 1.1, 0.25);
const ICE = new THREE.Color(0.8, 1.9, 2.6);

/**
 * @param {Object} ctx
 * @returns {{
 *   foe: (kind: 'yeti'|'trex') => ({x: number, y: number, z: number}|null),
 *   wall: () => (THREE.Vector3|null),
 *   standoff: () => number,
 *   report: (kind: 'yeti'|'trex', from: THREE.Vector3, firing: boolean) => void,
 *   state: () => {phase: string, timer: number, settled: boolean},
 *   initGiantClash: () => void,
 *   updateGiantClash: (dt: number) => void,
 *   resetGiantClash: () => void,
 *   disposeGiantClash: () => void
 * }}
 */
export function createGiantClashSystem(ctx) {
  const { Sim } = ctx;
  const S = {
    /** @type {'idle'|'closing'|'clash'} */
    phase: 'idle',
    timer: 0,
    burst: 0,
    /** @type {{trex: any, yeti: any}|null} the pair that has had it out */
    settled: null,
    /** @type {{trex: any, yeti: any}|null} the pair now */
    pair: null,
    reports: {
      trex: { at: new THREE.Vector3(), firing: false, seen: false },
      yeti: { at: new THREE.Vector3(), firing: false, seen: false }
    },
    meet: new THREE.Vector3(),
    bannerTimer: 0
  };
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let steam = null;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let sparks = null;
  let steamAlive = false;
  let sparksAlive = false;
  let owedSteam = 0;
  let owedSparks = 0;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const scratch = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const foeAt = { x: 0, y: 0, z: 0 };

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
      S.bannerTimer = CLASH.bannerSeconds;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /**
   * Who a giant goes for while they have it out: the other one (where it
   * stands, and the height to aim at).
   * @param {'yeti'|'trex'} kind
   * @returns {{x: number, y: number, z: number}|null}
   */
  function foe(kind) {
    if (S.phase === 'idle' || !S.pair) return null;
    const other = kind === 'yeti' ? S.pair.trex : S.pair.yeti;
    const p = kind === 'yeti' ? other.rig.root.position : other.root.position;
    const report = S.reports[kind === 'yeti' ? 'trex' : 'yeti'];
    foeAt.x = p.x;
    foeAt.z = p.z;
    foeAt.y = report.seen ? report.at.y : 8;
    return foeAt;
  }

  /**
   * Where the two beams meet, and stop; null when they are not facing off.
   * @returns {THREE.Vector3|null}
   */
  function wall() {
    if (S.phase === 'idle' || !S.reports.trex.seen || !S.reports.yeti.seen) return null;
    return S.meet;
  }

  /**
   * @param {'yeti'|'trex'} kind
   * @param {THREE.Vector3} from where its beam leaves
   * @param {boolean} firing
   * @returns {void}
   */
  function report(kind, from, firing) {
    const r = S.reports[kind];
    r.at.copy(from);
    r.firing = firing;
    r.seen = true;
    if (S.reports.trex.seen && S.reports.yeti.seen) S.meet.addVectors(S.reports.trex.at, S.reports.yeti.at).multiplyScalar(0.5);
  }

  /** @returns {void} */
  function initGiantClash() {
    steam = createParticlePool(Sim.three.scene, CLASH.steamMax, createSoftDotTexture(), THREE.NormalBlending, 'giant_clash_steam');
    sparks = createParticlePool(Sim.three.scene, CLASH.sparkMax, createSoftDotTexture(), THREE.AdditiveBlending, 'giant_clash_sparks');
    ctx.systems.caps.trackPool(steam);
    ctx.systems.caps.trackPool(sparks);
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
  }

  /**
   * The clash at the meeting point, this frame.
   * @param {number} dt
   * @returns {void}
   */
  function emit(dt) {
    if (!steam || !sparks) return;
    const m = S.meet;
    owedSteam += CLASH.steamRate * dt;
    let n = Math.min(Math.floor(owedSteam), ctx.systems.caps.particleRoom());
    owedSteam -= Math.floor(owedSteam);
    for (let k = 0; k < n; k++) {
      const i = steam.next;
      steam.next = (steam.next + 1) % CLASH.steamMax;
      const life = 2 + Math.random() * 1.5;
      steam.life[i] = life;
      steam.maxLife[i] = life;
      steam.seed[i] = Math.random();
      steam.positions.set([m.x + (Math.random() - 0.5) * 4, m.y + (Math.random() - 0.5) * 3, m.z + (Math.random() - 0.5) * 4], i * 3);
      steam.velocities.set([(Math.random() - 0.5) * 9, 4 + Math.random() * 7, (Math.random() - 0.5) * 9], i * 3);
    }
    if (n > 0) steamAlive = true;
    owedSparks += CLASH.sparkRate * dt;
    n = Math.min(Math.floor(owedSparks), ctx.systems.caps.particleRoom());
    owedSparks -= Math.floor(owedSparks);
    for (let k = 0; k < n; k++) {
      const i = sparks.next;
      sparks.next = (sparks.next + 1) % CLASH.sparkMax;
      const life = 0.35 + Math.random() * 0.6;
      sparks.life[i] = life;
      sparks.maxLife[i] = life;
      // The seed says which: fire (< 0.5) or ice.
      sparks.seed[i] = Math.random();
      sparks.positions.set([m.x, m.y, m.z], i * 3);
      velocity.set(Math.random() - 0.5, Math.random() * 0.9 - 0.2, Math.random() - 0.5).normalize().multiplyScalar(14 + Math.random() * 26);
      sparks.velocities.set([velocity.x, velocity.y, velocity.z], i * 3);
    }
    if (n > 0) sparksAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepParticles(dt) {
    if (steam && steamAlive) {
      steam.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
      let any = false;
      for (let i = 0; i < CLASH.steamMax; i++) {
        if (steam.life[i] <= 0) {
          if (steam.sizes[i] !== 0) { steam.colours[i * 4 + 3] = 0; steam.sizes[i] = 0; }
          continue;
        }
        any = true;
        steam.life[i] -= dt;
        const t = 1 - Math.max(0, steam.life[i]) / steam.maxLife[i];
        const v = i * 3;
        const drag = Math.max(0, 1 - 0.8 * dt);
        steam.velocities[v] *= drag;
        steam.velocities[v + 2] *= drag;
        steam.positions[v] += steam.velocities[v] * dt;
        steam.positions[v + 1] += steam.velocities[v + 1] * dt;
        steam.positions[v + 2] += steam.velocities[v + 2] * dt;
        // Grey steam, a touch blue: lighter than smoke, never a white glare.
        const grey = 0.58 + 0.14 * steam.seed[i];
        steam.colours.set([grey, grey * 1.03, grey * 1.08, 0.42 * Math.min(1, t * 5) * (1 - t)], i * 4);
        steam.sizes[i] = (3 + t * 13) * (0.7 + steam.seed[i] * 0.6);
      }
      markPoolDirty(steam);
      steamAlive = any;
    }
    if (sparks && sparksAlive) {
      sparks.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
      let any = false;
      for (let i = 0; i < CLASH.sparkMax; i++) {
        if (sparks.life[i] <= 0) {
          if (sparks.sizes[i] !== 0) { sparks.colours[i * 4 + 3] = 0; sparks.sizes[i] = 0; }
          continue;
        }
        any = true;
        sparks.life[i] -= dt;
        const t = 1 - Math.max(0, sparks.life[i]) / sparks.maxLife[i];
        const v = i * 3;
        sparks.velocities[v + 1] -= 18 * dt;
        sparks.positions[v] += sparks.velocities[v] * dt;
        sparks.positions[v + 1] = Math.max(0.2, sparks.positions[v + 1] + sparks.velocities[v + 1] * dt);
        sparks.positions[v + 2] += sparks.velocities[v + 2] * dt;
        const c = sparks.seed[i] < 0.5 ? FIRE : ICE;
        sparks.colours.set([c.r, c.g, c.b, 1 - t], i * 4);
        sparks.sizes[i] = 0.7 + (1 - t) * 0.9;
      }
      markPoolDirty(sparks);
      sparksAlive = any;
    }
  }

  /**
   * How near the camera is to the clash, 0..1.
   * @returns {number}
   */
  function nearness() {
    const cam = Sim.three.camera.position;
    return Math.max(0, 1 - cam.distanceTo(S.meet) / CLASH.heard);
  }

  /**
   * @param {boolean} [quiet] no banner (one of them fell, or a reset)
   * @returns {void}
   */
  function stop(quiet = false) {
    if (S.phase === 'clash' && S.pair && !quiet) {
      S.settled = S.pair;
      showBanner('STALEMATE', 'Neither gives way · they break off and hunt Roger');
    }
    S.phase = 'idle';
    S.timer = 0;
  }

  /**
   * After both giants' updates.
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateGiantClash(dt) {
    if (S.bannerTimer > 0) {
      S.bannerTimer -= dt;
      if (S.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    stepParticles(dt);
    if (dt <= 0) {
        return;
    }
    const trex = ctx.systems.trex.duelist();
    const yeti = ctx.systems.yeti.duelist();
    const sameAsSettled = S.settled && S.settled.trex === trex && S.settled.yeti === yeti;
    if (!trex || !yeti || sameAsSettled) {
      if (S.phase !== 'idle') stop(true);
      if (!trex || !yeti) {
        S.reports.trex.seen = !!trex && S.reports.trex.seen;
        S.reports.yeti.seen = !!yeti && S.reports.yeti.seen;
      }
      return;
    }
    if (S.phase === 'idle') {
      // A new pair: they go for each other, at once.
      S.pair = { trex, yeti };
      S.phase = 'closing';
      S.timer = 0;
      showBanner('YETI vs T-REX', 'Frost against fire · they go for each other');
    }
    if (S.phase === 'closing') {
      if (S.reports.trex.firing && S.reports.yeti.firing) {
        S.phase = 'clash';
        S.timer = 0;
        S.burst = 0.2;
      }
      return;
    }
    // The clash.
    S.timer += dt;
    emit(dt);
    const near = nearness();
    // The clash's own sound, at the meeting point (sound/creatures.js),
    // the pressure climbing to the end.
    ctx.systems.creatureSounds.loop('clash', S.meet, 1, S.timer / CLASH.seconds);
    const flicker = Math.sin(S.timer * 23) > 0;
    ctx.systems.lightPool.requestLight({
      x: S.meet.x, y: S.meet.y, z: S.meet.z,
      colour: flicker ? 0xffa060 : 0x9fe0ff, intensity: 9, distance: 90, priority: 6
    });
    S.burst -= dt;
    if (S.burst <= 0) {
      const [lo, hi] = CLASH.burstEvery;
      S.burst = lo + Math.random() * (hi - lo);
      // The burst: a puff of fire, shards of ice, a crack.
      ctx.systems.explosions.spawnImpactBurst(scratch.copy(S.meet), 0.9);
      for (let i = 0; i < 3; i++) {
        velocity.set((Math.random() - 0.5) * 18, 4 + Math.random() * 10, (Math.random() - 0.5) * 18);
        ctx.systems.debris.spawnDebris(scratch.copy(S.meet), velocity, 0.25, 0.6 + Math.random() * 0.6, 'ice');
      }
      ctx.systems.creatureSounds.play('clashBurst', S.meet, { size: 4 });
      if (near > 0.4) ctx.systems.gamefeel.addShake(0.12 * near, 0.15);
    }
    if (S.timer >= CLASH.seconds) stop();
  }

  /** @returns {void} */
  function resetGiantClash() {
    S.phase = 'idle';
    S.timer = 0;
    S.settled = null;
    S.pair = null;
    S.reports.trex.seen = S.reports.yeti.seen = false;
    S.reports.trex.firing = S.reports.yeti.firing = false;
    S.bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
    for (const pool of [steam, sparks]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.colours.fill(0);
      pool.sizes.fill(0);
      markPoolDirty(pool);
    }
    steamAlive = sparksAlive = false;
    owedSteam = owedSparks = 0;
  }

  /** @returns {void} */
  function disposeGiantClash() {
    if (steam) disposeParticlePool(Sim.three.scene, steam);
    if (sparks) disposeParticlePool(Sim.three.scene, sparks);
    steam = sparks = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return {
    foe, wall, standoff: () => CLASH.standoff, report,
    state: () => ({ phase: S.phase, timer: S.timer, settled: !!S.settled }),
    initGiantClash, updateGiantClash, resetGiantClash, disposeGiantClash
  };
}
