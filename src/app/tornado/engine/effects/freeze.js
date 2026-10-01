// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION FZ — Frozen: ice blocks, ice statues
 * ===========================================================================
 * The "frozen" state, for the cyber Yeti's ice storm and the Blizzard
 * (engine/yeti.js, engine/blizzard.js), in one place:
 *
 *  - An enemy frozen (freezeEnemy) is set 'frozen' in the shared register
 *    (engine/enemies.js) for so many seconds; its owner stops moving it
 *    while that lasts (terminator.js, hero/pursuers.js, aliens/crew.js,
 *    trex.js). A block of ice stands round it, and cracks away when it
 *    thaws.
 *  - Roger frozen (freezeRoger, heroMode.freezeRoger): he cannot move,
 *    fire or use an ability until he thaws. A block round him too. Never
 *    killed by the cold itself -- but a frozen Roger is easy prey.
 *  - A townsperson frozen becomes an ice statue (makeStatue): pale blue and
 *    glassy, stopped where they stood (peopleMotion skips a statue). A
 *    statue shatters at any impact -- picked up by the funnel, thrown,
 *    struck, anything moving it -- into ice shards through the debris
 *    system (the 'ice' kind: debris.js), and is gone.
 *
 * The ice blocks are a small pool of translucent boxes, made once.
 */

export const FREEZE = {
  blocks: 24,              // ice blocks at once
  statueTint: 0xbfe4ff,
  statueEmissive: 0x2a5a7a,
  shards: 7,               // ice debris pieces from one statue
  shatterSpeed: 2.5,       // a statue moving faster than this breaks
  thawCrack: 0.35          // seconds the block takes to crack away
};

/**
 * @param {Object} ctx
 * @returns {{
 *   freezeEnemy: (e: any, kind: import('../enemies.js').EnemyKind, seconds: number) => void,
 *   freezeRoger: (seconds: number) => boolean,
 *   makeStatue: (person: SimObject) => boolean,
 *   shatter: (person: SimObject) => void,
 *   statueCount: () => number,
 *   initFreeze: () => void,
 *   updateFreeze: (dt: number) => void,
 *   resetFreeze: () => void,
 *   disposeFreeze: () => void
 * }}
 */
export function createFreezeSystem(ctx) {
  const { Sim } = ctx;
  /**
   * @typedef {Object} Block
   * @property {THREE.Mesh} mesh
   * @property {() => ({x: number, y: number, z: number}|null)} follow where it stands, or null once gone
   * @property {number} seconds left
   * @property {number} crack seconds into cracking away; -1 while whole
   */
  /** @type {Block[]} */
  const blocks = [];
  /** @type {Set<SimObject>} */
  const statues = new Set();
  /** @type {THREE.BoxGeometry|null} */
  let blockGeo = null;
  const scratch = new THREE.Vector3();
  const velocity = new THREE.Vector3();

  /**
   * A block of ice round something, for so long.
   * @param {() => ({x: number, y: number, z: number}|null)} follow
   * @param {number} width
   * @param {number} height
   * @param {number} seconds
   * @returns {void}
   */
  function encase(follow, width, height, seconds) {
    const b = blocks.find(v => v.seconds <= 0 && v.crack < 0) || null;
    if (!b) return;
    b.follow = follow;
    b.seconds = seconds;
    b.crack = -1;
    b.mesh.scale.set(width, height, width);
    b.mesh.visible = true;
    /** @type {THREE.MeshStandardMaterial} */ (b.mesh.material).opacity = 0.55;
  }

  /**
   * @param {any} e
   * @param {import('../enemies.js').EnemyKind} kind
   * @param {number} seconds
   * @returns {void}
   */
  function freezeEnemy(e, kind, seconds) {
    const enemies = ctx.systems.enemies;
    if (enemies.getState(e, 'frozen')) return;
    enemies.setState(e, 'frozen', seconds);
    const box = kind.hitbox ? kind.hitbox(e) : null;
    const width = box ? box.radius * 2.2 : 2.6;
    const height = box ? box.top * 1.05 : 6;
    encase(() => {
      if (!enemies.getState(e, 'frozen')) return null;
      const p = kind.position(e);
      return { x: p.x, y: height / 2, z: p.z };
    }, width, height, seconds);
  }

  /**
   * @param {number} seconds
   * @returns {boolean} whether he was frozen (not already, on foot, in play)
   */
  function freezeRoger(seconds) {
    const hero = ctx.systems.heroMode;
    if (!hero || !hero.freezeRoger(seconds)) return false;
    encase(() => {
      if (!hero.rogerFrozen()) return null;
      const r = hero.rogerTarget();
      return r ? { x: r.x, y: 1.3, z: r.z } : null;
    }, 1.8, 2.8, seconds);
    ctx.events.emit('notice', { text: `🧊 FROZEN · ${seconds} s` });
    return true;
  }

  /**
   * A townsperson turned to ice where they stand.
   * @param {SimObject} person
   * @returns {boolean} whether they were (grounded, not already)
   */
  function makeStatue(person) {
    const p = /** @type {any} */ (person);
    if (p.statue || !p.mesh || !p.mesh.parent || p.abducted || p.heroName || p.captureState !== 'grounded') return false;
    p.statue = true;
    if (p.motion) p.motion.active = false;
    p.velocity.set(0, 0, 0);
    p.mesh.traverse((/** @type {any} */ child) => {
      const m = child.material;
      if (m && m.color && m.emissive) {
        m.color.setHex(FREEZE.statueTint);
        m.emissive.setHex(FREEZE.statueEmissive);
        m.roughness = 0.15;
      }
    });
    statues.add(person);
    return true;
  }

  /**
   * A statue breaking into shards.
   * @param {SimObject} person
   * @returns {void}
   */
  function shatter(person) {
    if (!statues.delete(person)) return;
    const pos = person.mesh.position;
    const debris = ctx.systems.debris;
    for (let i = 0; i < FREEZE.shards; i++) {
      scratch.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.4 + Math.random() * 1.4, pos.z + (Math.random() - 0.5) * 0.6);
      velocity.set((Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8).add(person.velocity);
      if (debris) debris.spawnDebris(scratch, velocity, 0.2, 0.6 + Math.random() * 0.6, 'ice');
    }
    ctx.systems.explosions.spawnImpactBurst(scratch.set(pos.x, pos.y + 1, pos.z), 0.25);
    ctx.systems.people.explodePerson(person);
  }

  /** @returns {void} */
  function initFreeze() {
    blockGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < FREEZE.blocks; i++) {
      const mesh = new THREE.Mesh(blockGeo, new THREE.MeshStandardMaterial({
        color: 0xd8f0ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55,
        emissive: 0x16384f, depthWrite: false
      }));
      mesh.name = 'ice_block';
      mesh.visible = false;
      Sim.three.scene.add(mesh);
      blocks.push({ mesh, follow: () => null, seconds: 0, crack: -1 });
    }
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateFreeze(dt) {
    if (dt <= 0) return;
    for (const b of blocks) {
      if (!b.mesh.visible) continue;
      const mat = /** @type {THREE.MeshStandardMaterial} */ (b.mesh.material);
      if (b.crack >= 0) {
        b.crack += dt;
        const t = b.crack / FREEZE.thawCrack;
        b.mesh.scale.multiplyScalar(1 + dt * 1.5);
        mat.opacity = 0.55 * (1 - t);
        if (t >= 1) {
          b.mesh.visible = false;
          b.crack = -1;
          b.seconds = 0;
        }
        continue;
      }
      b.seconds -= dt;
      const at = b.follow();
      if (!at || b.seconds <= 0) {
        // Thawed (or what was inside is gone): it cracks away.
        b.seconds = 0;
        b.crack = 0;
        const p = b.mesh.position;
        ctx.systems.explosions.spawnImpactBurst(scratch.set(p.x, p.y, p.z), 0.15);
        continue;
      }
      b.mesh.position.set(at.x, at.y, at.z);
    }
    // Statues: anything moving one breaks it.
    for (const person of [...statues]) {
      const p = /** @type {any} */ (person);
      if (!p.mesh || !p.mesh.parent) {
        statues.delete(person);
        continue;
      }
      if (p.captureState !== 'grounded' || p.velocity.length() > FREEZE.shatterSpeed) shatter(person);
    }
  }

  /** @returns {void} */
  function resetFreeze() {
    for (const b of blocks) {
      b.mesh.visible = false;
      b.seconds = 0;
      b.crack = -1;
    }
    // The town is rebuilt with fresh people: nothing to thaw.
    statues.clear();
  }

  /** @returns {void} */
  function disposeFreeze() {
    for (const b of blocks) {
      Sim.three.scene.remove(b.mesh);
      /** @type {THREE.Material} */ (b.mesh.material).dispose();
    }
    blocks.length = 0;
    if (blockGeo) blockGeo.dispose();
    blockGeo = null;
    statues.clear();
  }

  return { freezeEnemy, freezeRoger, makeStatue, shatter, statueCount: () => statues.size, initFreeze, updateFreeze, resetFreeze, disposeFreeze };
}
