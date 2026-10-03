import * as THREE from 'three';
import { createSoftDotTexture } from '../../utils/textures.js';
import { createParticlePool, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { POLE_HEIGHT, POLE_RADIUS, CROSSARM_LENGTH, CROSSARM_HEIGHT, POLE_COLOUR, SPARK_MAX } from './powerLines/config.js';
/** @typedef {import('./powerLines/config.js').PowerNode} PowerNode */
/** @typedef {import('./powerLines/config.js').Pole} Pole */
/** @typedef {import('./powerLines/config.js').Span} Span */
/** @typedef {import('./powerLines/config.js').Front} Front */
/** @typedef {import('./powerLines/config.js').Bolt} Bolt */
import { createPowerNetwork } from './powerLines/network.js';
import { createPowerFaults } from './powerLines/faults.js';
import { createPowerEffects } from './powerLines/effects.js';
export { lightningPath, BOLT_VERTEX, BOLT_FRAGMENT } from './powerLines/config.js';

/**
 * ===========================================================================
 * SECTION D.7 — Environment: power lines
 * ===========================================================================
 * Utility poles strung along the straight streets, service lines from them
 * into the buildings, and what happens when the storm gets at them. Distinct
 * from roadsDecor.js's streetlights, which are scattered around building lots
 * at random angles and so cannot be wired together into anything that reads
 * as a line: these are placed in ordered *runs* down each street, which is
 * the whole point -- a fault has somewhere to travel.
 *
 * The network is a graph (an adjacency list keyed by node id). Its nodes are
 * the poles and one connection point per building (building.powerNode), and
 * its edges are:
 *  - the spans between consecutive poles of a run;
 *  - a service line from each building to its nearest pole;
 *  - a link between the poles of two streets where they cross, which has no
 *    wire -- the arc simply jumps the corner.
 * The building half is rebuilt whenever the town is regenerated.
 *
 * What faults the network:
 *  - lightning striking a pole (registered with strikeTargets.js as a 'rare'
 *    target, so it is aimed at deliberately rather than incidentally);
 *  - flying debris hitting a pole or cutting a span (debrisImpacts.js);
 *  - a building collapsing onto a line, or taking its own service line down
 *    with it (damage.js's collapseBuilding);
 *  - the ground tearing open under a pole (fissure.js);
 *  - a funnel passing straight over a pole (see sweepFunnels).
 *
 * Whenever a pole comes down or a span is cut, empCharge.js is told
 * (lineDown): a tornado close enough to the line absorbs the discharge.
 *
 * A fault walks the graph a hop at a time, 80-200ms per hop, forking into one
 * or two neighbours at each node, with a chance of earthing itself out at
 * every hop and a hard cap on hops and on how many fronts can be running at
 * once. A node that has just arced cannot arc again for a moment, so a walk
 * never doubles back or floods the town. Each hop draws a jagged bolt
 * between the two nodes, regenerated every few frames so it jitters, and
 * throws a brief flash of light from the effect-light budget shared with the
 * lava vents (lightPool.js). At a pole it throws sparks and may set light to
 * what is nearby (buildingFire.js) or bring the pole down; reaching a
 * building it flashes the connection point and strobes the building's lit
 * windows. Sound is sound/powerArc.js.
 *
 * Costs: two InstancedMeshes for the poles, two LineSegments for every wire
 * in town, one shared particle pool for the sparks, and a small fixed pool
 * of bolt meshes that are only drawn while live. Nothing here runs per frame
 * unless something is actually arcing.
 */

/*
 * Split by job across engine/environment/powerLines/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js    tunables, the bolt shader, lightningPath
 *   network.js   poles, wires and the graph of what feeds what
 *   faults.js    faults travelling down the lines, sparks, flicker
 *   effects.js   the arcs, flashes and sparks drawn
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initPowerLines: () => void,
 *   updatePowerLines: (dt: number) => void,
 *   faultAt: (x: number, z: number, radius: number) => boolean,
 *   surgeAt: (x: number, z: number, radius: number) => THREE.Vector3|null,
 *   standingPoles: () => {x: number, z: number}[],
 *   debrisStrike: (from: THREE.Vector3, to: THREE.Vector3) => boolean,
 *   disconnectBuilding: (building: SimObject, seed: boolean) => void,
 *   resetPowerLines: () => void,
 *   disposePowerLines: () => void
 * }}
 */
export function createPowerLinesSystem(ctx) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {Pole[]} */
    poles: [],
    /** @type {Pole[][]} */
    runs: [],
    /** @type {Map<string, PowerNode>} */
    nodes: new Map(),
    /** @type {Map<string, string[]>} */
    adjacency: new Map(),
    /** @type {Map<string, Span>} wired edges only; street links have none */
    edgeSpans: new Map(),
    /** @type {SimObject[]|null} the buildings array the service lines were built for */
    connectedSource: null,
    /** @type {Front[]} */
    fronts: [],
    /** @type {Bolt[]} */
    bolts: [],
    /** @type {{x: number, y: number, z: number, intensity: number, distance: number, life: number, maxLife: number}[]} */
    flashes: [],
    /** @type {{windows: {mesh: THREE.InstancedMesh, totalCount: number, darkCount: number}, timer: number}[]} */
    flickers: [],
    /** @type {PowerNode[]} */
    cooling: [],
    /** @type {THREE.InstancedMesh|null} */
    poleMesh: null,
    /** @type {THREE.InstancedMesh|null} */
    armMesh: null,
    /** @type {THREE.LineSegments|null} */
    wires: null,
    /** @type {THREE.LineSegments|null} */
    drops: null,
    /** @type {Span[]} */
    spans: [],
    /** @type {Span[]} */
    dropSpans: [],
    /** @type {import('../particlePool.js').ParticlePool|null} */
    sparks: null,

    sparksAlive: 0,

    wasActive: false,

    dummy: new THREE.Object3D(),

    scratch: new THREE.Color(),

    tangent: new THREE.Vector3(),

    toCamera: new THREE.Vector3(),

    side: new THREE.Vector3(),
    /** @type {(() => void)|null} */
    unregisterStrikes: null
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createPowerNetwork(ctx, S, api),
    createPowerFaults(ctx, S, api),
    createPowerEffects(ctx, S, api),
    {  }
  );

  /** @returns {void} */
  function initPowerLines() {
    api.layOutPoles();

    const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS * 1.4, POLE_HEIGHT, 6);
    const armGeo = new THREE.BoxGeometry(CROSSARM_LENGTH, 0.16, 0.16);
    const mat = new THREE.MeshStandardMaterial({ color: POLE_COLOUR, roughness: 0.95 });
    S.poleMesh = new THREE.InstancedMesh(poleGeo, mat, S.poles.length);
    S.poleMesh.name = 'powerLines_poles';
    // No shadows from the poles or their cross-arms. At a fraction of a
    // shadow-map texel across, a pole's shadow came out as a long broken
    // staircase down the street that crawled every frame as the sun moved --
    // the "constant glitch" along the roads.
    S.poleMesh.castShadow = false;
    S.armMesh = new THREE.InstancedMesh(armGeo, mat, S.poles.length);
    S.armMesh.name = 'powerLines_crossarms';
    S.armMesh.castShadow = false;
    for (const pole of S.poles) api.writePole(pole);
    S.poleMesh.instanceMatrix.needsUpdate = true;
    S.armMesh.instanceMatrix.needsUpdate = true;
    Sim.three.scene.add(S.poleMesh, S.armMesh);

    api.buildWires();
    api.rebuildGraph();
    api.createBolts();

    S.sparks = createParticlePool(
      Sim.three.scene, SPARK_MAX, createSoftDotTexture(), THREE.AdditiveBlending, 'powerLines_sparks'
    );

    // 'rare': aimed at deliberately rather than hit incidentally, like the
    // chase car. The chance rises when there is nobody left in the open for
    // the bolt to go for instead.
    S.unregisterStrikes = ctx.systems.strikeTargets.registerStrikeProvider({
      name: 'powerLines',
      priority: 'rare',
      candidates: () => S.poles.filter(p => !p.down).map(p => p.target),
      strikeHeight: CROSSARM_HEIGHT,
      chance: (primaryInRange) => (primaryInRange ? 0.12 : 0.3),
      onStruck: (target) => api.seedFault(target.userData.pole.node)
    });
  }

  /**
   * Advances every fault, bolt, flash and spark. Returns early when nothing
   * is arcing, which is nearly always.
   * @param {number} dt
   * @returns {void}
   */
  function updatePowerLines(dt) {
    if (!S.sparks) return;
    api.ensureGraph();
    api.sweepFunnels();

    const liveBolts = S.bolts.filter(b => b.life > 0);
    const active = S.fronts.length > 0 || liveBolts.length > 0 || S.flashes.length > 0 || S.flickers.length > 0
      || S.cooling.length > 0 || S.sparksAlive > 0 || S.spans.some(s => s.flash > 0) || S.dropSpans.some(s => s.flash > 0);
    if (!active && !S.wasActive) return;
    S.wasActive = active;

    for (const node of S.cooling) node.cooldown -= dt;
    S.cooling = S.cooling.filter(node => node.cooldown > 0);
    api.updateFronts(dt);
    for (const bolt of liveBolts) api.updateBolt(bolt, dt);
    api.updateFlashes(dt);
    api.updateFlickers(dt);
    api.updateWireFlashes(dt);
    api.updateSparks(dt);
    const arcing = S.fronts.length + S.bolts.filter(b => b.life > 0).length;
    ctx.systems.powerArcSound.updatePowerArcSound(Math.min(1, arcing / 4), dt);
  }

  /**
   * Stands every pole back up, re-strings the wires and clears every fault,
   * called from resetSim(). The service lines are rebuilt on the next frame,
   * once resetEnvironment() has put up the new town they connect to.
   * @returns {void}
   */
  function resetPowerLines() {
    S.fronts = [];
    S.flashes = [];
    for (const f of S.flickers) f.timer = 0;
    api.updateFlickers(0);
    for (const node of S.cooling) node.cooldown = 0;
    S.cooling = [];
    for (const bolt of S.bolts) {
      bolt.life = 0;
      bolt.mesh.visible = false;
    }
    for (const pole of S.poles) {
      pole.down = false;
      pole.node.position.y = CROSSARM_HEIGHT;
      api.writePole(pole);
    }
    if (S.poleMesh) S.poleMesh.instanceMatrix.needsUpdate = true;
    if (S.armMesh) S.armMesh.instanceMatrix.needsUpdate = true;
    if (S.wires) {
      // The spans were only ever flattened in place, so rebuilding the sag is
      // just re-running the same layout over the existing buffer.
      Sim.three.scene.remove(S.wires);
      S.wires.geometry.dispose();
      S.wires.material.dispose();
      api.buildWires();
    }
    S.connectedSource = null;
    if (S.sparks) {
      S.sparks.life.fill(0);
      S.sparks.colours.fill(0);
      S.sparks.sizes.fill(0);
      markPoolDirty(S.sparks);
    }
    S.sparksAlive = 0;
    S.wasActive = true;
    ctx.systems.powerArcSound.fadeOutPowerArcSound();
  }

  /** @returns {void} */
  function disposePowerLines() {
    const scene = Sim.three.scene;
    if (S.unregisterStrikes) {
      S.unregisterStrikes();
      S.unregisterStrikes = null;
    }
    for (const mesh of [S.poleMesh, S.armMesh]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    // One material shared by both pole meshes.
    if (S.poleMesh) S.poleMesh.material.dispose();
    for (const lines of [S.wires, S.drops]) {
      if (!lines) continue;
      scene.remove(lines);
      lines.geometry.dispose();
      lines.material.dispose();
    }
    for (const bolt of S.bolts) {
      scene.remove(bolt.mesh);
      bolt.mesh.geometry.dispose();
      bolt.material.dispose();
    }
    S.bolts.length = 0;
    if (S.sparks) disposeParticlePool(scene, S.sparks);
    ctx.systems.powerArcSound.disposePowerArcSound();
    S.poleMesh = null;
    S.armMesh = null;
    S.wires = null;
    S.drops = null;
    S.sparks = null;
    S.poles = [];
    S.runs = [];
    S.spans = [];
    S.dropSpans = [];
    S.fronts = [];
    S.flashes = [];
    S.flickers = [];
    S.cooling = [];
    S.nodes = new Map();
    S.adjacency = new Map();
    S.edgeSpans = new Map();
    S.connectedSource = null;
  }

  return {
    initPowerLines, updatePowerLines, faultAt: api.faultAt, surgeAt: api.surgeAt, standingPoles: api.standingPoles, debrisStrike: api.debrisStrike, disconnectBuilding: api.disconnectBuilding, resetPowerLines, disposePowerLines
  };
}
