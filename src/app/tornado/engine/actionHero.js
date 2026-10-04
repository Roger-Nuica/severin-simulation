// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { HANK, MOVES, moveAt, showLength, isRecord, throwScore } from './hank/moves.js';
import { buildHank, buildBoulder } from './hank/model.js';

/**
 * ===========================================================================
 * SECTION AH — Hank Granite, the Human Landslide (on his button only)
 * ===========================================================================
 * An original character on the unstoppable-action-hero archetype, now
 * literally a force of nature: a 3.2 m man of quarried granite held
 * together by magma, who kept his red bandana and dark glasses (redesigned
 * 2026-10-04, on request; R-040).
 *
 * The show (about 13.5 s, hank/moves.js), on real time while the world
 * slows to HANK.slowmo, the camera on him with black bars:
 *  1. A boulder drops out of the sky trailing dust and slams into the
 *     street: a shock ring of dust, the camera shakes. Magma glows through
 *     its cracks, it bursts into chunks and Hank rises out of the crater.
 *     HANK GRANITE · THE HUMAN LANDSLIDE.
 *  2. Five townspeople are drawn in front of him. Five moves, one each, the
 *     move's name slammed on screen as it lands, his magma flaring:
 *     JAB, HAYMAKER, UPPERCUT (straight up into the sky), HAMMER THROW (he
 *     grabs one and spins round once, like a hammer thrower, and lets go)
 *     and GROUND POUND (both fists into the street, a ring of rock spikes
 *     bursts up round him).
 *  3. Every one thrown flies in a tall arc with a live distance over it,
 *     counting up like a home run on TV; where they land a ring marks the
 *     spot with the final distance, and the longest of the run is a NEW
 *     RECORD. Each throw scores HANK.perVictim plus HANK.perMetre a metre.
 *     The camera eases back to keep the newest flight in frame.
 *  4. He crumbles into a pile of rubble that sinks into the street; the
 *     camera and the world's time are given back, and then the town has not
 *     quite got over him: moon gravity, the parked cars round him floating.
 *
 * Only from his button (👊 Hank Granite). Not while Hero Mode is dead, the
 * landing cutscene or a replay has the camera. No lights added; one dust
 * pool; the townspeople thrown are taken out of the town when they land.
 */

const MARKERS = 6;
const LABELS = 6;

/**
 * @typedef {Object} Victim
 * @property {any} person
 * @property {'waiting'|'held'|'flying'|'landed'|'gone'} state
 * @property {THREE.Vector3} vel
 * @property {THREE.Vector3} spin
 * @property {THREE.Vector3} from where it was thrown from
 * @property {number} t seconds in its current state
 * @property {number} metres
 * @property {HTMLElement|null} label
 * @property {boolean} record
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
 *   disposeActionHero: () => void
 * }}
 */
export function createActionHeroSystem(ctx) {
  const { Sim } = ctx;
  /** @type {{t: number, x: number, z: number, heading: number, victims: Victim[], next: number, landed: boolean, best: number,
   *   saved: {pos: THREE.Vector3, target: THREE.Vector3, controls: boolean}, look: THREE.Vector3, camDist: number}|null} */
  let scene = null;
  /** @type {ReturnType<typeof buildHank>|null} */
  let hank = null;
  /** @type {ReturnType<typeof buildBoulder>|null} */
  let rockfall = null;
  /** @type {{vel: THREE.Vector3, spin: THREE.Vector3, t: number}[]} */
  let chunkState = [];
  /** @type {THREE.Mesh[]} */
  let spikes = [];
  let spikeT = -1;
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
  /** @type {THREE.Material[]} */
  const ownMaterials = [];
  /** @type {THREE.BufferGeometry[]} */
  const ownGeometries = [];
  const scratch = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const proj = new THREE.Vector3();
  // The pose he is easing towards, and the one he has.
  const want = { s0x: 0, s1x: 0, e0x: 0, e1x: 0, ty: 0, tx: 0, drop: 0 };
  const has = { s0x: 0, s1x: 0, e0x: 0, e1x: 0, ty: 0, tx: 0, drop: 0 };

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
    if (scene || !hank || !rockfall) return false;
    const cam = Sim.three.camera;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    const target = roger ? new THREE.Vector3(roger.x + 16, 0, roger.z + 16) : Sim.three.controls.target.clone().setY(0);
    const people = ctx.Environment.people
      .filter((/** @type {any} */ p) => p.mesh.parent && p.captureState === 'grounded' && !p.heroName && !p.abducted && !p.statue && p.motion)
      .sort((/** @type {any} */ a, /** @type {any} */ b) => a.mesh.position.distanceToSquared(target) - b.mesh.position.distanceToSquared(target))
      .slice(0, MOVES.length);
    if (people.length < 2) return false;
    // He faces across the camera's view, so the throws fly across the frame.
    const toCam = Math.atan2(cam.position.x - target.x, cam.position.z - target.z);
    const heading = toCam + Math.PI / 2;
    scene = {
      t: 0, x: target.x, z: target.z, heading, next: 0, landed: false, best: 0,
      victims: people.map((/** @type {any} */ person) => ({
        person, state: /** @type {'waiting'} */ ('waiting'), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
        from: new THREE.Vector3(), t: 0, metres: 0, label: null, record: false
      })),
      saved: { pos: cam.position.clone(), target: Sim.three.controls.target.clone(), controls: Sim.three.controls.enabled },
      look: new THREE.Vector3(target.x, 6, target.z),
      camDist: 20
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
   * The show over: the camera and the world's time back.
   * @param {boolean} [ended] played to its end (not cut short): then the low gravity
   */
  function finish(ended = false) {
    if (!scene) return;
    if (ended && hank) {
      startLowGravity(hank.group.position);
      ctx.systems.creatureSounds.play('poof', hank.group.position, { size: 1.6 });
      const thrown = scene.victims.filter((v) => v.state !== 'waiting').length;
      ctx.events.emit('announce', {
        title: 'HANK GRANITE',
        sub: `${thrown} thrown · the longest ${Math.round(Math.max(scene.best, 0))} m${scene.best >= record && scene.best > 0 ? ' · a new record' : ''}`
      });
    }
    ctx.systems.time.release('actionHero');
    Sim.three.camera.position.copy(scene.saved.pos);
    Sim.three.controls.target.copy(scene.saved.target);
    Sim.three.controls.enabled = scene.saved.controls;
    for (const v of scene.victims) {
      if (v.state === 'waiting') v.person.motion.active = true;
      if (v.state === 'held') launch(v, 2);
    }
    scene = null;
    if (hank) {
      hank.group.visible = false;
      hank.magma.emissiveIntensity = 1.2;
    }
    if (rockfall) rockfall.boulder.visible = false;
    bars?.classList.remove('visible');
    title?.classList.remove('visible');
    moveCall?.classList.remove('visible');
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
   * @param {number} m which move threw it
   */
  function launch(v, m) {
    if (!hank || !v.person.mesh.parent) return;
    const move = MOVES[m];
    const p = v.person.mesh.position;
    const heading = hank.group.rotation.y + (Math.random() - 0.5) * 0.25;
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
    // The ring where it landed.
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
      if (v.state === 'held' || v.state === 'gone') continue;
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
      // The label over it, on screen.
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
      if (!c.visible) return;
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

  /** @param {number} rawDt */
  function stepSpikes(rawDt) {
    if (spikeT < 0) return;
    spikeT += rawDt;
    const up = spikeT < 0.14 ? spikeT / 0.14 : spikeT < 1.1 ? 1 : Math.max(0, 1 - (spikeT - 1.1) / 0.7);
    for (const s of spikes) s.position.y = -2.6 + up * 2.6 * (s.userData.h || 1);
    if (spikeT > 1.9) {
      spikeT = -1;
      for (const s of spikes) s.visible = false;
    }
  }

  /** The ground pound's ring of rock spikes, round where he stands. */
  function raiseSpikes() {
    if (!scene || !hank) return;
    const c = hank.group.position;
    spikes.forEach((s, i) => {
      const a = (i / spikes.length) * Math.PI * 2;
      const r = HANK.spikeRing * (0.85 + (i % 2) * 0.35);
      s.position.set(c.x + Math.cos(a) * r, -2.6, c.z + Math.sin(a) * r);
      s.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 3, (Math.random() - 0.5) * 0.5);
      s.userData.h = 0.8 + Math.random() * 0.5;
      s.visible = true;
    });
    spikeT = 0;
    puff(scratch.set(c.x, 0.3, c.z), 160, 18, 2, 1);
  }

  /**
   * The pose for this moment of the show.
   * @param {number} t seconds into it
   */
  function choosePose(t) {
    // Standing: arms a little out, breathing.
    want.s0x = want.s1x = -0.1 + Math.sin(t * 2) * 0.04;
    want.e0x = want.e1x = -0.35;
    want.ty = 0;
    want.tx = 0.05;
    want.drop = 0;
    if (!scene) return;
    const i = scene.next;
    if (i >= MOVES.length) return;
    const lt = t - moveAt(i);
    const m = MOVES[i];
    const winding = lt > -m.wind && lt < 0;
    const after = lt >= 0 && lt < 0.6;
    if (!winding && !after) return;
    const k = winding ? 1 + lt / m.wind : 0;
    if (m.name === 'JAB') {
      if (winding) { want.s0x = 0.4; want.e0x = -1.7; want.ty = 0.25; }
      else { want.s0x = -1.55; want.e0x = 0; want.ty = -0.15; }
    } else if (m.name === 'HAYMAKER') {
      if (winding) { want.ty = 0.8 * k; want.s0x = -1.1; want.e0x = -0.6; }
      else { want.ty = -0.6; want.s0x = -1.5; want.e0x = -0.25; }
    } else if (m.name === 'UPPERCUT') {
      if (winding) { want.drop = -0.35 * k; want.tx = 0.3 * k; want.s0x = 0.5; want.e0x = -1.9; }
      else { want.drop = 0.12; want.tx = -0.15; want.s0x = -2.9; want.e0x = -0.4; }
    } else if (m.name === 'HAMMER THROW') {
      want.s0x = want.s1x = -1.45;
      want.e0x = want.e1x = -0.1;
      want.tx = -0.1;
    } else if (m.name === 'GROUND POUND') {
      if (winding) { want.s0x = want.s1x = -3.0; want.e0x = want.e1x = -0.6; want.tx = -0.2; }
      else { want.s0x = want.s1x = -0.7; want.e0x = want.e1x = -0.2; want.tx = 0.5; want.drop = -0.4; }
    }
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
  }

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
      stepSpikes(rawDt);
    }
    if (!scene || !hank || !rockfall || rawDt <= 0) return;
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
    // His rage: the magma breathing, flaring on every blow.
    hank.magma.emissiveIntensity = Math.max(1 + Math.sin(t * 5) * 0.35, hank.magma.emissiveIntensity - rawDt * 6);

    // The ones still waiting, drawn into an arc in front of him.
    const fx = Math.sin(scene.heading);
    const fz = Math.cos(scene.heading);
    scene.victims.forEach((v, i) => {
      if (v.state !== 'waiting' || !v.person.mesh.parent) return;
      const turn = i === scene.next;
      const off = turn ? 0 : (i - scene.next) * 1.4 * (i % 2 ? 1 : -1);
      const ahead = turn ? 2.1 : 3.4;
      const tx = g.position.x + fx * ahead + fz * off;
      const tz = g.position.z + fz * ahead - fx * off;
      const p = v.person.mesh.position;
      p.x += (tx - p.x) * Math.min(1, rawDt * 3);
      p.z += (tz - p.z) * Math.min(1, rawDt * 3);
      v.person.mesh.rotation.y = scene.heading + Math.PI;
    });

    // 3. The moves.
    choosePose(t);
    if (scene.next < MOVES.length) {
      const i = scene.next;
      const m = MOVES[i];
      const at = moveAt(i);
      const v = scene.victims[i];
      // The hammer throw: he takes hold and spins round once with it.
      if (m.name === 'HAMMER THROW' && v && t > at - m.wind && t < at) {
        if (v.state === 'waiting') v.state = 'held';
        const k = (t - (at - m.wind)) / m.wind;
        g.rotation.y = scene.heading + k * k * Math.PI * 2;
        hank.fists[0].getWorldPosition(scratch);
        v2.copy(scratch).sub(g.position).setY(0).normalize();
        const p = v.person.mesh.position;
        p.set(scratch.x + v2.x * 1.1, 1.6 + k * 0.6, scratch.z + v2.z * 1.1);
        v.person.mesh.rotation.set(Math.PI / 2 * k, g.rotation.y, 0);
      }
      if (t >= at) {
        g.rotation.y = scene.heading;
        scene.next++;
        hank.magma.emissiveIntensity = 6;
        callMove(m.name);
        ctx.systems.creatureSounds.play('hankGrunt', g.position, { size: 1.6, pitch: 0.75 + Math.random() * 0.1 });
        ctx.systems.gamefeel.addShake(m.name === 'GROUND POUND' ? 1.2 : 0.6, 0.3);
        if (m.name === 'GROUND POUND') {
          raiseSpikes();
          ctx.systems.creatureSounds.play('punch', g.position, { size: 2, pitch: 0.45 });
          // Whoever is still standing in front of him goes too.
          for (const w of scene.victims) if (w.state === 'waiting' || w.state === 'held') launch(w, i);
        } else if (v && (v.state === 'waiting' || v.state === 'held')) {
          const p = v.person.mesh.position;
          ctx.systems.creatureSounds.play('punch', p, { size: 1.4 });
          ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x, 1.5, p.z), 0.35);
          launch(v, i);
        }
      }
    }
    applyPose(rawDt);

    // 4. The bow, then he crumbles into the street.
    const end = showLength();
    if (t > end - HANK.outro) {
      const k = (t - (end - HANK.outro)) / HANK.outro;
      if (k > 0.35) {
        g.position.y = -HANK.height * 1.15 * ((k - 0.35) / 0.65) ** 2;
        if (Math.random() < 0.5) puff(scratch.set(g.position.x, 0.4, g.position.z), 6, 5, 2, 1);
      }
      hank.magma.emissiveIntensity = Math.max(0.2, 1.2 * (1 - k));
    }
    if (t > end) finish(true);
  }

  /**
   * The camera on him (after Hero Mode's camera, before the shake): side
   * on, easing back and along to keep the newest flight in frame.
   * @param {number} rawDt
   */
  function placeCamera(rawDt) {
    if (!scene || !hank) return;
    const cam = Sim.three.camera;
    const fx = Math.sin(scene.heading);
    const fz = Math.cos(scene.heading);
    const base = hank.group.position;
    // What to look at: the falling boulder; him, close; or between him and
    // the newest one in the air, further back as it goes.
    let lx = scene.x + fx * 1.5;
    let ly = 2.2;
    let lz = scene.z + fz * 1.5;
    let dist = 9.5;
    if (scene.t < HANK.fall && rockfall) {
      ly = THREE.MathUtils.clamp(rockfall.boulder.position.y * 0.55, 3, 32);
      dist = 20;
    }
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
    scene.camDist += (dist - scene.camDist) * Math.min(1, rawDt * 1.5);
    // Side on: off his right hand, a little behind.
    cam.position.set(
      scene.look.x + fz * scene.camDist - fx * scene.camDist * 0.15,
      Math.max(3.4, scene.look.y * 0.5 + 2.4 + scene.camDist * 0.12),
      scene.look.z - fx * scene.camDist - fz * scene.camDist * 0.15
    );
    void base;
    cam.lookAt(scene.look);
    Sim.three.controls.target.copy(scene.look);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

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
    // The ground pound's spikes: faceted stone cones.
    const spikeGeo = new THREE.ConeGeometry(0.55, 2.6, 5);
    spikeGeo.translate(0, 1.3, 0);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x77716a, roughness: 0.95, flatShading: true });
    ownGeometries.push(spikeGeo);
    ownMaterials.push(spikeMat);
    spikes = [];
    for (let i = 0; i < HANK.spikes; i++) {
      const s = new THREE.Mesh(spikeGeo, spikeMat);
      s.castShadow = true;
      s.visible = false;
      Sim.three.scene.add(s);
      spikes.push(s);
    }
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
    // Straight on the game's container: they cover the whole view.
    ctx.container.append(bars, title, moveCall, labelBox);
    const button = document.getElementById('btn-hank');
    button?.addEventListener('click', () => {
      if (start()) ctx.systems.camera.easeIntoMode();
    }, { signal: ctx.signal });
  }

  /** @returns {void} */
  function resetActionHero() {
    if (scene) finish();
    for (const v of flyers) if (v.state !== 'gone') removeVictim(v);
    flyers = [];
    record = 0;
    lowGravityLeft = 0;
    ctx.systems.physics.gravity.scale = 1;
    spikeT = -1;
    for (const s of spikes) s.visible = false;
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
    for (const s of spikes) s.removeFromParent();
    spikes = [];
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

  return { start, active: () => !!scene, placeCamera, initActionHero, updateActionHero, resetActionHero, disposeActionHero };
}
