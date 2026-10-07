// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { HANK, MOVES, moveAt, showLength, isRecord, throwScore, bossChoice } from './hank/moves.js';
import { buildHank, buildBoulder } from './hank/model.js';
import { HANK_STATE } from './net/figurePose.js';

/**
 * ===========================================================================
 * SECTION AH — Hank Granite, the Human Landslide (on his button only)
 * ===========================================================================
 * An original character on the unstoppable-action-hero archetype, literally
 * a force of nature: a 3.2 m man of quarried granite held together by
 * magma, who kept his red bandana and dark glasses (R-040; redesigned
 * 2026-10-04, the show and the fight reworked 2026-10-05, on request).
 *
 * The show (about 9.5 s, hank/moves.js), on real time while the world slows
 * to HANK.slowmo, black bars, filmed from the front:
 *  1. A boulder drops out of the sky and slams into the street: a shock ring
 *     of dust, the camera shakes, it bursts into chunks and Hank rises out
 *     of the crater facing the camera. HANK GRANITE · THE HUMAN LANDSLIDE.
 *  2. Two townspeople walk up to him over about two seconds (they come on
 *     their own feet; nobody is moved into place), stopping either side in
 *     front of him.
 *  3. One punch each, its name slammed on screen (HAYMAKER, KNOCKOUT), his
 *     magma flaring: each flies a long way in a tall arc with its distance
 *     counted live over it like a home run on TV, a ring where it lands and
 *     NEW RECORD when it beats an earlier throw. The camera eases back to
 *     keep the flight in frame.
 *  4. Out of Hero Mode he crumbles into the street and the town is left in
 *     moon gravity. In Hero Mode the camera goes back to Roger and Hank
 *     comes for him: the fight.
 *
 * The fight (Hero Mode, in the shared enemy register as kind `hank`, 60
 * health through the weapon table): he walks at Roger, flinging anyone in
 * his way; close enough, he winds up (his fist and magma flaring) and
 * punches, and a punch that lands kills Roger even through Invincible (a
 * piercing hit, engine/health/system.js) -- dodge it, out of reach or up.
 * Up on a roof or the jetpack, Roger is out of his reach and he throws rocks
 * instead (HANK.boss.rockEvery, hankRock 25). An EMP staggers him. Brought
 * down, he crumbles (+3000) and the low gravity follows.
 *
 * Only from his button (👊 Hank Granite). Not while Hero Mode is dead, the
 * landing cutscene or a replay has the camera. No lights added; one dust
 * pool; the townspeople thrown are taken out of the town when they land.
 */

const MARKERS = 6;
const LABELS = 8;

/**
 * @typedef {Object} Victim
 * @property {any} person
 * @property {'walking'|'waiting'|'flying'|'landed'|'gone'} state
 * @property {THREE.Vector3} vel
 * @property {THREE.Vector3} spin
 * @property {THREE.Vector3} from where it was thrown from
 * @property {THREE.Vector3} spot where it walks to, in front of him
 * @property {number} t seconds in its current state
 * @property {number} metres
 * @property {number} stride
 * @property {HTMLElement|null} label
 * @property {boolean} record
 */

/**
 * @typedef {Object} Boss
 * @property {'walk'|'wind'|'recover'|'throw'|'stagger'|'dying'} state
 * @property {number} t
 * @property {number} cooldown
 * @property {number} rockTimer
 * @property {number} stride
 * @property {number} flinch
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   start: () => boolean,
 *   active: () => boolean,
 *   placeCamera: (rawDt: number) => void,
 *   initActionHero: () => void,
 *   updateActionHero: (dt: number, rawDt: number) => void,
 *   resetActionHero: () => void,
 *   disposeActionHero: () => void,
 *   buildGuestModel: () => any,
 *   replicaState: () => any
 * }}
 */
export function createActionHeroSystem(ctx) {
  const { Sim } = ctx;
  /** @type {{t: number, x: number, z: number, heading: number, victims: Victim[], next: number, landed: boolean, best: number,
   *   saved: {pos: THREE.Vector3, target: THREE.Vector3, controls: boolean}, look: THREE.Vector3, camDist: number, camRoom: number, crumble: number}|null} */
  let scene = null;
  /** @type {Boss|null} the fight, after the show, in Hero Mode */
  let boss = null;
  /** Seconds into his crumbling into the street (out of Hero Mode, or brought down); -1 when not. */
  let crumbling = -1;
  /** @type {ReturnType<typeof buildHank>|null} */
  let hank = null;
  /** @type {ReturnType<typeof buildBoulder>|null} */
  let rockfall = null;
  /** @type {{vel: THREE.Vector3, spin: THREE.Vector3, t: number}[]} */
  let chunkState = [];
  /** A rock he throws at Roger up high: one of the boulder's chunks, re-used. */
  const rock = { live: false, mesh: /** @type {THREE.Mesh|null} */ (null), vel: new THREE.Vector3(), t: 0 };
  /** @type {{mesh: THREE.Mesh, t: number}[]} */
  let markers = [];
  /** Thrown townspeople still in the air or lying where they landed (they outlive the show). */
  /** @type {Victim[]} */
  let flyers = [];
  /** @type {HTMLDivElement|null} */
  let bars = null;
  /** @type {HTMLDivElement|null} */
  let title = null;
  /** @type {HTMLDivElement|null} */
  let moveCall = null;
  /** @type {HTMLDivElement|null} */
  let labelBox = null;
  /** @type {HTMLElement[]} */
  let labelPool = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let dust = null;
  let dustAlive = false;
  let lowGravityLeft = 0;
  /** The longest throw this run, metres. */
  let record = 0;
  /** @type {Object|null} his entry in the enemy register */
  let kind = null;
  /** @type {THREE.Material[]} */
  const ownMaterials = [];
  /** @type {THREE.BufferGeometry[]} */
  const ownGeometries = [];
  const scratch = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const proj = new THREE.Vector3();
  // The pose he is easing towards, and the one he has.
  const want = { s0x: 0, s1x: 0, e0x: 0, e1x: 0, ty: 0, tx: 0, drop: 0, legs: 0 };
  const has = { s0x: 0, s1x: 0, e0x: 0, e1x: 0, ty: 0, tx: 0, drop: 0, legs: 0 };

  // ---------------------------------------------------------------------
  // Dust
  // ---------------------------------------------------------------------

  /**
   * @param {THREE.Vector3} at
   * @param {number} n
   * @param {number} speed outward
   * @param {number} rise
   * @param {number} [flat] 1 for a flat ring along the ground
   */
  function puff(at, n, speed, rise, flat = 0) {
    if (!dust) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = dust.next;
      dust.next = (dust.next + 1) % dust.life.length;
      const life = 1.2 + Math.random() * 1.2;
      dust.life[i] = life;
      dust.maxLife[i] = life;
      dust.seed[i] = Math.random();
      dust.positions[i * 3] = at.x;
      dust.positions[i * 3 + 1] = at.y;
      dust.positions[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.5);
      dust.velocities[i * 3] = Math.cos(a) * s;
      dust.velocities[i * 3 + 1] = flat ? Math.random() * rise * 0.3 : (0.3 + Math.random() * 0.7) * rise;
      dust.velocities[i * 3 + 2] = Math.sin(a) * s;
    }
    if (count > 0) dustAlive = true;
  }

  /** @param {number} dt */
  function stepDust(dt) {
    if (!dust || !dustAlive) return;
    dust.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let alive = false;
    for (let i = 0; i < dust.life.length; i++) {
      if (dust.life[i] <= 0) {
        if (dust.sizes[i] !== 0) { dust.sizes[i] = 0; dust.colours[i * 4 + 3] = 0; }
        continue;
      }
      alive = true;
      dust.life[i] -= dt;
      const t = 1 - Math.max(0, dust.life[i]) / dust.maxLife[i];
      const k = i * 3;
      const drag = 1 - Math.min(1, dt * 1.6);
      dust.velocities[k] *= drag;
      dust.velocities[k + 1] = dust.velocities[k + 1] * drag + dt * 0.4;
      dust.velocities[k + 2] *= drag;
      dust.positions[k] += dust.velocities[k] * dt;
      dust.positions[k + 1] += dust.velocities[k + 1] * dt;
      dust.positions[k + 2] += dust.velocities[k + 2] * dt;
      const shade = 0.55 + dust.seed[i] * 0.15;
      dust.colours[i * 4] = shade;
      dust.colours[i * 4 + 1] = shade * 0.94;
      dust.colours[i * 4 + 2] = shade * 0.86;
      dust.colours[i * 4 + 3] = Math.min(1, t * 6) * (1 - t) * 0.75;
      dust.sizes[i] = 1.2 + t * 3.5;
    }
    markPoolDirty(dust);
    dustAlive = alive;
  }

  // ---------------------------------------------------------------------
  // Starting and ending
  // ---------------------------------------------------------------------

  /** @returns {boolean} whether the show began */
  function start() {
    if (scene || boss || crumbling >= 0 || !hank || !rockfall) return false;
    const cam = Sim.three.camera;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    const wanted = roger ? new THREE.Vector3(roger.x + 18, 0, roger.z + 18) : Sim.three.controls.target.clone().setY(0);
    // Somewhere open: a crater in a street or a square, not a roof.
    const target = openGround(wanted);
    // Two who are near enough to walk up in a couple of seconds (and not
    // already on top of the spot).
    const people = ctx.Environment.people
      .filter((/** @type {any} */ p) => p.mesh.parent && p.captureState === 'grounded' && !p.heroName && !p.abducted && !p.statue && p.motion && p.motion.limbs)
      .map((/** @type {any} */ p) => ({ p, d: Math.hypot(p.mesh.position.x - target.x, p.mesh.position.z - target.z) }))
      .filter((/** @type {{d: number}} */ e) => e.d > 4)
      .sort((/** @type {{d: number}} */ a, /** @type {{d: number}} */ b) => a.d - b.d)
      .slice(0, MOVES.length)
      .map((/** @type {{p: any}} */ e) => e.p);
    if (people.length < 1) return false;
    // He faces the camera (the show is filmed from the front), turned to
    // where the lens has a clear line to him.
    const heading = clearHeading(target, Math.atan2(cam.position.x - target.x, cam.position.z - target.z));
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    scene = {
      t: 0, x: target.x, z: target.z, heading, next: 0, landed: false, best: 0, crumble: 0,
      victims: people.map((/** @type {any} */ person, /** @type {number} */ i) => {
        // Where each stops: in front of him, one to each side, clear of the lens.
        const side = i === 0 ? -1 : 1;
        return {
          person, state: /** @type {'walking'} */ ('walking'), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
          from: new THREE.Vector3(), t: 0, metres: 0, stride: Math.random() * 6, label: null, record: false,
          spot: new THREE.Vector3(target.x + fx * 2.3 + fz * side * 1.5, 0, target.z + fz * 2.3 - fx * side * 1.5)
        };
      }),
      saved: { pos: cam.position.clone(), target: Sim.three.controls.target.clone(), controls: Sim.three.controls.enabled },
      look: new THREE.Vector3(target.x, 6, target.z),
      camDist: 12,
      // How far back the lens can go along its line before a wall.
      camRoom: clearRoom(target, heading + 0.28)
    };
    for (const v of scene.victims) v.person.motion.active = false;
    hank.group.position.set(scene.x, -HANK.height * 1.1, scene.z);
    hank.group.rotation.y = heading;
    hank.group.visible = false;
    rockfall.boulder.position.set(scene.x, 90, scene.z);
    rockfall.boulder.visible = true;
    ctx.systems.time.hold('actionHero', 'world', HANK.slowmo);
    Sim.three.controls.enabled = false;
    bars?.classList.add('visible');
    ctx.events.emit('announce', { title: 'HANK GRANITE', sub: 'The Human Landslide. He does not walk into town. He lands on it.' });
    return true;
  }

  /**
   * Whether nothing solid stands at (x, z) or round it at radius r.
   * @param {number} x @param {number} z @param {number} r
   * @returns {boolean}
   */
  function clearAt(x, z, r) {
    const hero = ctx.systems.heroMode;
    if (!hero || !hero.standable) return true;
    if (!hero.standable(x, z)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!hero.standable(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  }

  /**
   * The open spot nearest to `wanted` (spiralling out), for the boulder.
   * @param {THREE.Vector3} wanted
   * @returns {THREE.Vector3}
   */
  function openGround(wanted) {
    if (clearAt(wanted.x, wanted.z, 6)) return wanted;
    for (let ring = 1; ring <= 8; ring++) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = wanted.x + Math.cos(a) * ring * 5;
        const z = wanted.z + Math.sin(a) * ring * 5;
        if (clearAt(x, z, 6)) return new THREE.Vector3(x, 0, z);
      }
    }
    return wanted;
  }

  /**
   * A heading for him, as near `preferred` as it can be, with a clear line
   * out to where the front camera stands (no wall in front of the lens).
   * @param {THREE.Vector3} at
   * @param {number} preferred
   * @returns {number}
   */
  function clearHeading(at, preferred) {
    for (let k = 0; k < 24; k++) {
      const h = preferred + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const a = h + 0.28;
      let ok = true;
      for (const d of [3, 6, 9.5, 13]) {
        if (!clearAt(at.x + Math.sin(a) * d, at.z + Math.cos(a) * d, 1.5)) { ok = false; break; }
      }
      if (ok) return h;
    }
    return preferred;
  }

  /**
   * How far out along a line from `at` the ground is clear (up to 60 m).
   * @param {THREE.Vector3} at
   * @param {number} a heading of the line
   * @returns {number}
   */
  function clearRoom(at, a) {
    for (let d = 3; d <= 60; d += 2) {
      if (!clearAt(at.x + Math.sin(a) * d, at.z + Math.cos(a) * d, 1.2)) return Math.max(8, d - 2);
    }
    return 60;
  }

  /**
   * The show over: the camera and the world's time back; then either the
   * fight (Hero Mode) or his crumbling away.
   * @param {boolean} [ended] played to its end (not cut short)
   */
  function finish(ended = false) {
    if (!scene) return;
    ctx.systems.time.release('actionHero');
    Sim.three.camera.position.copy(scene.saved.pos);
    Sim.three.controls.target.copy(scene.saved.target);
    Sim.three.controls.enabled = scene.saved.controls;
    for (const v of scene.victims) {
      if (v.state === 'walking' || v.state === 'waiting') v.person.motion.active = true;
    }
    scene = null;
    bars?.classList.remove('visible');
    title?.classList.remove('visible');
    moveCall?.classList.remove('visible');
    if (!ended || !hank) {
      if (hank) hank.group.visible = false;
      if (rockfall) rockfall.boulder.visible = false;
      return;
    }
    if (ctx.Hero && ctx.Hero.active) {
      boss = { state: 'walk', t: 0, cooldown: 1, rockTimer: 1.5, stride: 0, flinch: 0 };
      ctx.events.emit('announce', { title: 'HANK GRANITE', sub: 'He is coming for you. One punch is the end, Invincible or not. Stay out of reach.' });
    } else {
      crumbling = 0;
    }
  }

  /**
   * Moon gravity for a while, and the parked cars round him float off.
   * @param {THREE.Vector3} at
   */
  function startLowGravity(at) {
    const LG = HANK.lowGravity;
    lowGravityLeft = LG.seconds;
    ctx.systems.physics.gravity.scale = LG.scale;
    for (const obj of Sim.objects) {
      if (obj.type !== 'car' || obj.captureState !== 'grounded' || !obj.mesh) continue;
      const p = obj.mesh.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) > LG.reach) continue;
      obj.captureState = 'falling';
      obj.velocity.set((Math.random() - 0.5) * 2, LG.hop[0] + Math.random() * (LG.hop[1] - LG.hop[0]), (Math.random() - 0.5) * 2);
    }
    ctx.events.emit('announce', { title: 'LOW GRAVITY', sub: 'The town has not quite got over Hank Granite' });
  }

  /** @param {number} dt */
  function stepLowGravity(dt) {
    if (lowGravityLeft <= 0) return;
    lowGravityLeft = Math.max(0, lowGravityLeft - dt);
    const LG = HANK.lowGravity;
    const ease = Math.min(1, lowGravityLeft / (LG.seconds / 3));
    ctx.systems.physics.gravity.scale = 1 - (1 - LG.scale) * ease;
  }

  /**
   * He crumbles into the street (the show's end out of Hero Mode, or
   * brought down in the fight), then the low gravity.
   * @param {number} rawDt
   */
  function stepCrumble(rawDt) {
    if (crumbling < 0 || !hank) return;
    crumbling += rawDt;
    const k = Math.min(1, crumbling / HANK.outro);
    const g = hank.group;
    if (k > 0.3) {
      g.position.y = -HANK.height * 1.15 * ((k - 0.3) / 0.7) ** 2;
      if (Math.random() < 0.5) puff(scratch.set(g.position.x, 0.4, g.position.z), 6, 5, 2, 1);
    }
    hank.magma.emissiveIntensity = Math.max(0.2, 1.2 * (1 - k));
    if (k >= 1) {
      crumbling = -1;
      g.visible = false;
      hank.magma.emissiveIntensity = 1.2;
      ctx.systems.creatureSounds.play('poof', g.position, { size: 1.6 });
      startLowGravity(g.position);
    }
  }

  // ---------------------------------------------------------------------
  // Throws, the distance labels and the markers
  // ---------------------------------------------------------------------

  /** @param {Victim} v */
  function removeVictim(v) {
    const person = v.person;
    person.mesh.removeFromParent();
    person.mesh.traverse((/** @type {any} */ o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    const env = ctx.Environment;
    for (const list of [Sim.objects, env.people]) {
      const i = list.indexOf(person);
      if (i !== -1) list.splice(i, 1);
    }
    v.state = 'gone';
    freeLabel(v);
  }

  /** @param {Victim} v */
  function takeLabel(v) {
    const el = labelPool.find((x) => !x.dataset.busy);
    if (!el) return;
    el.dataset.busy = '1';
    el.className = 'hank-dist';
    /** @type {HTMLElement} */ (el.querySelector('b')).textContent = '0';
    /** @type {HTMLElement} */ (el.querySelector('em')).textContent = '';
    el.style.display = 'block';
    v.label = el;
  }

  /** @param {Victim} v */
  function freeLabel(v) {
    if (!v.label) return;
    delete v.label.dataset.busy;
    v.label.style.display = 'none';
    v.label = null;
  }

  /**
   * Off it goes.
   * @param {Victim} v
   * @param {{speed: number, angle: number}} move
   * @param {number} heading which way, flat
   */
  function launch(v, move, heading) {
    if (!hank || !v.person.mesh.parent) return;
    const p = v.person.mesh.position;
    v.state = 'flying';
    v.t = 0;
    p.y = Math.max(p.y, 1.2);
    v.from.copy(p);
    v.metres = 0;
    v.record = false;
    const flat = Math.cos(move.angle) * move.speed;
    v.vel.set(Math.sin(heading) * flat, Math.sin(move.angle) * move.speed, Math.cos(heading) * flat);
    v.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 14);
    takeLabel(v);
    flyers.push(v);
  }

  /** @param {Victim} v */
  function land(v) {
    const p = v.person.mesh.position;
    p.y = 0;
    v.person.mesh.rotation.set(Math.PI / 2, v.person.mesh.rotation.y, 0);
    v.state = 'landed';
    v.t = 0;
    v.metres = Math.hypot(p.x - v.from.x, p.z - v.from.z);
    puff(scratch.set(p.x, 0.3, p.z), 50, 9, 2, 1);
    ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x, 0.6, p.z), 0.4);
    ctx.systems.creatureSounds.play('punch', p, { size: 0.9, pitch: 0.7 });
    ctx.systems.damage.addDamageScore(throwScore(v.metres));
    // A record beats an earlier throw: the run's first sets the mark quietly.
    if (isRecord(v.metres, record)) {
      v.record = record > 0;
      record = v.metres;
    }
    if (scene) scene.best = Math.max(scene.best, v.metres);
    const mk = markers.find((x) => x.t >= 1) || markers[0];
    mk.t = 0;
    mk.mesh.position.set(p.x, 0.12, p.z);
    mk.mesh.visible = true;
    /** @type {THREE.MeshBasicMaterial} */ (mk.mesh.material).color.setRGB(v.record ? 3 : 2.4, v.record ? 2.2 : 1.1, v.record ? 0.4 : 0.25);
    if (v.label) {
      v.label.classList.add('landed');
      if (v.record) v.label.classList.add('record');
      /** @type {HTMLElement} */ (v.label.querySelector('b')).textContent = String(Math.round(v.metres));
      /** @type {HTMLElement} */ (v.label.querySelector('em')).textContent = v.record ? 'NEW RECORD' : '';
    }
  }

  /** @param {number} rawDt */
  function stepFlyers(rawDt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const v of flyers) {
      const mesh = v.person.mesh;
      if (v.state === 'gone') continue;
      v.t += rawDt;
      const p = mesh.position;
      if (v.state === 'flying') {
        v.vel.y -= HANK.gravity * rawDt;
        p.addScaledVector(v.vel, rawDt);
        mesh.rotation.x += v.spin.x * rawDt;
        mesh.rotation.y += v.spin.y * rawDt;
        mesh.rotation.z += v.spin.z * rawDt;
        v.metres = Math.hypot(p.x - v.from.x, p.z - v.from.z);
        if (v.label) /** @type {HTMLElement} */ (v.label.querySelector('b')).textContent = String(Math.round(v.metres));
        if (p.y <= 0 && v.vel.y < 0) land(v);
      } else if (v.state === 'landed' && v.t > 3.2) {
        removeVictim(v);
        continue;
      }
      if (v.label) {
        proj.set(p.x, p.y + 2.4, p.z).project(Sim.three.camera);
        const on = proj.z < 1 && Math.abs(proj.x) < 1.15 && Math.abs(proj.y) < 1.15;
        v.label.style.opacity = on ? (v.state === 'landed' ? String(Math.min(1, (3.2 - v.t) * 1.5)) : '1') : '0';
        if (on) v.label.style.transform = `translate(${((proj.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    if (flyers.some((v) => v.state === 'gone')) flyers = flyers.filter((v) => v.state !== 'gone');
    for (const mk of markers) {
      if (mk.t >= 1) continue;
      mk.t = Math.min(1, mk.t + rawDt / 3.5);
      mk.mesh.scale.setScalar(1 + mk.t * 0.6);
      /** @type {THREE.MeshBasicMaterial} */ (mk.mesh.material).opacity = (1 - mk.t) * 0.9;
      mk.mesh.rotation.z += rawDt * 0.8;
      if (mk.t >= 1) mk.mesh.visible = false;
    }
  }

  // ---------------------------------------------------------------------
  // The show
  // ---------------------------------------------------------------------

  /** @param {string} name */
  function callMove(name) {
    if (!moveCall) return;
    moveCall.textContent = `${name}!`;
    moveCall.classList.remove('visible');
    void moveCall.offsetWidth;
    moveCall.classList.add('visible');
  }

  /** The boulder lands: the shock ring, the chunks, and him. */
  function impact() {
    if (!scene || !hank || !rockfall) return;
    const at = scratch.set(scene.x, 0.4, scene.z);
    rockfall.boulder.visible = false;
    ctx.systems.explosions.spawnImpactBurst(scratch.set(scene.x, 1.2, scene.z), 1.6);
    puff(scratch.set(scene.x, 0.3, scene.z), 220, 26, 3, 1);
    puff(scratch.set(scene.x, 1, scene.z), 60, 4, 8);
    ctx.systems.gamefeel.addShake(1.1, 0.45);
    ctx.systems.creatureSounds.play('hankArrive', at, { size: 1.8 });
    ctx.systems.creatureSounds.play('punch', at, { size: 1.8, pitch: 0.5 });
    rockfall.chunks.forEach((c, i) => {
      if (c === rock.mesh) return;
      const a = (i / rockfall.chunks.length) * Math.PI * 2 + Math.random() * 0.3;
      const s = 6 + Math.random() * 8;
      c.position.set(scene.x + Math.cos(a) * 1.2, 1.2 + Math.random(), scene.z + Math.sin(a) * 1.2);
      c.scale.setScalar(0.6 + Math.random() * 0.9);
      c.visible = true;
      chunkState[i].vel.set(Math.cos(a) * s, 5 + Math.random() * 7, Math.sin(a) * s);
      chunkState[i].spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      chunkState[i].t = 0;
    });
    hank.group.visible = true;
    hank.magma.emissiveIntensity = 5;
    if (title) {
      title.innerHTML = 'HANK GRANITE<small>THE HUMAN LANDSLIDE</small>';
      title.classList.add('visible');
    }
  }

  /** @param {number} rawDt */
  function stepChunks(rawDt) {
    if (!rockfall) return;
    rockfall.chunks.forEach((c, i) => {
      if (!c.visible || c === rock.mesh) return;
      const s = chunkState[i];
      s.t += rawDt;
      s.vel.y -= 14 * rawDt;
      c.position.addScaledVector(s.vel, rawDt);
      c.rotation.x += s.spin.x * rawDt;
      c.rotation.z += s.spin.z * rawDt;
      if (c.position.y < 0.25 * c.scale.x) {
        c.position.y = 0.25 * c.scale.x;
        s.vel.multiplyScalar(0.35);
        s.vel.y = Math.abs(s.vel.y) * 0.3;
        s.spin.multiplyScalar(0.5);
      }
      if (s.t > 4) c.position.y -= rawDt * 0.6;
      if (s.t > 6) c.visible = false;
    });
  }

  /**
   * A townsperson walking (their legs and arms swinging, on their own
   * limbs) towards `to`; true once there.
   * @param {Victim} v
   * @param {THREE.Vector3} to
   * @param {number} speed m/s
   * @param {number} rawDt
   * @returns {boolean}
   */
  function walkTo(v, to, speed, rawDt) {
    const p = v.person.mesh.position;
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    const limbs = v.person.motion.limbs;
    if (d < 0.15) {
      limbs.legL.rotation.x = limbs.legR.rotation.x = 0;
      limbs.armL.rotation.x = limbs.armR.rotation.x = 0;
      return true;
    }
    const step = Math.min(d, speed * rawDt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    v.person.mesh.rotation.y = Math.atan2(dx, dz);
    v.stride += step * 3.2;
    const swing = Math.sin(v.stride) * (speed > 3 ? 0.8 : 0.5);
    limbs.legL.rotation.x = swing;
    limbs.legR.rotation.x = -swing;
    limbs.armL.rotation.x = -swing * 0.8;
    limbs.armR.rotation.x = swing * 0.8;
    return false;
  }

  /**
   * The pose for this moment of the show.
   * @param {number} t seconds into it
   */
  function showPose(t) {
    restPose(t);
    if (!scene) return;
    const i = scene.next;
    if (i >= MOVES.length) return;
    const lt = t - moveAt(i);
    const m = MOVES[i];
    const winding = lt > -m.wind && lt < 0;
    const after = lt >= 0 && lt < 0.6;
    if (!winding && !after) return;
    // The side the one he hits stands: the right fist for the left one.
    const arm = i === 0 ? 0 : 1;
    if (winding) {
      setArm(arm, 0.5, -1.8);
      want.ty = (arm === 0 ? 1 : -1) * 0.7 * (1 + lt / m.wind);
    } else {
      setArm(arm, -1.55, -0.1);
      want.ty = (arm === 0 ? -1 : 1) * 0.45;
    }
  }

  /** @param {number} t */
  function restPose(t) {
    want.s0x = want.s1x = -0.1 + Math.sin(t * 2) * 0.04;
    want.e0x = want.e1x = -0.35;
    want.ty = 0;
    want.tx = 0.05;
    want.drop = 0;
    want.legs = 0;
  }

  /** @param {number} arm 0 or 1 @param {number} shoulder @param {number} elbow */
  function setArm(arm, shoulder, elbow) {
    if (arm === 0) { want.s0x = shoulder; want.e0x = elbow; } else { want.s1x = shoulder; want.e1x = elbow; }
  }

  /** @param {number} rawDt */
  function applyPose(rawDt) {
    if (!hank) return;
    const r = Math.min(1, rawDt * 16);
    for (const key of /** @type {(keyof typeof has)[]} */ (Object.keys(has))) has[key] += (want[key] - has[key]) * r;
    hank.shoulders[0].rotation.x = has.s0x;
    hank.shoulders[1].rotation.x = has.s1x;
    hank.elbows[0].rotation.x = has.e0x;
    hank.elbows[1].rotation.x = has.e1x;
    hank.torso.rotation.y = has.ty;
    hank.torso.rotation.x = has.tx;
    hank.torso.position.y = 1.45 + has.drop;
    hank.hips[0].rotation.x = has.legs;
    hank.hips[1].rotation.x = -has.legs;
  }

  /** @param {number} rawDt */
  function stepShow(rawDt) {
    if (!scene || !hank || !rockfall) return;
    scene.t += rawDt;
    const t = scene.t;
    const g = hank.group;
    // 1. The boulder falls, spinning, trailing dust.
    if (t < HANK.fall) {
      const k = t / HANK.fall;
      rockfall.boulder.position.set(scene.x, 90 - (90 - 1.9) * k * k, scene.z);
      rockfall.boulder.rotation.x += rawDt * 2.5;
      rockfall.boulder.rotation.z += rawDt * 1.7;
      if (Math.random() < 0.8) puff(scratch.copy(rockfall.boulder.position), 3, 1.5, 1);
      return;
    }
    if (!scene.landed) {
      scene.landed = true;
      impact();
    }
    // 2. Rising out of the crater.
    const rise = Math.min(1, (t - HANK.fall) / HANK.rise);
    g.position.y = -HANK.height * 1.1 * (1 - rise) * (1 - rise);
    if (title && t > HANK.fall + 2.4) title.classList.remove('visible');
    hank.magma.emissiveIntensity = Math.max(1 + Math.sin(t * 5) * 0.35, hank.magma.emissiveIntensity - rawDt * 6);

    // 3. The two walk up once he is standing, over about HANK.approach.
    const walkFrom = HANK.fall + HANK.rise;
    if (t > walkFrom) {
      for (const v of scene.victims) {
        if (v.state !== 'walking') continue;
        if (!v.person.mesh.parent) { v.state = 'gone'; continue; }
        const left = Math.max(0.4, walkFrom + HANK.approach - t);
        const d = Math.hypot(v.spot.x - v.person.mesh.position.x, v.spot.z - v.person.mesh.position.z);
        if (walkTo(v, v.spot, Math.min(8, Math.max(2.2, d / left)), rawDt)) {
          v.state = 'waiting';
          v.person.mesh.rotation.y = Math.atan2(g.position.x - v.person.mesh.position.x, g.position.z - v.person.mesh.position.z);
        }
      }
    }

    // 4. The punches: each lands once its time has come and the one it is
    // for has arrived (or has had a second longer to).
    showPose(t);
    if (scene.next < MOVES.length) {
      const i = scene.next;
      const m = MOVES[i];
      const v = scene.victims[i];
      const due = t >= moveAt(i) && (!v || v.state !== 'walking' || t >= moveAt(i) + 1);
      if (due) {
        scene.next++;
        hank.magma.emissiveIntensity = 6;
        callMove(m.name);
        ctx.systems.creatureSounds.play('hankGrunt', g.position, { size: 1.6, pitch: 0.75 + Math.random() * 0.1 });
        ctx.systems.gamefeel.addShake(0.7, 0.3);
        if (v && v.person.mesh.parent && (v.state === 'waiting' || v.state === 'walking')) {
          const p = v.person.mesh.position;
          ctx.systems.creatureSounds.play('punch', p, { size: 1.4 });
          ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x, 1.5, p.z), 0.35);
          // Away from him, past the side it stood on: across the frame.
          const away = Math.atan2(p.x - g.position.x, p.z - g.position.z);
          launch(v, m, away + (i === 0 ? -0.5 : 0.5));
        }
      }
    }
    applyPose(rawDt);
    if (t > showLength()) finish(true);
  }

  /**
   * The camera on him (after Hero Mode's camera, before the shake): from
   * the front, a little to one side, easing back to keep the newest flight
   * in frame.
   * @param {number} rawDt
   */
  function placeCamera(rawDt) {
    if (!scene || !hank) return;
    const cam = Sim.three.camera;
    const fx = Math.sin(scene.heading);
    const fz = Math.cos(scene.heading);
    let lx = scene.x;
    let ly = 2.2;
    let lz = scene.z;
    let dist = 9.5;
    if (scene.t < HANK.fall && rockfall) {
      ly = THREE.MathUtils.clamp(rockfall.boulder.position.y * 0.55, 3, 32);
      dist = 20;
    }
    // Following a flight: the look leans toward it and the lens backs off
    // and rises (never further back than the clear ground behind it).
    const flying = flyers.length ? flyers[flyers.length - 1] : null;
    if (flying && flying.state === 'flying') {
      const p = flying.person.mesh.position;
      lx += (p.x - lx) * 0.4;
      ly += (Math.min(p.y, 45) - ly) * 0.4;
      lz += (p.z - lz) * 0.4;
      dist = 9.5 + Math.min(55, flying.metres * 0.4 + p.y * 0.3);
    }
    const ease = Math.min(1, rawDt * 2.5);
    scene.look.x += (lx - scene.look.x) * ease;
    scene.look.y += (ly - scene.look.y) * ease;
    scene.look.z += (lz - scene.look.z) * ease;
    scene.camDist += (Math.min(dist, scene.camRoom) - scene.camDist) * Math.min(1, rawDt * 1.5);
    // In front of him (the way he faces), turned a touch to one side.
    const a = scene.heading + 0.28;
    // Anchored on where he stands (the line checked clear by clearRoom).
    cam.position.set(
      scene.x + Math.sin(a) * scene.camDist,
      Math.max(2.6, scene.look.y * 0.5 + 1.9 + scene.camDist * 0.1),
      scene.z + Math.cos(a) * scene.camDist
    );
    void fx;
    void fz;
    cam.lookAt(scene.look);
    Sim.three.controls.target.copy(scene.look);
  }

  // ---------------------------------------------------------------------
  // The fight
  // ---------------------------------------------------------------------

  /** Brought down: he crumbles (+score), and the low gravity follows. */
  function bossDown() {
    if (!boss || !hank) return;
    boss = null;
    rock.live = false;
    if (rock.mesh) rock.mesh.visible = false;
    ctx.systems.damage.addDamageScore(HANK.boss.score);
    ctx.events.emit('announce', { title: 'HANK GRANITE DOWN', sub: `The landslide is rubble · +${HANK.boss.score}` });
    ctx.systems.explosions.spawnImpactBurst(scratch.copy(hank.group.position).setY(2), 1.2);
    crumbling = 0;
  }

  /**
   * One frame of the fight, on the world's clock (Time Slow slows him).
   * @param {number} dt
   */
  function stepBoss(dt) {
    if (!boss || !hank || dt <= 0) return;
    const B = HANK.boss;
    const hero = ctx.systems.heroMode;
    const r = ctx.Hero && ctx.Hero.active && hero ? hero.rogerTarget() : null;
    if (!r) {
      // Roger gone (Hero Mode over): he goes too.
      boss = null;
      crumbling = 0;
      return;
    }
    const g = hank.group;
    const p = g.position;
    const dx = r.x - p.x;
    const dz = r.z - p.z;
    const dist = Math.hypot(dx, dz);
    const alt = hero.rogerHeight();
    boss.t += dt;
    boss.cooldown -= dt;
    boss.rockTimer -= dt;
    if (boss.flinch > 0) boss.flinch -= dt;
    restPose(boss.t);
    hank.magma.emissiveIntensity = Math.max(1 + Math.sin(boss.t * 4) * 0.3, hank.magma.emissiveIntensity - dt * 4);
    if (ctx.systems.enemies.getState(boss, 'frozen')) { applyPose(dt); return; }
    const face = Math.atan2(dx, dz);
    if (boss.state === 'stagger') {
      want.tx = 0.35;
      want.drop = -0.2;
      if (boss.t > B.stagger) { boss.state = 'walk'; boss.t = 0; }
    } else if (boss.state === 'wind') {
      // The wind-up: the right fist back, the magma flaring; dodge now.
      g.rotation.y = turnTo(g.rotation.y, face, 3 * dt);
      setArm(0, 0.6, -1.9);
      want.ty = 0.8;
      want.drop = -0.15;
      hank.magma.emissiveIntensity = 2 + boss.t * 8;
      if (boss.t >= B.windUp) {
        // The punch.
        callPunch();
        const inFront = Math.cos(face - g.rotation.y) > 0.5;
        if (dist <= B.hit && alt <= B.highAbove && inFront) {
          ctx.systems.health.damagePlayer({
            source: 'hankPunch', pierce: true, title: 'KNOCKED INTO ORBIT', sub: 'One punch from Hank Granite',
            position: { x: p.x, y: 1.6, z: p.z }
          });
        }
        boss.state = 'recover';
        boss.t = 0;
        boss.cooldown = B.recover;
      }
    } else if (boss.state === 'recover') {
      setArm(0, -1.55, -0.1);
      want.ty = -0.45;
      if (boss.t > 0.5) { boss.state = 'walk'; boss.t = 0; }
    } else if (boss.state === 'throw') {
      setArm(1, -2.6, -0.3);
      if (boss.t > 0.5) { boss.state = 'walk'; boss.t = 0; }
    } else {
      const choice = bossChoice({ dist, rogerAlt: alt, cooldown: boss.cooldown, rockTimer: boss.rockTimer });
      g.rotation.y = turnTo(g.rotation.y, face, 2.5 * dt);
      if (choice === 'punch') {
        boss.state = 'wind';
        boss.t = 0;
        ctx.systems.creatureSounds.play('hankGrunt', p, { size: 1.6, pitch: 0.7 });
      } else if (choice === 'rock') {
        throwRock(r.x, alt + 1.1, r.z);
        boss.rockTimer = B.rockEvery;
        boss.state = 'throw';
        boss.t = 0;
      } else if (choice === 'walk') {
        const step = B.speed * dt;
        const nx = p.x + (dx / (dist || 1)) * step;
        const nz = p.z + (dz / (dist || 1)) * step;
        if (!hero.standable || hero.standable(nx, nz)) {
          p.x = nx;
          p.z = nz;
        } else {
          p.x += (dz / (dist || 1)) * step;
          p.z -= (dx / (dist || 1)) * step;
        }
        boss.stride += step * 1.4;
        want.legs = Math.sin(boss.stride) * 0.5;
        want.s0x = -Math.sin(boss.stride) * 0.4;
        want.s1x = Math.sin(boss.stride) * 0.4;
        if (Math.floor((boss.stride - step * 1.4) / Math.PI) !== Math.floor(boss.stride / Math.PI)) {
          ctx.systems.creatureSounds.play('footstep', p, { size: 1.6 });
          ctx.systems.gamefeel.addShake(0.12, 0.12);
        }
        flingNear();
      }
    }
    if (boss.flinch > 0) want.tx -= boss.flinch * 1.2;
    applyPose(dt);
    stepRock(dt, r, alt);
  }

  /** @param {number} from @param {number} to @param {number} max @returns {number} */
  function turnTo(from, to, max) {
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + THREE.MathUtils.clamp(d, -max, max);
  }

  function callPunch() {
    if (!hank) return;
    hank.magma.emissiveIntensity = 6;
    ctx.systems.creatureSounds.play('punch', hank.group.position, { size: 1.8, pitch: 0.6 });
    ctx.systems.gamefeel.addShake(0.6, 0.25);
    hank.fists[0].getWorldPosition(scratch);
    puff(scratch, 30, 8, 2);
  }

  /** Anyone in his way while he walks is flung. */
  function flingNear() {
    if (!hank) return;
    const p = hank.group.position;
    for (const person of ctx.Environment.people) {
      if (!person.mesh.parent || person.captureState !== 'grounded' || person.heroName || !person.motion) continue;
      const q = person.mesh.position;
      if (Math.abs(q.x - p.x) > HANK.boss.flingRadius || Math.abs(q.z - p.z) > HANK.boss.flingRadius) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) > HANK.boss.flingRadius) continue;
      person.motion.active = false;
      /** @type {Victim} */
      const v = {
        person, state: 'waiting', vel: new THREE.Vector3(), spin: new THREE.Vector3(), from: new THREE.Vector3(),
        spot: new THREE.Vector3(), t: 0, metres: 0, stride: 0, label: null, record: false
      };
      ctx.systems.creatureSounds.play('punch', q, { size: 1.2 });
      launch(v, MOVES[0], Math.atan2(q.x - p.x, q.z - p.z));
    }
  }

  /**
   * A rock at Roger up high, led a little.
   * @param {number} x @param {number} y @param {number} z
   */
  function throwRock(x, y, z) {
    if (!hank || !rock.mesh) return;
    hank.fists[1].getWorldPosition(scratch);
    rock.mesh.position.copy(scratch);
    rock.mesh.scale.setScalar(1.1);
    rock.mesh.visible = true;
    const d = Math.hypot(x - scratch.x, z - scratch.z);
    const t = Math.max(0.4, d / HANK.boss.rockSpeed);
    // Up enough to arc onto him.
    rock.vel.set((x - scratch.x) / t, (y - scratch.y) / t + 0.5 * 14 * t, (z - scratch.z) / t);
    rock.t = 0;
    rock.live = true;
    ctx.systems.creatureSounds.play('hankGrunt', hank.group.position, { size: 1.4, pitch: 0.9 });
  }

  /**
   * @param {number} dt
   * @param {{x: number, z: number}} r
   * @param {number} alt
   */
  function stepRock(dt, r, alt) {
    if (!rock.live || !rock.mesh) return;
    rock.t += dt;
    rock.vel.y -= 14 * dt;
    rock.mesh.position.addScaledVector(rock.vel, dt);
    rock.mesh.rotation.x += dt * 6;
    rock.mesh.rotation.z += dt * 4;
    const m = rock.mesh.position;
    if (Math.hypot(m.x - r.x, m.y - (alt + 1), m.z - r.z) < 1.4) {
      ctx.systems.health.damagePlayer({
        source: 'hankRock', type: 'blast', title: 'STONED', sub: 'A rock from Hank Granite',
        position: { x: m.x, y: m.y, z: m.z }
      });
      endRock();
    } else if (m.y < 0.3 || rock.t > 5) {
      endRock();
    }
  }

  function endRock() {
    if (!rock.mesh) return;
    rock.live = false;
    puff(scratch.copy(rock.mesh.position).setY(Math.max(0.5, rock.mesh.position.y)), 30, 6, 2);
    ctx.systems.explosions.spawnImpactBurst(scratch, 0.5);
    rock.mesh.visible = false;
  }

  // ---------------------------------------------------------------------
  // The frame and the lifecycle
  // ---------------------------------------------------------------------

  /**
   * @param {number} dt simulation seconds
   * @param {number} rawDt real seconds: the show runs on real time
   */
  function updateActionHero(dt, rawDt) {
    if (dt > 0) stepLowGravity(dt);
    if (rawDt > 0) {
      stepDust(rawDt);
      stepFlyers(rawDt);
      stepChunks(rawDt);
      stepCrumble(rawDt);
      stepShow(rawDt);
    }
    if (boss) stepBoss(dt);
  }

  /** @returns {void} */
  function initActionHero() {
    hank = buildHank();
    hank.group.visible = false;
    Sim.three.scene.add(hank.group);
    rockfall = buildBoulder(hank.magma);
    rockfall.boulder.visible = false;
    Sim.three.scene.add(rockfall.boulder);
    chunkState = rockfall.chunks.map(() => ({ vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0 }));
    for (const c of rockfall.chunks) Sim.three.scene.add(c);
    // The last chunk is kept back as the rock he throws.
    rock.mesh = rockfall.chunks[rockfall.chunks.length - 1];
    // The rings where the thrown land.
    const ringGeo = new THREE.RingGeometry(1.4, 1.75, 40);
    ringGeo.rotateX(-Math.PI / 2);
    ownGeometries.push(ringGeo);
    markers = [];
    for (let i = 0; i < MARKERS; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide
      });
      ownMaterials.push(m);
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      Sim.three.scene.add(mesh);
      markers.push({ mesh, t: 1 });
    }
    dust = createParticlePool(Sim.three.scene, 900, createSoftDotTexture(), THREE.NormalBlending, 'hank_dust');
    ctx.systems.caps.trackPool(dust);
    bars = document.createElement('div');
    bars.className = 'cinema-bars';
    bars.innerHTML = '<i></i><i></i>';
    title = document.createElement('div');
    title.className = 'cinema-title hank-title';
    moveCall = document.createElement('div');
    moveCall.className = 'hank-move';
    labelBox = document.createElement('div');
    labelBox.className = 'hank-dists';
    labelPool = [];
    for (let i = 0; i < LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'hank-dist';
      el.innerHTML = '<b>0</b><i>m</i><em></em>';
      el.style.display = 'none';
      labelBox.appendChild(el);
      labelPool.push(el);
    }
    ctx.container.append(bars, title, moveCall, labelBox);
    const button = document.getElementById('btn-hank');
    button?.addEventListener('click', () => {
      if (start()) ctx.systems.camera.easeIntoMode();
    }, { signal: ctx.signal });

    // The fight: in the shared enemy register (engine/enemies.js), so every
    // weapon of Roger's finds him and takes the table's damage (R-054).
    kind = {
      kind: 'hank',
      list: () => (boss && hank ? [boss] : []),
      position: () => (hank ? hank.group.position : scratch),
      hitbox: () => ({ x: hank ? hank.group.position.x : 0, z: hank ? hank.group.position.z : 0, radius: 1.2, top: HANK.height }),
      // An EMP staggers him; the rest is the table's.
      accepts: ['emp'],
      damage: () => {
        if (boss) { boss.state = 'stagger'; boss.t = 0; }
        return false;
      },
      defeat: () => {
        bossDown();
        return true;
      },
      wounded: () => {
        if (!boss || !hank) return;
        boss.flinch = 0.2;
        hank.magma.emissiveIntensity = Math.max(hank.magma.emissiveIntensity, 3);
      },
      // The black hole takes him whole.
      consume: () => {
        boss = null;
        rock.live = false;
        if (rock.mesh) rock.mesh.visible = false;
        if (hank) hank.group.visible = false;
      },
      object: () => (hank ? hank.group : null),
      size: () => HANK.height
    };
    ctx.systems.enemies.registerKind(kind);
  }

  /** @returns {void} */
  function resetActionHero() {
    if (scene) finish();
    boss = null;
    crumbling = -1;
    rock.live = false;
    if (hank) hank.group.visible = false;
    for (const v of flyers) if (v.state !== 'gone') removeVictim(v);
    flyers = [];
    record = 0;
    lowGravityLeft = 0;
    ctx.systems.physics.gravity.scale = 1;
    for (const mk of markers) {
      mk.t = 1;
      mk.mesh.visible = false;
    }
    if (rockfall) for (const c of rockfall.chunks) c.visible = false;
    if (dust) {
      dust.life.fill(0);
      dust.colours.fill(0);
      dust.sizes.fill(0);
      markPoolDirty(dust);
    }
    dustAlive = false;
  }

  /** @returns {void} */
  function disposeActionHero() {
    if (scene) finish();
    boss = null;
    flyers = [];
    if (hank) {
      hank.group.removeFromParent();
      for (const g of hank.geometries) g.dispose();
      for (const m of hank.materials) m.dispose();
    }
    hank = null;
    if (rockfall) {
      rockfall.boulder.removeFromParent();
      for (const c of rockfall.chunks) c.removeFromParent();
      for (const g of rockfall.geometries) g.dispose();
      for (const m of rockfall.materials) m.dispose();
    }
    rockfall = null;
    rock.mesh = null;
    for (const mk of markers) mk.mesh.removeFromParent();
    markers = [];
    for (const g of ownGeometries) g.dispose();
    for (const m of ownMaterials) m.dispose();
    ownGeometries.length = ownMaterials.length = 0;
    if (dust) disposeParticlePool(Sim.three.scene, dust);
    dust = null;
    for (const el of [bars, title, moveCall, labelBox]) el?.remove();
    bars = title = moveCall = labelBox = null;
    labelPool = [];
  }

  /**
   * The co-op guest's Hank (net/system.js): his own model, built for the guest
   * to clone, with the joints and the material his pose moves. Nothing is
   * added to the scene and no state is touched; the geometry and materials
   * are the guest's to release.
   * @returns {{root: THREE.Object3D, joints: Record<string, THREE.Object3D>, magma: THREE.MeshStandardMaterial, stride: number, speed: number, geometries: THREE.BufferGeometry[], materials: THREE.Material[]}}
   */
  function buildGuestModel() {
    const h = buildHank();
    return {
      root: h.group,
      joints: { torso: h.torso, hip0: h.hips[0], hip1: h.hips[1], sh0: h.shoulders[0], sh1: h.shoulders[1], el0: h.elbows[0], el1: h.elbows[1] },
      magma: h.magma, stride: 1.4, speed: HANK.boss.speed, geometries: h.geometries, materials: h.materials
    };
  }

  /**
   * What the guest needs to draw him (a `figures` row, net/figurePose.js), or
   * null while he is not on the field. Read-only.
   * @returns {{x: number, y: number, z: number, heading: number, state: number, a: number, b: number}|null}
   */
  function replicaState() {
    if (!hank || !hank.group.visible) return null;
    const g = hank.group;
    const out = { x: g.position.x, y: g.position.y, z: g.position.z, heading: g.rotation.y, state: HANK_STATE.standing, a: 0, b: 0 };
    if (crumbling >= 0) {
      out.state = HANK_STATE.crumble;
      out.a = Math.min(1, crumbling / HANK.outro);
    } else if (boss) {
      if (boss.state === 'wind') { out.state = HANK_STATE.wind; out.a = Math.min(1, boss.t / HANK.boss.windUp); }
      else if (boss.state === 'recover') out.state = HANK_STATE.after;
      else if (boss.state === 'throw') out.state = HANK_STATE.throw;
      else if (boss.state === 'stagger') out.state = HANK_STATE.stagger;
    } else if (scene && scene.landed) {
      // The show: the punch for the next one, winding up and just after.
      const i = scene.next;
      if (i < MOVES.length) {
        const lt = scene.t - moveAt(i);
        const wind = MOVES[i].wind;
        out.b = i === 0 ? 0 : 1;
        if (lt > -wind && lt < 0) { out.state = HANK_STATE.wind; out.a = 1 + lt / wind; }
        else if (lt >= 0 && lt < 0.6) out.state = HANK_STATE.after;
      }
    } else if (!scene) return null;
    return out;
  }

  return { start, active: () => !!scene, placeCamera, initActionHero, updateActionHero, resetActionHero, disposeActionHero, buildGuestModel, replicaState };
}
