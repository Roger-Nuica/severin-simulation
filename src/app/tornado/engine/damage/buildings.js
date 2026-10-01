import * as THREE from 'three';
import { DEBRIS_KIND_DEFS, pickDebrisKind } from '../debris.js';
import { hideBuildingWindows } from '../environment/buildings.js';
import { FUEL_STATION_VARIANT } from '../environment/fuelStation.js';
import { WINDOW_DARK_COLOUR, CHAIN_SHOCK_BASE, CHAIN_SHOCK_PER_HEIGHT, CHAIN_REACH_BASE, CHAIN_REACH_PER_SIZE, CHAIN_DELAY, CHAIN_MAX_DEPTH, CHAIN_RESISTANCE_PER_THRESHOLD, CHAIN_RESISTANCE_PER_WALL_LOST, CHAIN_RESISTANCE_PER_ROOF_LOST, CHAIN_GLANCING_PIECES, CHAIN_COLLAPSE_BONUS, FUEL_FIRE_RADIUS, FIRENADO_IGNITE_CHANCE, FIRENADO_IGNITE_RADIUS_FACTOR, COLLAPSE_POLE_RADIUS } from './config.js';

/**
 * ===========================================================================
 * SECTION DM.2 — Buildings
 * ===========================================================================
 * Shocks queued and resolved, pieces torn off, windows going dark, a
 * collapse and the collapses it sets off round it.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see damage.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createBuildingDamage(ctx, S, api) {
  const { Sim, windForceMagnitudeAt } = ctx;
  const { spawnImpactBurst } = ctx.systems.explosions;
  const { spawnDebris } = ctx.systems.debris;

  /**
   * Queues a shock from outside the chain -- the ground tearing open under a
   * building (engine/fissure.js) -- through the same path a neighbouring
   * collapse uses, so it topples or glances by the same rules, and anything
   * it brings down sets off a chain of its own from depth 0.
   * @param {SimObject} building
   * @param {number} shock on the same scale as collapseResistance
   * @param {THREE.Vector3} origin where it came from, for thrown pieces
   * @param {number} [depth] chain depth to continue from. Left at 0 for a
   *   shock from outside the chain; a building landing on another one
   *   (engine/topple.js) passes its own depth on, so a row of towers going
   *   over like dominoes is counted as the chain it visibly is.
   * @returns {void}
   */
  function shockBuilding(building, shock, origin, depth = 0) {
    if (building.damageState === 'collapsed') return;
    S.pendingShocks.push({
      building,
      delay: CHAIN_DELAY[0] + Math.random() * (CHAIN_DELAY[1] - CHAIN_DELAY[0]),
      shock,
      depth,
      origin: origin.clone()
    });
  }

  /**
   * @param {SimObject} obj
   * @returns {void}
   */
  function updateBuildingDamage(obj) {
    // A building that is already down is finished with. Without this it keeps
    // being offered to the wind every frame, and a piece that only comes loose
    // *after* the collapse (typically the roof, which needs a free debris slot
    // and so often fails its first few attempts at EF5) writes damageState
    // back to 'roofLost'/'wallLost' -- un-collapsing it, so the wallsLost >= 3
    // test below collapses it a second time. That double-counted
    // buildingsCollapsed on its own; now that a collapse also shocks its
    // neighbours (see propagateCollapse) it would shock them twice and pay the
    // chain bonus twice over.
    if (obj.damageState === 'collapsed') return;

    const root = obj.mesh;
    const { roof, walls } = root.userData.pieces;
    const basePos = root.position;

    if (!roof.userData.lost) {
      // Scratch vectors: every building, every frame (performance pass).
      const roofWorld = S.damageScratchA.copy(basePos); roofWorld.y = roof.position.y;
      const mag = windForceMagnitudeAt(roofWorld);
      if (mag > obj.breakThreshold && detachBuildingPiece(root, roof)) {
        obj.damageState = 'roofLost';
        Sim.stats.buildingPiecesLost++;
        api.addDamageScore(20);
        darkenBuildingWindows(obj);
      }
    }

    let wallsLost = 0;
    for (const wall of walls) {
      if (wall.userData.lost) { wallsLost++; continue; }
      // Via the world matrix rather than basePos + wall.position, since
      // buildings can be turned a quarter (see createBuilding).
      const wallWorld = wall.getWorldPosition(S.damageScratchA);
      const mag = windForceMagnitudeAt(wallWorld);
      if (mag > obj.breakThreshold * 1.3 && detachBuildingPiece(root, wall)) {
        wallsLost++;
        Sim.stats.buildingPiecesLost++;
        api.addDamageScore(20);
        obj.damageState = 'wallLost';
        darkenBuildingWindows(obj);
      }
    }

    if (wallsLost >= 3) collapseBuilding(obj, 0);
  }

  /**
   * Brings a building down: the one place a building's damageState becomes
   * 'collapsed', whether the wind did it (updateBuildingDamage) or a
   * neighbour's collapse did (resolveShock). No-ops on anything already down,
   * which is what stops a cascade ever revisiting a building.
   * @param {SimObject} obj
   * @param {number} depth 0 for a wind-driven collapse, 1+ for a domino
   * @param {THREE.Vector3} [from] what knocked it down, which is what decides
   *   which way it goes over (engine/topple.js). Omitted for a collapse the
   *   wind or a fire caused, where the funnel is the only direction there is.
   * @returns {void}
   */
  function collapseBuilding(obj, depth, from) {
    if (obj.damageState === 'collapsed') return;
    const root = obj.mesh;
    const basePos = root.position;

    obj.damageState = 'collapsed';
    Sim.stats.buildingsCollapsed++;
    // A domino is the bigger moment of the two, and the one worth a heavier
    // shake -- it is also what most often bursts into a slow-motion, since a
    // cascade fires several of these within a fraction of a second.
    api.feel(depth > 0 ? 'chain' : 'collapse', basePos);
    api.addDamageScore(100);
    if (depth > 0) {
      Sim.stats.chainCollapses++;
      api.addDamageScore(CHAIN_COLLAPSE_BONUS);
    }
    darkenBuildingWindows(obj, true);
    // Nothing of this building is intact enough to still be showing glazing.
    hideBuildingWindows(root);
    // A second, heavier burst on top of the wall-detach burst that just
    // fired, low at the building's base: collapse is the one building event
    // worth reading as bigger than a piece tearing loose.
    spawnImpactBurst(new THREE.Vector3(basePos.x, 1.5, basePos.z), 2.4);

    // Coming down inside a Firenado means coming down alight, which is how
    // the tornado itself seeds fires along its path rather than only the one
    // it started at the filling station.
    const firenado = ctx.systems.firenado;
    if (firenado.burning() && Math.random() < FIRENADO_IGNITE_CHANCE) {
      const centre = ctx.tornadoes.nearest(basePos.x, basePos.z).center;
      const reach = Sim.params.radius * FIRENADO_IGNITE_RADIUS_FACTOR;
      if (Math.hypot(basePos.x - centre.x, basePos.z - centre.z) < reach) {
        ctx.systems.buildingFire.igniteBuilding(obj, 0.35);
      }
    }
    // A fuel station going up: a bigger blast of its own and the fires
    // round it. It does not light the tornado itself any more -- a funnel
    // standing in those fires catches them (firenado.js), and with no storm
    // there is no flame vortex.
    if (root.userData.variant === FUEL_STATION_VARIANT) {
      spawnImpactBurst(new THREE.Vector3(basePos.x, 3, basePos.z), 2.6);
      // A tank going up does not just light the tornado, it lights the
      // forecourt and everything around it -- which is where a spreading
      // blaze starts (see buildingFire.js).
      ctx.systems.buildingFire.igniteBuilding(obj, 0.6);
      ctx.systems.buildingFire.igniteNear(basePos.x, basePos.z, FUEL_FIRE_RADIUS);
      // And its tanks go up a moment later (engine/fuelFire.js).
      if (ctx.systems.fuelFire) ctx.systems.fuelFire.breach(obj);
    }
    // A building coming down across the pavement takes the line with it: the
    // pole drops, the wires snap and the fault runs off down the street (see
    // environment/powerLines.js), which is its own way of spreading fire.
    // Its own service line comes down either way, and arcs back out into
    // the network if nothing nearby has already faulted it.
    const faulted = ctx.systems.powerLines.faultAt(basePos.x, basePos.z, COLLAPSE_POLE_RADIUS);
    ctx.systems.powerLines.disconnectBuilding(obj, !faulted);

    // Over rather than down, when it is tall enough to have an "over".
    // engine/topple.js does the rest from here: the rotation, what the
    // structure lands on, and the rubble it leaves in the road. A building
    // too squat to topple keeps the behaviour it always had.
    const toppled = ctx.systems.topple.toppleBuilding(obj, from || null, depth);

    // The neighbour shock is what a *pancake* does: the ground shakes and the
    // walls either side of it give. A building that goes over does its damage
    // along the line it fell instead, so it does not also get a free circle of
    // destruction around its own base.
    if (!toppled) propagateCollapse(obj, depth);
  }

  /**
   * Queues a shock against every standing neighbour within reach of a building
   * that has just come down. Nothing resolves here — see resolveShock, which
   * runs once each queued delay expires.
   * @param {SimObject} obj the building that collapsed
   * @param {number} depth its own chain depth
   * @returns {void}
   */
  function propagateCollapse(obj, depth) {
    if (depth >= CHAIN_MAX_DEPTH) return;
    const origin = obj.mesh.position;
    const fp = obj.mesh.userData.footprint;
    const wallHeight = obj.mesh.userData.wallHeight || 4;
    const reach = CHAIN_REACH_BASE + Math.max(fp.width, fp.depth) * CHAIN_REACH_PER_SIZE;
    const strength = CHAIN_SHOCK_BASE + wallHeight * CHAIN_SHOCK_PER_HEIGHT;

    for (const other of ctx.Environment.buildings) {
      // A building already down cannot be knocked down again.
      if (other === obj || other.damageState === 'collapsed') continue;
      const d = Math.hypot(
        other.mesh.position.x - origin.x, other.mesh.position.z - origin.z
      );
      if (d >= reach) continue;
      S.pendingShocks.push({
        building: other,
        delay: CHAIN_DELAY[0] + Math.random() * (CHAIN_DELAY[1] - CHAIN_DELAY[0]),
        // Falls off with the square of the distance fraction rather than
        // linearly: next door is necessarily close to `reach` on this town's
        // grid, and a linear ramp left it with a fifth of the shock, which is
        // not what standing beside a collapsing building is like.
        shock: strength * (1 - (d / reach) * (d / reach)),
        depth: depth + 1,
        origin: origin.clone()
      });
    }
  }

  /**
   * How hard this building is to topple with a shock, on the same scale the
   * shock itself is measured in. Pieces the tornado has already torn off make
   * it markedly easier — which is what lets a chain run through a street the
   * storm has chewed along but not finished off.
   * @param {SimObject} obj
   * @returns {number}
   */
  function collapseResistance(obj) {
    const { roof, walls } = obj.mesh.userData.pieces;
    const wallsLost = walls.reduce((n, wall) => n + (wall.userData.lost ? 1 : 0), 0);
    return obj.breakThreshold * CHAIN_RESISTANCE_PER_THRESHOLD
      - wallsLost * CHAIN_RESISTANCE_PER_WALL_LOST
      - (roof.userData.lost ? CHAIN_RESISTANCE_PER_ROOF_LOST : 0);
  }

  /**
   * Ticks the queued shocks and resolves the ones whose delay has run out.
   * Iterated backwards so resolved entries can be spliced out in place, and
   * `pendingShocks` is re-read rather than captured because resolveShock can
   * push new entries onto it (that is the chain).
   * @param {number} dt
   * @returns {void}
   */
  function updatePendingShocks(dt) {
    // Driven from the animation loop whenever the scene is live rather than
    // from updateDamage -- the flood and the meteor barrage are independent
    // disasters that can queue shocks with no storm running at all, and a
    // queue draining only while a tornado runs left those buildings standing.
    for (let i = S.pendingShocks.length - 1; i >= 0; i--) {
      const entry = S.pendingShocks[i];
      entry.delay -= dt;
      if (entry.delay > 0) continue;
      S.pendingShocks.splice(i, 1);
      resolveShock(entry);
    }
  }

  /**
   * Applies one queued shock: topples the building if the shock beats its
   * resistance, otherwise tears a couple of pieces off it. A glancing shock
   * that happens to take the wall count to 3 collapses it anyway, by the same
   * rule the wind uses — so it still counts as a domino rather than waiting
   * for updateBuildingDamage to notice on some later frame.
   * @param {{building: SimObject, shock: number, depth: number, origin: THREE.Vector3}} entry
   * @returns {void}
   */
  function resolveShock({ building, shock, depth, origin }) {
    // The building may have come down some other way between queueing and
    // now (the tornado itself, or an earlier shock in the same cascade), and
    // resetSim() could have replaced the whole town.
    if (building.damageState === 'collapsed' || !building.mesh.parent) return;

    if (shock > collapseResistance(building)) {
      collapseBuilding(building, depth, origin);
      return;
    }

    // Glancing blow: pieces thrown off, away from whatever fell on it rather
    // than away from the tornado.
    const root = building.mesh;
    const { roof, walls } = root.userData.pieces;
    const standing = walls.filter(wall => !wall.userData.lost);
    if (!roof.userData.lost) standing.unshift(roof);
    let knocked = 0;
    for (const piece of standing) {
      if (knocked >= CHAIN_GLANCING_PIECES) break;
      if (!detachBuildingPiece(root, piece, origin)) continue;
      knocked++;
      Sim.stats.buildingPiecesLost++;
      api.addDamageScore(20);
      if (piece === roof) building.damageState = 'roofLost';
      else building.damageState = 'wallLost';
      darkenBuildingWindows(building);
    }
    if (walls.reduce((n, wall) => n + (wall.userData.lost ? 1 : 0), 0) >= 3) {
      collapseBuilding(building, depth, origin);
    }
  }

  /**
   * Darkens a building's still-lit windows on damage: a fifth of its total
   * pane count per call (so successive hits read as a progressively spreading
   * outage), or every remaining pane at once when `full` is set (used on
   * collapse for a decisive final blackout). Only recolours existing
   * instances via setColorAt -- geometry, matrices and draw-call count are
   * untouched, so this stays cheap regardless of how many buildings are hit.
   * @param {SimObject} obj
   * @param {boolean} [full]
   * @returns {void}
   */
  function darkenBuildingWindows(obj, full) {
    const windows = obj.mesh.userData.windows;
    if (!windows || windows.darkCount >= windows.totalCount) return;
    const step = full ? windows.totalCount : Math.max(1, Math.ceil(windows.totalCount / 5));
    const end = Math.min(windows.totalCount, windows.darkCount + step);
    for (let i = windows.darkCount; i < end; i++) {
      windows.mesh.setColorAt(i, WINDOW_DARK_COLOUR);
    }
    windows.darkCount = end;
    windows.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Detaches a building sub-piece, converting it into a free debris object
   * fed by the same force-field integration as the rest of the debris pool.
   * Mirrors uprootTree()'s ordering: spawnDebris() is attempted first, and
   * the piece is only removed from the building (and marked lost) once a
   * pooled debris slot is actually secured. Under debris-pool saturation
   * spawnDebris() can return null (nothing settled yet to evict) -- removing
   * the piece unconditionally beforehand was the same bug that used to make
   * uprooted trees disappear with nothing replacing them. Leaving the piece
   * attached on failure means it stays visible and the caller's un-lost
   * guard naturally retries the detach on a later frame instead of losing it.
   * @param {THREE.Group} root
   * @param {THREE.Object3D} piece
   * @param {THREE.Vector3} [from] point to throw the piece away from; defaults
   *   to the nearest tornado. A chain collapse (see resolveShock) passes the
   *   collapsing neighbour's position instead, so the rubble visibly flies off
   *   the side that was just hit rather than off the side facing the funnel.
   * @returns {boolean} whether the piece was actually detached into debris
   */
  function detachBuildingPiece(root, piece, from) {
    const worldPos = piece.getWorldPosition(new THREE.Vector3());
    const dir = from
      ? new THREE.Vector3(worldPos.x - from.x, 0, worldPos.z - from.z).normalize()
      : api.awayFromTornado(worldPos);
    const vel = dir.multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3(0, 3 + Math.random() * 2, 0));
    const isRoof = piece.userData.pieceName === 'roof';
    const kind = isRoof
      ? pickDebrisKind({ roofPiece: 0.85, box: 0.15 })
      : pickDebrisKind({ box: 0.5, rock: 0.5 });
    const def = DEBRIS_KIND_DEFS[kind];
    const mass = def.massMin + Math.random() * (def.massMax - def.massMin);
    const spawned = spawnDebris(worldPos, vel, mass, Sim.params.debrisSize * 1.4, kind);

    if (spawned) {
      piece.userData.lost = true;
      root.remove(piece);
      // The wall is now debris, so its windows have to go with it rather than
      // staying behind as floating panes (see hideBuildingWindows).
      const pieceName = piece.userData.pieceName;
      if (pieceName && pieceName.startsWith('wall-')) {
        hideBuildingWindows(root, pieceName.slice(5));
      }
      // Fired here rather than at updateBuildingDamage's two call sites so
      // roof and wall losses are covered by one hook, and so a burst can
      // never appear for a detach that failed (spawnDebris returning null
      // leaves the piece attached and the building visually undamaged).
      // Roof panels are the bigger, more visible tear-off of the two.
      spawnImpactBurst(worldPos, isRoof ? 1.7 : 1.35);
      // Same reasoning for the combo/shake event: this is the one place a
      // piece actually comes off, whether the wind, a neighbour's collapse or
      // flying debris did it, so every path feeds the chain from here.
      api.feel('piece', worldPos);
    }
    return !!spawned;
  }

  return { shockBuilding, updateBuildingDamage, collapseBuilding, propagateCollapse, collapseResistance, updatePendingShocks, resolveShock, darkenBuildingWindows, detachBuildingPiece };
}
