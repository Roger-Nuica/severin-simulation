// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION KT.5 -- What a slash can touch
 * ===========================================================================
 * Target rules for the Katana. Non-alien kinds are read from the one register
 * of enemies (ctx.systems.enemies.each); the crew come from the aliens owner's
 * additive `eachCuttable`, because the register's alien list omits `exiting`
 * crew and must stay as it is for the other weapons. No list is kept here.
 *
 *  - Only registry kind `alien`, in the phases `patrol`, `escort` or
 *    `exiting`, is cuttable. The hit goes through the alien adapter
 *    (aliens.js) as a `blade` hit carrying `cut`, which reaches the additive
 *    `sliceKill` (aliens/crew.js). `blade` is never sent to any other kind:
 *    the T-Rex accepts it for the samurai (R-020), the Katana must not use
 *    that door.
 *  - Every other registered kind in reach (the Terminator squad, the
 *    pursuers, T-Rex, Yeti, Patient Zero and clones, anything added later)
 *    parries: the clang and a few sparks, and no change at all to its state.
 *  - The samurai (friendly support, Q11) are ignored: no parry, no damage.
 *    The UFO, hunter ships and mothership are not in the register of
 *    enemies, so they are never found here.
 *
 * Presentation only: no score is added here (the base kill is scored once,
 * inside sliceKill, by damage.addDamageScore, R-027), and no `accepts` list
 * is read or changed. The search walks the register once, with preallocated
 * result arrays and one reusable visitor, so it allocates nothing per call
 * (R-044: up to 150 mutated aliens).
 */

/** Half the alien's width and a typical enemy's radius, metres (R-024). */
const ALIEN_RADIUS = 0.35;
/** The alien stands 1.4 m: feet, middle and head are tested against the blade's height (R-024). */
const ALIEN_SAMPLES = [0, 0.7, 1.4];
const DEFAULT_RADIUS = 0.6;
/** Registry kind names that are never targets (Q11). */
const IGNORED_KINDS = new Set(['samurai']);
/** The phases of an alien a blade can cut (Q6). */
const CUTTABLE_PHASES = new Set(['patrol', 'escort', 'exiting']);
/** The enemy capacity the register allows (R-048), the size of the result arrays. */
const MAX_RESULTS = 160;
/** Impact-burst strength for the sparks: the smallest the pool allows. */
const SPARK_STRENGTH = 0.4;

/**
 * @typedef {Object} Reach
 * @property {number} x the blade's origin, world metres
 * @property {number} z
 * @property {number} dirX the forward direction on the ground, unit length
 * @property {number} dirZ
 * @property {number} reach metres
 * @property {number} cosArc cosine of the half-angle of the forward arc
 * @property {number} [y] the blade's height; when given, an alien is also
 *   tested at its feet, middle and head (a stacked three-point test, R-024)
 */

/**
 * @typedef {Object} CutPlaneLike the slash's reusable cut plane (slash.js CutPlane)
 * @property {THREE.Vector3} point re-aimed at each alien's chest as it is cut
 * @property {THREE.Vector3} normal
 */

/**
 * @typedef {Object} StrikeResult
 * @property {number} cut how many aliens were cut
 * @property {boolean} parried whether the blade met something it must not cut
 */

/**
 * Whether `kind` should be skipped outright.
 * @param {{kind: string}} kind
 * @returns {boolean}
 */
export const isIgnoredKind = (kind) => IGNORED_KINDS.has(kind.kind);

/**
 * Whether an alien is in a phase the blade can cut.
 * @param {{phase: string}} alien
 * @returns {boolean}
 */
export const isCuttablePhase = (alien) => CUTTABLE_PHASES.has(alien.phase);

/**
 * Whether a point on the ground is inside the reach and forward arc.
 * @param {Reach} r
 * @param {number} x
 * @param {number} z
 * @param {number} radius the target's own radius, metres
 * @returns {boolean}
 */
export function inReach(r, x, z, radius) {
  const dx = x - r.x;
  const dz = z - r.z;
  const d = Math.hypot(dx, dz);
  if (d > r.reach + radius) return false;
  // Right on top of the blade's origin: inside the arc whichever way it faces.
  if (d < 0.05) return true;
  return (dx * r.dirX + dz * r.dirZ) / d >= r.cosArc;
}

/**
 * Whether the blade's height reaches the alien: the nearest of its feet,
 * middle and head, in three dimensions, is inside the reach.
 * @param {Reach} r with `y` set
 * @param {{x: number, y: number, z: number}} p the alien's root
 * @returns {boolean}
 */
export function reachesStack(r, p) {
  const ground = Math.hypot(p.x - r.x, p.z - r.z);
  const by = r.y === undefined ? 0 : r.y;
  let gap = Infinity;
  for (let i = 0; i < ALIEN_SAMPLES.length; i++) gap = Math.min(gap, Math.abs(p.y + ALIEN_SAMPLES[i] - by));
  return Math.hypot(ground, gap) <= r.reach + ALIEN_RADIUS;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   find: (r: Reach) => {cuttable: any[], cuttableCount: number, parryable: any[], parryCount: number},
 *   strike: (r: Reach, onRoot?: (root: THREE.Object3D, plane?: CutPlaneLike, skin?: THREE.Material) => void, plane?: CutPlaneLike) => StrikeResult,
 *   strikeAlong: (r: Reach, touches: (x: number, y: number, z: number, height: number, radius: number) => boolean, bodyRadius: number, onRoot?: (root: THREE.Object3D, plane?: CutPlaneLike, skin?: THREE.Material) => void, plane?: CutPlaneLike) => StrikeResult,
 *   parry: (x: number, y: number, z: number) => void
 * }}
 */
export function createKatanaTargets(ctx) {
  /** @type {any[]} */
  const cuttable = new Array(MAX_RESULTS);
  /** @type {any[]} */
  const parryable = new Array(MAX_RESULTS);
  /** @type {{cuttable: any[], cuttableCount: number, parryable: any[], parryCount: number}} */
  const found = { cuttable, cuttableCount: 0, parryable, parryCount: 0 };
  /** @type {Reach} */
  let query = { x: 0, z: 0, dirX: 0, dirZ: 1, reach: 0, cosArc: 0 };
  /** The nearest thing parried, for the sparks. */
  const sparkAt = new THREE.Vector3();
  let sparkDist = Infinity;
  /** The registry kind of each cuttable alien, parallel to `cuttable`. */
  /** @type {any[]} */
  const cuttableKinds = new Array(MAX_RESULTS);
  /** The registry kind of each parryable thing, parallel to `parryable`. */
  /** @type {any[]} */
  const parryKinds = new Array(MAX_RESULTS);
  /** Reused hit, so a strike does not allocate per alien. */
  /** @type {{type: 'blade', at: {x: number, y: number, z: number}, cut: {takeOver?: (root: THREE.Object3D, plane?: CutPlaneLike, skin?: THREE.Material) => void, plane?: CutPlaneLike}}} */
  const hit = { type: 'blade', at: { x: 0, y: 1, z: 0 }, cut: {} };

  /**
   * The register's visitor, created once.
   * @param {any} e
   * @param {{kind: string, position: (e: any) => {x: number, z: number}, hitbox?: (e: any) => {radius: number}}} kind
   * @returns {void}
   */
  function visit(e, kind) {
    if (isIgnoredKind(kind)) return;
    const p = kind.position(e);
    // Aliens are found through visitAlien instead (the registry's list holds
    // no `exiting` crew), so they are skipped here to avoid a double count.
    if (kind.kind === 'alien') return;
    const radius = kind.hitbox ? kind.hitbox(e).radius : DEFAULT_RADIUS;
    if (!inReach(query, p.x, p.z, radius)) return;
    if (found.parryCount < MAX_RESULTS) {
      parryKinds[found.parryCount] = kind;
      parryable[found.parryCount++] = e;
    }
    const d = Math.hypot(p.x - query.x, p.z - query.z);
    if (d < sparkDist) {
      sparkDist = d;
      sparkAt.set((p.x + query.x) * 0.5, 1.0, (p.z + query.z) * 0.5);
    }
  }

  /**
   * The aliens' own visitor (aliens.eachCuttable), created once: the
   * Katana's additive path to patrol, escort and exiting crew.
   * @param {any} e
   * @param {any} kind the alien's registry kind, for enemies.hit
   * @returns {void}
   */
  function visitAlien(e, kind) {
    if (!isCuttablePhase(e) || !inReach(query, e.root.position.x, e.root.position.z, ALIEN_RADIUS)) return;
    if (query.y !== undefined && !reachesStack(query, e.root.position)) return;
    if (found.cuttableCount < MAX_RESULTS) {
      cuttableKinds[found.cuttableCount] = kind;
      cuttable[found.cuttableCount++] = e;
    }
  }

  /**
   * Everything in reach this frame. The arrays are reused by the next call.
   * @param {Reach} r
   * @returns {{cuttable: any[], cuttableCount: number, parryable: any[], parryCount: number}}
   */
  function find(r) {
    query = r;
    found.cuttableCount = 0;
    found.parryCount = 0;
    sparkDist = Infinity;
    ctx.systems.enemies.each(visit);
    if (ctx.systems.aliens) ctx.systems.aliens.eachCuttable(visitAlien);
    return found;
  }

  /**
   * The clang and a few sparks. The sparks use the pooled impact burst at its
   * smallest, and only while the shared particle budget has room (R-048).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function parry(x, y, z) {
    const systems = ctx.systems;
    if (systems.katanaSound) systems.katanaSound.playParry();
    if (systems.explosions && systems.caps && systems.caps.particleRoom() > 0) {
      systems.explosions.spawnImpactBurst(sparkAt.set(x, y, z), SPARK_STRENGTH);
    }
  }

  /**
   * One slash landing: every cuttable alien in reach is cut (through the
   * register, so the owner's own rules apply), and if anything else was in
   * reach the blade parries once. Scoring happens in the owner.
   * @param {Reach} r
   * @param {(root: THREE.Object3D, plane?: CutPlaneLike, skin?: THREE.Material) => void} [onRoot]
   *   receives the root of each alien cut, which it then owns, with the cut
   *   plane and the alien's skin (see crew.js sliceKill)
   * @param {CutPlaneLike} [plane] the cut's plane, handed on as `cut.plane`
   * @returns {StrikeResult}
   */
  function strike(r, onRoot, plane) {
    const f = find(r);
    let cutCount = 0;
    hit.cut.takeOver = onRoot;
    hit.cut.plane = plane;
    for (let i = 0; i < f.cuttableCount; i++) {
      const alien = f.cuttable[i];
      const p = alien.root.position;
      hit.at.x = p.x;
      hit.at.y = 1.0;
      hit.at.z = p.z;
      if (plane) plane.point.set(p.x, p.y + 0.7, p.z);
      if (ctx.systems.enemies.hit(alien, cuttableKinds[i], hit)) cutCount++;
      f.cuttable[i] = null;
    }
    hit.cut.takeOver = undefined;
    hit.cut.plane = undefined;
    const parried = f.parryCount > 0;
    if (parried) {
      parry(sparkAt.x, sparkAt.y, sparkAt.z);
      for (let i = 0; i < f.parryCount; i++) f.parryable[i] = null;
    }
    return { cut: cutCount, parried };
  }

  /**
   * A cut along a line (Blade Mode): as `strike`, but only the aliens and
   * the other kinds that `touches` accepts are cut or parried, and the plane
   * is NOT re-aimed (it already holds the drawn line, so moving its point to
   * each chest would slide the cut off the line).
   * @param {Reach} r who is in range of Roger
   * @param {(x: number, y: number, z: number, height: number, radius: number) => boolean} touches
   *   whether the line passes through a body standing at (x, y, z), `height` tall
   * @param {number} bodyRadius how near the line must pass to an alien, metres
   * @param {(root: THREE.Object3D, plane?: CutPlaneLike, skin?: THREE.Material) => void} [onRoot]
   * @param {CutPlaneLike} [plane] handed on as `cut.plane`, unchanged
   * @returns {StrikeResult}
   */
  function strikeAlong(r, touches, bodyRadius, onRoot, plane) {
    const f = find(r);
    let cutCount = 0;
    hit.cut.takeOver = onRoot;
    hit.cut.plane = plane;
    for (let i = 0; i < f.cuttableCount; i++) {
      const alien = f.cuttable[i];
      f.cuttable[i] = null;
      // An alien that died or changed phase meanwhile is skipped by the owner too.
      if (!isCuttablePhase(alien)) continue;
      const p = alien.root.position;
      if (!touches(p.x, p.y, p.z, ALIEN_SAMPLES[ALIEN_SAMPLES.length - 1], bodyRadius)) continue;
      hit.at.x = p.x;
      hit.at.y = 1.0;
      hit.at.z = p.z;
      if (ctx.systems.enemies.hit(alien, cuttableKinds[i], hit)) cutCount++;
    }
    hit.cut.takeOver = undefined;
    hit.cut.plane = undefined;
    let parried = false;
    for (let i = 0; i < f.parryCount; i++) {
      const kind = parryKinds[i];
      const p = kind.position(f.parryable[i]);
      const radius = kind.hitbox ? kind.hitbox(f.parryable[i]).radius : DEFAULT_RADIUS;
      if (!parried && touches(p.x, 0, p.z, 2.0, radius)) {
        parried = true;
        sparkAt.set(p.x, 1.0, p.z);
      }
      f.parryable[i] = null;
      parryKinds[i] = null;
    }
    if (parried) parry(sparkAt.x, sparkAt.y, sparkAt.z);
    return { cut: cutCount, parried };
  }

  return { find, strike, strikeAlong, parry };
}
