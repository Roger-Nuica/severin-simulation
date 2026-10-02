// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { BLAST_SIZE } from './player/energy.js';
import { CAPS } from './perf/caps.js';
import { CHARACTERS, GIANT } from './scale.js';
import { createYetiModel } from './yeti/model.js';
import { createColdGun } from './yeti/gun.js';

// Tuned for a 3.5 m Yeti; now a giant (engine/scale.js CHARACTERS, GIANT).
const { size, pace } = GIANT.ratio(CHARACTERS.yeti.height, 3.5);
// How big it sounds (sound/creatures.js): deep, and heard from far off.
// Its voice's size (sound/creatures.js): smaller, higher, heard less far,
// with the body (was 4 at 15 m).
const SOUND_SIZE = 2.8;

/**
 * ===========================================================================
 * SECTION YT — The cyber Yeti
 * ===========================================================================
 * An elite enemy from the panel's 🦍 Cyber Yeti: a 15 m giant, half yeti
 * (shaggy white and ice-blue fur) and half machine (a metal arm and leg,
 * steel over half its face, a glowing cyan eye) -- yeti/model.js -- walking
 * in from the edge of town inside its own ice storm -- snow whirling round
 * it out to YETI.stormRadius. One at a time. Its footfalls shake the
 * camera and thud, in proportion to how near they land.
 *
 * In its metal hand, the cold gun (yeti/gun.js): a Mr. Freeze blaster that
 * fires one continuous cone of frost, YETI.gunRange long, at whatever it is
 * going for once that is in range -- a frost beam, ice crystals, frost
 * settling on the ground. Everything in the cone freezes, every
 * YETI.gunTick: townspeople into ice statues (CAPS.batch a tick), aliens in
 * blocks of ice, and Roger by the storm's own rule (YETI.freezeAfter
 * seconds in it, then YETI.rogerFreeze seconds frozen).
 *
 * A T-Rex in town as well: the two go for each other and end in a
 * stalemate, flame against frost (giants/clash.js), and afterwards hunt
 * Roger.
 *
 * The storm freezes (engine/effects/freeze.js):
 *  - Roger, once he has stood in it for YETI.freezeAfter seconds: frozen
 *    solid for YETI.rogerFreeze seconds. A frozen Roger it reaches, it
 *    smashes ("SHATTERED"); an unfrozen one it reaches, it mauls.
 *  - the other enemies in it (Terminators, pursuers, aliens), for
 *    YETI.enemyFreeze seconds in a block of ice -- not the T-Rex, its
 *    equal (see the stalemate);
 *  - the townspeople in it: ice statues, CAPS.batch a tick at most, which
 *    shatter at any impact.
 *
 * It goes for Roger in Hero Mode, otherwise the nearest townsperson. Only
 * fire hurts it -- Roger's Fire Gun (YETI.damage.fire a tick) -- and an
 * EMP stuns its implants and stills the storm for a moment. The rifle, the
 * minigun and the railgun do nothing to it (on request, 2026-10-01).
 * Killed, it falls and bursts into ice: an explosion Roger can take energy
 * from, +YETI.score.
 */

export const YETI = {
  // The legend's 2.5-3 m, cyber-enlarged (engine/scale.js CHARACTERS).
  height: CHARACTERS.yeti.height,
  walkSpeed: 3.6 * pace,  // 7.5 m/s: Roger (9) can still outrun it
  turnRate: 1.4,
  spawnRing: 150,
  stormRadius: 14,        // 20 at 15 m: with its size
  tick: 0.5,              // seconds between two freezing checks
  freezeAfter: 1.5,       // seconds of storm before Roger freezes
  rogerFreeze: 3,
  enemyFreeze: 4,
  reach: 2.2 * size,      // metres: its blow (9.4)
  hitboxRadius: 0.32,     // of its height: the cylinder the guns aim at
  // Footfalls: the shake and thud, felt out to stepHeard metres.
  stepShake: 0.2 * pace,
  stepHeard: 100,         // 140 at 15 m
  // The cold gun: a cone gunRange long and gunHalfAngle wide either side,
  // checked every gunTick; it fires whenever what it goes for is in range.
  gunRange: 38,           // 55 at 15 m: with its size
  gunHalfAngle: 0.2,
  gunTick: 0.25,
  hp: 30,
  // Fire is its weakness (Roger's Fire Gun, on request). Since D1 every other
  // weapon chips its health too, through the register's weapon x enemy
  // table (health/damageTable.js: 0.6 of 30 a hit). An EMP still stuns it,
  // for no hurt of its own.
  // A burst of the Fire Gun (a tick every 0.25 s) takes `fire`.
  damage: { fire: 1.2, emp: 0 },
  empStun: 3,
  score: 3000,
  snowMax: 700,
  snowRate: 180,          // flakes a second
  fur: 0xeef4fa,
  metal: 0x8a949f,
  visor: new THREE.Color(0.3, 2.4, 3.2)
};

/**
 * @param {Object} ctx
 * @returns {{
 *   spawn: () => boolean,
 *   alive: () => boolean,
 *   duelist: () => any,
 *   initYeti: () => void,
 *   updateYeti: (dt: number) => void,
 *   resetYeti: () => void,
 *   disposeYeti: () => void
 * }}
 */
export function createYetiSystem(ctx) {
  const { Sim } = ctx;
  /**
   * @typedef {Object} Yeti
   * @property {import('./yeti/model.js').YetiRig} rig
   * @property {THREE.Group} root
   * @property {number} heading
   * @property {number} hp
   * @property {'walking'|'stunned'|'falling'|'dead'} phase
   * @property {number} timer
   * @property {number} stride
   * @property {number} tick
   * @property {number} gunTick
   * @property {number} exposure seconds Roger has stood in the storm
   * @property {number} gunExposure seconds Roger has stood in the cone
   * @property {number} swing seconds left of a blow
   * @property {number} aim 0..1, the gun arm raised
   * @property {boolean} firing this frame
   * @property {number} [stepCount] footfalls so far
   */
  /** @type {Yeti|null} */
  let yeti = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let snow = null;
  let snowAlive = false;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  const model = createYetiModel(YETI);
  const gun = createColdGun(ctx);
  const scratch = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const aimDir = new THREE.Vector3();

  /**
   * @returns {Yeti}
   */
  function build() {
    const rig = model.build();
    return {
      rig, root: rig.root,
      heading: 0, hp: YETI.hp, phase: 'walking', timer: 0, stride: 0, tick: 0, gunTick: 0,
      exposure: 0, gunExposure: 0, swing: 0, aim: 0, firing: false
    };
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
      bannerTimer = 3.2;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /** @returns {boolean} */
  function spawn() {
    if (yeti || !ctx.systems.caps.canSpawn('yeti')) return false;
    const y = build();
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    const angle = roger ? Math.atan2(roger.x, roger.z) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
    y.root.position.set(Math.sin(angle) * YETI.spawnRing, 0, Math.cos(angle) * YETI.spawnRing);
    y.heading = angle + Math.PI;
    Sim.three.scene.add(y.root);
    yeti = y;
    if (button) button.disabled = true;
    showBanner('CYBER YETI!', 'Its cold gun and its storm freeze everything · keep out of the frost');
    ctx.systems.creatureSounds.play('yetiRoar', y.root.position, { size: SOUND_SIZE, shake: 0.35 });
    return true;
  }

  /**
   * The storm: flakes whirling round it.
   * @param {Yeti} y
   * @param {number} dt
   * @returns {void}
   */
  function emitSnow(y, dt) {
    if (!snow) return;
    const n = Math.min(Math.round(YETI.snowRate * dt + Math.random()), ctx.systems.caps.particleRoom());
    const p = y.root.position;
    for (let k = 0; k < n; k++) {
      const i = snow.next;
      snow.next = (snow.next + 1) % snow.life.length;
      const life = 1.4 + Math.random();
      snow.life[i] = life;
      snow.maxLife[i] = life;
      snow.seed[i] = Math.random();
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * YETI.stormRadius;
      snow.positions.set([p.x + Math.cos(a) * r, 0.5 + Math.random() * 7, p.z + Math.sin(a) * r], i * 3);
      // Round and round it, and down.
      snow.velocities.set([-Math.sin(a) * 7, -1.5, Math.cos(a) * 7], i * 3);
    }
    if (n > 0) snowAlive = true;
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
      snow.colours.set([0.92, 0.97, 1, 0.8 * Math.min(1, t * 6) * (1 - t)], i * 4);
      snow.sizes[i] = 0.35 + snow.seed[i] * 0.45;
    }
    markPoolDirty(snow);
    snowAlive = any;
  }

  /**
   * Every YETI.tick: what the storm freezes.
   * @param {Yeti} y
   * @returns {void}
   */
  function freezeTick(y) {
    const p = y.root.position;
    const freeze = ctx.systems.freeze;
    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    if (roger && Math.hypot(roger.x - p.x, roger.z - p.z) < YETI.stormRadius) {
      y.exposure += YETI.tick;
      if (y.exposure >= YETI.freezeAfter && freeze.freezeRoger(YETI.rogerFreeze)) y.exposure = 0;
    } else {
      y.exposure = Math.max(0, y.exposure - YETI.tick);
    }
    for (const kind of ctx.systems.enemies.kinds()) {
      if (kind.kind === 'yeti' || kind.kind === 'trex') continue;
      for (const e of kind.list()) {
        const q = kind.position(e);
        if (Math.hypot(q.x - p.x, q.z - p.z) < YETI.stormRadius) freeze.freezeEnemy(e, kind, YETI.enemyFreeze);
      }
    }
    let turned = 0;
    ctx.systems.area.forEachInRadius({ x: p.x, z: p.z, radius: YETI.stormRadius, targets: ['person'] }, (hit) => {
      if (turned < CAPS.batch && freeze.makeStatue(hit.target)) turned++;
    });
  }

  /**
   * Its health is used up, by fire, an EMP or any other weapon (D1): it
   * falls, scored once.
   * @param {Yeti} y
   * @returns {boolean} true, it is down
   */
  function fell(y) {
    if (y.phase === 'falling' || y.phase === 'dead') return true;
    y.phase = 'falling';
    ctx.systems.creatureSounds.play('yetiDeath', y.root.position, { size: SOUND_SIZE, shake: 0.4 });
    y.timer = 0;
    ctx.systems.damage.addDamageScore(YETI.score);
    showBanner('YETI DOWN!', `The cyber Yeti falls · +${YETI.score} bonus`);
    return true;
  }

  /**
   * @param {Yeti} y
   * @param {import('./enemies.js').Hit} hit
   * @returns {boolean} whether it is down
   */
  function damage(y, hit) {
    if (y.phase === 'falling' || y.phase === 'dead') return true;
    const d = YETI.damage;
    y.hp -= hit.type === 'fire' ? d.fire : hit.type === 'emp' ? d.emp : 0;
    if (y.hp <= 0) return fell(y);
    if (hit.type === 'emp') {
      y.phase = 'stunned';
      y.timer = 0;
      ctx.events.emit('notice', { text: `🦍 YETI STUNNED · ${YETI.empStun} s` });
    } else if (hit.type === 'fire' && Math.random() < 0.35) {
      ctx.systems.creatureSounds.play('yetiGrunt', y.root.position, { size: SOUND_SIZE });
      ctx.events.emit('notice', { text: `🦍 YETI ${Math.round((y.hp / YETI.hp) * 100)}%` });
    }
    return false;
  }

  /**
   * Is (x, z) inside the gun's cone, as far as `range`?
   * @param {Yeti} y
   * @param {number} x
   * @param {number} z
   * @param {number} range
   * @returns {boolean}
   */
  function inCone(y, x, z, range) {
    const dx = x - muzzle.x;
    const dz = z - muzzle.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d < YETI.reach) return true;
    const off = Math.atan2(dx, dz) - Math.atan2(aimDir.x, aimDir.z);
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < YETI.gunHalfAngle + YETI.reach / d;
  }

  /**
   * Every YETI.gunTick while it fires: what the cone freezes.
   * @param {Yeti} y
   * @param {number} range
   * @returns {void}
   */
  function gunTick(y, range) {
    const freeze = ctx.systems.freeze;
    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    // Roger, by the storm's rule: so long in it, then frozen.
    if (roger && inCone(y, roger.x, roger.z, range)) {
      y.gunExposure += YETI.gunTick;
      if (y.gunExposure >= YETI.freezeAfter && freeze.freezeRoger(YETI.rogerFreeze)) y.gunExposure = 0;
    } else {
      y.gunExposure = Math.max(0, y.gunExposure - YETI.gunTick);
    }
    // Aliens, in blocks of ice (and the other small fry with them).
    for (const kind of ctx.systems.enemies.kinds()) {
      if (kind.kind === 'yeti' || kind.kind === 'trex') continue;
      for (const e of kind.list()) {
        const q = kind.position(e);
        if (inCone(y, q.x, q.z, range) && !ctx.systems.enemies.getState(e, 'frozen')) {
          freeze.freezeEnemy(e, kind, YETI.enemyFreeze);
          ctx.systems.creatureSounds.play('iceCrackle', q);
        }
      }
    }
    // People: ice statues, a batch at a time.
    let turned = 0;
    ctx.systems.area.forEachInRadius({ x: muzzle.x, z: muzzle.z, radius: range, targets: ['person'] }, (hit) => {
      if (turned < CAPS.batch && inCone(y, hit.x, hit.z, range) && freeze.makeStatue(hit.target)) {
        turned++;
        ctx.systems.creatureSounds.play('iceCrackle', { x: hit.x, y: 1, z: hit.z });
      }
    });
  }

  /**
   * A footfall: the camera shakes and the ground thuds, by how near it is.
   * @param {Yeti} y
   * @returns {void}
   */
  function footfall(y) {
    const p = y.root.position;
    const cam = Sim.three.camera.position;
    const near = Math.max(0, 1 - Math.hypot(cam.x - p.x, cam.z - p.z) / YETI.stepHeard);
    if (near <= 0) return;
    ctx.systems.gamefeel.addShake(YETI.stepShake * near, 0.2);
    // The thud itself, where it lands (sound/creatures.js); every other
    // step the metal leg's servos whine.
    const sounds = ctx.systems.creatureSounds;
    sounds.play('stomp', p, { size: SOUND_SIZE, gain: 0.9 });
    if ((y.stepCount = (y.stepCount || 0) + 1) % 2 === 0) sounds.play('servo', { x: p.x, y: YETI.height * 0.3, z: p.z }, { pitch: 0.8, size: 2 });
  }

  /** @returns {void} */
  function initYeti() {
    snow = createParticlePool(Sim.three.scene, YETI.snowMax, createSoftDotTexture(), THREE.NormalBlending, 'yeti_snow');
    ctx.systems.caps.trackPool(snow);
    gun.init();
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-yeti'));
    if (button) {
      button.addEventListener('click', () => {
        // Called in from the panel: the camera glides over to it.
        if (spawn()) ctx.systems.camera.glideTo(() => (yeti ? yeti.root.position : null), YETI.height);
      }, { signal: ctx.signal });
    }
    ctx.systems.enemies.registerKind({
      kind: 'yeti',
      list: () => (yeti && (yeti.phase === 'walking' || yeti.phase === 'stunned') ? [yeti] : []),
      position: (y) => y.root.position,
      // Fire (Roger's Fire Gun) is its weakness (1.2 a tick of 30) and an EMP
      // stuns it. Every other weapon now chips its health (D1,
      // health/damageTable.js) and `defeat` drops it when that is used up.
      accepts: ['fire', 'emp'],
      damage: (y, hit) => damage(y, hit),
      defeat: (y) => {
        y.hp = 0;
        return fell(y);
      },
      hitbox: (y) => ({ x: y.root.position.x, z: y.root.position.z, radius: YETI.height * YETI.hitboxRadius, top: YETI.height }),
      size: () => YETI.height,
      // The black hole: gone, with no fall of its own.
      consume: () => removeYeti()
    });
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateYeti(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    stepSnow(dt);
    gun.update(dt);
    const y = yeti;
    if (!y || dt <= 0) return;
    y.timer += dt;
    y.firing = false;
    const p = y.root.position;
    const rig = y.rig;
    if (y.phase === 'falling' || y.phase === 'dead') {
      if (y.phase === 'falling') {
        const t = Math.min(1, y.timer / 1.6);
        y.root.rotation.x = -t * t * 1.4;
        if (t >= 1) {
          y.phase = 'dead';
          y.timer = 0;
          // It bursts into ice.
          for (let i = 0; i < 16; i++) {
            scratch.set(p.x + (Math.random() - 0.5) * 3 * size, 1 + Math.random() * 3 * size, p.z + (Math.random() - 0.5) * 3 * size);
            const v = new THREE.Vector3((Math.random() - 0.5) * 16, 4 + Math.random() * 9, (Math.random() - 0.5) * 16);
            ctx.systems.debris.spawnDebris(scratch, v, 0.3 * pace, 1 + Math.random(), 'ice');
          }
          ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x, 4, p.z), 3 * pace);
          ctx.systems.cues.playLargeExplosion({ gain: 0.8 });
          ctx.systems.gamefeel.addShake(0.6, 0.5);
          ctx.events.emit('explosion', { x: p.x, z: p.z, size: BLAST_SIZE.yeti, source: y });
        }
      } else if (y.timer > 4) {
        removeYeti();
      }
      return;
    }
    const frozen = ctx.systems.enemies.getState(y, 'frozen');
    if (y.phase === 'stunned') {
      rig.glowMat.color.copy(YETI.visor).multiplyScalar(0.1);
      if (y.timer > YETI.empStun) { y.phase = 'walking'; y.timer = 0; }
      return;
    }
    rig.glowMat.color.copy(YETI.visor);
    emitSnow(y, dt);
    y.tick -= dt;
    if (y.tick <= 0) {
      y.tick = YETI.tick;
      freezeTick(y);
    }
    if (frozen) return;

    // What it goes for: the T-Rex while they have it out (giants/clash.js),
    // else Roger, else the nearest person still flesh and blood.
    const clash = ctx.systems.giantClash;
    const foe = clash.foe('yeti');
    const hero = ctx.systems.heroMode;
    const roger = foe ? null : hero && hero.rogerTarget();
    let tx = 0;
    let tz = 0;
    let ty = 1;
    if (foe) {
      tx = foe.x;
      tz = foe.z;
      ty = foe.y;
    } else if (roger) {
      tx = roger.x;
      tz = roger.z;
    } else {
      let best = Infinity;
      for (const person of ctx.Environment.people) {
        const q = person.mesh.position;
        if (/** @type {any} */ (person).statue || !person.mesh.parent) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < best) { best = d; tx = q.x; tz = q.z; }
      }
    }
    const dist = Math.hypot(tx - p.x, tz - p.z);
    const want = Math.atan2(tx - p.x, tz - p.z);
    const turn = Math.atan2(Math.sin(want - y.heading), Math.cos(want - y.heading));
    y.heading += THREE.MathUtils.clamp(turn, -YETI.turnRate * dt, YETI.turnRate * dt);
    y.root.rotation.y = y.heading;
    // Facing the T-Rex it stops at the stand-off; anything else it walks up to.
    const stopAt = foe ? clash.standoff() : YETI.reach * 0.8;
    if (dist > stopAt) {
      const speed = YETI.walkSpeed * (Math.abs(turn) > 1 ? 0.4 : 1);
      p.x += Math.sin(y.heading) * speed * dt;
      p.z += Math.cos(y.heading) * speed * dt;
      const before = y.stride;
      y.stride += speed * dt * 1.2 / size;
      if (Math.floor(before / Math.PI) !== Math.floor(y.stride / Math.PI)) footfall(y);
    }

    // The cold gun: raised once what it goes for is in range, and firing.
    const wall = foe ? clash.wall() : null;
    const inRange = foe ? dist < clash.standoff() + 12 : dist < YETI.gunRange;
    const raise = inRange && Math.abs(turn) < 0.5 ? 1 : 0;
    if (raise && y.aim < 0.05) ctx.systems.creatureSounds.play('servo', p, { pitch: 0.7, size: 2 });
    y.aim += (raise - y.aim) * Math.min(1, dt * 5);
    y.root.updateMatrixWorld(true);
    rig.muzzle.getWorldPosition(muzzle);
    if (y.aim > 0.85 && raise) {
      // Along its heading, dipping to what it aims at (or to where the
      // beams meet, which it does not pass).
      let range = YETI.gunRange;
      if (wall) {
        aimDir.subVectors(wall, muzzle);
        range = Math.min(range, aimDir.length());
        aimDir.normalize();
      } else {
        const flat = Math.max(1, dist - YETI.reach);
        aimDir.set(Math.sin(y.heading), (ty - muzzle.y) / flat, Math.cos(y.heading)).normalize();
      }
      gun.fire(muzzle, aimDir, range, YETI.gunHalfAngle, dt);
      // Its hiss, held while it fires (sound/creatures.js).
      ctx.systems.creatureSounds.loop('yetiGun', muzzle, 1);
      y.firing = true;
      ctx.systems.lightPool.requestLight({
        x: muzzle.x + aimDir.x * range * 0.5, y: Math.max(3, muzzle.y + aimDir.y * range * 0.5), z: muzzle.z + aimDir.z * range * 0.5,
        colour: 0x7fd8ff, intensity: 5, distance: range * 1.6, priority: 4
      });
      y.gunTick -= dt;
      if (y.gunTick <= 0) {
        y.gunTick = YETI.gunTick;
        gunTick(y, range);
      }
    }
    clash.report('yeti', muzzle, y.firing);

    // Its blow, on Roger in reach.
    if (roger && dist < YETI.reach && y.swing <= 0) {
      y.swing = 0.5;
      ctx.systems.creatureSounds.play('yetiRoar', p, { size: SOUND_SIZE, shake: 0.3 });
      const frozenRoger = hero.rogerFrozen();
      ctx.systems.health.damagePlayer({
        source: 'yeti', instantKill: true, position: { x: p.x, y: 0, z: p.z },
        title: frozenRoger ? 'SHATTERED' : 'MAULED',
        sub: frozenRoger ? 'The Yeti smashed frozen Roger' : 'The cyber Yeti got hold of Roger'
      });
    }
    y.swing = Math.max(0, y.swing - dt);
    const s = Math.sin(y.stride);
    rig.legL.rotation.x = s * 0.5;
    rig.legR.rotation.x = -s * 0.5;
    rig.armL.rotation.x = -s * 0.4 - (y.swing > 0 ? 1.8 : 0);
    // The gun arm: carried low, raised straight out to fire.
    rig.armR.rotation.x = THREE.MathUtils.lerp(-0.35 + s * 0.15, -Math.PI / 2 + Math.sin(y.timer * 9) * 0.02, y.aim);
    const pulse = 0.75 + 0.25 * Math.sin(y.timer * (y.firing ? 18 : 3));
    rig.coolantMat.color.setRGB(0.5 * pulse, 2.2 * pulse, 3 * pulse);
  }

  /**
   * The Yeti for the stalemate (giants/clash.js): itself while it stands.
   * @returns {Yeti|null}
   */
  function duelist() {
    return yeti && (yeti.phase === 'walking' || yeti.phase === 'stunned') ? yeti : null;
  }

  /** @returns {void} */
  function removeYeti() {
    if (!yeti) return;
    Sim.three.scene.remove(yeti.root);
    yeti.rig.dispose();
    yeti = null;
    if (button) button.disabled = false;
  }

  /** @returns {void} */
  function resetYeti() {
    removeYeti();
    gun.clear();
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
  function disposeYeti() {
    removeYeti();
    if (snow) disposeParticlePool(Sim.three.scene, snow);
    snow = null;
    gun.release();
    model.dispose();
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
  }

  return { spawn, alive: () => !!duelist(), duelist, initYeti, updateYeti, resetYeti, disposeYeti };
}
