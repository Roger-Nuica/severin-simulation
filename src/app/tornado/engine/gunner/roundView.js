// @ts-check
import * as THREE from 'three';
import { buildRoundMeshes } from './model.js';
import { GUNNER } from './config.js';

/**
 * ===========================================================================
 * SECTION GN.3 — HAVOC's rounds, drawn for a co-op guest
 * ===========================================================================
 * The host announces some of HAVOC's rounds (net/enemyFx.js `round`); this draws each
 * one with the host's own round meshes (`buildRoundMeshes`: the slug and its tracer, red)
 * flying straight from the muzzle to the end the host computed, at the gunner's speed.
 * Visual only (R-053): it never tests Roger, hurts, catches or returns a round, and Time
 * Slow does not slow it (the guest's world is not slowed). A small fixed pool made on the
 * first round and released with the session (R-047, R-048): the oldest round is reused
 * when all are in flight. Nothing is allocated per round or per frame.
 */

/** Rounds in flight at once: about two gunners' announced stream (one round in three, 2.2 s a round) with room to spare. */
export const ROUND_VIEW_MAX = 40;

const RED = new THREE.Color(3, 0.55, 0.18);

/**
 * @param {any} ctx
 * @param {(x: number, y: number, z: number) => void} onLand a round reached its end (the mirror's sparks)
 * @returns {{
 *   fire: (from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}) => void,
 *   update: (dt: number) => void,
 *   clear: () => void,
 *   dispose: () => void,
 *   alive: () => number
 * }}
 */
export function createRoundView(ctx, onLand) {
  const N = ROUND_VIEW_MAX;
  /** @type {THREE.BufferGeometry[]} */
  const geos = [];
  /** @type {THREE.Material[]} */
  const mats = [];
  const { heads, trails } = buildRoundMeshes(ctx.Sim.three.scene, N, RED, { geos, mats });
  const pos = new Float32Array(N * 3);
  const dir = new Float32Array(N * 3);
  /** Metres left to fly (0 or less: free). */
  const left = new Float32Array(N);
  let next = 0;
  let live = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** The tracer's length at full speed, as the host draws it (`speed * 0.06`). */
  const TRACER = GUNNER.speed * 0.06;

  return {
    fire(from, to) {
      const i = next;
      next = (next + 1) % N;
      const k = i * 3;
      d.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const len = d.length();
      if (len < 0.01) return;
      d.divideScalar(len);
      pos[k] = from.x; pos[k + 1] = from.y; pos[k + 2] = from.z;
      dir[k] = d.x; dir[k + 1] = d.y; dir[k + 2] = d.z;
      if (left[i] <= 0) live++;
      left[i] = len;
    },
    update(dt) {
      if (live === 0) return;
      for (let i = 0; i < N; i++) {
        if (left[i] <= 0) continue;
        const k = i * 3;
        const step = Math.min(left[i], GUNNER.speed * dt);
        pos[k] += dir[k] * step;
        pos[k + 1] += dir[k + 1] * step;
        pos[k + 2] += dir[k + 2] * step;
        left[i] -= step;
        if (left[i] <= 1e-3) {
          left[i] = 0;
          live--;
          heads.setMatrixAt(i, zero);
          trails.setMatrixAt(i, zero);
          onLand(pos[k], pos[k + 1], pos[k + 2]);
          continue;
        }
        p.set(pos[k], pos[k + 1], pos[k + 2]);
        d.set(dir[k], dir[k + 1], dir[k + 2]);
        q.setFromUnitVectors(Z, d);
        heads.setMatrixAt(i, m4.compose(p, q, sc.set(1, 1, 1)));
        trails.setMatrixAt(i, m4.compose(p, q, sc.set(1, 1, TRACER)));
      }
      heads.instanceMatrix.needsUpdate = true;
      trails.instanceMatrix.needsUpdate = true;
    },
    clear() {
      left.fill(0);
      live = 0;
      for (let i = 0; i < N; i++) { heads.setMatrixAt(i, zero); trails.setMatrixAt(i, zero); }
      heads.instanceMatrix.needsUpdate = true;
      trails.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      heads.removeFromParent();
      trails.removeFromParent();
      heads.dispose();
      trails.dispose();
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
    alive: () => live
  };
}
