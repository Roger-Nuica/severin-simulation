// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AE.2 — Consumable: what the black hole can swallow
 * ===========================================================================
 * The Black Hole Gun (engine/player/blackHole.js) swallows everything but
 * the player. Rather than the hole knowing every system in the game, this
 * is the one place that says, for anything at all, three things:
 *   - where it is and how big (so the hole knows when it is in reach, and
 *     whether it is drawn in whole or dissolved);
 *   - its Object3D, which the hole moves, stretches or dissolves;
 *   - how to take it out of play quietly: no death explosion, no score
 *     burst of its own -- it is not killed, it is gone.
 *
 * Four families are covered by default, with nothing for their owners to do,
 * so anything added to them later is swallowed too:
 *   'person'   the townspeople (not Roger)
 *   'object'   everything in Sim.objects -- cars, trees, debris, train
 *              wagons, tankers, emergency vehicles, cows, power poles,
 *              highway spans... An object may carry its own
 *              `onConsumed()`; otherwise it is hidden and dropped from
 *              Sim.objects and the town's lists (the fallback).
 *   'building' every building, the shelters and the fuel stations included
 *   'enemy'    every kind in the enemy register (engine/enemies.js). A kind
 *              may give `consume(e)` (its owner's own quiet removal) and
 *              `object(e)` / `size(e)`; otherwise the fallback: frozen,
 *              marked absorbed and disintegrated (owners skip it), hidden.
 * And anything else registers a provider here (register): the UFOs, the
 * hunter ships, the mothership, the nuclear plants, the tornadoes.
 *
 * The fallback for anything that says no more than where it is: shrink,
 * fade, and its Object3D hidden.
 */

/**
 * @typedef {Object} Consumable one thing the hole can take
 * @property {string} family 'person' | 'object' | 'building' | 'enemy' | a provider's kind
 * @property {any} target the entity itself (the key the hole holds it by)
 * @property {THREE.Vector3|{x: number, y?: number, z: number}} pos where it is (live)
 * @property {THREE.Object3D|null} object what is moved / dissolved, if anything
 * @property {number} size metres across, roughly
 * @property {boolean} big dissolved where it stands rather than drawn in
 * @property {() => void} take out of its owner's control (it is caught)
 * @property {() => void} consume gone, quietly
 */

/**
 * @typedef {Object} ConsumableProvider anything outside the four families
 * @property {string} kind
 * @property {() => any[]} list
 * @property {(e: any) => {x: number, y?: number, z: number}} position
 * @property {(e: any) => THREE.Object3D|null} [object]
 * @property {(e: any) => number} [size]
 * @property {boolean} [big]
 * @property {(e: any) => void} [take]
 * @property {(e: any) => void} consume
 */

const BIG = 13;               // metres across: above this, dissolved in place
const box = new THREE.Box3();
const sphere = new THREE.Sphere();

/**
 * @param {Object} ctx
 * @returns {{
 *   register: (provider: ConsumableProvider) => void,
 *   each: (x: number, z: number, radius: number, visit: (target: any, d: number, make: () => Consumable|null, family: string) => void) => void,
 *   sizeOf: (object: THREE.Object3D|null) => number,
 *   resetConsumables: () => void
 * }}
 */
export function createConsumables(ctx) {
  const { Sim } = ctx;
  /** @type {ConsumableProvider[]} */
  const providers = [];
  /** @type {WeakMap<THREE.Object3D, number>} measured once */
  let sizes = new WeakMap();

  /**
   * @param {ConsumableProvider} provider
   * @returns {void}
   */
  function register(provider) {
    const i = providers.findIndex(p => p.kind === provider.kind);
    if (i !== -1) providers[i] = provider;
    else providers.push(provider);
  }

  /**
   * How big an Object3D is, across, measured once.
   * @param {THREE.Object3D|null} object
   * @returns {number}
   */
  function sizeOf(object) {
    if (!object) return 1;
    const known = sizes.get(object);
    if (known !== undefined) return known;
    box.setFromObject(object);
    const size = box.isEmpty() ? 1 : box.getBoundingSphere(sphere).radius * 2;
    sizes.set(object, size);
    return size;
  }

  /**
   * @param {any[]} list
   * @param {any} item
   * @returns {void}
   */
  function drop(list, item) {
    if (!list) return;
    const i = list.indexOf(item);
    if (i !== -1) list.splice(i, 1);
  }

  /**
   * The fallback: hidden, and out of every list the town keeps.
   * @param {any} obj
   * @returns {void}
   */
  function dropObject(obj) {
    obj.consumed = true;
    if (obj.mesh) obj.mesh.visible = false;
    drop(Sim.objects, obj);
    const env = ctx.Environment;
    if (env) {
      drop(env.cars, obj);
      drop(env.trees, obj);
      drop(env.people, obj);
    }
  }

  /**
   * @param {any} person
   * @returns {Consumable}
   */
  function person(person) {
    return {
      family: 'person', target: person, pos: person.mesh.position, object: person.mesh, size: 1.8, big: false,
      take: () => { if (person.motion) person.motion.active = false; },
      consume: () => {
        person.mesh.removeFromParent();
        // As people.explodePerson does: each person owns its materials.
        person.mesh.traverse((/** @type {any} */ o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        dropObject(person);
      }
    };
  }

  /**
   * @param {any} obj
   * @returns {Consumable|null}
   */
  function object(obj) {
    const pos = obj.pooled ? obj.position : obj.mesh && obj.mesh.position;
    if (!pos || obj.consumed) return null;
    const mesh = obj.pooled ? null : obj.mesh;
    const size = obj.pooled ? 1.5 : sizeOf(mesh);
    return {
      family: 'object', target: obj, pos, object: mesh, size, big: size > BIG,
      take: () => {
        obj.rooted = true;
        if (obj.velocity) obj.velocity.set(0, 0, 0);
      },
      consume: () => {
        if (typeof obj.onConsumed === 'function') {
          obj.onConsumed();
          obj.consumed = true;
          drop(Sim.objects, obj);
        } else if (obj.pooled) {
          ctx.systems.debris.releaseDebris(obj);
        } else {
          dropObject(obj);
        }
      }
    };
  }

  /**
   * @param {any} building
   * @returns {Consumable}
   */
  function building(building) {
    return {
      family: 'building', target: building, pos: building.mesh.position, object: building.mesh,
      size: sizeOf(building.mesh), big: true,
      take: () => {},
      consume: () => {
        building.damageState = 'collapsed';
        building.consumed = true;
        building.mesh.visible = false;
      }
    };
  }

  /**
   * @param {any} e
   * @param {import('../enemies.js').EnemyKind} kind
   * @returns {Consumable}
   */
  function enemy(e, kind) {
    const enemies = ctx.systems.enemies;
    const obj = kind.object ? kind.object(e) : (e.root || (e.rig && e.rig.root) || null);
    const size = kind.size ? kind.size(e) : (kind.hitbox ? Math.max(kind.hitbox(e).top, kind.hitbox(e).radius * 2) : sizeOf(obj));
    const at = kind.position(e);
    return {
      family: 'enemy', target: e, pos: obj ? obj.position : at, object: obj, size, big: size > BIG,
      take: () => {
        // Its own AI stops (every owner skips a frozen enemy).
        enemies.setState(e, 'frozen', 1e6);
        enemies.setState(e, 'absorbed');
      },
      consume: () => {
        enemies.setState(e, 'disintegrated');
        if (kind.consume) kind.consume(e);
        else if (obj) obj.visible = false;
      }
    };
  }

  /**
   * @param {ConsumableProvider} p
   * @param {any} e
   * @returns {Consumable}
   */
  function provided(p, e) {
    const obj = p.object ? p.object(e) : null;
    const size = p.size ? p.size(e) : sizeOf(obj);
    return {
      family: p.kind, target: e, pos: obj ? obj.position : p.position(e), object: obj, size,
      big: p.big !== undefined ? p.big : size > BIG,
      take: () => { if (p.take) p.take(e); },
      consume: () => p.consume(e)
    };
  }

  /**
   * Everything consumable within radius of (x, z), but the player: its
   * entity, how far, and how to describe it (made only when asked, so a
   * caller can skip what it already holds without building anything).
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {(target: any, d: number, make: () => Consumable|null, family: string) => void} visit
   * @returns {void}
   */
  function each(x, z, radius, visit) {
    /** @type {{target: any, make: () => Consumable|null, d: number, family: string}[]} */
    const found = [];
    ctx.systems.area.forEachInRadius({ x, z, radius }, (hit) => {
      const t = hit.target;
      if (t.consumed) return;
      if (hit.kind === 'person') {
        if (t.abducted || !t.mesh || !t.mesh.parent) return;
        found.push({ target: t, make: () => person(t), d: hit.d, family: 'person' });
      } else if (hit.kind === 'object') {
        if (t.playerControlled || (t.mesh && t.mesh.userData && t.mesh.userData.heroDriving)) return;
        found.push({ target: t, make: () => object(t), d: hit.d, family: 'object' });
      } else if (hit.kind === 'building') {
        if (t.damageState === 'collapsed' && !t.mesh.visible) return;
        found.push({ target: t, make: () => building(t), d: hit.d, family: 'building' });
      } else if (hit.kind === 'enemy' && hit.enemyKind) {
        const kind = hit.enemyKind;
        if (ctx.systems.enemies.getState(t, 'disintegrated')) return;
        found.push({ target: t, make: () => enemy(t, kind), d: hit.d, family: 'enemy' });
      }
    });
    for (const p of providers) {
      for (const e of p.list()) {
        const q = p.position(e);
        const d = Math.hypot(q.x - x, q.z - z);
        if (d <= radius) found.push({ target: e, make: () => provided(p, e), d, family: p.kind });
      }
    }
    // Collected first: consuming one can take it out of its owner's list.
    for (const f of found) visit(f.target, f.d, f.make, f.family);
  }

  /** @returns {void} */
  function resetConsumables() {
    sizes = new WeakMap();
  }

  return { register, each, sizeOf, resetConsumables };
}
