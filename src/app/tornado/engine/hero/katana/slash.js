// @ts-check
import * as THREE from 'three';
import { HERO } from '../config.js';
import { createKatanaTargets } from './targets.js';

/**
 * ===========================================================================
 * SECTION KT.6 -- Quick Slash
 * ===========================================================================
 * A short press of the left button with the Katana drawn is a quick slash.
 *
 *  - Which slash: the mouse's accumulated movement over the press picks it.
 *    A swipe of SWIPE_MIN_PX or more is read in screen space: up or down is a
 *    vertical, left or right a horizontal, in between a diagonal (two
 *    directions). A plain click runs the automatic chain diagonal,
 *    horizontal, vertical, which starts over after CHAIN_IDLE seconds idle.
 *  - What it touches: everything inside REACH metres and a forward arc, found
 *    by targets.js (a stacked three-point height test, R-024). Aliens are cut
 *    through the register; every other kind parries and takes the table's
 *    chip (a plain `blade` hit, D1: see targets.js). The strike lands
 *    STRIKE_DELAY seconds after the press, at the blade's strike (the
 *    model's wind-up), not at the press.
 *  - The auto-lunge: during that wind-up Roger slides towards the nearest
 *    cuttable alien in front (looked for up to LUNGE_MAX metres away), at
 *    most LUNGE_SLIDE metres -- a nudge, barely noticed -- stopping
 *    LUNGE_STOP metres short. Every step is tested with the movement helpers (blockedAt,
 *    pushOut) so he never enters a building or leaves HERO.bound, and nothing
 *    runs while he is dazed, frozen, driving or dying.
 *  - The cooldown is COOLDOWN seconds on the weapons' real-time clock
 *    (R-029, R-032): Time Slow does not stretch it. A held button does not
 *    repeat.
 *  - The cut plane (CutPlane): a point and a normal in world space, built
 *    from the swipe direction (screen right and up, taken from the camera)
 *    and Roger's heading (forward), exactly as placeFollowCamera frames him.
 *    It is one reusable object, handed to every alien hit as `cut.plane`
 *    (additive to `cut.takeOver`, see enemies.js) and kept as `lastCut` for
 *    later subtasks (the slicing core, Blade Mode lines). For each alien the
 *    point is re-aimed at its chest, so the plane always passes through the
 *    body being cut.
 *
 * Input and presentation only: a landed cut is reported to feel.js (hit-stop,
 * shake, combo event, bonus score); the base kill is scored once, in the
 * alien owner's sliceKill, and never here.
 * All state lives in the closure, made per simulation and cleared with
 * `cancel`; no allocation happens per slash or per frame (R-048).
 */

/** How far the blade reaches from Roger, metres (3 until 2026-10-02). */
const REACH = 6.0;
/** Half-angle of the forward arc the cut lands in, cosine of 60 degrees. */
const COS_STRIKE_ARC = 0.5;
/** Half-angle of the arc the lunge looks in, cosine of 45 degrees (narrower, so the cut still lands). */
const COS_LUNGE_ARC = Math.SQRT1_2;
/** The furthest an alien can be for Roger to lunge at it, metres. */
const LUNGE_MAX = 6.0;
/** The furthest the lunge slides him, metres: a nudge (it was up to LUNGE_MAX until 2026-10-02). */
const LUNGE_SLIDE = 0.4;
/** How close the lunge brings him to the alien's centre, metres (inside REACH). */
const LUNGE_STOP = 1.6;
/** The blade's height above Roger's feet, metres. */
const BLADE_HEIGHT = 1.1;
/** Real seconds between slashes. */
const COOLDOWN = 0.35;
/** Real seconds from the press to the blade's strike (the model's wind-up is 0.3 of 0.26 s). */
const STRIKE_DELAY = 0.08;
/** A swipe shorter than this, in pixels, is a plain click. */
const SWIPE_MIN_PX = 28;
/** Tangent of 67.5 degrees: beyond it a swipe counts as straight along one axis. */
const AXIS_TAN = 2.414;
/** Real seconds idle after which the click chain starts over. */
const CHAIN_IDLE = 1.2;
/** The automatic chain for plain clicks, in order. */
const CHAIN = /** @type {const} */ (['diagonalLeft', 'horizontal', 'vertical']);
/** How high above an alien's root the cut passes, metres (its chest; it is 1.4 m tall). */
const ALIEN_CHEST = 0.7;

/**
 * @typedef {import('./model.js').SlashKind} SlashKind
 */

/**
 * @typedef {Object} CutPlane the cut as a plane in world space, one reusable
 *   object (shared with the slicing core)
 * @property {THREE.Vector3} point a point on the plane, metres
 * @property {THREE.Vector3} normal unit normal (its sign is arbitrary)
 * @property {SlashKind} kind the slash that made it
 */

/**
 * @typedef {Object} KatanaSlashEnv what the slash needs from Hero Mode
 * @property {() => number} heading Roger's heading, radians (S.state.heading)
 * @property {() => boolean} canAct on foot, upright and not frozen
 * @property {() => ({slash: (kind: SlashKind) => boolean, isSlashing: () => boolean}|null)} rig
 * @property {() => THREE.Vector3} position Roger's position, mutated by the lunge
 * @property {(x: number, z: number, pad: number) => boolean} blockedAt
 * @property {(p: THREE.Vector3, pad: number) => void} pushOut
 * @property {() => (import('./pieces.js').KatanaPieces|null)} [pieces] the
 *   slicing core (made on first use by heroWeapons.js); without it a cut alien
 *   is simply removed
 * @property {() => (import('./feel.js').KatanaFeel|null)} [feel] the cut's
 *   hit-stop, shake, combo event and bonus score (feel.js); without it a
 *   landed cut has no feel and earns no bonus
 */

/**
 * @typedef {Object} KatanaRelease
 * @property {number} dx swipe movement along x, pixels
 * @property {number} dy swipe movement along y, pixels
 */

/**
 * The slash a swipe asks for.
 * @param {number} dx pixels, right positive
 * @param {number} dy pixels, down positive
 * @returns {SlashKind}
 */
export function classifySwipe(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= ax * AXIS_TAN) return dy > 0 ? 'vertical' : 'verticalUp';
  // The blade of 'horizontal' sweeps from Roger's left to his right (the
  // model's yaw +1.1 to -1.0), which is a swipe to the right on screen.
  if (ax >= ay * AXIS_TAN) return dx > 0 ? 'horizontal' : 'horizontalBack';
  // Down-right (and its reverse) is the diagonal that starts high on the
  // left, the other pair its mirror.
  return dx * dy > 0 ? 'diagonalLeft' : 'diagonalRight';
}

/**
 * The swipe a click-chain slash stands for, in screen right and up.
 * @param {SlashKind} kind
 * @param {{x: number, y: number}} out written in place
 * @returns {{x: number, y: number}} out
 */
function canonicalSwipe(kind, out) {
  switch (kind) {
    case 'vertical': return Object.assign(out, { x: 0, y: -1 });
    case 'verticalUp': return Object.assign(out, { x: 0, y: 1 });
    case 'horizontal': return Object.assign(out, { x: 1, y: 0 });
    case 'horizontalBack': return Object.assign(out, { x: -1, y: 0 });
    case 'diagonalLeft': return Object.assign(out, { x: 1, y: -1 });
    default: return Object.assign(out, { x: -1, y: -1 });
  }
}

/**
 * @param {Object} ctx
 * @param {KatanaSlashEnv} env
 * @returns {{
 *   release: (r: KatanaRelease) => boolean,
 *   update: (dt: number) => void,
 *   cancel: () => void,
 *   lastCut: CutPlane
 * }}
 */
export function createKatanaSlash(ctx, env) {
  const targets = createKatanaTargets(ctx);
  /** @type {CutPlane} */
  const cut = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), kind: 'vertical' };
  /** The reach query, one object reused for the lunge search and the strike. */
  const reach = { x: 0, z: 0, y: BLADE_HEIGHT, dirX: 0, dirZ: 1, reach: REACH, cosArc: COS_STRIKE_ARC };
  const swipe = { x: 0, y: 0 };
  const right = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const along = new THREE.Vector3();
  /** Where the slash landed, for the shake falloff. */
  const landedAt = new THREE.Vector3();

  let clock = 0;
  let cooldown = 0;
  let lastSlashAt = -Infinity;
  let chain = 0;
  /** The strike waiting for its moment, and the lunge on the way to it. */
  const pending = { active: false, timer: 0, lunge: 0, lungeSpeed: 0, dirX: 0, dirZ: 0 };

  /**
   * Aims the shared cut plane: the swipe's direction on screen (right and
   * up), turned into the world with the camera's right and Roger's heading.
   * @param {SlashKind} kind
   * @param {number} sx screen right component
   * @param {number} sy screen up component
   * @returns {void}
   */
  function aimPlane(kind, sx, sy) {
    const h = env.heading();
    forward.set(Math.sin(h), 0, Math.cos(h));
    // The camera's right, flattened to the ground; Roger's own right if the
    // camera is looking straight down.
    const cam = ctx.Sim.three.camera;
    const e = cam.matrixWorld.elements;
    right.set(e[0], 0, e[2]);
    if (right.lengthSq() < 1e-6) right.set(-Math.cos(h), 0, Math.sin(h));
    right.normalize();
    // The blade's travel: screen right and world up.
    along.copy(right).multiplyScalar(sx);
    along.y = sy;
    along.normalize();
    // The plane holds the blade's travel and the way he faces.
    cut.normal.crossVectors(forward, along);
    if (cut.normal.lengthSq() < 1e-6) cut.normal.set(Math.cos(h), 0, -Math.sin(h));
    cut.normal.normalize();
    cut.kind = kind;
  }

  /**
   * The nearest cuttable alien or civilian in front, for the lunge.
   * @param {THREE.Vector3} p Roger
   * @param {number} h his heading
   * @returns {boolean} whether there is one; if so `pending.dir*` points at it
   *   and `pending.lunge` is how far to slide
   */
  function aimLunge(p, h) {
    reach.x = p.x;
    reach.z = p.z;
    reach.y = BLADE_HEIGHT + p.y;
    reach.dirX = Math.sin(h);
    reach.dirZ = Math.cos(h);
    reach.reach = LUNGE_MAX;
    reach.cosArc = COS_LUNGE_ARC;
    const f = targets.find(reach);
    let best = Infinity;
    for (let i = 0; i < f.cuttableCount; i++) {
      const a = f.cuttable[i];
      // An alien stands at its `root`, a civilian at its `mesh` (no registry kind).
      const at = a.root ? a.root.position : a.mesh.position;
      const dx = at.x - p.x;
      const dz = at.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < best) {
        best = d;
        pending.dirX = dx / (d || 1);
        pending.dirZ = dz / (d || 1);
      }
      f.cuttable[i] = null;
    }
    for (let i = 0; i < f.parryCount; i++) f.parryable[i] = null;
    if (best === Infinity) return false;
    pending.lunge = Math.min(LUNGE_SLIDE, Math.max(0, best - LUNGE_STOP));
    pending.lungeSpeed = pending.lunge / STRIKE_DELAY;
    return true;
  }

  /**
   * The blade lands: the cut aliens go through the register, the rest parry and are chipped.
   * @returns {void}
   */
  function land() {
    const p = env.position();
    const h = env.heading();
    reach.x = p.x;
    reach.z = p.z;
    reach.y = BLADE_HEIGHT + p.y;
    reach.dirX = Math.sin(h);
    reach.dirZ = Math.cos(h);
    reach.reach = REACH;
    reach.cosArc = COS_STRIKE_ARC;
    // The other Rogers in the arc take a cut too (co-op friendly fire, R-053): once
    // per landing, through health.damagePlayer; nothing outside a room.
    if (ctx.systems.net) ctx.systems.net.hurtSector('0', reach.x, reach.z, reach.dirX, reach.dirZ, REACH, COS_STRIKE_ARC, 0.05, 'blade', 'melee', 'Cut down by');
    // Aimed again: Roger may have turned or slid since the press.
    cut.point.set(p.x + reach.dirX * REACH * 0.5, reach.y, p.z + reach.dirZ * REACH * 0.5);
    // The slicing core: pieces already lying about are cut again first (so
    // the halves this very slash makes are not), then the aliens are handed
    // over to it. Without it the alien's owner just removes them.
    const pieces = env.pieces ? env.pieces() : null;
    const recut = pieces ? pieces.cutInReach(reach, cut) : 0;
    // `cut.point` is re-aimed at each alien by the strike, so the landing is kept first.
    landedAt.copy(cut.point);
    const result = targets.strike(reach, pieces ? pieces.takeOver : undefined, cut);
    if (result.cut > 0 || result.people > 0 || recut > 0) {
      if (ctx.systems.katanaSound) ctx.systems.katanaSound.playSlice();
      // A killing breaks Smooth Criminal's spell, as the other weapons' do.
      ctx.events.emit('rogerKill');
      const feel = env.feel ? env.feel() : null;
      if (feel) feel.cut(result.cut, recut, landedAt, result.people);
    }
  }

  /**
   * One step of the lunge, along the line to the alien, stopped by anything
   * solid and kept inside the map.
   * @param {number} dt real seconds
   * @returns {void}
   */
  function lungeStep(dt) {
    if (pending.lunge <= 0) return;
    const p = env.position();
    const step = Math.min(pending.lunge, pending.lungeSpeed * dt);
    const x = p.x + pending.dirX * step;
    const z = p.z + pending.dirZ * step;
    if (env.blockedAt(x, z, HERO.pad)) {
      pending.lunge = 0;
      return;
    }
    p.x = x;
    p.z = z;
    pending.lunge -= step;
    env.pushOut(p, HERO.pad * 0.5);
  }

  /**
   * The button came up: a quick slash, if it is one and the blade is ready.
   * @param {KatanaRelease} r
   * @returns {boolean} whether a slash started
   */
  function release(r) {
    // Blade Mode (blade.js, offered the release first by heroWeapons.js) takes
    // the release while it is on, so a quick slash is only ever made outside it.
    const rig = env.rig();
    if (!rig || !env.canAct() || cooldown > 0 || pending.active || rig.isSlashing()) return false;

    const swiped = Math.hypot(r.dx, r.dy) >= SWIPE_MIN_PX;
    /** @type {SlashKind} */
    let kind;
    if (swiped) {
      kind = classifySwipe(r.dx, r.dy);
      const m = Math.hypot(r.dx, r.dy);
      swipe.x = r.dx / m;
      swipe.y = -r.dy / m;
    } else {
      if (clock - lastSlashAt > CHAIN_IDLE) chain = 0;
      kind = CHAIN[chain % CHAIN.length];
      canonicalSwipe(kind, swipe);
    }
    if (!rig.slash(kind)) return false;
    if (!swiped) chain = (chain + 1) % CHAIN.length;

    aimPlane(kind, swipe.x, swipe.y);
    cooldown = COOLDOWN;
    lastSlashAt = clock;
    pending.active = true;
    pending.timer = STRIKE_DELAY;
    pending.lunge = 0;
    pending.lungeSpeed = 0;
    aimLunge(env.position(), env.heading());
    if (ctx.systems.katanaSound) ctx.systems.katanaSound.playSwing();
    return true;
  }

  /**
   * Per frame, on the weapons' real-time clock.
   * @param {number} dt real seconds
   * @returns {void}
   */
  function update(dt) {
    clock += dt;
    cooldown = Math.max(0, cooldown - dt);
    if (!pending.active) return;
    // A daze, a freeze, a car or death in the wind-up spoils the strike.
    if (!env.canAct()) {
      cancel();
      return;
    }
    lungeStep(dt);
    pending.timer -= dt;
    if (pending.timer <= 0) {
      pending.active = false;
      pending.lunge = 0;
      land();
    }
  }

  /**
   * Drops anything waiting: the wheel, Esc, a blur, a car, a daze, a freeze,
   * death, the run ending. The cooldown and the chain are cleared too.
   * @returns {void}
   */
  function cancel() {
    pending.active = false;
    pending.lunge = 0;
    cooldown = 0;
    chain = 0;
    lastSlashAt = -Infinity;
  }

  return { release, update, cancel, lastCut: cut };
}
