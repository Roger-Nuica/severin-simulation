// @ts-check
/**
 * ===========================================================================
 * SECTION RP — Patient Zero and its clones on the guest: the `replicator` and `clones` kinds, encoded and posed
 * ===========================================================================
 * Two additive optional kinds (an older guest ignores them, an older host
 * never sends them):
 *   replicator  [id 0, x, z, heading, attack, evolve, grown, flare]
 *   clones      [id, x, z, heading, attack, grown]
 * `attack` (0 to 1) is how far the arms are up. `evolve` is 0 before the
 * second evolution, 0 to 1 while it changes and 1 once evolved. `grown`
 * (0 to 1) is how far a figure is built (from the feet up) or come apart for
 * a warp, worked out by `grownOf` from the host's own state. `flare` is the
 * swarm's light level (1 at rest). The walk comes from the interpolated
 * movement (rogerView.js `stepRunCycle`), and the pose is the host's own
 * `poseReplicator` / `partTurn` (patientZero/model.js). The heat (the glow
 * going from green to lime as the swarm nears the encirclement) is worked out
 * on the guest from how many clones stand. Not here: the head's twitch, the
 * flinch, the orbiting blocks, the swarm's particles, stains, shards, the
 * link and the encirclement (effects, not state). No scene, no DOM, no module
 * state.
 */
import * as THREE from 'three';
import { REPLICATOR, PARTS, makePose, poseReplicator, partTurn } from '../patientZero/model.js';
import { newRunCycle, stepRunCycle } from './rogerView.js';

/** @typedef {{key: object, x: number, z: number, heading: number, attack: number, form: number, warpT: number|null}} WalkerState */

const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
const unit = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));

/**
 * How far a figure is built or come apart, as the host draws it: from the
 * feet up while it forms, coming apart for a warp (1 while it waits to go).
 * @param {{form: number, warpT: number|null}} s
 * @param {number} warpOut Seconds a warp takes to come apart.
 * @returns {number} 0.02 to 1.
 */
export function grownOf(s, warpOut) {
  if (s.warpT !== null) return s.warpT <= 0 ? 1 : Math.max(0.02, 1 - s.warpT / warpOut);
  return s.form < 1 ? Math.max(0.02, 1 - Math.pow(1 - s.form, 2.2)) : 1;
}

/**
 * The original's row.
 * @param {WalkerState & {evolve: number}} s
 * @param {number} flare The swarm's light level.
 * @param {number} warpOut
 * @param {(v: number) => number} clamp Keeps a position inside the world.
 * @returns {number[]}
 */
export function replicatorRow(s, flare, warpOut, clamp) {
  return [0, r2(clamp(s.x)), r2(clamp(s.z)), r2(s.heading), r2(unit(s.attack)), r2(unit(s.evolve)), r2(grownOf(s, warpOut)), r2(Math.min(5, Math.max(0, flare)))];
}

/**
 * The clones' rows (at most `cap`).
 * @param {WalkerState[]} list
 * @param {number} warpOut
 * @param {(o: object) => number} idOf A stable small id for a clone.
 * @param {(v: number) => number} clamp
 * @param {number} cap
 * @returns {number[][]}
 */
export function cloneRows(list, warpOut, idOf, clamp, cap) {
  const out = [];
  for (const c of list) {
    if (out.length >= cap) break;
    out.push([idOf(c.key), r2(clamp(c.x)), r2(clamp(c.z)), r2(c.heading), r2(unit(c.attack)), r2(grownOf(c, warpOut))]);
  }
  return out;
}

/**
 * A clone's size, 0.94 to 1.06, from its id (the host's is random; the guest
 * only needs each clone to keep its own).
 * @param {number} id
 * @returns {number}
 */
export const cloneSize = (id) => 0.94 + ((id * 0.6180339887) % 1) * 0.12;

/**
 * How many clone rows stand (fully built), which sets the heat.
 * @param {Iterable<number[]>} rows
 * @returns {number}
 */
export function standingCount(rows) {
  let n = 0;
  for (const r of rows) if (r[5] >= 1) n++;
  return n;
}

/**
 * The heat, eased towards standing clones over the encirclement's count.
 * @param {number} heat 0 to 1.
 * @param {number} standing
 * @param {number} trigger Clones standing for the encirclement.
 * @param {number} dt
 * @returns {number}
 */
export const easeHeat = (heat, standing, trigger, dt) => heat + (Math.min(1, standing / trigger) - heat) * Math.min(1, dt * 1.5);

/**
 * The glow of the clones' and the original's material, as the host sets them.
 * `cloneHeat` and `originalHeat` blend the tint from white to the hot colour.
 * @param {number} flare The swarm's light level.
 * @param {number} heat 0 to 1.
 * @param {boolean} evolving The original is changing or evolved (it burns hot).
 * @param {number} clock Seconds.
 * @param {number} heatFlare The extra light at full heat.
 * @returns {{cloneGlow: number, cloneHeat: number, originalGlow: number, originalHeat: number}}
 */
export function glowLevels(flare, heat, evolving, clock, heatFlare) {
  const h = heat * heat;
  const breathe = 1 - (0.15 + 0.15 * heat) + (0.15 + 0.15 * heat) * Math.sin(clock * (2.6 + 6 * heat));
  const level = flare + heatFlare * h;
  return { cloneGlow: level * breathe, cloneHeat: h, originalGlow: 1.3 * Math.max(1, level) * breathe, originalHeat: evolving ? Math.max(h, 0.8) : h };
}

/**
 * The original's size: its own scale, half as big again once evolved.
 * @param {number} evolve 0 to 1.
 * @param {number} scale The original's base scale.
 * @param {number} grow Its size after, times.
 * @returns {number}
 */
export function originalSize(evolve, scale, grow) {
  const e = unit(evolve);
  return scale * (1 + (grow - 1) * e * e * (3 - 2 * e));
}

/** @returns {{pose: ReturnType<typeof makePose>, turn: THREE.Euler, twitch: {yaw: number, pitch: number, roll: number}, body: THREE.Matrix4, local: THREE.Matrix4, m4: THREE.Matrix4, q: THREE.Quaternion, ql: THREE.Quaternion, euler: THREE.Euler, p: THREE.Vector3, sc: THREE.Vector3, one: THREE.Vector3}} Scratch for posing (one per session). */
export function newReplicaScratch() {
  return {
    pose: makePose(), turn: new THREE.Euler(), twitch: { yaw: 0, pitch: 0, roll: 0 },
    body: new THREE.Matrix4(), local: new THREE.Matrix4(), m4: new THREE.Matrix4(),
    q: new THREE.Quaternion(), ql: new THREE.Quaternion(), euler: new THREE.Euler(),
    p: new THREE.Vector3(), sc: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1)
  };
}

/**
 * Poses the original from its interpolated row as patientZero.js `writeOriginal` does.
 * @param {{root: THREE.Object3D, parts: Record<string, THREE.Object3D>, halo: THREE.Object3D, halo2: THREE.Object3D}} fig
 * @param {number[]} row A `replicator` row.
 * @param {number} pace How fast it goes, 0 to 1 (`stepRunCycle` with 4 m/s as a full run).
 * @param {number} cycle Walk-cycle radians.
 * @param {number} clock Seconds.
 * @param {number} dt Seconds since the last frame.
 * @param {{scale: number, grow: number}} consts
 * @param {ReturnType<typeof newReplicaScratch>} k
 * @returns {void}
 */
export function poseOriginal(fig, row, pace, cycle, clock, dt, consts, k) {
  const evolve = row[5];
  const changing = evolve > 0 && evolve < 1;
  const attack = row[4];
  const pose = poseReplicator(k.pose, cycle, changing ? 0 : pace, attack, k.twitch);
  const grown = row[6];
  const size = originalSize(evolve, consts.scale, consts.grow);
  fig.root.position.set(row[1], 0, row[2]);
  const f = fig.parts.figure;
  const wide = size * (1 + (1 - grown) * 0.5);
  f.scale.set(wide, size * grown, wide);
  const rising = changing ? Math.sin(Math.PI * evolve) : 0;
  f.position.y = pose.lift * grown + rising * 0.9;
  f.rotation.set(pose.lean - rising * 0.35, row[3], pose.roll, 'YXZ');
  for (const name of PARTS) {
    if (name === 'body') continue;
    fig.parts[name].rotation.copy(partTurn(name, pose, k.turn));
  }
  const sprout = evolve >= 1 ? 1 : evolve > 0 ? evolve * evolve * (3 - 2 * evolve) : 0;
  for (const [name, side] of /** @type {const} */ ([['armL2', 1], ['armR2', -1]])) {
    const pivot = fig.parts[name];
    pivot.visible = sprout > 0.01;
    pivot.scale.setScalar(0.78 * sprout);
    pivot.rotation.set(Math.sin(cycle + 1.3 * side) * 0.5 * Math.min(1, pace) - attack + rising * 0.8, 0, side * (0.3 + attack * 0.4 + rising * 0.6));
  }
  for (const [name, side] of /** @type {const} */ ([['scytheL', 1], ['scytheR', -1]])) {
    const pivot = fig.parts[name];
    pivot.visible = sprout > 0.01;
    pivot.scale.setScalar(sprout);
    const slash = attack > 0.5 ? 0.5 + 0.5 * Math.sin(clock * 8 + (side > 0 ? 0 : Math.PI)) : 0;
    pivot.rotation.set(-0.15 + Math.sin(clock * 1.4 + side) * 0.12 + slash * 0.95 - rising * 0.5, 0, side * (0.12 + rising * 0.3));
  }
  fig.halo2.visible = sprout > 0.01;
  fig.halo2.scale.setScalar(sprout);
  fig.halo2.rotation.y -= dt * 3.2;
  fig.halo.rotation.y += dt * (changing ? 9 : 2.2);
  fig.halo.position.y = 2.32 + Math.sin(clock * 3) * 0.04;
}

/**
 * Writes the clones' instances from their interpolated rows, as
 * patientZero.js `writeInstances` does, and walks each one's cycle.
 * @param {Record<string, THREE.InstancedMesh>} meshes The six parts' instanced meshes.
 * @param {Map<number, number[]>} rows The interpolated `clones` rows by id.
 * @param {Map<number, import('./rogerView.js').RunCycle>} runs Each clone's walk cycle (pruned here).
 * @param {number} dt
 * @param {number} stride Walk-cycle radians per metre.
 * @param {number} cap The most instances.
 * @param {ReturnType<typeof newReplicaScratch>} k
 * @returns {number} How many were drawn.
 */
export function writeClones(meshes, rows, runs, dt, stride, cap, k) {
  for (const id of [...runs.keys()]) if (!rows.has(id)) runs.delete(id);
  let i = 0;
  for (const [id, row] of rows) {
    if (i >= cap) break;
    let run = runs.get(id);
    if (!run) { run = newRunCycle(); runs.set(id, run); }
    const pace = stepRunCycle(run, row[1], row[2], dt, stride, 4);
    const pose = poseReplicator(k.pose, run.phase, pace, row[4], k.twitch);
    const size = cloneSize(id);
    const grown = row[5];
    const wide = size * (1 + (1 - grown) * 0.5);
    k.euler.set(pose.lean, row[3], pose.roll, 'YXZ');
    k.q.setFromEuler(k.euler);
    k.body.compose(k.p.set(row[1], pose.lift * grown, row[2]), k.q, k.sc.set(wide, size * grown, wide));
    for (const name of PARTS) {
      if (name === 'body') { meshes.body.setMatrixAt(i, k.body); continue; }
      k.ql.setFromEuler(partTurn(name, pose, k.turn));
      k.local.compose(REPLICATOR.pivots[/** @type {'head'} */ (name)], k.ql, k.one);
      k.m4.multiplyMatrices(k.body, k.local);
      meshes[name].setMatrixAt(i, k.m4);
    }
    i++;
  }
  for (const name of PARTS) {
    meshes[name].count = i;
    meshes[name].instanceMatrix.needsUpdate = true;
  }
  return i;
}
