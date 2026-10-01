// @ts-check
import * as THREE from 'three';
import { onRailway, RAIL_Z } from './train.js';


// Placed at the start of a run; more arrive in waves later
// (reinforcements.js). Exported for the humans readout (ui.js).
export const INITIAL_PEOPLE = 165;

/**
 * ===========================================================================
 * SECTION D — Environment generation
 * ===========================================================================
 */

// Where fuel stations go, as fractions along Environment.buildingSpots.
const FUEL_STATION_SPOT_FRACTIONS = [0.1, 0.45, 0.8];
// Which building spots are storm shelters (environment/shelters.js): one in
// each quarter of the town, at (-22,-16), (22,16), (30,-44) and (-30,44)
// before jitter, clear of the fuel stations' spots.
const SHELTER_SPOT_INDICES = [6, 9, 19, 24];
// Metres of open ground kept between two neighbouring buildings.
const BUILDING_GAP = 2.5;

/**
 * @param {Object} ctx
 * @returns {{ Environment: Object, generateEnvironment: () => void, resetEnvironment: () => void }}
 */
export function createEnvironmentSystem(ctx) {
  const { Sim } = ctx;
  const { createBuilding } = ctx.systems.buildings;
  const { createFuelStation } = ctx.systems.fuelStation;
  const { markShelter } = ctx.systems.shelters;
  const { createTree } = ctx.systems.trees;
  const { createCar } = ctx.systems.cars;
  const { createPerson } = ctx.systems.people;

  const Environment = {
    buildings: [], trees: [], cars: [], people: [], groups: /** @type {THREE.Group|null} */ (null),
    buildingSpots: /** @type {{x:number, z:number}[]} */ [],
    roadsGroup: /** @type {THREE.Group|null} */ (null),
    decorMeshes: /** @type {Object<string, THREE.InstancedMesh>} */ ({})
  };

  ctx.Environment = Environment;

  /** @returns {void} */
  function generateEnvironment() {
    const group = new THREE.Group();
    group.name = 'environment';
    Sim.three.scene.add(group);
    Environment.groups = group;

    // Town grid: buildings along two perpendicular outer "streets" plus a
    // third, closer-in offset ring, so the centre of town reads as built-up
    // rather than a thin ring of buildings around an empty core.
    const buildingSpots = [];
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      buildingSpots.push({ x: i * 22, z: -20 + (Math.abs(i) % 2) * 4 });
      buildingSpots.push({ x: i * 22, z: 20 - (Math.abs(i) % 2) * 4 });
    }
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      buildingSpots.push({ x: -30 + (Math.abs(i) % 2) * 4, z: i * 22 });
      buildingSpots.push({ x: 30 - (Math.abs(i) % 2) * 4, z: i * 22 });
    }
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      buildingSpots.push({ x: i * 22, z: -8 + (Math.abs(i) % 2) * 4 });
      buildingSpots.push({ x: i * 22, z: 8 - (Math.abs(i) % 2) * 4 });
    }
    Environment.buildingSpots = buildingSpots;
    // A few spots, spread across the list (and so across the town), get a
    // fuel station instead of a building: destroying one sets off the
    // Firenado (engine/firenado.js).
    const fuelSpots = new Set(FUEL_STATION_SPOT_FRACTIONS.map(f => Math.floor(f * buildingSpots.length)));
    // Where each one actually stands (a little off its spot), then how much
    // room each has: against every other, along whichever axis separates
    // them more, half the gap less a little air -- so the real-size
    // buildings (engine/scale.js BUILDINGS) never overlap a neighbour.
    const placed = buildingSpots.map(spot => ({ x: spot.x + (Math.random() - 0.5) * 4, z: spot.z + (Math.random() - 0.5) * 4 }));
    const rooms = placed.map((p, i) => {
      let hx = Infinity;
      let hz = Infinity;
      placed.forEach((q, j) => {
        if (i === j) return;
        const dx = Math.abs(p.x - q.x);
        const dz = Math.abs(p.z - q.z);
        if (dx >= dz) hx = Math.min(hx, (dx - BUILDING_GAP) / 2);
        else hz = Math.min(hz, (dz - BUILDING_GAP) / 2);
      });
      return { hx, hz };
    });
    buildingSpots.forEach((spot, idx) => {
      const make = fuelSpots.has(idx) ? createFuelStation : createBuilding;
      const obj = make(placed[idx].x, placed[idx].z, idx, rooms[idx]);
      if (make === createBuilding && SHELTER_SPOT_INDICES.includes(idx)) markShelter(obj);
      Environment.buildings.push(obj);
      group.add(obj.mesh);
      Sim.objects.push(obj);
    });

    // Tree lines along streets and scattered clusters.
    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2;
      const rad = 18 + Math.random() * 70;
      const x = Math.cos(angle) * rad;
      const z = Math.sin(angle) * rad;
      if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;
      if (onRailway(x, z)) continue;
      const obj = createTree(x, z, i);
      Environment.trees.push(obj);
      group.add(obj.mesh);
      Sim.objects.push(obj);
    }

    // Denser clusters in the parks (see parks.js), as ordinary trees.
    for (const obj of ctx.systems.parks.populateParks(group, Environment.trees.length)) {
      Environment.trees.push(obj);
      Sim.objects.push(obj);
    }

    // Cars parked near buildings.
    for (let i = 0; i < 34; i++) {
      const spot = buildingSpots[i % buildingSpots.length];
      const x = spot.x + (Math.random() - 0.5) * 10;
      const z = spot.z + (Math.random() - 0.5) * 10 + 6;
      if (onRailway(x, z)) continue;
      const obj = createCar(x, z, `envCar_${i}`);
      Environment.cars.push(obj);
      group.add(obj.mesh);
      Sim.objects.push(obj);
    }

    // Bystanders scattered near buildings/streets, same spot-plus-jitter
    // placement as the parked cars above but with its own offset so they
    // don't spawn standing inside one. The jitter box is widened well past
    // the cars' +-10 (to +-40): at 165 people against only ~36 building
    // spots, the old +-16 box packed 2-3 (then 5.5 m tall)
    // figures into a footprint barely wider than one of them, clumping
    // instead of spreading. +-40 overlaps neighbouring spots (they sit ~22
    // units apart on the town grid), which is what actually reads as spread
    // across the map rather than clustered at discrete points, while every
    // person is still anchored near some building.
    //
    // More arrive in waves as the run goes on
    // (engine/environment/reinforcements.js) rather than all placed here.
    const peopleCount = INITIAL_PEOPLE;
    for (let i = 0; i < peopleCount; i++) {
      const spot = buildingSpots[i % buildingSpots.length];
      const x = spot.x + (Math.random() - 0.5) * 80;
      const z = spot.z + (Math.random() - 0.5) * 80 - 4;
      // Nudged off the line rather than skipped, so the head count holds.
      const obj = createPerson(x, onRailway(x, z) ? z + (z < RAIL_Z ? -5 : 5) : z, i);
      Environment.people.push(obj);
      group.add(obj.mesh);
      Sim.objects.push(obj);
    }
  }

  /**
   * Discards the current town (buildings/trees/cars/people) and generates a
   * fresh one, called from resetSim(). Surviving trees/cars/people are
   * re-added to Sim.objects first, then Sim.objects is fully cleared
   * (releaseDebris et al already emptied it of debris by the time
   * resetSim() calls this) so generateEnvironment()'s fresh
   * buildings/trees/cars/people are the only objects left in it.
   * @returns {void}
   */
  function resetEnvironment() {
    for (const obj of [...Environment.trees, ...Environment.cars, ...Environment.people]) {
      if (!Sim.objects.includes(obj)) Sim.objects.push(obj);
    }

    Environment.groups.clear();
    Environment.buildings = [];
    Environment.trees = [];
    Environment.cars = [];
    Environment.people = [];
    Sim.objects = Sim.objects.filter(o => o.pooled); // clears everything since pool was just released -> empty
    Sim.objects = [];
    generateEnvironment();
  }

  return { Environment, generateEnvironment, resetEnvironment };
}
