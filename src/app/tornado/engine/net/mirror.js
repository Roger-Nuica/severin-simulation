// @ts-check
import * as THREE from 'three';
import { createBullets } from '../hero/bullets.js';
import { newFxQueue, dueFx } from './fxQueue.js';
import { unpackExtra } from './fxOut.js';
import { boltFromRow, empFromRow } from './skyFx.js';
import { rayFromRow, roundFromRow, missileFromRow } from './enemyFx.js';
import { createRoundView } from '../gunner/roundView.js';
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
 * The enemies' projectiles (`ray`, `round`, `missile`, net/enemyFx.js) are the aliens'
 * and HAVOC's own builders run render-only: `aliens.showRay` and `showTracker` (the
 * bolt, lance and tracking laser with no hit to deliver), `aliens.showMissile` (the
 * missile on an eased straight path, never homing, with a cosmetic burst) and
 * `gunner/roundView.js` (the round meshes flying a straight line). None tests, hurts,
 * pushes or scores (R-053); sounds are capped per kind by `CUE_GAP`.
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
  const lastCue = { bullet: -Infinity, rail: -Infinity, plasma: -Infinity, mega: -Infinity, holeShot: -Infinity, bolt: -Infinity, emp: -Infinity, ray: -Infinity, round: -Infinity, missile: -Infinity };
  /** HAVOC's announced rounds (made on the first one). @type {ReturnType<typeof createRoundView>|null} */
  let roundView = null;
  let roundLands = 0;
  const landAt = new THREE.Vector3();
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
   * The host's storm bolt (random, targeted or the electric storm's) at its end point: the
   * storm's own bolt, flash and thunder, with no camera shake (owner decision 10).
   * Presentation only; `strikeAt` hits nobody. At most one per `CUE_GAP.bolt`.
   * @param {ReadonlyArray<number>} row
   * @returns {void}
   */
  function skyBolt(row) {
    const b = boltFromRow(row);
    const lightning = ctx.systems.lightning;
    if (!b || !lightning) return;
    const now = performance.now() / 1000;
    if (!cueDue(lastCue.bolt, now, CUE_GAP.bolt)) return;
    lastCue.bolt = now;
    to.set(b.x, b.y, b.z);
    lightning.strikeAt(to, b.power, false, true);
  }

  /**
   * The host's EMP, drawn as its wave alone (ring, dome, flash and sounds): never the stun,
   * the line faults or the notice. The ring is always drawn; the sounds are rate-capped.
   * @param {ReadonlyArray<number>} row
   * @returns {void}
   */
  function skyEmp(row) {
    const e = empFromRow(row);
    if (!e) return;
    const now = performance.now() / 1000;
    const sound = cueDue(lastCue.emp, now, CUE_GAP.emp);
    if (sound) lastCue.emp = now;
    if (e.variant === 'wave') {
      if (ctx.systems.empCharge) ctx.systems.empCharge.showWave(e.x, e.z, sound);
    } else if (ctx.systems.emp) {
      ctx.systems.emp.showPulse(e.x, e.z, e.radius, e.variant === 'solar', sound);
    }
  }

  /**
   * Whether a cue of `kind` may sound now (and notes it): the per-kind rate cap.
   * @param {'ray'|'round'|'missile'} kind
   * @returns {boolean}
   */
  function soundDue(kind) {
    const now = performance.now() / 1000;
    if (!cueDue(lastCue[kind], now, CUE_GAP[kind])) return false;
    lastCue[kind] = now;
    return true;
  }

  /**
   * An alien's ray bolt, a ship's lance or a tracking laser burst, drawn by the aliens' own
   * builders (`aliens.showRay`, `showTracker`): no hit, no harm (R-053). The sounds are rate-capped.
   * @param {ReadonlyArray<number>} row
   * @returns {void}
   */
  function enemyRay(row) {
    const r = rayFromRow(row);
    const aliens = ctx.systems.aliens;
    if (!r || !aliens) return;
    const sound = soundDue('ray');
    from.set(r.from.x, r.from.y, r.from.z);
    if (r.tracker) { aliens.showTracker(from, r.foot, r.sub === 4, sound); return; }
    to.set(r.to.x, r.to.y, r.to.z);
    aliens.showRay(from, to, r.sub, sound);
  }

  /**
   * One of HAVOC's announced rounds, flown straight to its end with the gunner's own round
   * meshes; a spark where one ends on the ground (room permitting). One burst sound a second.
   * @param {ReadonlyArray<number>} row
   * @returns {void}
   */
  function enemyRound(row) {
    const r = roundFromRow(row);
    if (!r) return;
    if (!roundView) {
      roundView = createRoundView(ctx, (x, y, z) => {
        if (y > 0.5 || ++roundLands % 2 !== 0 || !sparkGate() || !ctx.systems.explosions) return;
        ctx.systems.explosions.spawnImpactBurst(landAt.set(x, Math.max(0.1, y), z), 0.2);
      });
    }
    roundView.fire(r.from, r.to);
    if (!soundDue('round') || !ctx.systems.gunnerSound) return;
    from.set(r.from.x, r.from.y, r.from.z);
    ctx.systems.gunnerSound.playBurst(Math.max(0, 1 - ctx.Sim.three.camera.position.distanceTo(from) / 140), 1);
  }

  /**
   * An alien ship's homing missile: the same model and trail flown on an eased path to where the
   * host expected it to arrive, then a cosmetic burst (`aliens.showMissile`); it homes on nothing here.
   * @param {ReadonlyArray<number>} row
   * @returns {void}
   */
  function enemyMissile(row) {
    const m = missileFromRow(row);
    const aliens = ctx.systems.aliens;
    if (!m || !aliens) return;
    aliens.showMissile(m.from, m.to, m.seconds, soundDue('missile'));
  }

  /**
   * Plays one due row.
   * @param {ReadonlyArray<number>} row [id, kind, shooter, x, y, z, a, b, c, extra]
   * @returns {void}
   */
  function play(row) {
    const kind = playedKind(row[1]);
    if (!kind) return;
    if (kind === 'bolt') { skyBolt(row); return; }
    if (kind === 'emp') { skyEmp(row); return; }
    if (kind === 'ray') { enemyRay(row); return; }
    if (kind === 'round') { enemyRound(row); return; }
    if (kind === 'missile') { enemyMissile(row); return; }
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
      if (roundView) roundView.update(dt);
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
      if (roundView) roundView.clear();
      lastCue.bullet = lastCue.rail = lastCue.plasma = lastCue.mega = lastCue.holeShot = lastCue.bolt = lastCue.emp = lastCue.ray = lastCue.round = lastCue.missile = -Infinity;
      hideBeams();
    },
    dispose() {
      queue = newFxQueue();
      if (rounds) rounds.dispose();
      rounds = null;
      if (roundView) roundView.dispose();
      roundView = null;
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
