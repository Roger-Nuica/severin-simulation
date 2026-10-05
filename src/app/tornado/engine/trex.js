// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { TREX } from './trex/config.js';
import { createTrexModel } from './trex/model.js';
import { createTrexFlames } from './trex/flames.js';
import { BLAST_SIZE } from './player/energy.js';
import { HEALTH } from './health/config.js';
import { IDLE_DOT, stepDot, dotAmount } from './health/dot.js';

// How big it sounds (sound/creatures.js): the deepest of all, heard from
// farthest.
const SOUND_SIZE = 5;

/**
 * ===========================================================================
 * SECTION TX — The cyber T-Rex
 * ===========================================================================
 * An 18 m giant with metal implants (trex/model.js) that walks into town
 * from the edge and sets it on fire; its footfalls shake the camera and
 * thud, by how near they land. Called by the panel's 🦖 Cyber T-Rex; one
 * at a time (the button is off while it lives, and the entity caps are
 * asked first: engine/perf/caps.js).
 *
 * What it goes for: Roger in Hero Mode; otherwise the nearest standing
 * building not yet alight. It walks there at TREX.walkSpeed, straight
 * through anything in the way -- a building it walks into is shaken
 * (damage.shockBuilding), cars under its feet are thrown, people under them
 * crushed -- and once its target is within TREX.flameAim it breathes fire:
 * a cone TREX.flameRange long, for TREX.flameSeconds, every TREX.flameEvery
 * seconds. Everything the cone reaches catches: buildings through the
 * existing fire system (buildingFire.igniteBuilding, which spreads on its
 * own from there), people in it die, so do the aliens, and so does Roger.
 *
 * A Yeti in town as well: the two go for each other and end in a
 * stalemate, flame against frost, the breath stopping where it meets the
 * frost (giants/clash.js); afterwards it hunts Roger.
 *
 * It fights back against everything Roger has (the shared register of
 * enemies, engine/enemies.js, with a hitbox so the rifle and the minigun
 * can aim at it): the rifle takes TREX.damage.plasma of its TREX.hp, the
 * mega beam kills it outright, the minigun chips at it, lightning and the
 * railgun hurt it, and an EMP (E) knocks its implants out: it stands
 * stunned for TREX.empStun seconds, eye and vents dark.
 *
 * Killed, it topples over and blows up: an explosion Roger can take energy
 * from (the 'explosion' event), +TREX.score.
 *
 * Cost: one model (a few dozen meshes, shared geometry), one particle pool
 * asking the particle budget for room, and checks against the buildings
 * four times a second while it breathes.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   spawn: () => boolean,
 *   alive: () => boolean,
 *   duelist: () => any,
 *   initTrex: () => void,
 *   updateTrex: (dt: number) => void,
 *   resetTrex: () => void,
 *   disposeTrex: () => void
 * }}
 */
export function createTrexSystem(ctx) {
  const { Sim } = ctx;
  const model = createTrexModel();
  const flames = createTrexFlames(ctx);
  /**
   * @typedef {Object} Rex
   * @property {import('./trex/model.js').TrexRig} rig
   * @property {number} heading
   * @property {number} hp
   * @property {'walking'|'breathing'|'stunned'|'falling'|'dead'} phase
   * @property {number} timer seconds in this phase
   * @property {number} breathCooldown
   * @property {number} stride walk-cycle phase
   * @property {number} igniteTimer
   * @property {import('./health/dot.js').DotState} burn damage-over-time accumulator against Roger
   * @property {number} retarget
   * @property {{x: number, z: number, building?: SimObject}|null} target
   * @property {Set<SimObject>} shaken buildings it has already walked into
   * @property {number} hitFlash seconds of the vents flashing after a hit
   */
  /** @type {Rex|null} */
  let rex = null;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  const mouth = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const toWall = new THREE.Vector3();
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
      bannerTimer = 3.2;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /** @returns {void} */
  function syncButton() {
    if (button) button.disabled = !!rex;
  }

  /**
   * One T-Rex, walking in from the edge of town.
   * @returns {boolean} whether it came
   */
  function spawn() {
    if (rex || !ctx.systems.caps.canSpawn('trex')) return false;
    const rig = model.build();
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    // In Hero Mode it comes in on Roger's side of town, so the fight comes
    // to him.
    const angle = roger ? Math.atan2(roger.x, roger.z) + (Math.random() - 0.5) * 1.2 : Math.random() * Math.PI * 2;
    const x = Math.sin(angle) * TREX.spawnRing;
    const z = Math.cos(angle) * TREX.spawnRing;
    rig.root.position.set(x, 0, z);
    const heading = Math.atan2(-x, -z);
    rig.root.rotation.y = heading;
    Sim.three.scene.add(rig.root);
    rex = {
      rig, heading, hp: TREX.hp, phase: 'walking', timer: 0,
      breathCooldown: 2, stride: 0, igniteTimer: 0, burn: IDLE_DOT, retarget: 0, target: null,
      shaken: new Set(), hitFlash: 0, pitch: 0
    };
    showBanner('CYBER T-REX!', 'Flames that set the town alight · plasma, minigun and an EMP stop it');
    ctx.systems.creatureSounds.play('trexRoar', rig.root.position, { size: SOUND_SIZE, shake: 0.45 });
    syncButton();
    return true;
  }

  /**
   * What it goes for now.
   * @param {Rex} r
   * @returns {void}
   */
  function pickTarget(r) {
    const p = r.rig.root.position;
    const foe = ctx.systems.giantClash.foe('trex');
    if (foe) {
      r.target = { x: foe.x, z: foe.z };
      return;
    }
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    if (roger) {
      r.target = { x: roger.x, z: roger.z };
      return;
    }
    const fire = ctx.systems.buildingFire;
    let best = null;
    let bestD = Infinity;
    for (const b of ctx.Environment.buildings) {
      if (b.damageState === 'collapsed' || b.shelter || (fire && fire.isBurning(b))) continue;
      const q = b.mesh.position;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) { bestD = d; best = b; }
    }
    r.target = best ? { x: best.mesh.position.x, z: best.mesh.position.z, building: best } : { x: 0, z: 0 };
  }

  /**
   * @param {Rex} r
   * @param {number} x
   * @param {number} z
   * @param {number} range
   * @returns {boolean} whether (x, z) is inside its flame cone
   */
  function inCone(r, x, z, range) {
    const p = r.rig.root.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d < TREX.crushRadius) return d < TREX.crushRadius;
    const off = Math.atan2(dx, dz) - r.heading;
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < TREX.flameHalfAngle + TREX.crushRadius / d;
  }

  /**
   * What the cone reaches catches, or dies.
   * @param {Rex} r
   * @param {number} range metres: the flame's, or less where it meets the frost
   * @returns {void}
   */
  function scorch(r, range) {
    const fire = ctx.systems.buildingFire;
    for (const b of ctx.Environment.buildings) {
      if (b.damageState === 'collapsed' || fire.isBurning(b)) continue;
      const q = b.mesh.position;
      if (inCone(r, q.x, q.z, range)) fire.igniteBuilding(b, 0.6);
    }
    /** @type {SimObject[]} */
    const people = [];
    const p = r.rig.root.position;
    ctx.systems.area.forEachInRadius({ x: p.x, z: p.z, radius: range, targets: ['person'] }, (hit) => {
      if (inCone(r, hit.x, hit.z, range)) people.push(hit.target);
    });
    for (const person of people) ctx.systems.people.explodePerson(person);
    // The aliens burn too (engine/enemies.js: they answer to 'fire').
    const enemies = ctx.systems.enemies;
    for (const kind of enemies.kinds()) {
      if (kind.kind !== 'alien') continue;
      for (const alien of kind.list().slice()) {
        const q = kind.position(alien);
        if (inCone(r, q.x, q.z, range)) enemies.hit(alien, kind, { type: 'fire', at: q });
      }
    }
  }

  /**
   * Roger in the cone burns: `trexFlame` (about 33 a second) as ticks from
   * the shared accumulator (health/dot.js), every frame it breathes, not on
   * the slower ignite check. Out of the cone, or out of breath, it stops at
   * once. The lethal tick carries the TOASTED card. Allocation-free.
   * @param {Rex} r
   * @param {number} range metres: the flame's, or less where it meets the frost
   * @param {number} dt
   * @returns {void}
   */
  function burnRoger(r, range, dt) {
    const hero = ctx.systems.heroMode;
    const roger = r.phase === 'breathing' && hero ? hero.rogerTarget() : null;
    const next = stepDot(r.burn, roger !== null && inCone(r, roger.x, roger.z, range * 0.9), dt, HEALTH.dot.interval);
    r.burn = next.state;
    if (next.ticks === 0) return;
    ctx.systems.health.damagePlayer({
      source: 'trexFlame',
      amount: dotAmount(HEALTH.damage.trexFlame.amount, HEALTH.dot.interval, next.ticks),
      type: 'fire',
      position: r.rig.root.position,
      title: 'TOASTED',
      sub: 'The cyber T-Rex\'s flames caught Roger',
    });
  }

  /**
   * Walking: its feet, what they land on, the buildings it walks through.
   * @param {Rex} r
   * @param {number} dt
   * @param {number} speed
   * @returns {void}
   */
  function walk(r, dt, speed) {
    const p = r.rig.root.position;
    p.x += Math.sin(r.heading) * speed * dt;
    p.z += Math.cos(r.heading) * speed * dt;
    const before = r.stride;
    // The model is built 15 m tall: its stride grows with it.
    r.stride += speed * dt * 0.4 * (15 / TREX.height);
    // A footfall: a thud felt in proportion to how near the camera is.
    if (Math.floor(before / Math.PI) !== Math.floor(r.stride / Math.PI)) {
      const cam = Sim.three.camera.position;
      const near = Math.max(0, 1 - Math.hypot(cam.x - p.x, cam.z - p.z) / TREX.stepHeard);
      if (near > 0) {
        ctx.systems.gamefeel.addShake(TREX.stepShake * near, 0.22);
      }
      // The stomp and its clank, where it lands (sound/creatures.js), now
      // and then the hydraulics letting go.
      const sounds = ctx.systems.creatureSounds;
      sounds.play('metalStomp', p, { size: SOUND_SIZE });
      if (Math.random() < 0.3) sounds.play('hydraulic', { x: p.x, y: TREX.height * 0.4, z: p.z }, { size: 2 });
    }
    // Under its feet.
    /** @type {SimObject[]} */
    const crushed = [];
    ctx.systems.area.forEachInRadius({ x: p.x, z: p.z, radius: TREX.crushRadius, targets: ['person', 'object'] }, (hit) => {
      const obj = hit.target;
      if (hit.kind === 'person') crushed.push(obj);
      else if (obj.type === 'car' && obj.velocity && !obj.rooted) {
        obj.velocity.x += Math.sin(r.heading) * 12;
        obj.velocity.z += Math.cos(r.heading) * 12;
        obj.velocity.y += 6;
        if (obj.damageState === 'intact') obj.damageState = 'tipped';
      }
    });
    for (const person of crushed) ctx.systems.people.explodePerson(person);
    // Straight through a building: shaken, once.
    for (const b of ctx.Environment.buildings) {
      if (r.shaken.has(b) || b.damageState === 'collapsed') continue;
      const fp = b.mesh.userData.footprint;
      if (!fp) continue;
      const q = b.mesh.position;
      if (Math.abs(q.x - p.x) < fp.width / 2 + TREX.crushRadius && Math.abs(q.z - p.z) < fp.depth / 2 + TREX.crushRadius) {
        r.shaken.add(b);
        ctx.systems.damage.shockBuilding(b, TREX.buildingShock, scratch.set(p.x, 6, p.z));
      }
    }
  }

  /**
   * The pose: legs, tail, jaw and breathing, from the phase.
   * @param {Rex} r
   * @param {number} dt
   * @returns {void}
   */
  function pose(r, dt) {
    const { rig } = r;
    const swing = r.phase === 'walking' ? Math.sin(r.stride) * 0.45 : 0;
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.tail.rotation.y = Math.sin(r.stride * 0.5 + r.timer) * 0.22;
    // The neck and head bow towards what it breathes on, and come back up.
    if (r.phase !== 'breathing') r.pitch += (0 - r.pitch) * Math.min(1, dt * 2);
    rig.neck.rotation.x = -0.5 + r.pitch * 0.45;
    rig.head.rotation.x = 0.32 + r.pitch * 0.55;
    const open = r.phase === 'breathing' ? 0.55 : r.phase === 'stunned' ? 0.3 : 0.05;
    rig.jaw.rotation.x += (open - rig.jaw.rotation.x) * Math.min(1, dt * 8);
    rig.body.position.y = 8 + Math.abs(Math.sin(r.stride)) * 0.25;
    // Eye and vents: dark while stunned, white-hot for a moment when hit.
    const lit = r.phase === 'stunned' ? 0.08 : 1;
    const flash = r.hitFlash > 0 ? 1 + r.hitFlash * 6 : 1;
    rig.eyeMat.color.copy(TREX.eye).multiplyScalar(lit);
    rig.ventMat.color.copy(TREX.vent).multiplyScalar(lit * flash);
  }

  /**
   * Its hit points gone: over it goes.
   * @param {Rex} r
   * @returns {void}
   */
  function fall(r) {
    if (r.phase === 'falling' || r.phase === 'dead') return;
    r.phase = 'falling';
    r.timer = 0;
    ctx.systems.creatureSounds.play('trexDeath', r.rig.root.position, { size: SOUND_SIZE, shake: 0.5 });
    ctx.systems.damage.addDamageScore(TREX.score);
    showBanner('T-REX DOWN!', `The cyber T-Rex falls · +${TREX.score} bonus`);
  }

  /**
   * On the ground: its tanks go up.
   * @param {Rex} r
   * @returns {void}
   */
  function blowUp(r) {
    const p = r.rig.root.position;
    const at = new THREE.Vector3(p.x, 5, p.z);
    ctx.systems.explosions.spawnImpactBurst(at, 14);
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: 1.1 });
    ctx.systems.lightning.flashScreen(at, 0.6, '#ffb070');
    ctx.systems.gamefeel.event('tanker', at);
    ctx.systems.buildingFire.igniteNear(p.x, p.z, 36);
    ctx.events.emit('explosion', { x: p.x, z: p.z, size: BLAST_SIZE.trex, source: r });
  }

  /**
   * One hit from the shared register (engine/enemies.js).
   * @param {Rex} r
   * @param {import('./enemies.js').Hit} hit
   * @returns {boolean} whether it is down
   */
  function damage(r, hit) {
    if (r.phase === 'falling' || r.phase === 'dead') return true;
    const d = TREX.damage;
    const amount = hit.type === 'plasma' ? (hit.mega ? d.mega : d.plasma)
      : hit.type === 'bullet' ? d.bullet : hit.type === 'bolt' ? d.bolt : hit.type === 'emp' ? d.emp
        : hit.type === 'blade' ? (hit.amount || 0) : 0;
    const before = r.hp;
    r.hp -= amount;
    // The samurai's cuts are small: a word every tenth of it.
    if (hit.type === 'blade' && r.hp > 0 && Math.floor(before / (TREX.hp / 10)) !== Math.floor(r.hp / (TREX.hp / 10))) {
      ctx.events.emit('notice', { text: `🦖 T-REX ${Math.max(0, Math.round((r.hp / TREX.hp) * 100))}% · the samurai are cutting it down` });
    }
    r.hitFlash = 0.25;
    if (r.hp > 0 && amount >= 1) ctx.systems.creatureSounds.play('trexHurt', r.rig.root.position, { size: SOUND_SIZE });
    if (hit.type === 'emp' && r.hp > 0) {
      r.phase = 'stunned';
      r.timer = 0;
      ctx.events.emit('notice', { text: `🦖 T-REX STUNNED · ${TREX.empStun} s` });
    }
    if (r.hp <= 0) {
      fall(r);
      return true;
    }
    if (hit.type === 'plasma' || hit.type === 'bolt') {
      ctx.events.emit('notice', { text: `🦖 T-REX ${Math.max(0, Math.round((r.hp / TREX.hp) * 100))}%` });
    }
    return false;
  }

  /** @returns {void} */
  function initTrex() {
    flames.init();
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-trex'));
    if (button) {
      button.addEventListener('click', () => {
        // Called in from the panel: the camera glides over to it.
        if (spawn()) ctx.systems.camera.glideTo(() => (rex ? rex.rig.root.position : null), TREX.height);
      }, { signal: ctx.signal });
    }
    ctx.systems.enemies.registerKind({
      kind: 'trex',
      list: () => (rex && rex.phase !== 'falling' && rex.phase !== 'dead' ? [rex] : []),
      position: (r) => r.rig.root.position,
      accepts: ['plasma', 'bullet', 'bolt', 'emp', 'blade'],
      damage: (r, hit) => damage(r, hit),
      // Out of health (D1, health/damageTable.js: every other weapon, the
      // Katana and fire included, chips it): it falls as at 0 hp.
      defeat: (r) => {
        if (r.phase === 'falling' || r.phase === 'dead') return true;
        r.hp = 0;
        fall(r);
        return true;
      },
      hitbox: (r) => ({ x: r.rig.root.position.x, z: r.rig.root.position.z, radius: TREX.hitboxRadius * TREX.height, top: TREX.height }),
      size: () => TREX.length,
      // The black hole: gone, with no fall of its own.
      consume: () => removeRex()
    });
    syncButton();
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateTrex(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    flames.update(dt);
    const r = rex;
    if (!r || dt <= 0) return;
    r.timer += dt;
    r.hitFlash = Math.max(0, r.hitFlash - dt);
    const root = r.rig.root;
    const p = root.position;

    if (r.phase === 'falling' || r.phase === 'dead') {
      if (r.phase === 'falling') {
        const t = Math.min(1, r.timer / TREX.fallSeconds);
        root.rotation.z = t * t * (Math.PI / 2 - 0.15);
        root.position.y = -t * 1.5;
        if (t >= 1) {
          r.phase = 'dead';
          r.timer = 0;
          blowUp(r);
        }
      } else if (r.timer > TREX.goneAfter) {
        removeRex();
      }
      return;
    }

    // Frozen (engine/effects/freeze.js): it stands in its block of ice.
    if (ctx.systems.enemies.getState(r, 'frozen')) return;

    if (r.phase === 'stunned') {
      if (r.timer > TREX.empStun) { r.phase = 'walking'; r.timer = 0; }
      if (Math.random() < dt * 6) {
        const k = TREX.height / 15;
        ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x + (Math.random() - 0.5) * 6 * k, (6 + Math.random() * 6) * k, p.z + (Math.random() - 0.5) * 6 * k), 0.3 * k);
      }
      pose(r, dt);
      return;
    }

    r.retarget -= dt;
    if (r.retarget <= 0 || !r.target) {
      pickTarget(r);
      r.retarget = 1;
    }
    const target = r.target || { x: 0, z: 0 };
    const tx = target.x - p.x;
    const tz = target.z - p.z;
    const dist = Math.hypot(tx, tz);
    const want = Math.atan2(tx, tz);
    const turn = Math.atan2(Math.sin(want - r.heading), Math.cos(want - r.heading));
    r.heading += THREE.MathUtils.clamp(turn, -TREX.turnRate * dt, TREX.turnRate * dt);
    root.rotation.y = r.heading;
    r.breathCooldown -= dt;
    // Facing the Yeti (giants/clash.js): it stops at the stand-off and
    // breathes for as long as they have it out; where the two meet, the
    // breath stops.
    const clash = ctx.systems.giantClash;
    const foe = clash.foe('trex');
    const wall = foe ? clash.wall() : null;
    root.updateMatrixWorld(true);
    r.rig.mouth.getWorldPosition(mouth);
    let firing = false;

    if (r.phase === 'breathing') {
      // The fire, out of the mouth and along its heading, a little down --
      // or straight at where it meets the frost.
      let range = TREX.flameRange;
      if (wall) {
        dir.subVectors(wall, mouth);
        range = Math.min(range, dir.length());
        dir.normalize();
      } else {
        // Straight at its target's chest (Roger's, wherever he is, up a roof
        // or on the jetpack; a building's lower floors): it used to breathe
        // along its heading, level, over the head of anyone near it.
        const roger = !foe && ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
        const ty = roger ? ctx.systems.heroMode.rogerHeight() + 1.1 : 3;
        dir.set(target.x - mouth.x, ty - mouth.y, target.z - mouth.z);
        if (dir.lengthSq() < 1) dir.set(Math.sin(r.heading), -0.5, Math.cos(r.heading));
        dir.normalize();
      }
      // The head follows the breath down (pose).
      r.pitch += (THREE.MathUtils.clamp(Math.asin(-dir.y), -0.3, 1.1) - r.pitch) * Math.min(1, dt * 4);
      flames.emit(mouth, dir, Math.round(TREX.flameRate * dt + Math.random()), wall ? toWall.subVectors(wall, mouth).length() : undefined);
      // The flame's roar, held while it breathes (sound/creatures.js).
      ctx.systems.creatureSounds.loop('trexFlame', mouth, 1);
      firing = true;
      ctx.systems.lightPool.requestLight({
        x: mouth.x + dir.x * range * 0.4, y: Math.max(4, mouth.y + dir.y * range * 0.4), z: mouth.z + dir.z * range * 0.4,
        colour: 0xff7a2a, intensity: 7, distance: range * 2.2, priority: 5
      });
      burnRoger(r, range, dt);
      r.igniteTimer -= dt;
      if (r.igniteTimer <= 0) {
        r.igniteTimer = TREX.igniteEvery;
        scorch(r, range);
      }
      const lockedOn = foe && dist < clash.standoff() + 12;
      if (!lockedOn && r.timer > TREX.flameSeconds) {
        r.phase = 'walking';
        r.timer = 0;
        const [lo, hi] = TREX.flameEvery;
        r.breathCooldown = lo + Math.random() * (hi - lo);
      }
    } else {
      r.burn = IDLE_DOT;
      const aim = foe ? clash.standoff() + 12 : TREX.flameAim;
      if (dist < aim && Math.abs(turn) < 0.3 && (r.breathCooldown <= 0 || foe)) {
        // A roar before the fire, now and then.
        if (Math.random() < 0.5) ctx.systems.creatureSounds.play('trexRoar', mouth, { size: SOUND_SIZE, shake: 0.3 });
        r.phase = 'breathing';
        r.timer = 0;
        r.igniteTimer = 0;
      }
    }
    // It walks between breaths: up to its target, or to the stand-off.
    const stopAt = foe ? clash.standoff() : TREX.flameAim * 0.6;
    if (dist > stopAt && r.phase === 'walking') {
      walk(r, dt, TREX.walkSpeed * (Math.abs(turn) > 1 ? 0.4 : 1));
    }
    clash.report('trex', mouth, firing);
    pose(r, dt);
  }

  /** @returns {void} */
  function removeRex() {
    if (!rex) return;
    Sim.three.scene.remove(rex.rig.root);
    for (const m of rex.rig.materials) m.dispose();
    rex = null;
    syncButton();
  }

  /** @returns {void} */
  function resetTrex() {
    removeRex();
    flames.clear();
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeTrex() {
    removeRex();
    flames.release();
    model.dispose();
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
  }

  /**
   * The T-Rex for the stalemate (giants/clash.js): itself while it stands.
   * @returns {Rex|null}
   */
  function duelist() {
    return rex && rex.phase !== 'falling' && rex.phase !== 'dead' ? rex : null;
  }

  return { spawn, alive: () => !!duelist(), duelist, initTrex, updateTrex, resetTrex, disposeTrex };
}
