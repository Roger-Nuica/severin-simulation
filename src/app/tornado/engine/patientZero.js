// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { CHARACTERS } from './scale.js';
import { REPLICATOR, PARTS, glowMaterial, withGlow, buildReplicatorGeometry, makePose, poseReplicator, partTurn } from './patientZero/model.js';
import { createSwarm } from './patientZero/swarm.js';
import { createEncircle, ENCIRCLE } from './patientZero/encircle.js';

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
 *
 * Since 2026-10-04 (on request) it is a **Replicator**: a nanite machine of
 * dark chrome blocks and acid-green light (patientZero/model.js) -- the
 * original a head taller, with a crown of glowing shards turning over its
 * head (the tell, where the halo was) and blocks orbiting it. Its clones
 * twitch, sprint hunched with claws out, and are built in front of you:
 * a stream of blocks pours from the original's chest along a green link
 * (or out of the person just infected) and spirals in, the figure growing
 * from the feet up, glitching, until it stands -- a ripple of light under it
 * (patientZero/swarm.js). Shot down, a clone falls apart into its blocks.
 * At 15 clones they surround Roger at 100 m and close in from every side,
 * throwing shards (patientZero/encircle.js). The six body parts of all the
 * clones are six InstancedMeshes.
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
  halo: new THREE.Color(0.6, 3, 0.8),
  // The building of a clone: how long, and how many blocks pour in.
  formSeconds: 1.3,
  originalFormSeconds: 2.2,
  budBlocks: 70,
  infectBlocks: 55,
  burstBlocks: 36,
  warpOut: 0.4,         // seconds coming apart before a warp
  warpForm: 0.9,        // seconds building itself again where it went
  attackRange: 7,       // metres: claws up and out
  // The swarm heating up as it nears the encirclement (ENCIRCLE.trigger
  // standing clones): the glow brighter, faster and shifted from toxic green
  // to a searing lime; warnings at these counts.
  heatTint: new THREE.Color(2.6, 1.35, 1.2),
  heatFlare: 0.9,
  heatWarnings: [10, 13]
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
 * @property {number} form 0..1 built (it stands still and grows until 1)
 * @property {number} formRate per second
 * @property {{x: number, z: number, t: number, sent: boolean}|null} warp coming apart to rebuild at (x, z)
 * @property {boolean} ring one of the encirclement (patientZero/encircle.js)
 * @property {number} slot @property {number} slotX @property {number} slotZ
 * @property {number} throwT @property {number} wind
 * @property {number} attack 0..1, claws up
 * @property {number} size
 * @property {number} pace how fast it is going, for the stride
 * @property {{yaw: number, pitch: number, roll: number, ty: number, tp: number, tr: number, next: number}} twitch
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
  /**
   * @typedef {Walker & {hp: number, root: THREE.Group, halo: THREE.Group, parts: Record<string, THREE.Object3D>, budTimer: number, budding: number, orbit: THREE.InstancedMesh}} Original
   */
  /** @type {Original|null} */
  let original = null;
  /** @type {Walker[]} */
  let clones = [];
  /** @type {Record<string, THREE.InstancedMesh>|null} the clones' six parts */
  let instanced = null;
  /** @type {Record<string, THREE.BufferGeometry>|null} */
  let geo = null;
  /** @type {THREE.MeshStandardMaterial|null} the clones' */
  let cloneMat = null;
  /** @type {THREE.MeshStandardMaterial|null} the original's */
  let originalMat = null;
  /** @type {THREE.BufferGeometry[]} made once in init: the link, the crown's shard, an orbiting block */
  const extraGeos = [];
  /** @type {{shardGeo: THREE.BufferGeometry, shardMat: THREE.Material, blockGeo: THREE.BufferGeometry}|null} */
  let crownKit = null;
  /** @type {THREE.Material[]} */
  const extraMats = [];
  /** @type {ReturnType<typeof createSwarm>|null} */
  let swarm = null;
  /** @type {ReturnType<typeof createEncircle>|null} */
  let encircle = null;
  /** @type {THREE.Mesh|null} the link from the original to the clone it buds */
  let link = null;
  /** @type {Walker|null} */
  let linkTo = null;
  let flare = 1;
  let flareGoal = 1;
  // How close the swarm is to the encirclement, 0..1, eased; the last count
  // a warning was given at.
  let heat = 0;
  let warned = 0;
  const tint = new THREE.Color();
  let clock = 0;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  const m4 = new THREE.Matrix4();
  const body = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const ql = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const turn = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const pose = makePose();
  const UP = new THREE.Vector3(0, 1, 0);
  const originalScale = CHARACTERS.patientZero.height / REPLICATOR.height;

  /** @returns {any} */
  function sounds() {
    return ctx.systems.replicatorSound;
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

  /**
   * @param {number} x
   * @param {number} z
   * @returns {Walker}
   */
  function walker(x, z) {
    return {
      pos: new THREE.Vector3(x, 0, z), heading: Math.random() * Math.PI * 2, speed: 0, retarget: Math.random() * PZ.retarget,
      bob: Math.random() * 6, target: null, prey: null,
      form: 0, formRate: 1 / PZ.formSeconds, warp: null, ring: false, slot: 0, slotX: x, slotZ: z, throwT: 0, wind: 0,
      attack: 0, size: 0.94 + Math.random() * 0.12, pace: 0,
      twitch: { yaw: 0, pitch: 0, roll: 0, ty: 0, tp: 0, tr: 0, next: Math.random() }
    };
  }

  /**
   * The original's figure: the six parts as meshes on their pivots, the
   * crown of shards turning over its head, blocks orbiting it.
   * @returns {{root: THREE.Group, halo: THREE.Group, parts: Record<string, THREE.Object3D>, orbit: THREE.InstancedMesh}}
   */
  function buildOriginal() {
    const root = new THREE.Group();
    root.name = 'patient_zero';
    const figure = new THREE.Group();
    figure.name = 'patient_zero_figure';
    /** @type {Record<string, THREE.Object3D>} */
    const parts = { figure };
    for (const name of PARTS) {
      const mesh = new THREE.Mesh(/** @type {any} */ (geo)[name], /** @type {THREE.Material} */ (originalMat));
      mesh.castShadow = true;
      if (name === 'body') {
        figure.add(mesh);
        parts.body = mesh;
        continue;
      }
      const pivot = new THREE.Group();
      pivot.position.copy(REPLICATOR.pivots[/** @type {'head'} */ (name)]);
      pivot.add(mesh);
      figure.add(pivot);
      parts[name] = pivot;
    }
    // The crown: seven shards of light turning over the head.
    const halo = new THREE.Group();
    const { shardGeo, shardMat, blockGeo } = /** @type {NonNullable<typeof crownKit>} */ (crownKit);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const shard = new THREE.Mesh(shardGeo, shardMat);
      shard.position.set(Math.sin(a) * 0.32, 0, Math.cos(a) * 0.32);
      shard.rotation.set(0.35 * Math.cos(a), 0, -0.35 * Math.sin(a));
      halo.add(shard);
    }
    halo.position.set(0, 2.32, 0.02);
    figure.add(halo);
    // Blocks orbiting it, like a cloud of its own parts.
    const orbit = new THREE.InstancedMesh(blockGeo, /** @type {THREE.Material} */ (originalMat), 28);
    orbit.frustumCulled = false;
    orbit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(orbit);
    root.add(figure);
    return { root, halo, parts, orbit };
  }

  /** @returns {boolean} */
  function spawn() {
    if (original || !instanced) return false;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    const angle = roger ? Math.atan2(roger.x, roger.z) + (Math.random() - 0.5) : Math.random() * Math.PI * 2;
    const built = buildOriginal();
    built.parts.figure.scale.setScalar(originalScale);
    Sim.three.scene.add(built.root);
    const w = walker(Math.sin(angle) * PZ.spawnRing, Math.cos(angle) * PZ.spawnRing);
    original = Object.assign(w, { hp: PZ.hp, root: built.root, halo: built.halo, parts: built.parts, orbit: built.orbit, budTimer: PZ.cloneEvery + PZ.originalFormSeconds, budding: 0 });
    original.speed = PZ.speed;
    original.size = originalScale;
    original.formRate = 1 / PZ.originalFormSeconds;
    // It builds itself out of a storm of blocks falling from the sky.
    if (swarm) swarm.assemble(w.pos.x, 22, w.pos.z, 7, w.pos.x, w.pos.z, 220, PZ.originalFormSeconds, originalScale);
    if (sounds()) sounds().playAssemble(w.pos.x, w.pos.z, true);
    if (button) button.disabled = true;
    showBanner('PATIENT ZERO · THE REPLICATOR', 'It builds copies of itself · anyone it touches becomes one · kill the one with the crown');
    ctx.systems.creatureSounds.play('groan', original.pos, { pitch: 0.6, size: 1.3, gain: 1.2 });
    return true;
  }

  /**
   * A new clone building itself at (x, z), out of blocks pouring from
   * (fx, fy, fz), if there is room for one.
   * @param {number} x
   * @param {number} z
   * @param {number} fx @param {number} fy @param {number} fz
   * @param {number} spread
   * @param {number} blocks
   * @returns {Walker|null}
   */
  function addClone(x, z, fx, fy, fz, spread, blocks) {
    if (clones.length >= PZ.maxClones || !ctx.systems.caps.canSpawn('patientZeroClone')) return null;
    const c = walker(x, z);
    c.speed = PZ.cloneSpeed[0] + Math.random() * (PZ.cloneSpeed[1] - PZ.cloneSpeed[0]);
    clones.push(c);
    if (swarm) swarm.assemble(fx, fy, fz, spread, x, z, blocks, PZ.formSeconds, c.size);
    if (sounds()) sounds().playAssemble(x, z);
    return c;
  }

  /**
   * A clone sent somewhere else: it comes apart here, its blocks stream
   * there, and it builds itself again (the encirclement's gather).
   * @param {Walker} c
   * @param {number} x
   * @param {number} z
   * @param {number} delay
   * @returns {void}
   */
  function warp(c, x, z, delay) {
    c.warp = { x, z, t: -delay, sent: false };
    c.prey = null;
  }

  /**
   * @param {Walker} c
   * @param {number} [blocks]
   * @returns {void}
   */
  function removeClone(c, blocks = PZ.burstBlocks) {
    const i = clones.indexOf(c);
    if (i === -1) return;
    clones.splice(i, 1);
    if (linkTo === c) linkTo = null;
    // It falls apart into its blocks.
    if (swarm) {
      swarm.burst(c.pos.x, 1.1 * c.size, c.pos.z, blocks, 5);
      swarm.ripple(c.pos.x, c.pos.z, 2.2);
    }
    if (sounds()) sounds().playShatter(c.pos.x, c.pos.z);
    // A swarm going at once shares a few voices (sound/creatures.js GAP).
    ctx.systems.creatureSounds.play('zombieDeath', c.pos, { pitch: ctx.systems.creatureSounds.pitchOf(c) });
  }

  /** @returns {void} the original dead: every clone with it */
  function killOriginal() {
    if (!original) return;
    const n = clones.length;
    const each = Math.max(6, Math.floor(600 / Math.max(1, n)));
    for (const c of clones.slice()) removeClone(c, Math.min(PZ.burstBlocks, each));
    if (swarm) {
      swarm.burst(original.pos.x, 1.4, original.pos.z, 120, 8);
      swarm.ripple(original.pos.x, original.pos.z, 9);
    }
    ctx.systems.explosions.spawnImpactBurst(p.set(original.pos.x, 1.5, original.pos.z), 1.2);
    ctx.systems.creatureSounds.play('zombieDeath', original.pos, { pitch: 0.7, size: 1.5, gain: 1.3 });
    if (sounds()) sounds().playShatter(original.pos.x, original.pos.z);
    removeOriginalFigure();
    if (button) button.disabled = false;
    ctx.systems.damage.addDamageScore(PZ.score);
    showBanner('PATIENT ZERO DOWN', `The original is dead · ${n} clones gone with it · +${PZ.score}`);
  }

  /** @returns {void} the original's figure out of the scene */
  function removeOriginalFigure() {
    if (!original) return;
    Sim.three.scene.remove(original.root);
    original.orbit.dispose();
    original = null;
    linkTo = null;
    if (link) link.visible = false;
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
   * The head's twitch: now and then it snaps to a new angle, fast.
   * @param {Walker} w
   * @param {number} dt
   * @returns {void}
   */
  function twitch(w, dt) {
    const t = w.twitch;
    t.next -= dt;
    if (t.next <= 0) {
      const calm = Math.random() < 0.35;
      t.ty = calm ? 0 : (Math.random() - 0.5) * 1.1;
      t.tp = calm ? 0 : (Math.random() - 0.5) * 0.6;
      t.tr = calm ? 0 : (Math.random() - 0.5) * 0.8;
      t.next = 0.12 + Math.random() * 0.9;
    }
    const k = Math.min(1, dt * 28);
    t.yaw += (t.ty - t.yaw) * k;
    t.pitch += (t.tp - t.pitch) * k;
    t.roll += (t.tr - t.roll) * k;
  }

  /**
   * One walker's step, and whom it touches.
   * @param {Walker} w
   * @param {number} dt
   * @param {boolean} isOriginal
   * @returns {void}
   */
  function step(w, dt, isOriginal) {
    twitch(w, dt);
    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    // In the ring (patientZero/encircle.js): to its place on it, facing
    // Roger; standing still while it gathers and holds.
    if (w.ring && encircle) {
      const phase = encircle.phase();
      const face = roger ? Math.atan2(roger.x - w.pos.x, roger.z - w.pos.z) : w.heading;
      w.heading = face;
      w.prey = null;
      if (phase === 'close') {
        const dx = w.slotX - w.pos.x;
        const dz = w.slotZ - w.pos.z;
        const d = Math.hypot(dx, dz);
        const stepLen = Math.min(d, 15 * dt);
        if (d > 1e-3) {
          w.pos.x += (dx / d) * stepLen;
          w.pos.z += (dz / d) * stepLen;
        }
        w.pace = dt > 0 ? (stepLen / dt) / 4 : 0;
        w.bob += stepLen * 2.2;
      } else {
        w.pace = 0;
      }
      const near = roger ? Math.hypot(roger.x - w.pos.x, roger.z - w.pos.z) : Infinity;
      w.attack = Math.min(1, Math.max(w.wind > 0 ? 1 : 0, near < PZ.attackRange ? 1 : phase === 'hold' ? 0.6 : 0.2));
      if (roger && near < PZ.touch * 1.2) {
        ctx.systems.health.damagePlayer({
          source: 'patientZero', instantKill: true, position: { x: w.pos.x, y: 0, z: w.pos.z },
          title: 'INFECTED', sub: 'The swarm closed round Roger'
        });
      }
      return;
    }
    w.retarget -= dt;
    if (w.retarget <= 0 || !w.target) {
      w.retarget = PZ.retarget;
      choose(w);
    }
    if (!w.target) {
      w.pace = 0;
      return;
    }
    const dx = w.target.x - w.pos.x;
    const dz = w.target.z - w.pos.z;
    const d = Math.hypot(dx, dz);
    w.heading = Math.atan2(dx, dz);
    w.attack += ((d < PZ.attackRange ? 1 : 0) - w.attack) * Math.min(1, dt * 6);
    if (d > 0.3) {
      w.pos.x += (dx / d) * w.speed * dt;
      w.pos.z += (dz / d) * w.speed * dt;
      const before = w.bob;
      w.bob += dt * w.speed * 2.2;
      w.pace = w.speed / 4;
      const creature = ctx.systems.creatureSounds;
      // Groans now and then, each its own pitch; the swarm's share a few
      // voices (sound/creatures.js GAP). The original's steps, too.
      if (Math.random() < dt * (isOriginal ? 0.4 : 0.08)) creature.play('groan', w.pos, { pitch: isOriginal ? 0.6 : creature.pitchOf(w) * 0.8, size: isOriginal ? 1.3 : 1 });
      if (isOriginal && Math.floor(before / Math.PI) !== Math.floor(w.bob / Math.PI)) creature.play('footstep', w.pos, { size: 1.3, gain: 0.8 });
    }
    if (d > PZ.touch) return;
    // A touch.
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
      // The victim's body turns to blocks, and they build a clone where it stood.
      addClone(at.x, at.z, at.x, 1, at.z, 1.2, PZ.infectBlocks);
    }
    w.prey = null;
    w.target = null;
  }

  /**
   * Building, and coming apart for a warp, a frame.
   * @param {Walker} w
   * @param {number} dt
   * @returns {boolean} whether it is busy (not walking)
   */
  function build(w, dt) {
    if (w.warp) {
      const wp = w.warp;
      wp.t += dt;
      if (wp.t < 0) return true;
      if (!wp.sent) {
        wp.sent = true;
        if (swarm) swarm.assemble(w.pos.x, 1, w.pos.z, 0.5, wp.x, wp.z, 40, PZ.warpOut + PZ.warpForm, w.size);
        if (sounds()) sounds().playShatter(w.pos.x, w.pos.z);
      }
      if (wp.t >= PZ.warpOut) {
        w.pos.set(wp.x, 0, wp.z);
        w.warp = null;
        w.form = 0;
        w.formRate = 1 / PZ.warpForm;
      }
      return true;
    }
    if (w.form < 1) {
      w.form = Math.min(1, w.form + w.formRate * dt);
      if (w.form >= 1 && swarm) {
        swarm.ripple(w.pos.x, w.pos.z, 3 * w.size);
        // A scorch of green left where it was built.
        swarm.stain(w.pos.x, w.pos.z, w.size);
        ctx.systems.creatureSounds.play('snarl', w.pos, { pitch: ctx.systems.creatureSounds.pitchOf(w) });
      }
      return true;
    }
    return false;
  }

  /**
   * The body's matrix for a walker: where it stands, its lean, and how far
   * it is built (from the feet up, wider and glitching while unfinished) or
   * come apart (a warp).
   * @param {Walker} w
   * @param {number} size
   * @param {THREE.Matrix4} out
   * @returns {void}
   */
  function bodyMatrix(w, size, out) {
    let grown = 1;
    if (w.warp) grown = w.warp.t <= 0 ? 1 : Math.max(0.02, 1 - w.warp.t / PZ.warpOut);
    else if (w.form < 1) grown = Math.max(0.02, 1 - Math.pow(1 - w.form, 2.2));
    const glitch = grown < 1 ? (Math.random() - 0.5) * 0.25 * (1 - grown) : 0;
    const wide = 1 + (1 - grown) * 0.5 + glitch;
    euler.set(pose.lean, w.heading, pose.roll, 'YXZ');
    q.setFromEuler(euler);
    out.compose(p.set(w.pos.x + glitch * 0.3, pose.lift * grown, w.pos.z), q, sc.set(size * wide, size * grown, size * wide));
  }

  /** @returns {void} the clones' instances, from their walkers */
  function writeInstances() {
    if (!instanced) return;
    for (let i = 0; i < clones.length; i++) {
      const c = clones[i];
      poseReplicator(pose, c.bob, c.pace, c.attack, c.twitch);
      bodyMatrix(c, c.size, body);
      for (const name of PARTS) {
        if (name === 'body') {
          instanced.body.setMatrixAt(i, body);
          continue;
        }
        ql.setFromEuler(partTurn(name, pose, turn));
        local.compose(REPLICATOR.pivots[/** @type {'head'} */ (name)], ql, one);
        m4.multiplyMatrices(body, local);
        instanced[name].setMatrixAt(i, m4);
      }
    }
    for (const name of PARTS) {
      instanced[name].count = clones.length;
      instanced[name].instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * The original's figure, posed, and its crown and orbiting blocks.
   * @param {number} dt
   * @returns {void}
   */
  function writeOriginal(dt) {
    if (!original) return;
    const o = original;
    // Budding: arms out, core flaring.
    const attack = Math.max(o.attack, o.budding > 0 ? 0.8 : 0);
    poseReplicator(pose, o.bob, o.pace, attack, o.twitch);
    o.root.position.set(o.pos.x, 0, o.pos.z);
    const fig = /** @type {THREE.Object3D} */ (o.parts.figure);
    const grown = o.form < 1 ? Math.max(0.02, 1 - Math.pow(1 - o.form, 2.2)) : 1;
    const glitch = grown < 1 ? (Math.random() - 0.5) * 0.2 * (1 - grown) : 0;
    fig.scale.set(originalScale * (1 + (1 - grown) * 0.5 + glitch), originalScale * grown, originalScale * (1 + (1 - grown) * 0.5 + glitch));
    fig.position.y = pose.lift * grown;
    fig.rotation.set(pose.lean, o.heading, pose.roll, 'YXZ');
    for (const name of PARTS) {
      if (name === 'body') continue;
      partTurn(name, pose, turn);
      o.parts[name].rotation.copy(turn);
    }
    o.halo.rotation.y += dt * 2.2;
    o.halo.position.y = 2.32 + Math.sin(clock * 3) * 0.04;
    // Blocks orbiting it at different heights and speeds.
    for (let i = 0; i < o.orbit.count; i++) {
      const a = clock * (0.8 + (i % 5) * 0.25) + i * 2.399;
      const r = (0.75 + (i % 3) * 0.25) * originalScale;
      const y = (0.4 + ((i * 37) % 19) / 19 * 2) * originalScale * grown;
      euler.set(a * 2, a, 0);
      q.setFromEuler(euler);
      m4.compose(p.set(Math.cos(a) * r, y + Math.sin(a * 3 + i) * 0.1, Math.sin(a) * r), q, one);
      o.orbit.setMatrixAt(i, m4);
    }
    o.orbit.instanceMatrix.needsUpdate = true;
  }

  /**
   * The green link from the original's chest to the clone it is budding.
   * @returns {void}
   */
  function writeLink() {
    if (!link) return;
    if (!original || !linkTo || linkTo.form >= 1) {
      link.visible = false;
      linkTo = null;
      return;
    }
    const from = p.set(original.pos.x, 1.5 * originalScale, original.pos.z);
    const d = sc.set(linkTo.pos.x, 1.1 * linkTo.form + 0.2, linkTo.pos.z).sub(from);
    const len = d.length();
    link.position.copy(from);
    link.quaternion.setFromUnitVectors(UP, d.normalize());
    link.scale.set(1 + Math.random() * 0.8, len, 1 + Math.random() * 0.8);
    /** @type {THREE.MeshBasicMaterial} */ (link.material).opacity = 0.5 + Math.random() * 0.5;
    link.visible = true;
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
    // Blocks knocked off it.
    if (swarm) swarm.burst(original.pos.x, 1.6, original.pos.z, 12, 4);
    return false;
  }

  /** @returns {void} */
  function initPatientZero() {
    geo = buildReplicatorGeometry();
    const shardGeo = new THREE.ConeGeometry(0.035, 0.32, 3);
    const shardMat = new THREE.MeshBasicMaterial({ color: PZ.halo });
    const blockGeo = withGlow(new THREE.BoxGeometry(0.055, 0.055, 0.055), REPLICATOR.green.clone().multiplyScalar(0.5));
    extraGeos.push(shardGeo, blockGeo);
    extraMats.push(shardMat);
    crownKit = { shardGeo, shardMat, blockGeo };
    cloneMat = glowMaterial(1);
    originalMat = glowMaterial(1.3);
    instanced = {};
    for (const name of PARTS) {
      const m = new THREE.InstancedMesh(geo[name], cloneMat, PZ.maxClones);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.name = `patient_zero_clones_${name}`;
      Sim.three.scene.add(m);
      instanced[name] = m;
    }
    swarm = createSwarm(Sim.three.scene);
    encircle = createEncircle(ctx, {
      clones: () => clones,
      warp,
      banner: showBanner,
      flare: (level) => { flareGoal = level; }
    });
    const linkGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true);
    linkGeo.translate(0, 0.5, 0);
    extraGeos.push(linkGeo);
    const linkMat = new THREE.MeshBasicMaterial({ color: REPLICATOR.green, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    extraMats.push(linkMat);
    link = new THREE.Mesh(linkGeo, linkMat);
    link.visible = false;
    link.frustumCulled = false;
    link.name = 'patient_zero_link';
    Sim.three.scene.add(link);
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
        removeOriginalFigure();
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
        if (linkTo === w) linkTo = null;
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
    clock += dt;
    const enemies = ctx.systems.enemies;
    if (original) {
      const o = original;
      if (!enemies.getState(o, 'frozen') && !build(o, dt)) {
        step(o, dt, true);
        if (o.budding > 0) o.budding -= dt;
        o.budTimer -= dt;
        if (o.budTimer <= 0) {
          o.budTimer = PZ.cloneEvery;
          const a = o.heading + (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 1.2);
          const x = o.pos.x + Math.sin(a) * 2.4;
          const z = o.pos.z + Math.cos(a) * 2.4;
          // Out of its chest, along the link.
          const bud = addClone(x, z, o.pos.x, 1.5 * originalScale, o.pos.z, 0.35, PZ.budBlocks);
          if (bud) {
            linkTo = bud;
            o.budding = PZ.formSeconds;
            flareGoal = Math.max(flareGoal, 1.8);
          }
        }
      }
    }
    for (const c of clones.slice()) {
      if (enemies.getState(c, 'frozen')) continue;
      if (!build(c, dt)) step(c, dt, false);
    }
    if (encircle) encircle.update(dt);
    // The light in them all: breathing, flaring at a bud and in the ring.
    if (!linkTo && encircle && encircle.phase() === 'idle') flareGoal = 1;
    flare += (flareGoal - flare) * Math.min(1, dt * 4);
    // The heat: standing clones against the encirclement's count (full while
    // it runs), the glow brighter, faster and hotter in colour as it climbs.
    let standing = 0;
    for (const c of clones) if (c.form >= 1 && !c.warp) standing++;
    const ringing = !!encircle && encircle.phase() !== 'idle';
    const heatGoal = ringing ? 1 : Math.min(1, standing / ENCIRCLE.trigger);
    heat += (heatGoal - heat) * Math.min(1, dt * 1.5);
    // One warning for the highest count crossed, however many at once.
    let crossed = 0;
    for (const n of PZ.heatWarnings) if (standing >= n && warned < n) crossed = n;
    if (crossed && !ringing) {
      warned = crossed;
      ctx.events.emit('notice', { text: `☣ THE SWARM GROWS · ${standing} / ${ENCIRCLE.trigger}` });
      if (sounds() && original) sounds().playShatter(original.pos.x, original.pos.z);
    }
    if (standing < PZ.heatWarnings[0]) warned = 0;
    const h = heat * heat;
    tint.setRGB(1, 1, 1).lerp(PZ.heatTint, h);
    const breathe = 1 - (0.15 + 0.15 * heat) + (0.15 + 0.15 * heat) * Math.sin(clock * (2.6 + 6 * heat));
    const level = flare + PZ.heatFlare * h;
    if (cloneMat) {
      cloneMat.userData.glow.value = level * breathe;
      cloneMat.userData.tint.value.copy(tint);
    }
    if (originalMat) {
      originalMat.userData.glow.value = 1.3 * Math.max(1, level) * breathe;
      originalMat.userData.tint.value.copy(tint);
    }
    writeInstances();
    writeOriginal(dt);
    writeLink();
    if (swarm) swarm.update(dt);
  }

  /** @returns {void} */
  function resetPatientZero() {
    removeOriginalFigure();
    clones = [];
    writeInstances();
    if (swarm) swarm.clear();
    if (encircle) encircle.reset();
    flare = flareGoal = 1;
    heat = 0;
    warned = 0;
    if (button) button.disabled = false;
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposePatientZero() {
    resetPatientZero();
    if (instanced) {
      for (const m of Object.values(instanced)) {
        Sim.three.scene.remove(m);
        m.dispose();
      }
    }
    instanced = null;
    if (geo) for (const g of Object.values(geo)) g.dispose();
    geo = null;
    if (swarm) swarm.dispose();
    swarm = null;
    if (encircle) encircle.dispose();
    encircle = null;
    if (link) Sim.three.scene.remove(link);
    link = null;
    for (const g of extraGeos) g.dispose();
    for (const m of extraMats) m.dispose();
    extraGeos.length = 0;
    extraMats.length = 0;
    crownKit = null;
    for (const m of [cloneMat, originalMat]) if (m) m.dispose();
    cloneMat = originalMat = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    button = null;
  }

  return { spawn, cloneCount: () => clones.length, originalAlive: () => !!original, initPatientZero, updatePatientZero, resetPatientZero, disposePatientZero };
}
