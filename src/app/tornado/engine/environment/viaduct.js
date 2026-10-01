import * as THREE from 'three';
import { VIADUCT_Z, DECK_Y, DECK_HALF, HALF_LENGTH, DECK, RAMP, ROUTE, TRAFFIC } from './viaduct/config.js';
import { ROAD_COLOUR } from './roadsDecor.js';
/** @typedef {import('./viaduct/config.js').Pillar} Pillar */
/** @typedef {import('./viaduct/config.js').Segment} Segment */
import { createViaductStructure } from './viaduct/structure.js';
import { createViaductTraffic } from './viaduct/traffic.js';
export { VIADUCT_Z } from './viaduct/config.js';

/**
 * ===========================================================================
 * SECTION D.8 — Elevated highway (viaduct)
 * ===========================================================================
 * A raised road crossing the map on pillars, with traffic on it, where both
 * the traffic *and* the structure are destructible. The train
 * (environment/train.js) already gives the storm something moving to catch at
 * ground level; this gives it something to bring down.
 *
 * Built as separate pieces from the outset even though it reads as one
 * continuous road: DECK.segments deck sections, each spanning between two of
 * the DECK.segments + 1 pillars, sharing the ground roads' material and
 * butted end to end so the seams do not show. That separation is the whole
 * point -- a single slab could only ever be indestructible or vanish whole,
 * whereas independent segments let one span drop while the rest of the
 * highway stands, which is the shot worth building this for.
 *
 * How it comes down, in order:
 *  - **integrity** drains on a pillar or a deck segment while a tornado's
 *    capture radius is over it (the structure is a target in its own right,
 *    not merely a shelf for cars), and takes a lump off on a direct debris
 *    hit -- a thrown car or an uprooted trunk, through the same
 *    damageFromImpact path buildings use. A fissure opening under a pillar
 *    (engine/fissure.js) zeroes it outright;
 *  - **a pillar at zero integrity snaps** at a random height: the stump stays,
 *    the top becomes a free physical object and topples away;
 *  - **a deck segment that has lost a support sags** toward the gap over
 *    DECK.sagSeconds, hinged on whichever end still has a pillar, then
 *    detaches as a falling chunk that lands on whatever is underneath;
 *  - **neighbouring spans shudder** as it goes, so a partial collapse reads as
 *    one structure failing rather than as unrelated pieces.
 *
 * It is a road that goes somewhere: at each end a ramp (two sloping spans,
 * on a half-height pillar) comes down to the ground, and a ground road goes
 * on round a bend to the town's street at z = ROUTE.junctionZ. The ramps
 * are spans like the others and come down the same way. The traffic drives
 * the whole of it: in at one junction, up a ramp, across, down the other
 * ramp and out at the far junction, then back in at the start.
 *
 * Cars on the deck are ordinary car objects (environment/cars.js), held on
 * the deck kinematically the same way the train is held on its rails: the
 * module writes their position each frame but keeps `velocity` set to their
 * real travel, so when the tornado takes one, or the deck drops from under
 * it, the speed it already had carries into what happens next rather than
 * being zeroed and restarted.
 */

/*
 * Split by job across engine/environment/viaduct/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js     tunables and where it runs
 *   structure.js  pillars and spans, damage, a pillar breaking, spans sagging and falling
 *   traffic.js    the cars on the deck
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initViaduct: () => void,
 *   updateViaduct: (dt: number) => void,
 *   impactTargets: () => Object[],
 *   damageStructure: (target: Object, energy: number) => boolean,
 *   fissureUnder: (x: number, z: number, radius: number) => boolean,
 *   resetViaduct: () => void,
 *   disposeViaduct: () => void
 * }}
 */
export function createViaductSystem(ctx) {
  const { Sim, nextObjectId } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {Pillar[]} */
    pillars: [],
    /** @type {Segment[]} */
    segments: [],
    /** @type {{obj: SimObject, along: number, lane: number, onDeck: boolean}[]} */
    cars: [],
    /** @type {THREE.Material[]} */
    materials: []
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createViaductStructure(ctx, S, api),
    createViaductTraffic(ctx, S, api),
    {  }
  );

  /** @returns {void} */
  function initViaduct() {
    S.group = new THREE.Group();
    S.group.name = 'viaduct';
    Sim.three.scene.add(S.group);

    // The deck's pillars, then the ramps' half-way pillars and their feet.
    const span = (DECK_HALF * 2) / DECK.segments;
    for (let i = 0; i <= DECK.segments; i++) S.pillars.push(api.createPillar(-DECK_HALF + i * span));
    const midX = (DECK_HALF + HALF_LENGTH) / 2;
    const midW = api.createPillar(-midX, RAMP.midHeight);
    const midE = api.createPillar(midX, RAMP.midHeight);
    S.pillars.push(midW, midE);
    const footW = api.createAbutment(-HALF_LENGTH);
    const footE = api.createAbutment(HALF_LENGTH);
    const first = S.pillars[0];
    const last = S.pillars[DECK.segments];

    // The spans, west to east: the west ramp, the deck, the east ramp.
    let index = 0;
    const add = (x0, y0, x1, y1, left, right) => S.segments.push(api.createSegment(index++, x0, y0, x1, y1, left, right));
    add(-HALF_LENGTH, RAMP.footY, -midX, RAMP.midHeight, footW, midW);
    add(-midX, RAMP.midHeight, -DECK_HALF, DECK_Y, midW, first);
    for (let i = 0; i < DECK.segments; i++) {
      add(-DECK_HALF + span * i, DECK_Y, -DECK_HALF + span * (i + 1), DECK_Y, S.pillars[i], S.pillars[i + 1]);
    }
    add(DECK_HALF, DECK_Y, midX, RAMP.midHeight, last, midE);
    add(midX, RAMP.midHeight, HALF_LENGTH, RAMP.footY, midE, footE);

    buildGroundRoads();
    for (let i = 0; i < TRAFFIC.cars; i++) api.createTrafficCar(i);
  }

  /**
   * The ground road beyond each ramp's foot: on along the line to the bend,
   * then north to the town's street. Flat asphalt at the roads' height, part
   * of this group so it goes with it on a Reset.
   * @returns {void}
   */
  function buildGroundRoads() {
    const mat = new THREE.MeshStandardMaterial({ color: ROAD_COLOUR, roughness: 1 });
    S.materials.push(mat);
    const w = ROUTE.roadWidth;
    const cx = ROUTE.connectorX;
    for (const side of [-1, 1]) {
      // From the ramp's foot to just past the bend.
      const along = cx + w / 2 - HALF_LENGTH;
      const lead = new THREE.Mesh(new THREE.PlaneGeometry(along, w), mat);
      lead.rotation.x = -Math.PI / 2;
      lead.position.set(side * (HALF_LENGTH + along / 2), ROUTE.roadY, VIADUCT_Z);
      // North to the street.
      const north = ROUTE.junctionZ - VIADUCT_Z + w / 2;
      const link = new THREE.Mesh(new THREE.PlaneGeometry(w, north), mat);
      link.rotation.x = -Math.PI / 2;
      link.position.set(side * cx, ROUTE.roadY, VIADUCT_Z - w / 2 + north / 2);
      for (const m of [lead, link]) {
        m.receiveShadow = true;
        m.name = 'viaduct_ground_road';
        S.group.add(m);
      }
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateViaduct(dt) {
    if (!S.group) return;
    api.updateStructure(dt);
    api.updateTraffic(dt);
  }

  /** @returns {void} */
  function resetViaduct() {
    disposeViaduct();
    initViaduct();
  }

  /** @returns {void} */
  function disposeViaduct() {
    if (!S.group) return;
    // The shadow zones go with the spans that cast them, or the crowd would
    // keep running from a highway that no longer exists.
    for (const segment of S.segments) {
      if (segment.hazard) ctx.systems.hazards.removeHazard(segment.hazard);
      segment.hazard = null;
    }
    for (const car of S.cars) {
      const idx = Sim.objects.indexOf(car.obj);
      if (idx !== -1) Sim.objects.splice(idx, 1);
      const envIdx = ctx.Environment.cars.indexOf(car.obj);
      if (envIdx !== -1) ctx.Environment.cars.splice(envIdx, 1);
    }
    // Deck spans and snapped pillar tops that are still falling.
    for (const obj of Sim.objects.filter(o => o.type === 'viaductDebris')) {
      const idx = Sim.objects.indexOf(obj);
      if (idx !== -1) Sim.objects.splice(idx, 1);
    }
    S.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const mat of S.materials) mat.dispose();
    S.materials.length = 0;
    Sim.three.scene.remove(S.group);
    S.group = null;
    S.pillars = [];
    S.segments = [];
    S.cars = [];
  }

  return {
    initViaduct, updateViaduct, impactTargets: api.impactTargets, damageStructure: api.damageStructure, fissureUnder: api.fissureUnder,
    resetViaduct, disposeViaduct
  };
}
