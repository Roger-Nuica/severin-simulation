import * as THREE from 'three';
import { FISSURE, RIFT, CALDERA, between, lerpRange, halfWidthAt, pointAlong } from './config.js';

/**
 * ===========================================================================
 * SECTION FS.2 — Eruptions and what the ground breaks
 * ===========================================================================
 * An eruption and how it grows, and what a fissure opening under the town
 * breaks: buildings, poles, the viaduct, the gas mains; where it is hot, and
 * water putting it out.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see fissure.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFissureEruption(ctx, S, api) {
  /**
   * Tears the ground open: an epicentre, its vent, and fissures spread
   * roughly evenly around it with vents of their own.
   * @param {number} severity 0..1
   * @returns {void}
   */
  function erupt(severity) {
    S.eruption.severity = severity;
    S.eruption.heat = 0;
    S.eruption.scarTimer = 0;
    S.shared.uOpacity.value = 1;
    const angle = Math.random() * Math.PI * 2;
    const r = between(FISSURE.epicentreRadius);
    const cx = Math.cos(angle) * r;
    const cz = Math.sin(angle) * r;
    // The rift first: two arms leaving the epicentre in exactly opposite
    // directions, so the ground reads as splitting in two rather than
    // cracking in a few places. The radiating fissures below then open around
    // it as branches.
    const riftHeading = Math.random() * Math.PI * 2;
    for (const away of [0, Math.PI]) {
      const arm = api.createFissure(cx, cz, riftHeading + away, severity, true);
      S.fissures.push(arm);
      for (let v = 0; v < RIFT.vents; v++) {
        // Spread along the arm rather than clustered near the epicentre,
        // which already has the biggest vent of all.
        const along = 0.2 + (v / RIFT.vents) * 0.7;
        const at = pointAlong(arm, along);
        const radius = lerpRange(RIFT.ventRadius, severity) * (0.8 + Math.random() * 0.4);
        S.vents.push(api.createVent(at.x, at.z, radius, arm, along, arm.lava));
      }
    }

    const count = Math.round(lerpRange(FISSURE.count, severity * 0.8 + Math.random() * 0.2));
    const base = Math.random() * Math.PI * 2;
    const sector = (Math.PI * 2) / count;
    for (let k = 0; k < count; k++) {
      const fissure = api.createFissure(cx, cz, base + k * sector + (Math.random() - 0.5) * sector * 0.5, severity);
      S.fissures.push(fissure);
      const ventCount = Math.random() < severity ? FISSURE.ventsPerFissure[1] : FISSURE.ventsPerFissure[0];
      for (let v = 0; v < ventCount; v++) {
        const along = between(FISSURE.ventAlong);
        const at = pointAlong(fissure, along);
        const radius = Math.max(FISSURE.ventRadius[0], Math.min(FISSURE.ventRadius[1], halfWidthAt(fissure, along) * 1.4));
        S.vents.push(api.createVent(at.x, at.z, radius, fissure, along, fissure.lava));
      }
    }
    S.vents.push(api.createVent(cx, cz, FISSURE.epicentreVent * (0.8 + 0.3 * severity), null, 0, { value: 0 }));

    // The crater itself. Kept in its own list, because unlike everything
    // above it is still there when the eruption is over.
    S.calderas.push(api.createCaldera(cx, cz, severity));
    while (S.calderas.length > CALDERA.maxKept) api.disposeCaldera(S.calderas.shift());
  }

  /**
   * A quake while an eruption is still showing reheats the same fissures
   * (the strength envelope does that by itself, via the heat) rather than
   * opening a second set over the first.
   * @param {number} severity
   * @returns {void}
   */
  function extendEruption(severity) {
    S.eruption.severity = Math.max(S.eruption.severity, severity);
    S.eruption.scarTimer = 0;
    S.shared.uOpacity.value = 1;
  }

  /**
   * Queues a building shock for every standing building a newly opened
   * fissure runs under, through damage.js's chain-reaction path.
   * @param {Fissure} fissure
   * @returns {void}
   */
  function shockBuildingsAlong(fissure) {
    const damage = ctx.systems.damage;
    if (!damage || !damage.shockBuilding || !ctx.Environment) return;
    // The rift hits far harder than a branch crack: a building it opens
    // under has the ground leaving from beneath it, so it should come down
    // rather than shed a wall.
    const shock = lerpRange(FISSURE.shock, S.eruption.severity) * (fissure.rift ? RIFT.shockMul : 1);
    for (const building of ctx.Environment.buildings) {
      if (building.shelter || building.damageState === 'collapsed') continue;
      const { x, z } = building.mesh.position;
      const fp = building.mesh.userData.footprint;
      const footprintHalf = fp ? Math.max(fp.width, fp.depth) * 0.5 : 3;
      const hit = fissure.points.find((point, i) => Math.hypot(point.x - x, point.y - z)
        < footprintHalf * 0.8 + halfWidthAt(fissure, fissure.cumulative[i] / fissure.total));
      if (hit) damage.shockBuilding(building, shock, new THREE.Vector3(hit.x, 0, hit.y));
    }
  }

  /**
   * Faults the first utility pole a newly opened fissure runs under. One per
   * fissure: the arc it starts does the rest.
   * @param {Fissure} fissure
   * @returns {void}
   */
  function faultPolesAlong(fissure) {
    fissure.points.some((point, i) => ctx.systems.powerLines.faultAt(
      point.x, point.y, halfWidthAt(fissure, fissure.cumulative[i] / fissure.total) + FISSURE.poleFaultMargin
    ));
  }

  /**
   * Undermines any elevated-highway pillar the crack opens under: there is
   * nothing left for it to stand on, so it goes (environment/viaduct.js).
   * Unlike the pole fault above this does not stop at the first one -- a rift
   * running the length of the map can take out a whole run of pillars, which
   * is exactly the moment worth having.
   * @param {Fissure} fissure
   * @returns {void}
   */
  function undermineViaduct(fissure) {
    fissure.points.forEach((point, i) => ctx.systems.viaduct.fissureUnder(
      point.x, point.y, halfWidthAt(fissure, fissure.cumulative[i] / fissure.total)
    ));
  }

  /**
   * @param {Fissure} fissure
   * @returns {void}
   */
  function onFissureOpened(fissure) {
    fissure.opened = true;
    ctx.systems.earthquakeSound.playRupture(S.eruption.severity);
    shockBuildingsAlong(fissure);
    faultPolesAlong(fissure);
    undermineViaduct(fissure);
    rupturePipesAlong(fissure);
  }

  /**
   * Opens any buried gas main the crack runs across (engine/gasMains.js).
   * Unlike the pole fault this does not stop at the first one: a rift running
   * the length of the map should cut every street it crosses, and each of
   * those becomes its own fire running away down the road.
   *
   * The gas is lit on the spot rather than left to hiss -- the crack it came
   * out of has lava in it.
   * @param {Fissure} fissure
   * @returns {void}
   */
  function rupturePipesAlong(fissure) {
    const gasMains = ctx.systems.gasMains;
    if (!gasMains) return;
    // Every few points rather than all of them: consecutive points are a
    // fraction of a unit apart and the rupture radius is several units wide,
    // so testing each one would be the same work many times over.
    for (let i = 0; i < fissure.points.length; i += 4) {
      const point = fissure.points[i];
      const width = halfWidthAt(fissure, fissure.cumulative[i] / fissure.total);
      gasMains.ruptureAt(point.x, point.y, width + FISSURE.pipeRuptureMargin, { ignite: true });
    }
  }

  /**
   * The lava currently showing on the ground, for anything that has to know
   * where the molten parts of the map are: the tornado picking a load up
   * (engine/lavanado.js), and the flood front finding one
   * (engine/collisions.js).
   *
   * Returns the live vent list rather than a copy -- it is read every frame by
   * both callers, and `level` is what tells them how molten a vent is right
   * now (0 for one that has not opened yet or has been put out).
   * @returns {Vent[]}
   */
  function hotSpots() {
    S.hotSpotList.length = 0;
    for (const vent of S.vents) {
      if (vent.quenched) continue;
      vent.spot.x = vent.x;
      vent.spot.z = vent.z;
      vent.spot.radius = vent.radius;
      vent.spot.level = vent.level;
      S.hotSpotList.push(vent.spot);
    }
    for (const caldera of S.calderas) {
      if (caldera.quenched) continue;
      // The lake, not the rim: the molten part of a caldera is the pool in
      // the middle of it, and the rim is cold rock piled up around that.
      caldera.spot.x = caldera.x;
      caldera.spot.z = caldera.z;
      caldera.spot.radius = caldera.lakeR;
      caldera.spot.level = caldera.glow.value * caldera.rise;
      S.hotSpotList.push(caldera.spot);
    }
    return S.hotSpotList;
  }

  /**
   * Puts one vent out for good: the flood reached it. The mesh goes with it,
   * because a cold vent is a hole in the ground and there is already a
   * crater decal over the top of it.
   * @param {Vent} vent
   * @returns {void}
   */
  function quench(spot) {
    spot.level = 0;
    if (spot.caldera) {
      // The lake goes out and stays out, but the crater itself is left where
      // it is: a caldera is a permanent scar in the ground and having the
      // water arrive does not fill it in.
      spot.caldera.quenched = true;
      spot.caldera.glow.value = 0;
      return;
    }
    const vent = spot.vent;
    vent.level = 0;
    vent.active = false;
    vent.quenched = true;
    vent.mesh.visible = false;
    // Its own lava uniform if it has one (the epicentre vent does); a vent
    // sharing its fissure's uniform is left alone, since that is also what
    // draws the seam.
    if (!vent.fissure) vent.lava.value = 0;
  }

  /**
   * Arms the next eruption with the quake's severity; it goes off once the
   * quake is shaking hard enough (see updateFissures). Called from
   * triggerEarthquake.
   * @param {number} severity 0..1
   * @returns {void}
   */
  function armEruption(severity) {
    S.armed = THREE.MathUtils.clamp(severity, 0, 1);
  }

  /**
   * Removes every fissure and vent and frees their GPU resources. The vent
   * dome geometry is shared, so it stays until disposeFissures.
   * @returns {void}
   */
  function clearEruption() {
    for (const fissure of S.fissures) {
      S.group.remove(fissure.mesh);
      fissure.mesh.geometry.dispose();
      fissure.mesh.material.dispose();
    }
    for (const vent of S.vents) {
      S.group.remove(vent.mesh);
      vent.mesh.material.dispose();
    }
    S.fissures.length = 0;
    S.vents.length = 0;
    // Deliberately not the calderas: the crater a quake leaves is the one
    // part of an eruption that stays for the rest of the run.
    S.eruption.heat = 0;
    S.eruption.scarTimer = 0;
    S.shared.uGlow.value = 0;
    S.shared.uOpacity.value = 1;
  }

  return { erupt, extendEruption, shockBuildingsAlong, faultPolesAlong, undermineViaduct, onFissureOpened, rupturePipesAlong, hotSpots, quench, armEruption, clearEruption };
}
