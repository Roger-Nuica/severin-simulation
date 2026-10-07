// @ts-check
import * as THREE from 'three';
import { createBullets } from '../hero/bullets.js';
import { newFxQueue, dueFx } from './fxQueue.js';
import { unpackExtra } from './fxOut.js';
import { playedKind, shotEnd, takeRows, cueDue, CUE_GAP, RAIL_POWER, beamLook } from './mirrorRules.js';
import { HERO } from '../hero/config.js';
import { buildBeamMeshes, placeBeamMesh, fadeBeamMeshes, buildRingMeshes, placeRingMeshes, ringsTotal } from '../hero/plasmaBeam.js';

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
 * The rifle's shot (`plasma`) and the MEGA BEAM (`mega`) are the host's own beam
 * (`hero/plasmaBeam.js`: core, sheath, halo, the splash where it lands and the
 * mega rings), drawn from the row's two ends and burnt out on the host's own
 * timings, with the host's `playPlasma` and `playSonicBoom` cues. Visual only:
 * no `plasmaHit`, no damage, no score, no neutralise or chip, and no shake or
 * flash on this camera from someone else's beam (owner decision 10). A small
 * fixed set of `BEAMS` is made on the first one and released with the session.
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
/** Beams alive at once: the own and the partner's rifle (0.55 s each, one shot every 0.35 s) with room to spare. */
export const BEAMS = 3;
/** The sparks need this much of the shared particle budget (`caps.particleRoom()`). */
const SPARK_ROOM = 24;

/**
 * @param {any} ctx
 * @returns {{
 *   feed: (rows: ReadonlyArray<number[]>|undefined, hostT: number, ownId: number) => void,
 *   update: (renderT: number|null, dt: number) => void,
 *   drawOwn: (kind: 'bullet'|'rail'|'plasma', from: THREE.Vector3, to: THREE.Vector3) => void,
 *   drawGuestShot: (kind: 'bullet'|'rail'|'plasma', from: THREE.Vector3, to: THREE.Vector3, hit: number) => void,
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
  const lastCue = { bullet: -Infinity, rail: -Infinity, plasma: -Infinity, mega: -Infinity, holeShot: -Infinity };
  /**
   * The beams (made on first use): the meshes, and per beam the seconds it burns, its width and its ends.
   * @type {{beam: THREE.Group, splash: THREE.Mesh, t: number, life: number, width: number, mega: boolean, from: THREE.Vector3, to: THREE.Vector3}[]|null}
   */
  let beams = null;
  let nextBeam = 0;
  /** @type {THREE.Mesh[]|null} */
  let rings = null;
  let ringT = 0;
  const ringFrom = new THREE.Vector3();
  const ringTo = new THREE.Vector3();
  /** Geometries and materials this instance made, disposed with it. @type {THREE.BufferGeometry[]} */
  const geos = [];
  /** @type {THREE.Material[]} */
  const mats = [];
  const kit = {
    keepGeo: /** @type {any} */ ((/** @type {THREE.BufferGeometry} */ g) => { geos.push(g); return g; }),
    keepMat: /** @type {any} */ ((/** @type {THREE.Material} */ m) => { mats.push(m); return m; })
  };
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
   * One plasma beam, from the muzzle to where the ray ended, with the host's look. No hit is
   * resolved and the camera is left alone (owner decision 10).
   * @param {THREE.Vector3} a muzzle @param {THREE.Vector3} b recorded end @param {number} hit a HIT_CODES index
   * @param {boolean} mega @param {number} extra charge in hundredths of a second
   * @returns {void}
   */
  function beam(a, b, hit, mega, extra) {
    shotEnd(a, b, hit, end);
    if (!beams) {
      const scene = ctx.Sim.three.scene;
      beams = [];
      for (let i = 0; i < BEAMS; i++) {
        const m = buildBeamMeshes(scene, kit);
        beams.push({ beam: m.beam, splash: m.splash, t: 0, life: 1, width: 1, mega: false, from: new THREE.Vector3(), to: new THREE.Vector3() });
      }
    }
    const e = beams[nextBeam];
    nextBeam = (nextBeam + 1) % BEAMS;
    const look = beamLook(mega, extra, HERO);
    e.t = e.life = look.life;
    e.width = look.width;
    e.mega = mega;
    e.from.copy(a);
    e.to.set(end.x, end.y, end.z);
    e.beam.visible = true;
    e.splash.visible = end.kind !== 'sky';
    e.splash.position.copy(e.to);
    placeBeamMesh(e.beam, e.from, e.to, dir);
    fadeBeamMeshes(e.beam, e.splash, 1, e.width, mega);
    if (mega) {
      if (!rings) rings = buildRingMeshes(ctx.Sim.three.scene, kit);
      ringFrom.copy(e.from);
      ringTo.copy(e.to);
      ringT = ringsTotal();
    }
  }

  /** Burns the beams down and runs the rings (no allocation). @param {number} dt */
  function stepBeams(dt) {
    if (beams) {
      for (const e of beams) {
        if (e.t <= 0) continue;
        e.t -= dt;
        if (e.t <= 0) { e.beam.visible = e.splash.visible = false; continue; }
        fadeBeamMeshes(e.beam, e.splash, Math.max(0, e.t / e.life), e.width, e.mega);
      }
    }
    if (rings && ringT > 0) {
      ringT -= dt;
      if (ringT <= 0) for (const r of rings) r.visible = false;
      else placeRingMeshes(rings, ringsTotal() - ringT, ringFrom, ringTo, dir);
    }
  }

  /** Hides every beam and ring now. */
  function hideBeams() {
    if (beams) for (const e of beams) { e.t = 0; e.beam.visible = e.splash.visible = false; }
    if (rings) for (const r of rings) r.visible = false;
    ringT = 0;
  }

  /**
   * The cue of a kind, through this computer's own hero sound, at most once per `CUE_GAP`.
   * @param {'bullet'|'rail'|'plasma'|'mega'|'holeShot'} kind
   * @returns {void}
   */
  function cue(kind) {
    const now = performance.now() / 1000;
    if (!cueDue(lastCue[kind], now, CUE_GAP[kind])) return;
    lastCue[kind] = now;
    const snd = ctx.systems.heroSound;
    if (!snd) return;
    if (kind === 'bullet') snd.playBullet();
    else if (kind === 'rail' || kind === 'holeShot') snd.playZap();
    else {
      // The host's own pair for the rifle: the shot's sound and the sonic boom, louder for the MEGA BEAM.
      const mega = kind === 'mega';
      snd.playPlasma(mega ? HERO.megaBeamSeconds : HERO.beamSeconds);
      if (ctx.systems.cues) ctx.systems.cues.playSonicBoom(mega ? 1.4 : 0.75);
    }
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
    const { hit, extra } = unpackExtra(row[9]);
    // The Black Hole Gun's shot is its zap alone, as on the host (flash and zap, no world trace): the hole is the `hole` row's.
    if (kind === 'holeShot') { cue(kind); return; }
    if (kind === 'bullet') round(from, b, hit);
    else if (kind === 'rail') bolt(from, b, hit);
    else beam(from, b, hit, kind === 'mega', extra);
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
      stepBeams(dt);
    },
    drawOwn(kind, a, b) {
      // Predicted at the press: no hit is known, so the ray is cut at the ground or left in the sky. Its cue is the predicted one.
      if (kind === 'bullet') round(a, b, 0);
      else if (kind === 'rail') bolt(a, b, 0);
      else beam(a, b, 0, false, 0);
    },
    drawGuestShot(kind, a, b, hit) {
      if (kind === 'bullet') round(a, b, hit);
      else if (kind === 'rail') bolt(a, b, hit);
      else beam(a, b, hit, false, 0);
      cue(kind);
    },
    /** A bare tracer: no hit, no casing, no cue. No weapon uses it now (the Black Hole Gun's shot is its flash and zap, as on the host). */
    tracer(a, b) { pool().fire(a, b, null, null, null); },
    reset() {
      queue = newFxQueue();
      if (rounds) rounds.clear();
      lastCue.bullet = lastCue.rail = lastCue.plasma = lastCue.mega = lastCue.holeShot = -Infinity;
      hideBeams();
    },
    dispose() {
      queue = newFxQueue();
      if (rounds) rounds.dispose();
      rounds = null;
      if (beams) for (const e of beams) { ctx.Sim.three.scene.remove(e.beam, e.splash); }
      if (rings) for (const r of rings) ctx.Sim.three.scene.remove(r);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      geos.length = mats.length = 0;
      beams = null;
      rings = null;
      nextBeam = 0;
      ringT = 0;
    },
    waiting: () => queue.items.length
  };
}
