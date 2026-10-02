// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { CHARACTERS } from './scale.js';

/**
 * ===========================================================================
 * SECTION PZ — Patient Zero
 * ===========================================================================
 * An enemy that copies itself. The panel's 🧟 Patient Zero sends the
 * original in from the edge of town: a sickly green figure, a head taller
 * than anyone, with a glowing green halo over its head -- the tell that
 * this one is the original. Every PZ.cloneEvery seconds it buds a clone, and
 * anyone a clone or the original touches is infected: gone, and a new clone
 * stands where they were. Never more than CAPS.perKind.patientZeroClone
 * (50) clones at once (engine/perf/caps.js).
 *
 * The clones are cheap on purpose: drawn as two InstancedMeshes (body and
 * head: two draw calls for all fifty), with the simplest movement there is
 * -- straight at the nearest person (or Roger), re-chosen once a second,
 * staggered across them, through whatever is in the way. Any hit of any
 * kind drops a clone.
 *
 * The original takes PZ.hp; when it dies every clone dies with it, all at
 * once. It and its clones reach Roger: "INFECTED". Both are in the shared
 * register of enemies (engine/enemies.js) with hitboxes, so the rifle, the
 * minigun, the EMP and the black hole all find them; frozen ones stand
 * still (engine/effects/freeze.js).
 */

export const PZ = {
  spawnRing: 120,
  cloneEvery: 2.5,          // seconds between two buds
  maxClones: 50,            // the same as CAPS.perKind.patientZeroClone
  speed: 2.2,               // the original, m/s
  cloneSpeed: [2.4, 3.4],
  touch: 1.1,               // metres: infected
  retarget: 1,              // seconds between two choices of whom to chase
  hp: 12,
  damage: { plasma: 3, mega: 12, bullet: 0.5, bolt: 6, emp: 4 },
  score: 2000,
  skin: 0x7fa36a,
  cloth: 0x3d4a33,
  halo: new THREE.Color(0.6, 3, 0.8)
};

/**
 * @typedef {Object} Walker
 * @property {THREE.Vector3} pos
 * @property {number} heading
 * @property {number} speed
 * @property {number} retarget
 * @property {number} bob
 * @property {{x: number, z: number}|null} target
 * @property {SimObject|null} prey the person being chased
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   spawn: () => boolean,
 *   cloneCount: () => number,
 *   originalAlive: () => boolean,
 *   initPatientZero: () => void,
 *   updatePatientZero: (dt: number) => void,
 *   resetPatientZero: () => void,
 *   disposePatientZero: () => void
 * }}
 */
export function createPatientZeroSystem(ctx) {
  const { Sim } = ctx;
  /** @type {(Walker & {hp: number, root: THREE.Group, halo: THREE.Mesh, budTimer: number})|null} */
  let original = null;
  /** @type {Walker[]} */
  let clones = [];
  /** @type {THREE.InstancedMesh|null} */
  let bodies = null;
  /** @type {THREE.InstancedMesh|null} */
  let heads = null;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  const geo = {
    body: new THREE.CapsuleGeometry(0.32, 1.0, 4, 8),
    head: new THREE.SphereGeometry(0.26, 10, 8),
    halo: new THREE.TorusGeometry(0.34, 0.05, 6, 20)
  };
  /** @type {THREE.Material[]} */
  const materials = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s1 = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();

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

  /**
   * @param {number} x
   * @param {number} z
   * @returns {Walker}
   */
  function walker(x, z) {
    return { pos: new THREE.Vector3(x, 0, z), heading: Math.random() * Math.PI * 2, speed: 0, retarget: Math.random() * PZ.retarget, bob: Math.random() * 6, target: null, prey: null };
  }

  /** @returns {boolean} */
  function spawn() {
    if (original || !bodies) return false;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    const angle = roger ? Math.atan2(roger.x, roger.z) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
    const root = new THREE.Group();
    root.name = 'patient_zero';
    const skin = materials[0];
    const cloth = materials[1];
    const body = new THREE.Mesh(geo.body, cloth);
    body.position.y = 0.82;
    const head = new THREE.Mesh(geo.head, skin);
    head.position.y = 1.62;
    const halo = new THREE.Mesh(geo.halo, materials[2]);
    halo.position.y = 2.05;
    halo.rotation.x = Math.PI / 2;
    for (const m of [body, head]) m.castShadow = true;
    root.add(body, head, halo);
    // A head taller than anyone: the original (engine/scale.js CHARACTERS;
    // the figure is built 1.82 m tall, like a person).
    root.scale.setScalar(CHARACTERS.patientZero.height / 1.82);
    Sim.three.scene.add(root);
    const w = walker(Math.sin(angle) * PZ.spawnRing, Math.cos(angle) * PZ.spawnRing);
    original = Object.assign(w, { hp: PZ.hp, root, halo, budTimer: PZ.cloneEvery });
    original.speed = PZ.speed;
    if (button) button.disabled = true;
    showBanner('PATIENT ZERO', 'It copies itself · anyone it touches becomes a clone · kill the one with the halo');
    ctx.systems.creatureSounds.play('groan', original.pos, { pitch: 0.75, size: 1.3, gain: 1.2 });
    return true;
  }

  /**
   * A new clone at (x, z), if there is room for one.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function addClone(x, z) {
    if (clones.length >= PZ.maxClones || !ctx.systems.caps.canSpawn('patientZeroClone')) return false;
    const c = walker(x, z);
    c.speed = PZ.cloneSpeed[0] + Math.random() * (PZ.cloneSpeed[1] - PZ.cloneSpeed[0]);
    clones.push(c);
    return true;
  }

  /**
   * @param {Walker} c
   * @returns {void}
   */
  function removeClone(c) {
    const i = clones.indexOf(c);
    if (i === -1) return;
    clones.splice(i, 1);
    ctx.systems.explosions.spawnImpactBurst(p.set(c.pos.x, 1, c.pos.z), 0.25);
    // A swarm going at once shares a few voices (sound/creatures.js GAP).
    ctx.systems.creatureSounds.play('zombieDeath', c.pos, { pitch: ctx.systems.creatureSounds.pitchOf(c) });
  }

  /** @returns {void} the original dead: every clone with it */
  function killOriginal() {
    if (!original) return;
    const n = clones.length;
    for (const c of clones.slice()) removeClone(c);
    ctx.systems.explosions.spawnImpactBurst(p.set(original.pos.x, 1.5, original.pos.z), 1.2);
    ctx.systems.creatureSounds.play('zombieDeath', original.pos, { pitch: 0.7, size: 1.5, gain: 1.3 });
    Sim.three.scene.remove(original.root);
    original = null;
    if (button) button.disabled = false;
    ctx.systems.damage.addDamageScore(PZ.score);
    showBanner('PATIENT ZERO DOWN', `The original is dead · ${n} clones gone with it · +${PZ.score}`);
  }

  /**
   * Whom to chase: Roger in Hero Mode, else the nearest townsperson.
   * @param {Walker} w
   * @returns {void}
   */
  function choose(w) {
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    let best = roger ? Math.hypot(roger.x - w.pos.x, roger.z - w.pos.z) : Infinity;
    w.target = roger ? { x: roger.x, z: roger.z } : null;
    w.prey = null;
    for (const person of ctx.Environment.people) {
      const pp = person.mesh.position;
      const any = /** @type {any} */ (person);
      if (!person.mesh.parent || any.abducted || any.statue || any.heroName) continue;
      const d = Math.hypot(pp.x - w.pos.x, pp.z - w.pos.z);
      if (d < best) { best = d; w.target = pp; w.prey = person; }
    }
  }

  /**
   * One walker's step, and whom it touches.
   * @param {Walker} w
   * @param {number} dt
   * @param {boolean} isOriginal
   * @returns {void}
   */
  function step(w, dt, isOriginal) {
    w.retarget -= dt;
    if (w.retarget <= 0 || !w.target) {
      w.retarget = PZ.retarget;
      choose(w);
    }
    if (!w.target) return;
    const dx = w.target.x - w.pos.x;
    const dz = w.target.z - w.pos.z;
    const d = Math.hypot(dx, dz);
    w.heading = Math.atan2(dx, dz);
    if (d > 0.3) {
      w.pos.x += (dx / d) * w.speed * dt;
      w.pos.z += (dz / d) * w.speed * dt;
      const before = w.bob;
      w.bob += dt * w.speed * 3;
      const sounds = ctx.systems.creatureSounds;
      // Groans now and then, each its own pitch; the swarm's share a few
      // voices (sound/creatures.js GAP). The original's steps, too.
      if (Math.random() < dt * (isOriginal ? 0.4 : 0.08)) sounds.play('groan', w.pos, { pitch: isOriginal ? 0.75 : sounds.pitchOf(w), size: isOriginal ? 1.3 : 1 });
      if (isOriginal && Math.floor(before / Math.PI) !== Math.floor(w.bob / Math.PI)) sounds.play('footstep', w.pos, { size: 1.3, gain: 0.8 });
    }
    if (d > PZ.touch) return;
    // A touch.
    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    if (roger && !w.prey && Math.hypot(roger.x - w.pos.x, roger.z - w.pos.z) < PZ.touch * 1.2) {
      ctx.systems.health.damagePlayer({
        source: 'patientZero', instantKill: true, position: { x: w.pos.x, y: 0, z: w.pos.z },
        title: 'INFECTED', sub: isOriginal ? 'Patient Zero got to Roger' : 'A clone of Patient Zero got to Roger'
      });
      return;
    }
    if (w.prey && w.prey.mesh.parent) {
      const at = w.prey.mesh.position.clone();
      ctx.systems.creatureSounds.play('snarl', at, { pitch: isOriginal ? 0.8 : ctx.systems.creatureSounds.pitchOf(w) });
      ctx.systems.people.explodePerson(w.prey);
      addClone(at.x, at.z);
    }
    w.prey = null;
    w.target = null;
  }

  /** @returns {void} the clones' instances, from their walkers */
  function writeInstances() {
    if (!bodies || !heads) return;
    for (let i = 0; i < clones.length; i++) {
      const c = clones[i];
      q.setFromAxisAngle(up, c.heading);
      const lean = Math.sin(c.bob) * 0.06;
      m4.compose(p.set(c.pos.x, 0.82 + Math.abs(lean), c.pos.z), q, s1);
      bodies.setMatrixAt(i, m4);
      m4.compose(p.set(c.pos.x + Math.sin(c.heading) * lean, 1.62, c.pos.z + Math.cos(c.heading) * lean), q, s1);
      heads.setMatrixAt(i, m4);
    }
    bodies.count = heads.count = clones.length;
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {any} target the original
   * @param {import('./enemies.js').Hit} hit
   * @returns {boolean} whether it is dead
   */
  function hitOriginal(target, hit) {
    if (!original || target !== original) return true;
    const d = PZ.damage;
    original.hp -= hit.type === 'plasma' ? (hit.mega ? d.mega : d.plasma)
      : hit.type === 'bullet' ? d.bullet : hit.type === 'bolt' ? d.bolt : hit.type === 'emp' ? d.emp : d.mega;
    if (original.hp <= 0) {
      killOriginal();
      return true;
    }
    ctx.events.emit('notice', { text: `🧟 PATIENT ZERO ${Math.round((original.hp / PZ.hp) * 100)}%` });
    ctx.systems.creatureSounds.play('snarl', original.pos, { pitch: 0.7, size: 1.3 });
    return false;
  }

  /** @returns {void} */
  function initPatientZero() {
    materials.push(
      new THREE.MeshStandardMaterial({ color: PZ.skin, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: PZ.cloth, roughness: 0.95 }),
      new THREE.MeshBasicMaterial({ color: PZ.halo })
    );
    bodies = new THREE.InstancedMesh(geo.body, materials[1], PZ.maxClones);
    heads = new THREE.InstancedMesh(geo.head, materials[0], PZ.maxClones);
    for (const m of [bodies, heads]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      Sim.three.scene.add(m);
    }
    bodies.name = 'patient_zero_clones';
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-patient-zero'));
    if (button) {
      button.addEventListener('click', () => {
        // Called in from the panel: the camera glides over to it.
        if (spawn()) ctx.systems.camera.glideTo(() => (original ? original.root.position : null), CHARACTERS.patientZero.height);
      }, { signal: ctx.signal });
    }
    const enemies = ctx.systems.enemies;
    enemies.registerKind({
      kind: 'patientZero',
      list: () => (original ? [original] : []),
      position: (w) => w.pos,
      accepts: ['plasma', 'bullet', 'bolt', 'emp', 'gravity'],
      damage: (w, hit) => hitOriginal(w, hit),
      // Out of health (D1, health/damageTable.js: the Katana, fire and the
      // rest chip it): it dies as at 0 hp, its clones with it, scored once.
      defeat: (w) => {
        if (original !== w) return true;
        killOriginal();
        return true;
      },
      hitbox: (w) => ({ x: w.pos.x, z: w.pos.z, radius: 0.9, top: 2.8 }),
      object: (w) => w.root,
      // The black hole: gone quietly. Its clones are swallowed one by one
      // (they are their own kind), not killed with it.
      consume: (w) => {
        if (w !== original) return;
        Sim.three.scene.remove(w.root);
        original = null;
        if (button) button.disabled = false;
      }
    });
    enemies.registerKind({
      kind: 'patientZeroClone',
      list: () => clones,
      position: (w) => w.pos,
      accepts: ['plasma', 'bullet', 'bolt', 'emp', 'gravity', 'fire', 'freeze'],
      damage: (w) => {
        removeClone(w);
        return true;
      },
      // Every weapon the table lists kills a clone (1 health); the rest
      // (the Katana, the rocket) chip it and it is removed when that is used up.
      defeat: (w) => {
        removeClone(w);
        return true;
      },
      hitbox: (w) => ({ x: w.pos.x, z: w.pos.z, radius: 0.7, top: 2.1 }),
      // Drawn instanced, from its pos: the black hole moves that.
      object: () => null,
      size: () => 1.8,
      consume: (w) => {
        const i = clones.indexOf(w);
        if (i !== -1) clones.splice(i, 1);
      }
    });
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updatePatientZero(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (dt <= 0) return;
    const enemies = ctx.systems.enemies;
    if (original) {
      if (!enemies.getState(original, 'frozen')) {
        step(original, dt, true);
        original.budTimer -= dt;
        if (original.budTimer <= 0) {
          original.budTimer = PZ.cloneEvery;
          const a = Math.random() * Math.PI * 2;
          addClone(original.pos.x + Math.sin(a) * 1.5, original.pos.z + Math.cos(a) * 1.5);
        }
      }
      // A black hole may have killed it (as by a mega beam) already.
      if (original) {
        original.root.position.copy(original.pos);
        original.root.rotation.y = original.heading;
        original.halo.rotation.z += dt * 2;
        /** @type {THREE.MeshBasicMaterial} */ (original.halo.material).color.copy(PZ.halo).multiplyScalar(0.8 + 0.2 * Math.sin(original.bob * 2));
      }
    }
    for (const c of clones.slice()) {
      if (!enemies.getState(c, 'frozen')) step(c, dt, false);
    }
    writeInstances();
  }

  /** @returns {void} */
  function resetPatientZero() {
    if (original) Sim.three.scene.remove(original.root);
    original = null;
    clones = [];
    writeInstances();
    if (button) button.disabled = false;
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposePatientZero() {
    resetPatientZero();
    for (const m of [bodies, heads]) if (m) { Sim.three.scene.remove(m); m.dispose(); }
    bodies = heads = null;
    for (const g of Object.values(geo)) g.dispose();
    for (const m of materials) m.dispose();
    materials.length = 0;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
  }

  return { spawn, cloneCount: () => clones.length, originalAlive: () => !!original, initPatientZero, updatePatientZero, resetPatientZero, disposePatientZero };
}
