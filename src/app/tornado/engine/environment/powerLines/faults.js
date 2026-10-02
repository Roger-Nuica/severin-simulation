import * as THREE from 'three';
import { WINDOW_LIT_COLOUR } from '../buildings.js';
import { POLE_HEIGHT, CROSSARM_HEIGHT, WIRE_SAG, ARC_HOP_DELAY, ARC_MAX_HOPS, ARC_MAX_FRONTS, ARC_BRANCH_CHANCE, ARC_FIZZLE_CHANCE, NODE_COOLDOWN, ARC_IGNITE_RADIUS, ARC_DROP_CHANCE, ARC_SCORE, BUILDING_ARC_SCORE, HOP_FLASH, BUILDING_FLASH, WINDOW_FLICKER_TIME, POLE_HIT_RADIUS, FUNNEL_POLE_REACH, WIRE_HIT_BAND, SPARK_MAX, SPARK_PER_ARC, SPARK_PER_BUILDING, SPARK_LIFE, SPARK_SPEED, WIRE_FLASH_TIME, between, edgeKey } from './config.js';
/** @typedef {import('./config.js').PowerNode} PowerNode */

/**
 * ===========================================================================
 * SECTION PL.2 — Faults
 * ===========================================================================
 * A fault starting (debris, a funnel, a pole down) and running along the
 * lines, energising what it reaches, blacking windows out.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see powerLines.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createPowerFaults(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * @param {THREE.Vector3} at
   * @param {number} count
   * @returns {void}
   */
  function throwSparks(at, count) {
    const p = S.sparks;
    for (let n = 0; n < count; n++) {
      const i = p.next;
      p.next = (p.next + 1) % SPARK_MAX;
      p.positions[i * 3] = at.x + (Math.random() - 0.5) * 1.6;
      p.positions[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.8;
      p.positions[i * 3 + 2] = at.z + (Math.random() - 0.5) * 1.6;
      // Thrown downward and outward: sparks fall off a line, they do not rise.
      p.velocities[i * 3] = (Math.random() - 0.5) * SPARK_SPEED;
      p.velocities[i * 3 + 1] = -Math.random() * SPARK_SPEED * 0.5;
      p.velocities[i * 3 + 2] = (Math.random() - 0.5) * SPARK_SPEED;
      p.life[i] = p.maxLife[i] = SPARK_LIFE[0] + Math.random() * (SPARK_LIFE[1] - SPARK_LIFE[0]);
      p.seed[i] = Math.random();
    }
  }

  /**
   * @param {THREE.Vector3} at
   * @param {{life: number, intensity: number, distance: number}} kind
   * @returns {void}
   */
  function addFlash(at, kind) {
    S.flashes.push({ x: at.x, y: at.y, z: at.z, intensity: kind.intensity, distance: kind.distance, life: kind.life, maxLife: kind.life });
  }

  /**
   * Strobes a building's still-lit windows blue-white for a moment, if it
   * has any (see WINDOW_LIT_COLOUR in buildings.js and darkenBuildingWindows
   * in damage.js, which darkens panes from the front of the list).
   * @param {SimObject} building
   * @returns {void}
   */
  function flickerWindows(building) {
    const windows = building.mesh.userData.windows;
    if (!windows || windows.darkCount >= windows.totalCount) return;
    const existing = S.flickers.find(f => f.windows === windows);
    if (existing) existing.timer = WINDOW_FLICKER_TIME;
    else S.flickers.push({ windows, timer: WINDOW_FLICKER_TIME });
  }

  /**
   * A node the arc has just reached: sparks and score everywhere, and then
   * whatever arcing does to that kind of node.
   * @param {PowerNode} node
   * @returns {void}
   */
  function energise(node) {
    node.cooldown = NODE_COOLDOWN;
    S.cooling.push(node);
    const { addDamageScore } = ctx.systems.damage;
    // Game feel (engine/gamefeel.js): an arc is a small, sharp shake at the
    // node it reached. Deliberately not a combo event -- a fault running a
    // street fires this once per hop, which would flood a chain.
    ctx.systems.gamefeel.event('arc', node.position);
    if (node.pole) {
      const pole = node.pole;
      throwSparks(node.position, SPARK_PER_ARC);
      ctx.systems.buildingFire.igniteNear(pole.x, pole.z, ARC_IGNITE_RADIUS);
      addDamageScore(ARC_SCORE);
      if (!pole.down && Math.random() < ARC_DROP_CHANCE) api.dropPole(pole);
    } else if (node.building) {
      throwSparks(node.position, SPARK_PER_BUILDING);
      addFlash(node.position, BUILDING_FLASH);
      addDamageScore(BUILDING_ARC_SCORE);
      if (node.building.damageState !== 'collapsed') flickerWindows(node.building);
    }
  }

  /**
   * Sends the fault on from a node to one or two of its neighbours (two
   * from where it started), skipping the node it came from and anything
   * still cooling down from arcing, within the global cap on fronts.
   * @param {PowerNode} node
   * @param {PowerNode|null} cameFrom
   * @param {number} hopsLeft
   * @returns {void}
   */
  function branchFrom(node, cameFrom, hopsLeft) {
    if (hopsLeft <= 0) return;
    const options = (S.adjacency.get(node.id) || [])
      .map(id => S.nodes.get(id))
      .filter(n => n && n !== cameFrom && n.cooldown <= 0
        && !(n.building && n.building.damageState === 'collapsed'))
      .map(n => ({ n, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .map(o => o.n);
    const forks = cameFrom === null ? 2 : (Math.random() < ARC_BRANCH_CHANCE ? 2 : 1);
    for (const to of options.slice(0, forks)) {
      if (S.fronts.length >= ARC_MAX_FRONTS) return;
      S.fronts.push({ from: node, to, hops: hopsLeft - 1, timer: between(ARC_HOP_DELAY) });
    }
  }

  /**
   * Starts a fault at a node, unless it has only just arced.
   * @param {PowerNode} node
   * @returns {boolean} whether a fault started
   */
  function seedFault(node) {
    if (!node || node.cooldown > 0) return false;
    api.ensureGraph();
    energise(node);
    ctx.systems.powerArcSound.playZap(1);
    addFlash(node.position, HOP_FLASH);
    branchFrom(node, null, ARC_MAX_HOPS);
    return true;
  }

  /**
   * Faults the nearest standing pole to a point, if one is close enough,
   * bringing it down. The entry point for anything that lands on or opens
   * under a line: a building collapsing onto one (damage.js), the ground
   * tearing open under one (fissure.js).
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {boolean} whether a pole was faulted
   */
  function faultAt(x, z, radius) {
    let best = null;
    let bestDist = radius;
    for (const pole of S.poles) {
      if (pole.down || pole.node.cooldown > 0) continue;
      const d = Math.hypot(pole.x - x, pole.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = pole;
      }
    }
    if (!best) return false;
    api.dropPole(best);
    return seedFault(best.node);
  }

  /**
   * A surge, not a fault: the nearest standing pole to a point, if one is
   * close enough and not still cooling, crackles with current -- sparks, a
   * flash, a zap, and a bolt jumping to one or two of its neighbours -- and
   * nothing more. It sets nothing alight, brings nothing down and does not
   * walk the network: the overloaded grid of a solar storm
   * (engine/solarStorm.js), and the amplified EMP running down the lines
   * (player/emp.js), which would otherwise burn the whole town.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {THREE.Vector3|null} where it arced (the crossarm), or null
   */
  function surgeAt(x, z, radius) {
    if (!S.sparks) return null;
    api.ensureGraph();
    let best = null;
    let bestDist = radius;
    for (const pole of S.poles) {
      if (pole.down || pole.node.cooldown > 0) continue;
      const d = Math.hypot(pole.x - x, pole.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = pole;
      }
    }
    if (!best) return null;
    const node = best.node;
    node.cooldown = NODE_COOLDOWN;
    S.cooling.push(node);
    throwSparks(node.position, SPARK_PER_ARC);
    addFlash(node.position, HOP_FLASH);
    ctx.systems.gamefeel.event('arc', node.position);
    ctx.systems.powerArcSound.playZap(0.8);
    const near = (S.adjacency.get(node.id) || []).map(id => S.nodes.get(id)).filter(Boolean);
    for (let n = 0; n < 2 && near.length; n++) {
      const to = near.splice(Math.floor(Math.random() * near.length), 1)[0];
      api.spawnBolt(node, to);
      const span = S.edgeSpans.get(edgeKey(node, to));
      if (span) span.flash = WIRE_FLASH_TIME;
    }
    return node.position;
  }

  /**
   * Where every pole still standing is, for whoever wants to walk the lines
   * (the amplified EMP, player/emp.js). Read-only.
   * @returns {{x: number, z: number}[]}
   */
  function standingPoles() {
    return S.poles.filter(p => !p.down);
  }

  /**
   * Broad phase for flying debris against the network (debrisImpacts.js),
   * over the segment the piece covered this frame: a standing pole it passes
   * through comes down and faults; a span it cuts snaps and faults at the
   * nearer pole. Debris is not stopped by either -- a wire does not stop a
   * car.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @returns {boolean} whether it hit anything
   */
  function debrisStrike(from, to) {
    if (!S.sparks || Math.min(from.y, to.y) > POLE_HEIGHT + 0.5) return false;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lenSq = dx * dx + dz * dz;

    for (const pole of S.poles) {
      if (pole.down || pole.node.cooldown > 0) continue;
      const t = lenSq < 1e-9 ? 0
        : THREE.MathUtils.clamp(((pole.x - from.x) * dx + (pole.z - from.z) * dz) / lenSq, 0, 1);
      if (Math.hypot(from.x + dx * t - pole.x, from.z + dz * t - pole.z) > POLE_HIT_RADIUS) continue;
      if (THREE.MathUtils.lerp(from.y, to.y, t) > POLE_HEIGHT) continue;
      api.dropPole(pole);
      return seedFault(pole.node);
    }

    for (const span of S.spans) {
      const a = span.from.pole;
      const b = span.to.pole;
      if (a.down || b.down) continue;
      // Where the debris path crosses the span, as fractions along each.
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const denom = dx * ez - dz * ex;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((a.x - from.x) * ez - (a.z - from.z) * ex) / denom;
      const u = ((a.x - from.x) * dz - (a.z - from.z) * dx) / denom;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const wireY = CROSSARM_HEIGHT - WIRE_SAG * 4 * u * (1 - u);
      if (Math.abs(THREE.MathUtils.lerp(from.y, to.y, t) - wireY) > WIRE_HIT_BAND) continue;
      api.dropSpan(span);
      if (ctx.systems.empCharge) ctx.systems.empCharge.lineDown(a.x + ex * u, a.z + ez * u);
      return seedFault(u < 0.5 ? span.from : span.to);
    }
    return false;
  }

  /**
   * Counts down every front, and jumps the ones that are due: a bolt, a
   * flash, a zap, the far node energised, and then -- unless the fault
   * earths itself out -- onward.
   * @param {number} dt
   * @returns {void}
   */
  function updateFronts(dt) {
    const due = S.fronts.filter(front => (front.timer -= dt) <= 0);
    S.fronts = S.fronts.filter(front => front.timer > 0);
    for (const { from, to, hops } of due) {
      // Another branch may have got there first.
      if (to.cooldown > 0) continue;
      api.spawnBolt(from, to);
      addFlash(new THREE.Vector3().lerpVectors(from.position, to.position, 0.5), HOP_FLASH);
      const span = S.edgeSpans.get(edgeKey(from, to));
      if (span) span.flash = WIRE_FLASH_TIME;
      ctx.systems.powerArcSound.playZap(to.building ? 1 : 0.6);
      energise(to);
      if (Math.random() >= ARC_FIZZLE_CHANCE) branchFrom(to, from, hops);
    }
  }

  /**
   * A funnel passing over a standing pole brings it down and faults it: the
   * core of the vortex, not just what it throws, is enough to take a line.
   * @returns {void}
   */
  function sweepFunnels() {
    if (!Sim.state.running) return;
    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.birth < 0.5 || Vortex.neutralized) continue;
      const reach = Sim.params.radius * (Vortex.sizeMul || 1) * FUNNEL_POLE_REACH;
      for (const pole of S.poles) {
        if (pole.down || pole.node.cooldown > 0) continue;
        if (Math.hypot(pole.x - Vortex.center.x, pole.z - Vortex.center.z) > reach) continue;
        api.dropPole(pole);
        seedFault(pole.node);
      }
    }
  }

  return { throwSparks, addFlash, flickerWindows, energise, branchFrom, seedFault, faultAt, surgeAt, standingPoles, debrisStrike, updateFronts, sweepFunnels };
}
