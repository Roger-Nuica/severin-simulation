// @ts-check
import { fullHealth, healthAfter, tableDamage } from './health/enemyDamage.js';
/**
 * ===========================================================================
 * SECTION EN — Enemies
 * ===========================================================================
 * One register of everything that fights the hero, whatever system owns it:
 * the aliens (aliens.js), the Terminator squad (terminator.js), the machines
 * sent after Roger (hero/pursuers.js), and the enemies still to come (the
 * cyber T-Rex, the Yeti, Patient Zero). Each owner registers its kind once,
 * in its init, with an adapter:
 *
 *   list()                 its enemies alive now
 *   position(e)            where one is ({x, z}, world units)
 *   accepts                the kinds of damage it answers to: its weaknesses
 *                          and old rules, handled by its own `damage`
 *   damage(e, hit)         one hit: {type, amount?, at?, mega?}; returns
 *                          whether it was stopped (killed, knocked down)
 *   defeat(e, hit)         optional: takes it down through its normal kill
 *                          path when its health is used up (see below)
 *
 * Kinds of damage: 'plasma' (the rifle; mega for the mega beam), 'bullet'
 * (the minigun), 'bolt' (lightning, the railgun), 'emp', 'fire', 'freeze',
 * 'gravity' (the black hole), 'cleanse' (Mr. Proper), 'blade' (a samurai's
 * sword, Landing Support: `amount` is the cut; the Katana's blow on a kind
 * that is not an alien carries no cut), 'throw' (a car thrown by
 * telekinesis, player/telekinesis.js).
 *
 * Health (decision D1: every weapon hurts every enemy; the old immunities
 * became weaknesses). Each enemy has the health of engine/health/damageTable.js
 * and every hit on it, whatever the weapon, takes the table's damage for that
 * (weapon, kind) off it. The health lives in this register, per instance
 * (a WeakMap), so an owner keeps its own state. A hit of a kind in `accepts`
 * still reaches the owner's `damage` exactly as before (stun, knockdown,
 * kill): the weaknesses are unchanged. A hit of a kind NOT in `accepts` is no
 * longer ignored: it chips the health, with no effect of its own and no
 * particles; when the health reaches 0 the owner's `defeat` takes the enemy
 * down through its normal kill path, which scores it once. A hit of a
 * kind with no weapon column ('freeze', 'gravity', 'cleanse') does nothing
 * to a kind that does not accept it. The black hole stays an outright kill
 * through `consume`.
 *
 * Besides their owners' own state, enemies can be in a few states every
 * system shares (setState): 'frozen' (for a time), 'disintegrated' and
 * 'absorbed'. The new abilities and enemies use them; the owners read them
 * with getState.
 *
 * The existing weapons keep calling their targets directly; this register
 * is what the new area effects (engine/effects/area.js) and abilities go
 * through, and what the entity caps count (engine/perf/caps.js).
 */

/** @typedef {'plasma'|'bullet'|'bolt'|'emp'|'fire'|'freeze'|'gravity'|'cleanse'|'blade'|'throw'} DamageType */
/**
 * `cut` is only read by the aliens' adapter, for the Katana's blade hit: the
 * alien is removed and `takeOver` receives its root (see crew.js sliceKill).
 * `plane` is the slash's cut plane in world space (a point on it and its
 * normal), for the slicing core: the alien's owner hands it, with the root
 * and the alien's skin, to `takeOver`.
 * @typedef {{type: DamageType, amount?: number, at?: {x: number, y?: number, z: number}, mega?: boolean, cut?: {takeOver?: (root: import('three').Object3D, plane?: any, skin?: import('three').Material) => void, plane?: {point: {x: number, y: number, z: number}, normal: {x: number, y: number, z: number}}}}} Hit
 */
/** @typedef {'frozen'|'disintegrated'|'absorbed'} EnemyState */

/**
 * @typedef {Object} EnemyKind
 * @property {string} kind
 * @property {() => any[]} list
 * @property {(e: any) => {x: number, z: number}} position
 * @property {DamageType[]} accepts
 * @property {(e: any, hit: Hit) => boolean} damage
 * @property {(e: any) => {x: number, z: number, radius: number, top: number}} [hitbox]
 *   a kind with one can be aimed at and hit by Roger's rifle and minigun
 *   (hero/plasma.js traceAim), as a standing cylinder
 * @property {(e: any, hit: Hit) => boolean} [defeat] its health is used up:
 *   take it down through the owner's normal kill path (scoring once, a no-op
 *   if it is already down); returns whether it was stopped
 * @property {(e: any) => void} [consume] taken by the black hole: the owner
 *   takes it out of play quietly, with no death of its own
 *   (engine/effects/consumables.js; without one it is frozen and hidden)
 * @property {(e: any) => import('three').Object3D|null} [object] what to
 *   move or dissolve, when it is not e.root / e.rig.root
 * @property {(e: any) => number} [size] metres across
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   registerKind: (kind: EnemyKind) => void,
 *   kinds: () => EnemyKind[],
 *   each: (visit: (e: any, kind: EnemyKind) => void) => void,
 *   count: (kind?: string) => number,
 *   hit: (e: any, kind: EnemyKind, hit: Hit) => boolean,
 *   setState: (e: any, state: EnemyState, seconds?: number) => void,
 *   getState: (e: any, state: EnemyState) => boolean,
 *   updateEnemies: (dt: number) => void,
 *   resetEnemies: () => void
 * }}
 */
export function createEnemyRegistry(ctx) {
  void ctx;
  /** @type {Map<string, EnemyKind>} */
  const registered = new Map();
  /** @type {Map<any, {frozen: number, disintegrated: boolean, absorbed: boolean}>} */
  let states = new Map();
  /**
   * The health each enemy has left, per instance, set at its first hit. A
   * WeakMap: an enemy nobody holds any more takes its entry with it.
   * @type {WeakMap<object, number>}
   */
  let healths = new WeakMap();

  /**
   * @param {EnemyKind} kind
   * @returns {void}
   */
  function registerKind(kind) {
    registered.set(kind.kind, kind);
  }

  /** @returns {EnemyKind[]} */
  function kinds() {
    return [...registered.values()];
  }

  /**
   * Every enemy alive now, of every kind.
   * @param {(e: any, kind: EnemyKind) => void} visit
   * @returns {void}
   */
  function each(visit) {
    for (const kind of registered.values()) {
      for (const e of kind.list()) visit(e, kind);
    }
  }

  /**
   * @param {string} [kind] one kind, or all
   * @returns {number}
   */
  function count(kind) {
    if (kind) {
      const k = registered.get(kind);
      return k ? k.list().length : 0;
    }
    let n = 0;
    for (const k of registered.values()) n += k.list().length;
    return n;
  }

  /**
   * One hit on one enemy (D1, see the header). A kind the owner accepts goes
   * to its `damage` unchanged; every hit with a table value, accepted or
   * not, also takes health, and an enemy out of health is taken down by the
   * owner's `defeat` (once: it is then no longer listed, and `defeat` is a
   * no-op on one that is down). No allocation per hit.
   * @param {any} e
   * @param {EnemyKind} kind
   * @param {Hit} h
   * @returns {boolean} whether it was stopped
   */
  function hit(e, kind, h) {
    const accepted = kind.accepts.includes(h.type);
    const damage = kind.defeat ? tableDamage(kind.kind, h) : 0;
    if (!accepted && damage <= 0) return false;
    let stopped = accepted ? kind.damage(e, h) : false;
    if (stopped || damage <= 0 || !kind.defeat) return stopped;
    const left = healthAfter(healths.has(e) ? /** @type {number} */ (healths.get(e)) : fullHealth(kind.kind), damage);
    healths.set(e, left);
    return left <= 0 ? kind.defeat(e, h) : false;
  }

  /**
   * @param {any} e
   * @param {EnemyState} state
   * @param {number} [seconds] how long, for 'frozen'
   * @returns {void}
   */
  function setState(e, state, seconds = 0) {
    let s = states.get(e);
    if (!s) {
      s = { frozen: 0, disintegrated: false, absorbed: false };
      states.set(e, s);
    }
    if (state === 'frozen') s.frozen = Math.max(s.frozen, seconds);
    else s[state] = true;
  }

  /**
   * @param {any} e
   * @param {EnemyState} state
   * @returns {boolean}
   */
  function getState(e, state) {
    const s = states.get(e);
    if (!s) return false;
    return state === 'frozen' ? s.frozen > 0 : s[state];
  }

  /**
   * The frozen enemies thawing, on the world's time; and the states of
   * enemies that are no longer anywhere forgotten.
   * @param {number} dt
   * @returns {void}
   */
  function updateEnemies(dt) {
    if (!states.size) return;
    for (const [e, s] of states) {
      if (s.frozen > 0) s.frozen = Math.max(0, s.frozen - dt);
      if (s.frozen <= 0 && !s.disintegrated && !s.absorbed) states.delete(e);
    }
  }

  /** @returns {void} */
  function resetEnemies() {
    states = new Map();
    healths = new WeakMap();
  }

  return { registerKind, kinds, each, count, hit, setState, getState, updateEnemies, resetEnemies };
}
