// @ts-check
import * as THREE from 'three';
import { newTargets, newShown, resetShown, readTargets, stepShown, crossedUp, FUNNEL_SLOTS } from './funnelMirror.js';
import { BIRTH } from '../vortex/config.js';

/**
 * ===========================================================================
 * SECTION NG — The host's tornado on the guest's screen
 * ===========================================================================
 * The guest does not build a tornado: it hands the funnels it already has
 * (`ctx.tornadoes`, built at start-up, the primary and the Outbreak's extras)
 * to the host's state. Each frame the interpolated `tornadoes` rows and the
 * newest `tw` rows (net/funnelMirror.js) set what `Vortex.remote` holds, and
 * vortex.js draws the real funnel from it: its own wander is not run, `birth`
 * stays 0 (so the force field, capture, damage and hero daze find nothing),
 * and `Sim.state.running` is never touched. `release` gives every funnel back
 * (session end, a new welcome), so a single-player run starts normally.
 * The touchdown is drawn as the bolt and the screen flash only: no camera
 * shake, no `gamefeel` event (owner decision 10).
 *
 * @param {Object} ctx
 * @returns {{
 *   feed: (twRows: ReadonlyArray<ReadonlyArray<number>>|null|undefined) => void,
 *   drive: (tornadoRows: ReadonlyMap<number, ReadonlyArray<number>>|null|undefined, dt: number) => void,
 *   release: () => void,
 *   shown: () => import('./funnelMirror.js').FunnelShown[]
 * }}
 */
export function createFunnels(ctx) {
  const targets = newTargets();
  const shown = newShown();
  const prevBirth = new Float64Array(FUNNEL_SLOTS).fill(-1);
  const seen = new Uint8Array(FUNNEL_SLOTS);
  const touch = new Uint8Array(FUNNEL_SLOTS);
  const at = new THREE.Vector3();
  /** @type {ReadonlyArray<ReadonlyArray<number>>|null} */
  let twRows = null;
  let held = false;

  /**
   * A snapshot's `tw` rows arrived: keep them, and note which funnels' own
   * birth crossed the touchdown line since the last snapshot.
   * @param {ReadonlyArray<ReadonlyArray<number>>|null|undefined} rows
   * @returns {void}
   */
  function feed(rows) {
    twRows = rows || null;
    seen.fill(0);
    if (twRows) {
      for (const r of twRows) {
        const id = r[0];
        if (!(id >= 0 && id < FUNNEL_SLOTS)) continue;
        seen[id] = 1;
        if (crossedUp(prevBirth[id], r[1], BIRTH.dropEnd)) touch[id] = 1;
        prevBirth[id] = r[1];
      }
    }
    for (let i = 0; i < FUNNEL_SLOTS; i++) if (!seen[i]) prevBirth[i] = -1;
  }

  /**
   * @param {ReadonlyMap<number, ReadonlyArray<number>>|null|undefined} tornadoRows interpolated, by id
   * @param {number} dt real seconds
   * @returns {void}
   */
  function drive(tornadoRows, dt) {
    const reg = ctx.tornadoes;
    if (!reg) return;
    if (!held) {
      const n = Math.min(FUNNEL_SLOTS, reg.instances.length);
      for (let i = 0; i < n; i++) reg.setRemote(i, shown[i]);
      held = true;
    }
    readTargets(targets, tornadoRows, twRows);
    for (let i = 0; i < FUNNEL_SLOTS; i++) stepShown(shown[i], targets[i], dt);
    reg.syncRemote();
    for (let i = 0; i < FUNNEL_SLOTS; i++) {
      if (!touch[i]) continue;
      touch[i] = 0;
      if (!shown[i].on) continue;
      const lightning = ctx.systems.lightning;
      if (!lightning) continue;
      lightning.strikeAt(at.set(shown[i].x, 0.5, shown[i].z), 1, false, true);
      lightning.flashScreen(at.set(shown[i].x, 20, shown[i].z), 0.9);
    }
  }

  /** Gives every funnel back to a normal local one and forgets the host's state. @returns {void} */
  function release() {
    const reg = ctx.tornadoes;
    if (held && reg) {
      const n = Math.min(FUNNEL_SLOTS, reg.instances.length);
      for (let i = 0; i < n; i++) reg.setRemote(i, null);
    }
    held = false;
    twRows = null;
    prevBirth.fill(-1);
    seen.fill(0);
    touch.fill(0);
    resetShown(shown);
  }

  return { feed, drive, release, shown: () => shown };
}
