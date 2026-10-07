// @ts-check
import * as THREE from 'three';
import { createBullets } from '../hero/bullets.js';
import { newFxQueue, dueFx } from './fxQueue.js';
import { unpackExtra } from './fxOut.js';
import { playedKind, shotEnd, takeRows, cueDue, CUE_GAP, RAIL_POWER } from './mirrorRules.js';

/**
 * ===========================================================================
 * SECTION NR — The mirror: the host's shots drawn on this screen
 * ===========================================================================
 * Draws what a snapshot's `fx` rows say happened, with the builders the host's
 * own weapons use (R-061): the minigun round through the shared `createBullets`
 * with its casings, and a sparks-only landing; the rail bolt through
 * `lightning.strikeAt` (presentation only: it hits nobody). It never runs the
 * gameplay half of anything: no `enemies.hit`, no `damagePlayer`, no score, no
 * `blackHole.fire`, no `boltAt` (R-053, R-054). Damage is the host's.
 *
 * Three callers, one renderer. The guest feeds each snapshot's rows in (`feed`)
 * and plays them on the interpolation clock (`update`, `renderT` from the
 * snapshot buffer: no second clock); the guest's own predicted shot is drawn
 * at the press (`drawOwn`, its cue is the predicted one in `net/system.js`); and
 * the host draws a guest's shot as it resolves it (`drawGuestShot`). The guest's
 * own shot never comes back from the host (the queue drops its `shooter`), so
 * nothing is drawn twice.
 *
 * One small pool of rounds per instance, made on first use and released with
 * the session (R-047, R-048): `ROUNDS` bullets and `CASINGS` casings are about
 * the own and the partner's minigun in flight at once; sparks check
 * `caps.particleRoom()` first. Nothing is allocated per shot or per frame:
 * the hit records, scratch vectors and the queue's own arrays are the only
 * per-shot work, and the queue's are a few small arrays per snapshot.
 */

/** Rounds alive at once: two miniguns (18 a second each, about 0.7 s in the air at 320 m/s) with room to spare. */
export const ROUNDS = 48;
/** Casings alive at once (4 s each; the oldest is reused). */
export const CASINGS = 40;
/** The sparks need this much of the shared particle budget (`caps.particleRoom()`). */
const SPARK_ROOM = 24;

/**
 * @param {any} ctx
 * @returns {{
 *   feed: (rows: ReadonlyArray<number[]>|undefined, hostT: number, ownId: number) => void,
 *   update: (renderT: number|null, dt: number) => void,
 *   drawOwn: (kind: 'bullet'|'rail', from: THREE.Vector3, to: THREE.Vector3) => void,
 *   drawGuestShot: (kind: 'bullet'|'rail', from: THREE.Vector3, to: THREE.Vector3, hit: number) => void,
 *   tracer: (from: THREE.Vector3, to: THREE.Vector3) => void,
 *   reset: () => void,
 *   dispose: () => void,
 *   waiting: () => number
 * }}
 */
export function createMirror(ctx) {
  let queue = newFxQueue();
  /** @type {ReturnType<typeof createBullets>|null} */
  let rounds = null;
  /** The landing of each round in flight: one record per pool slot, in firing order (the pool reuses its slots round-robin). */
  const hits = Array.from({ length: ROUNDS }, () => ({ kind: 'ground', obj: null, at: new THREE.Vector3() }));
  let nextHit = 0;
  const lastCue = { bullet: -Infinity, rail: -Infinity };
  const end = { x: 0, y: 0, z: 0, kind: '' };
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const rowTo = new THREE.Vector3();
  const eject = new THREE.Vector3();
  const side = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const noLanding = () => {};
  const sparkGate = () => !!ctx.systems.caps && ctx.systems.caps.particleRoom() >= SPARK_ROOM;

  /** @returns {ReturnType<typeof createBullets>} */
  function pool() {
    if (!rounds) rounds = createBullets(ctx, { max: ROUNDS, casings: CASINGS, sparkRoom: sparkGate });
    return rounds;
  }

  /**
   * One minigun round, with its casing and a sparks-only landing (no damage).
   * @param {THREE.Vector3} a muzzle @param {THREE.Vector3} b recorded end @param {number} hit a HIT_CODES index
   * @returns {void}
   */
  function round(a, b, hit) {
    shotEnd(a, b, hit, end);
    const h = hits[nextHit];
    nextHit = (nextHit + 1) % ROUNDS;
    h.kind = end.kind;
    h.at.set(end.x, end.y, end.z);
    dir.subVectors(h.at, a);
    side.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); else side.normalize();
    eject.copy(a).addScaledVector(side, 0.12);
    pool().fire(a, h.at, h, eject, side);
  }

  /**
   * One rail bolt onto the ground (or where it ended): the storm's own bolt with the
   * railgun's tamer flash, without its camera shake (owner decision 10: no shake
   * from the partner's shots). Presentation only; `strikeAt` hits nobody.
   * @param {THREE.Vector3} a @param {THREE.Vector3} b @param {number} hit
   * @returns {void}
   */
  function bolt(a, b, hit) {
    shotEnd(a, b, hit, end);
    to.set(end.x, Math.max(end.y, end.kind === 'sky' ? 0.5 : 0), end.z);
    if (ctx.systems.lightning) ctx.systems.lightning.strikeAt(to, RAIL_POWER, true, true);
  }

  /**
   * The cue of a kind, through this computer's own hero sound, at most once per `CUE_GAP`.
   * @param {'bullet'|'rail'} kind
   * @returns {void}
   */
  function cue(kind) {
    const now = performance.now() / 1000;
    if (!cueDue(lastCue[kind], now, CUE_GAP[kind])) return;
    lastCue[kind] = now;
    const snd = ctx.systems.heroSound;
    if (!snd) return;
    if (kind === 'bullet') snd.playBullet(); else snd.playZap();
  }

  /**
   * Plays one due row.
   * @param {ReadonlyArray<number>} row [id, kind, shooter, x, y, z, a, b, c, extra]
   * @returns {void}
   */
  function play(row) {
    const kind = playedKind(row[1]);
    if (!kind) return;
    from.set(row[3], row[4], row[5]);
    const b = rowTo.set(row[6], row[7], row[8]);
    const hit = unpackExtra(row[9]).hit;
    if (kind === 'bullet') round(from, b, hit); else bolt(from, b, hit);
    cue(kind);
  }

  return {
    /** The snapshot's rows into the queue (the guest's own shooter and repeats dropped). */
    feed(rows, hostT, ownId) { queue = takeRows(queue, rows, hostT, ownId); },
    /**
     * Plays the rows whose time has come on the snapshot clock, and steps the pool.
     * `renderT` is null before the first snapshot (nothing due).
     */
    update(renderT, dt) {
      if (renderT !== null && queue.items.length > 0) {
        const r = dueFx(queue, renderT);
        queue = r.queue;
        for (const row of r.due) play(row);
      }
      if (rounds) rounds.update(dt, 1, noLanding);
    },
    drawOwn(kind, a, b) {
      // Predicted at the press: no hit is known, so the ray is cut at the ground or left in the sky. Its cue is the predicted one.
      if (kind === 'bullet') round(a, b, 0); else bolt(a, b, 0);
    },
    drawGuestShot(kind, a, b, hit) {
      if (kind === 'bullet') round(a, b, hit); else bolt(a, b, hit);
      cue(kind);
    },
    /** A bare tracer (the rifle's and the Black Hole Gun's until their own subtasks): no hit, no casing, no cue. */
    tracer(a, b) { pool().fire(a, b, null, null, null); },
    reset() {
      queue = newFxQueue();
      if (rounds) rounds.clear();
      lastCue.bullet = lastCue.rail = -Infinity;
    },
    dispose() {
      queue = newFxQueue();
      if (rounds) rounds.dispose();
      rounds = null;
    },
    waiting: () => queue.items.length
  };
}
