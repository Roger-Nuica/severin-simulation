// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { CHARACTERS } from './scale.js';

/**
 * ===========================================================================
 * SECTION AH — Hank Granite (a cinematic event, on his button only)
 * ===========================================================================
 * An original character, on the unstoppable-action-hero archetype (not a
 * portrait of anyone real): a broad bearded man in a red bandana, dark
 * glasses, a black vest over a grey shirt and faded jeans, walking out of
 * nowhere into the middle of the town.
 *
 * The scene (about 14 s, AH.walk + 5 x AH.punchEvery + AH.outro):
 *  - The camera locks on him (placeCamera, a camera writer after Hero
 *    Mode's), black bars top and bottom; the world slows to AH.slowmo
 *    through its time group (engine/time.js) while the player keeps
 *    control -- as agreed with Roger.
 *  - He walks towards the camera. Five townspeople are drawn into a line
 *    in front of him, facing him.
 *  - One punch every AH.punchEvery seconds, a different ending each time:
 *    one of the five is blown apart into a cloud of particles; the others
 *    are thrown like rag dolls, tumbling, at enormous speed off the edge of
 *    the map, and gone.
 *  - He nods at the camera and is gone in a puff of dust; the camera and
 *    the world's time are given back.
 *
 * Only from his button (👊 Hank Granite). He used to turn up by himself
 * once a run, 70-200 s in, which read as a scripted event coming out of
 * nowhere (often while the black hole was open): that is gone, on request
 * (2026-10-01). Not while Hero Mode is dead, the landing cutscene or a
 * replay has the camera.
 */

export const AH = {
  walk: 3,                   // seconds walking in
  punchEvery: 2,
  outro: 2,
  victims: 5,
  slowmo: 0.35,              // the world's time while the scene runs
  throwSpeed: 90,            // m/s: off the map
  // Life-size (engine/scale.js): Hank 2.2 m, his five townspeople 1.8 m.
  lineGap: 1.1,              // metres between the five
  lineAhead: 1.7,            // how far in front of him they stand
  cameraDistance: 7.5,       // side on, at a 2.2 m man's distance
  cameraHeight: 2.2,
  dustMax: 500,
  // Afterwards, the world has not quite recovered: moon gravity for a few
  // seconds (physics.js gravity.scale), and the parked cars round him hop
  // off the ground to float in it. Eased back to normal over its last third.
  lowGravity: { scale: 0.3, seconds: 10, reach: 45, hop: [4, 7] }
};

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
  /**
   * @typedef {Object} Victim
   * @property {SimObject} person
   * @property {'waiting'|'flying'|'gone'} state
   * @property {THREE.Vector3} vel
   * @property {THREE.Vector3} spin
   * @property {number} t
   */
  /** @type {{t: number, x: number, z: number, heading: number, victims: Victim[], punched: number, saved: {pos: THREE.Vector3, target: THREE.Vector3, controls: boolean}}|null} */
  let scene = null;
  /** @type {THREE.Group|null} */
  let hank = null;
  /** @type {THREE.Object3D|null} */
  let armR = null;
  /** @type {THREE.Object3D|null} */
  let armL = null;
  /** @type {THREE.Object3D[]} */
  let legs = [];
  /** @type {HTMLDivElement|null} */
  let bars = null;
  /** @type {HTMLDivElement|null} */
  let title = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let dust = null;
  let dustAlive = false;
  // Seconds of low gravity left after the scene (AH.lowGravity).
  let lowGravityLeft = 0;
  /** @type {THREE.Material[]} */
  const materials = [];
  const scratch = new THREE.Vector3();

  /**
   * The man himself, in his own local frame (facing +z).
   * @returns {THREE.Group}
   */
  function build() {
    /**
     * @param {number} c
     * @param {number} [rough]
     * @returns {THREE.MeshStandardMaterial}
     */
    const mat = (c, rough = 0.8) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough });
      materials.push(m);
      return m;
    };
    const skin = mat(0xc99a78);
    const beard = mat(0x5a3b24, 1);
    const shirt = mat(0x6d7178);
    const vest = mat(0x1c1c1e, 0.5);
    const jeans = mat(0x3f5f86);
    const boots = mat(0x3a2718, 0.6);
    const bandana = mat(0xb3261e);
    const glasses = mat(0x0a0a0a, 0.1);
    const g = new THREE.Group();
    g.name = 'hank_granite';
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
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.9, 0.95, 0.5), shirt, g, [0, 1.55, 0]);
    add(new THREE.BoxGeometry(0.95, 0.9, 0.52), vest, g, [0, 1.57, -0.01]).scale.set(1, 1, 1);
    add(new THREE.BoxGeometry(0.8, 0.2, 0.46), mat(0x2b1d12), g, [0, 1.05, 0]); // belt
    add(new THREE.SphereGeometry(0.26, 14, 10), skin, g, [0, 2.3, 0]);
    add(new THREE.SphereGeometry(0.24, 12, 8), beard, g, [0, 2.18, 0.08]).scale.set(1, 0.9, 0.8);
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 14), bandana, g, [0, 2.46, 0]);
    add(new THREE.BoxGeometry(0.34, 0.07, 0.05), glasses, g, [0, 2.33, 0.25]);
    legs = [-0.2, 0.2].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.05, 0);
      g.add(pivot);
      add(new THREE.CylinderGeometry(0.15, 0.13, 0.95, 8), jeans, pivot, [0, -0.5, 0]);
      add(new THREE.BoxGeometry(0.24, 0.16, 0.38), boots, pivot, [0, -1, 0.06]);
      return pivot;
    });
    const arm = (/** @type {number} */ x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.95, 0);
      g.add(pivot);
      add(new THREE.CylinderGeometry(0.12, 0.11, 0.8, 8), skin, pivot, [0, -0.4, 0]);
      add(new THREE.SphereGeometry(0.13, 8, 6), skin, pivot, [0, -0.85, 0]);
      return pivot;
    };
    armL = arm(-0.58);
    armR = arm(0.58);
    // Built with his head's top at 2.56 m; scaled to his height in
    // engine/scale.js CHARACTERS (larger than life, but a man).
    g.scale.setScalar(CHARACTERS.hank.height / 2.56);
    return g;
  }

  /**
   * @param {THREE.Vector3} at
   * @param {number} n
   * @param {boolean} blast outward and bright (the one blown apart), or dust
   * @returns {void}
   */
  function puff(at, n, blast) {
    if (!dust) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = dust.next;
      dust.next = (dust.next + 1) % dust.life.length;
      const life = blast ? 0.8 + Math.random() * 0.6 : 1 + Math.random();
      dust.life[i] = life;
      dust.maxLife[i] = life;
      dust.seed[i] = blast ? -1 : Math.random();
      dust.positions.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const s = blast ? 6 + Math.random() * 10 : 1 + Math.random() * 2;
      dust.velocities.set([Math.cos(a) * s, (Math.random() * 0.8 + 0.2) * s, Math.sin(a) * s], i * 3);
    }
    if (count > 0) dustAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepDust(dt) {
    if (!dust || !dustAlive) return;
    dust.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < dust.life.length; i++) {
      if (dust.life[i] <= 0) {
        if (dust.sizes[i] !== 0) { dust.colours[i * 4 + 3] = 0; dust.sizes[i] = 0; }
        continue;
      }
      any = true;
      dust.life[i] -= dt;
      const t = 1 - Math.max(0, dust.life[i]) / dust.maxLife[i];
      const v = i * 3;
      dust.positions[v] += dust.velocities[v] * dt;
      dust.positions[v + 1] += dust.velocities[v + 1] * dt;
      dust.positions[v + 2] += dust.velocities[v + 2] * dt;
      if (dust.seed[i] < 0) {
        dust.colours.set([1.6, 1.3, 1, (1 - t)], i * 4);
        dust.sizes[i] = 0.5 + t;
      } else {
        dust.colours.set([0.62, 0.56, 0.48, 0.6 * (1 - t)], i * 4);
        dust.sizes[i] = 1 + t * 3;
      }
    }
    markPoolDirty(dust);
    dustAlive = any;
  }

  /**
   * The scene starts: where, whom, and the camera taken.
   * @returns {boolean}
   */
  function start() {
    if (scene || !hank) return false;
    const cam = Sim.three.camera;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    // Somewhere on the ground the player is looking at (or beside Roger).
    const target = roger ? new THREE.Vector3(roger.x + 14, 0, roger.z + 14) : Sim.three.controls.target.clone().setY(0);
    const people = ctx.Environment.people
      .filter((/** @type {any} */ p) => p.mesh.parent && p.captureState === 'grounded' && !p.heroName && !p.abducted && !p.statue && p.motion)
      .sort((a, b) => a.mesh.position.distanceToSquared(target) - b.mesh.position.distanceToSquared(target))
      .slice(0, AH.victims);
    if (people.length < 2) return false;
    const heading = Math.atan2(cam.position.x - target.x, cam.position.z - target.z);
    scene = {
      t: 0, x: target.x - Math.sin(heading) * 10, z: target.z - Math.cos(heading) * 10, heading, punched: 0,
      victims: people.map(person => ({ person, state: 'waiting', vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0 })),
      saved: { pos: cam.position.clone(), target: Sim.three.controls.target.clone(), controls: Sim.three.controls.enabled }
    };
    // His entrance: "dun, dun" (sound/creatures.js).
    ctx.systems.creatureSounds.play('hankArrive', { x: scene.x, y: 1.5, z: scene.z }, { size: 1.5 });
    for (const v of scene.victims) {
      const m = /** @type {any} */ (v.person).motion;
      m.active = false;
    }
    hank.position.set(scene.x, 0, scene.z);
    hank.rotation.y = heading;
    hank.visible = true;
    puff(hank.position.clone().setY(1), 60, false);
    ctx.systems.time.hold('actionHero', 'world', AH.slowmo);
    Sim.three.controls.enabled = false;
    if (bars) bars.classList.add('visible');
    if (title) {
      title.textContent = 'HANK GRANITE';
      title.classList.add('visible');
    }
    ctx.events.emit('announce', { title: 'HANK GRANITE', sub: 'He does not walk into town. The town walks into him.' });
    return true;
  }

  /**
   * The scene over: the camera and the world's time back.
   * @param {boolean} [ended] whether it played to its end (not cut short by a
   *   Reset or the page closing): only then does the low gravity follow
   * @returns {void}
   */
  function finish(ended = false) {
    if (!scene) return;
    if (ended && hank) {
      startLowGravity(hank.position);
      // Gone in a puff of dust.
      ctx.systems.creatureSounds.play('poof', hank.position, { size: 1.2 });
    }
    ctx.systems.time.release('actionHero');
    Sim.three.camera.position.copy(scene.saved.pos);
    Sim.three.controls.target.copy(scene.saved.target);
    Sim.three.controls.enabled = scene.saved.controls;
    for (const v of scene.victims) {
      if (v.state === 'waiting') /** @type {any} */ (v.person).motion.active = true;
    }
    scene = null;
    if (hank) {
      puff(hank.position.clone().setY(1), 80, false);
      hank.visible = false;
    }
    if (bars) bars.classList.remove('visible');
    if (title) title.classList.remove('visible');
  }

  /**
   * Moon gravity for AH.lowGravity.seconds, and every parked car within
   * reach of where he stood hops off the ground to float in it.
   * @param {THREE.Vector3} at where Hank was
   * @returns {void}
   */
  function startLowGravity(at) {
    const LG = AH.lowGravity;
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

  /**
   * The low gravity running out, eased back over its last third.
   * @param {number} dt
   * @returns {void}
   */
  function stepLowGravity(dt) {
    if (lowGravityLeft <= 0) return;
    lowGravityLeft = Math.max(0, lowGravityLeft - dt);
    const LG = AH.lowGravity;
    const ease = Math.min(1, lowGravityLeft / (LG.seconds / 3));
    ctx.systems.physics.gravity.scale = 1 - (1 - LG.scale) * ease;
  }

  /**
   * @param {Victim} v
   * @returns {void}
   */
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
  }

  /**
   * The next punch, and its ending.
   * @returns {void}
   */
  function punch() {
    if (!scene || !hank) return;
    const v = scene.victims[scene.punched];
    scene.punched++;
    if (!v || !v.person.mesh.parent) return;
    const p = v.person.mesh.position;
    // His "hah!" and the blow landing.
    ctx.systems.creatureSounds.play('hankGrunt', hank.position, { size: 1.2, pitch: 0.95 + Math.random() * 0.1 });
    ctx.systems.creatureSounds.play('punch', p, { size: 1.2 });
    ctx.systems.gamefeel.addShake(0.6, 0.25);
    ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x, 1.4, p.z), 0.3);
    ctx.systems.damage.addDamageScore(500);
    // One of the five (the third) is blown apart; the rest fly.
    if (scene.punched === 3) {
      puff(scratch.set(p.x, 1.2, p.z), 160, true);
      removeVictim(v);
      return;
    }
    const away = Math.atan2(p.x - hank.position.x, p.z - hank.position.z) + (Math.random() - 0.5) * 0.6;
    v.state = 'flying';
    v.t = 0;
    v.vel.set(Math.sin(away) * AH.throwSpeed, AH.throwSpeed * 0.35, Math.cos(away) * AH.throwSpeed);
    v.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
  }

  /** @returns {void} */
  function initActionHero() {
    hank = build();
    hank.visible = false;
    Sim.three.scene.add(hank);
    dust = createParticlePool(Sim.three.scene, AH.dustMax, createSoftDotTexture(), THREE.NormalBlending, 'hank_dust');
    ctx.systems.caps.trackPool(dust);
    bars = document.createElement('div');
    bars.className = 'cinema-bars';
    bars.innerHTML = '<i></i><i></i>';
    title = document.createElement('div');
    title.className = 'cinema-title';
    // Straight on the game's container, not the banner host: they cover the
    // whole view, and the host is a narrow column for pop-ups.
    ctx.container.appendChild(bars);
    ctx.container.appendChild(title);
    const button = document.getElementById('btn-hank');
    if (button) {
      button.addEventListener('click', () => {
        // Called in from the panel: the scene's own framing, glided into
        // rather than cut to.
        if (start()) ctx.systems.camera.easeIntoMode();
      }, { signal: ctx.signal });
    }
  }

  /**
   * @param {number} dt simulation seconds (slowed with the world)
   * @param {number} rawDt real seconds: the scene runs on real time
   * @returns {void}
   */
  function updateActionHero(dt, rawDt) {
    if (dt > 0) {
      stepDust(dt);
      stepLowGravity(dt);
    }
    if (!scene || !hank || rawDt <= 0) return;
    scene.t += rawDt;
    const t = scene.t;
    // Walking in, towards the camera.
    if (t < AH.walk) {
      hank.position.x += Math.sin(scene.heading) * 1.6 * rawDt;
      hank.position.z += Math.cos(scene.heading) * 1.6 * rawDt;
      const swing = Math.sin(t * 7) * 0.5;
      // A footfall at each swing's turn (sound/creatures.js).
      if (Math.floor((t - rawDt) * 7 / Math.PI) !== Math.floor(t * 7 / Math.PI)) {
        ctx.systems.creatureSounds.play('footstep', hank.position, { size: 1.3 });
      }
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      if (armL) armL.rotation.x = -swing * 0.6;
      if (armR) armR.rotation.x = swing * 0.6;
    } else {
      legs[0].rotation.x = legs[1].rotation.x = 0;
    }
    // The five in a line in front of him, facing him.
    const fx = Math.sin(scene.heading);
    const fz = Math.cos(scene.heading);
    scene.victims.forEach((v, i) => {
      if (v.state !== 'waiting' || !v.person.mesh.parent) return;
      const offset = (i - (scene.victims.length - 1) / 2) * AH.lineGap;
      const tx = hank.position.x + fx * AH.lineAhead + fz * offset;
      const tz = hank.position.z + fz * AH.lineAhead - fx * offset;
      const p = v.person.mesh.position;
      p.x += (tx - p.x) * Math.min(1, rawDt * 3);
      p.z += (tz - p.z) * Math.min(1, rawDt * 3);
      v.person.mesh.rotation.y = scene.heading + Math.PI;
    });
    // The punches, one every AH.punchEvery.
    const due = Math.floor((t - AH.walk) / AH.punchEvery) + 1;
    if (t >= AH.walk && scene.punched < Math.min(due, scene.victims.length)) punch();
    // The punching arm: out and back.
    const phase = t >= AH.walk ? ((t - AH.walk) % AH.punchEvery) / AH.punchEvery : 1;
    if (armR && t >= AH.walk) armR.rotation.x = phase < 0.15 ? -Math.PI / 2 * (phase / 0.15) : -Math.PI / 2 * Math.max(0, 1 - (phase - 0.15) / 0.3);
    // The ones thrown: tumbling off the map, then gone.
    for (const v of scene.victims) {
      if (v.state !== 'flying') continue;
      v.t += rawDt;
      const p = v.person.mesh.position;
      p.addScaledVector(v.vel, rawDt);
      v.person.mesh.rotation.x += v.spin.x * rawDt;
      v.person.mesh.rotation.z += v.spin.z * rawDt;
      if (v.t > 2.5) removeVictim(v);
    }
    if (title && t > 2.5) title.classList.remove('visible');
    const end = AH.walk + AH.punchEvery * scene.victims.length + AH.outro;
    if (t > end - AH.outro && hank) hank.rotation.y = scene.heading + Math.sin((t - end + AH.outro) * 6) * 0.05;
    if (t > end) finish(true);
  }

  /**
   * The camera on him (after Hero Mode's camera, before the shake).
   * @param {number} rawDt
   * @returns {void}
   */
  function placeCamera(rawDt) {
    if (!scene || !hank) return;
    void rawDt;
    const cam = Sim.three.camera;
    const fx = Math.sin(scene.heading);
    const fz = Math.cos(scene.heading);
    const t = scene.t;
    // (Straight in front of him, the line stood between him and the lens.)
    void t;
    // Side on and a step behind him: the whole line in front of him is
    // across the frame, none of it between him and the lens.
    const dist = AH.cameraDistance;
    cam.position.set(
      hank.position.x - fx * dist * 0.25 + fz * dist,
      AH.cameraHeight,
      hank.position.z - fz * dist * 0.25 - fx * dist
    );
    const look = scratch.set(hank.position.x + fx * AH.lineAhead * 0.4, CHARACTERS.hank.height * 0.6, hank.position.z + fz * AH.lineAhead * 0.4);
    cam.lookAt(look);
    Sim.three.controls.target.copy(look);
  }

  /** @returns {void} */
  function resetActionHero() {
    if (scene) finish();
    lowGravityLeft = 0;
    ctx.systems.physics.gravity.scale = 1;
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
    if (hank) {
      Sim.three.scene.remove(hank);
      hank.traverse((/** @type {any} */ o) => { if (o.geometry) o.geometry.dispose(); });
    }
    hank = null;
    for (const m of materials) m.dispose();
    materials.length = 0;
    if (dust) disposeParticlePool(Sim.three.scene, dust);
    dust = null;
    for (const el of [bars, title]) if (el && el.parentNode) el.parentNode.removeChild(el);
    bars = title = null;
  }

  return { start, active: () => !!scene, placeCamera, initActionHero, updateActionHero, resetActionHero, disposeActionHero };
}
