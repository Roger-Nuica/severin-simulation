import * as THREE from 'three';
import { STREET_Z_LINES, STREET_X_LINES, POLE_OFFSET, POLE_SPACING, POLE_EXTENT, POLE_HEIGHT, CROSSARM_HEIGHT, WIRE_OFFSETS, WIRE_SEGMENTS, WIRE_SAG, WIRE_COLOUR, DROP_MAX_DISTANCE, DROP_MAX, DROP_SAG, DROP_ATTACH_FRACTION, DROP_ATTACH_MAX, STREET_LINK_DISTANCE, DOWNED_POLE_TOP, edgeKey } from './config.js';
/** @typedef {import('./config.js').PowerNode} PowerNode */
/** @typedef {import('./config.js').Pole} Pole */
/** @typedef {import('./config.js').Span} Span */

/**
 * ===========================================================================
 * SECTION PL.1 — Poles, wires and the network
 * ===========================================================================
 * Laying out the poles along the streets, stringing the sagging wires,
 * the graph of which building each span feeds, and a span or pole coming
 * down.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see powerLines.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createPowerNetwork(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Lays out the poles: one run per street, evenly spaced along it, on
   * alternating sides so the town does not read as one long fence.
   * @returns {void}
   */
  function layOutPoles() {
    S.poles = [];
    S.runs = [];
    /** @type {{axis: 'x'|'z', line: number, side: number}[]} */
    const streets = [
      ...STREET_Z_LINES.map((line, i) => ({ axis: /** @type {'x'} */ ('x'), line, side: i % 2 === 0 ? 1 : -1 })),
      ...STREET_X_LINES.map((line, i) => ({ axis: /** @type {'z'} */ ('z'), line, side: i % 2 === 0 ? 1 : -1 }))
    ];

    for (const street of streets) {
      /** @type {Pole[]} */
      const run = [];
      for (let along = -POLE_EXTENT; along <= POLE_EXTENT; along += POLE_SPACING) {
        const offset = street.side * POLE_OFFSET;
        const x = street.axis === 'x' ? along : street.line + offset;
        const z = street.axis === 'x' ? street.line + offset : along;
        // strikeTargets.js expects candidates shaped like a SimObject: it
        // reads target.mesh.position to aim the bolt and hands the whole
        // thing back to onStruck. A pole is not a simulated object and has no
        // business in Sim.objects, so it carries a standing proxy instead --
        // built once here rather than per query, since lightning asks for
        // candidates on every strike.
        const proxy = new THREE.Object3D();
        proxy.position.set(x, 0, z);
        /** @type {Pole} */
        const pole = {
          x, z,
          // The crossarm sits across the street, i.e. perpendicular to the
          // run, so the three wires leave it along the street's direction.
          yaw: street.axis === 'x' ? 0 : Math.PI / 2,
          run: S.runs.length,
          at: run.length,
          down: false,
          index: S.poles.length,
          node: null,
          target: { type: 'powerPole', mesh: proxy, userData: { pole: null } }
        };
        pole.target.userData.pole = pole;
        pole.node = {
          id: `p${pole.index}`, kind: 'pole', position: new THREE.Vector3(x, CROSSARM_HEIGHT, z),
          cooldown: 0, pole, building: null, connectedPoles: []
        };
        S.poles.push(pole);
        run.push(pole);
      }
      S.runs.push(run);
    }
  }

  /**
   * Writes one pole's transform into both instance meshes. A downed pole is
   * tipped over about its base rather than hidden, so the street keeps its
   * wreckage.
   * @param {Pole} pole
   * @returns {void}
   */
  function writePole(pole) {
    const lean = pole.down ? Math.PI * 0.42 : 0;
    S.dummy.position.set(pole.x, pole.down ? POLE_HEIGHT * 0.3 : POLE_HEIGHT / 2, pole.z);
    S.dummy.rotation.set(lean * Math.cos(pole.yaw), pole.yaw, lean * Math.sin(pole.yaw));
    S.dummy.scale.setScalar(1);
    S.dummy.updateMatrix();
    S.poleMesh.setMatrixAt(pole.index, S.dummy.matrix);

    S.dummy.position.set(pole.x, pole.down ? 1.1 : CROSSARM_HEIGHT, pole.z);
    S.dummy.updateMatrix();
    S.armMesh.setMatrixAt(pole.index, S.dummy.matrix);
  }

  /**
   * One LineSegments from a flat list of vertex positions, with a per-vertex
   * colour so a live span can flash without touching geometry.
   * @param {number[]} positions
   * @param {string} name
   * @returns {THREE.LineSegments}
   */
  function createWireLines(positions, name) {
    const posArray = new Float32Array(positions);
    const colours = new Float32Array(posArray.length);
    const base = new THREE.Color(WIRE_COLOUR);
    for (let i = 0; i < colours.length; i += 3) {
      colours[i] = base.r;
      colours[i + 1] = base.g;
      colours[i + 2] = base.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      // Unlit, like the streetlight globes: a 3cm cable picks up no useful
      // shading at this scale and a lit material would just cost more.
      toneMapped: false
    }));
    lines.name = name;
    Sim.three.scene.add(lines);
    return lines;
  }

  /**
   * Appends one sagging wire, as WIRE_SEGMENTS line segments, to a vertex
   * list. Parabolic approximation of a catenary: zero sag at both ends,
   * deepest in the middle.
   * @param {number[]} positions
   * @param {THREE.Vector3} a
   * @param {THREE.Vector3} b
   * @param {number} sagDepth
   * @returns {void}
   */
  function pushSaggingWire(positions, a, b, sagDepth) {
    for (let s = 0; s < WIRE_SEGMENTS; s++) {
      for (const t of [s / WIRE_SEGMENTS, (s + 1) / WIRE_SEGMENTS]) {
        positions.push(
          THREE.MathUtils.lerp(a.x, b.x, t),
          THREE.MathUtils.lerp(a.y, b.y, t) - sagDepth * 4 * t * (1 - t),
          THREE.MathUtils.lerp(a.z, b.z, t)
        );
      }
    }
  }

  /**
   * Builds the sagging wire geometry between consecutive poles of each run,
   * all in one LineSegments.
   * @returns {void}
   */
  function buildWires() {
    S.spans = [];
    /** @type {number[]} */
    const positions = [];
    /** @type {{from: Pole, to: Pole, base: number, count: number}[]} */
    const ranges = [];
    const ends = [new THREE.Vector3(), new THREE.Vector3()];

    for (const run of S.runs) {
      for (let i = 0; i + 1 < run.length; i++) {
        const a = run[i];
        const b = run[i + 1];
        const base = positions.length / 3;
        for (const offset of WIRE_OFFSETS) {
          // The crossarm runs across the street, so its ends are offset
          // perpendicular to the span direction.
          ends[0].set(a.x + Math.cos(a.yaw) * offset, CROSSARM_HEIGHT, a.z - Math.sin(a.yaw) * offset);
          ends[1].set(b.x + Math.cos(b.yaw) * offset, CROSSARM_HEIGHT, b.z - Math.sin(b.yaw) * offset);
          pushSaggingWire(positions, ends[0], ends[1], WIRE_SAG);
        }
        ranges.push({ from: a, to: b, base, count: positions.length / 3 - base });
      }
    }

    S.wires = createWireLines(positions, 'powerLines_wires');
    S.spans = ranges.map(r => ({ from: r.from.node, to: r.to.node, lines: S.wires, base: r.base, count: r.count, flash: 0 }));
  }

  /**
   * The point on a building's footprint nearest a pole, at connection height.
   * Footprints are axis-aligned (buildings.js only ever turns them by 90
   * degrees and swaps width and depth when it does).
   * @param {SimObject} building
   * @param {Pole} pole
   * @returns {THREE.Vector3}
   */
  function connectionPoint(building, pole) {
    const { x, z } = building.mesh.position;
    const fp = building.mesh.userData.footprint;
    const hw = fp ? fp.width / 2 : 3;
    const hd = fp ? fp.depth / 2 : 3;
    const height = Math.min(DROP_ATTACH_MAX, (building.mesh.userData.wallHeight || 4) * DROP_ATTACH_FRACTION);
    return new THREE.Vector3(
      THREE.MathUtils.clamp(pole.x, x - hw, x + hw),
      height,
      THREE.MathUtils.clamp(pole.z, z - hd, z + hd)
    );
  }

  /**
   * @param {PowerNode} a
   * @param {PowerNode} b
   * @returns {void}
   */
  function link(a, b) {
    S.adjacency.get(a.id).push(b.id);
    S.adjacency.get(b.id).push(a.id);
  }

  /**
   * (Re)builds the whole graph for the town as it currently stands: the
   * poles and their spans, the street-corner links, and a service line from
   * each building to its nearest pole. Called whenever the buildings array
   * has been replaced, i.e. on start-up and after every reset.
   * @returns {void}
   */
  function rebuildGraph() {
    const buildings = ctx.Environment ? ctx.Environment.buildings : [];
    S.connectedSource = buildings;
    S.nodes = new Map(S.poles.map(p => [p.node.id, p.node]));
    S.adjacency = new Map(S.poles.map(p => [p.node.id, []]));
    S.edgeSpans = new Map();

    for (const span of S.spans) {
      link(span.from, span.to);
      S.edgeSpans.set(edgeKey(span.from, span.to), span);
    }

    // Street corners: poles of two different runs close enough to jump.
    S.poles.forEach((a, i) => {
      for (const b of S.poles.slice(i + 1)) {
        if (a.run !== b.run && Math.hypot(a.x - b.x, a.z - b.z) < STREET_LINK_DISTANCE) link(a.node, b.node);
      }
    });

    // Service lines, nearest first so the cap drops the most remote ones.
    const candidates = buildings
      .filter(b => !b.shelter && b.damageState !== 'collapsed')
      .map((building) => {
        const pole = S.poles.reduce((best, p) => {
          const d = Math.hypot(p.x - building.mesh.position.x, p.z - building.mesh.position.z);
          return d < best.d ? { p, d } : best;
        }, { p: /** @type {Pole|null} */ (null), d: DROP_MAX_DISTANCE }).p;
        return { building, pole };
      })
      .filter(c => c.pole)
      .sort((a, b) => a.building.mesh.position.distanceTo(a.pole.node.position)
        - b.building.mesh.position.distanceTo(b.pole.node.position))
      .slice(0, DROP_MAX);

    /** @type {number[]} */
    const positions = [];
    /** @type {{from: PowerNode, to: PowerNode, base: number, count: number}[]} */
    const ranges = [];
    for (const building of buildings) building.powerNode = null;
    candidates.forEach(({ building, pole }, i) => {
      /** @type {PowerNode} */
      const node = {
        id: `b${i}`, kind: 'building', position: connectionPoint(building, pole),
        cooldown: 0, pole: null, building, connectedPoles: [pole]
      };
      building.powerNode = node;
      S.nodes.set(node.id, node);
      S.adjacency.set(node.id, []);
      link(pole.node, node);
      const base = positions.length / 3;
      pushSaggingWire(positions, new THREE.Vector3(pole.x, CROSSARM_HEIGHT - 0.3, pole.z), node.position, DROP_SAG);
      ranges.push({ from: pole.node, to: node, base, count: positions.length / 3 - base });
    });

    if (S.drops) {
      Sim.three.scene.remove(S.drops);
      S.drops.geometry.dispose();
      S.drops.material.dispose();
    }
    S.drops = createWireLines(positions, 'powerLines_serviceLines');
    S.dropSpans = ranges.map(r => ({ ...r, lines: S.drops, flash: 0 }));
    for (const span of S.dropSpans) S.edgeSpans.set(edgeKey(span.from, span.to), span);
  }

  /**
   * Rebuilds the graph if the town has been regenerated since it was built.
   * @returns {void}
   */
  function ensureGraph() {
    if (ctx.Environment && ctx.Environment.buildings !== S.connectedSource) rebuildGraph();
  }

  /**
   * Drops a wire to the ground, which is what a snapped line looks like from
   * any distance that matters.
   * @param {Span} span
   * @returns {void}
   */
  function dropSpan(span) {
    const pos = span.lines.geometry.attributes.position.array;
    for (let v = span.base; v < span.base + span.count; v++) {
      pos[v * 3 + 1] = 0.08;
    }
    span.lines.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Brings a pole down and snaps the wires either side of it.
   * @param {Pole} pole
   * @returns {void}
   */
  function dropPole(pole) {
    if (pole.down) return;
    pole.down = true;
    if (ctx.systems.empCharge) ctx.systems.empCharge.lineDown(pole.x, pole.z);
    pole.node.position.y = DOWNED_POLE_TOP;
    writePole(pole);
    S.poleMesh.instanceMatrix.needsUpdate = true;
    S.armMesh.instanceMatrix.needsUpdate = true;
    for (const span of [...S.spans, ...S.dropSpans]) {
      if (span.from === pole.node || span.to === pole.node) dropSpan(span);
    }
  }

  /**
   * A building has come down: its service line goes with it, and (when
   * `seed` is set, i.e. nothing else has already faulted the line) the
   * fault arcs back out of its connection point into the network.
   * @param {SimObject} building
   * @param {boolean} seed
   * @returns {void}
   */
  function disconnectBuilding(building, seed) {
    ensureGraph();
    const node = building.powerNode;
    if (!node) return;
    for (const span of S.dropSpans) if (span.to === node) dropSpan(span);
    if (seed) api.seedFault(node);
  }

  return { layOutPoles, writePole, createWireLines, pushSaggingWire, buildWires, connectionPoint, link, rebuildGraph, ensureGraph, dropSpan, dropPole, disconnectBuilding };
}
