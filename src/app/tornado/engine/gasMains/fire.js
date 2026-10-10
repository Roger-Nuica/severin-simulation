// @ts-check
import { GAS } from './config.js';
import { FIRE, fireId, maskOf, segmentState } from '../net/fireFx.js';
/** @typedef {import('./config.js').Segment} Segment */

/**
 * ===========================================================================
 * SECTION GM.2 — Jets and smoke
 * ===========================================================================
 * The burning jets and their smoke, the light they ask for, and the hazard
 * they are to people.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see gasMains.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createGasFire(ctx, S, api) {
  // ---------------------------------------------------------------------
  // Fire
  // ---------------------------------------------------------------------

  /**
   * @param {Segment} segment
   * @param {'jet'|'column'|'vent'} kind
   * @returns {void}
   */
  function spawnJet(segment, kind) {
    const p = S.jets;
    const i = p.next;
    p.next = (p.next + 1) % GAS.jetMax;
    // Spread along the street, tight across it: the fire comes out of a slot
    // in the road, not a hole.
    const along = (Math.random() - 0.5) * GAS.segment;
    const across = (Math.random() - 0.5) * GAS.seamWidth * 0.6;
    p.positions[i * 3] = segment.x + (segment.main.axis === 'x' ? along : across);
    p.positions[i * 3 + 1] = 0.3;
    p.positions[i * 3 + 2] = segment.z + (segment.main.axis === 'x' ? across : along);
    const rise = kind === 'column' ? GAS.columnRise : (kind === 'vent' ? GAS.ventRise : GAS.jetRise);
    p.velocities[i * 3] = (Math.random() - 0.5) * (kind === 'column' ? 3 : 5);
    p.velocities[i * 3 + 1] = api.between(rise);
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * (kind === 'column' ? 3 : 5);
    p.life[i] = p.maxLife[i] = api.between(
      kind === 'column' ? GAS.columnLife : GAS.jetLife
    );
    // Carried into the draw, which reads it to tell the three apart: the
    // fraction is the seed, the band is the kind.
    p.seed[i] = (kind === 'column' ? 2 : (kind === 'vent' ? 1 : 0)) + Math.random() * 0.999;
  }

  /**
   * @param {Segment} segment
   * @returns {void}
   */
  function spawnSmoke(segment) {
    const p = S.smoke;
    const i = p.next;
    p.next = (p.next + 1) % GAS.smokeMax;
    const along = (Math.random() - 0.5) * GAS.segment;
    p.positions[i * 3] = segment.x + (segment.main.axis === 'x' ? along : 0);
    p.positions[i * 3 + 1] = 1.5 + Math.random() * 2;
    p.positions[i * 3 + 2] = segment.z + (segment.main.axis === 'x' ? 0 : along);
    p.velocities[i * 3] = (Math.random() - 0.5) * 3;
    p.velocities[i * 3 + 1] = api.between(GAS.smokeRise);
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
    p.life[i] = p.maxLife[i] = api.between(GAS.smokeLife);
    p.seed[i] = Math.random();
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateJets(dt) {
    const p = S.jets;
    let alive = 0;
    for (let i = 0; i < GAS.jetMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      const band = Math.floor(p.seed[i]);
      // Fire accelerates upward (it is buoyant); raw gas just drifts and
      // slows, which is what separates the hiss from the flame.
      p.velocities[i * 3 + 1] += (band === 1 ? -1.5 : 9) * dt;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      const size = band === 2 ? GAS.columnSize : (band === 1 ? GAS.ventSize : GAS.jetSize);
      if (band === 1) {
        p.colours[i * 4] = GAS.gasColour.r;
        p.colours[i * 4 + 1] = GAS.gasColour.g;
        p.colours[i * 4 + 2] = GAS.gasColour.b;
        // Barely there: gas you can only just see is far more unsettling
        // than a white cloud, and it reads as the thing before the fire.
        p.colours[i * 4 + 3] = Math.sin(Math.PI * u) * 0.16;
      } else {
        const c = S.scratch.copy(GAS.hot).lerp(GAS.cool, u * u);
        p.colours[i * 4] = c.r;
        p.colours[i * 4 + 1] = c.g;
        p.colours[i * 4 + 2] = c.b;
        p.colours[i * 4 + 3] = (1 - u) * 0.9;
      }
      p.sizes[i] = size * (0.55 + (p.seed[i] - band) * 0.7) * (0.5 + u * 0.9);
    }
    S.jetsAlive = alive;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSmoke(dt) {
    const p = S.smoke;
    let alive = 0;
    for (let i = 0; i < GAS.smokeMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      p.velocities[i * 3 + 1] += 2.5 * dt;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      p.colours[i * 4] = GAS.smokeColour.r;
      p.colours[i * 4 + 1] = GAS.smokeColour.g;
      p.colours[i * 4 + 2] = GAS.smokeColour.b;
      p.colours[i * 4 + 3] = Math.sin(Math.PI * u) * 0.5;
      p.sizes[i] = GAS.smokeSize * (0.6 + p.seed[i] * 0.7) * (0.5 + u * 1.5);
    }
    S.smokeAlive = alive;
  }

  /**
   * Asks the shared light budget for a light over each burning cover. Only
   * the covers: a light per burning segment would flood the pool and they
   * would all be at the same height along one line anyway.
   * @returns {void}
   */
  function requestLights() {
    const { requestLight } = ctx.systems.lightPool;
    for (const segment of S.segments) {
      if (segment.state !== 'burning' || !segment.manhole || segment.heat <= 0.05) continue;
      const flicker = 0.82 + 0.12 * Math.sin(S.time * 15 + segment.x) + 0.08 * Math.sin(S.time * 26 + segment.z);
      requestLight({
        x: segment.x, y: GAS.lightHeight, z: segment.z,
        colour: GAS.lightColour,
        intensity: GAS.lightPeak * segment.heat * flicker,
        distance: GAS.lightDistance,
        priority: GAS.lightPriority
      });
    }
  }

  /**
   * Keeps one elongated hazard over the burning stretch of each main, so the
   * crowd clears the street rather than each individual trench.
   * @returns {void}
   */
  function updateHazards() {
    const { addHazard, removeHazard } = ctx.systems.hazards;
    for (const main of S.mains) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const segment of main.segments) {
        if (segment.state !== 'burning' && segment.state !== 'venting') continue;
        const along = main.axis === 'x' ? segment.x : segment.z;
        lo = Math.min(lo, along - GAS.segment * 0.5);
        hi = Math.max(hi, along + GAS.segment * 0.5);
      }
      if (lo > hi) {
        if (main.hazard) {
          removeHazard(main.hazard);
          main.hazard = null;
        }
        continue;
      }
      const centre = (lo + hi) / 2;
      const reach = Math.max(GAS.segment, (hi - lo) / 2);
      if (!main.hazard) {
        main.hazard = addHazard({
          x: 0, z: 0, radius: 1, radiusZ: 1, kind: 'gasFire'
        });
      }
      main.hazard.x = main.axis === 'x' ? centre : main.line;
      main.hazard.z = main.axis === 'x' ? main.line : centre;
      main.hazard.radius = main.axis === 'x' ? reach : GAS.hazardWidth;
      main.hazard.radiusZ = main.axis === 'x' ? GAS.hazardWidth : reach;
    }
  }

  // ---------------------------------------------------------------------
  // Co-op guest: the host's mains, drawn and never burned
  // ---------------------------------------------------------------------

  /**
   * The host's mains as bit masks over their segments (a snapshot's `fires`
   * rows), read-only. A main with nothing open is left out.
   * @returns {{index: number, burn: number, vent: number, spent: number}[]}
   */
  function replicaState() {
    const out = [];
    for (let m = 0; m < S.mains.length; m++) {
      const segments = S.mains[m].segments;
      const burn = segments.map(g => g.state === 'burning');
      const vent = segments.map(g => g.state === 'venting');
      const spent = segments.map(g => g.state === 'spent');
      if (!burn.includes(true) && !vent.includes(true) && !spent.includes(true)) continue;
      out.push({ index: m, burn: maskOf(burn), vent: maskOf(vent), spent: maskOf(spent) });
    }
    return out;
  }

  /**
   * Co-op guest: sets every segment's state from the `fires` rows (the
   * sampled kind, every type; a main missing from the rows is sealed). Only
   * the states: the heat, scar, jets, smoke and light follow in `stepReplica`.
   * @param {Map<number, number[]>} rows
   * @returns {void}
   */
  function mirror(rows) {
    for (let m = 0; m < S.mains.length; m++) {
      const r = rows.get(fireId(FIRE.gas, m));
      const segments = S.mains[m].segments;
      for (let i = 0; i < segments.length; i++) {
        segments[i].state = r ? segmentState(r[5], r[6], r[7], i) : 'sealed';
      }
    }
  }

  /**
   * Co-op guest: one segment's look from its mirrored state, at the host's
   * rates and inside the particle budget. No timers, no hand-off to the next
   * segment, no blast, no hazard: the heat rises in 0.35 s and falls over
   * the fade, the scar grows as the host's does.
   * @param {Segment} segment
   * @param {number} dt
   * @returns {boolean} whether it is burning or venting
   */
  function stepReplica(segment, dt) {
    const state = segment.state;
    const heat = state === 'burning'
      ? Math.min(1, segment.heat + dt / 0.35)
      : Math.max(0, segment.heat - dt / GAS.fadeSeconds);
    const scar = state === 'sealed' ? 0 : Math.min(1, segment.scar + dt * 0.8);
    if (heat !== segment.heat || scar !== segment.scar) S.seamDirty = true;
    segment.heat = heat;
    segment.scar = scar;
    if (state === 'venting') {
      S.jets.accumulator += GAS.ventRate * dt;
      while (S.jets.accumulator >= 1) {
        S.jets.accumulator -= 1;
        if (S.room-- > 0) spawnJet(segment, 'vent');
      }
      return true;
    }
    if (state !== 'burning') return false;
    S.jets.accumulator += GAS.jetRate * heat * dt;
    if (segment.manhole) S.jets.accumulator += GAS.columnRate * heat * dt;
    while (S.jets.accumulator >= 1) {
      S.jets.accumulator -= 1;
      if (S.room-- > 0) spawnJet(segment, segment.manhole && Math.random() < 0.55 ? 'column' : 'jet');
    }
    S.smoke.accumulator += GAS.smokeRate * heat * dt;
    while (S.smoke.accumulator >= 1) {
      S.smoke.accumulator -= 1;
      if (S.room-- > 0) spawnSmoke(segment);
    }
    return true;
  }

  return { spawnJet, spawnSmoke, updateJets, updateSmoke, requestLights, updateHazards, replicaState, mirror, stepReplica };
}
