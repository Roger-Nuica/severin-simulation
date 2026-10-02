import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION PL.0 — The power lines' tunables and shared shapes
 * ===========================================================================
 * Every number the power network is tuned by, the bolt shader, and
 * lightningPath (also used by the EMP-charged funnel, empCharge.js).
 */

// Street centre lines, mirroring roadsDecor.js's generateRoads() (and the
// copy peopleMotion.js keeps for its wander targets).
export const STREET_Z_LINES = [-20, -8, 8, 20];
export const STREET_X_LINES = [-30, 30];
// Poles stand this far off the street centre, on the pavement, and this far
// apart along it. 26 is a little wider than the ~22 building grid so poles
// and buildings do not line up in a repeating pattern.
export const POLE_OFFSET = 4.6;
export const POLE_SPACING = 26;
export const POLE_EXTENT = 100;

export const POLE_HEIGHT = 9;
export const POLE_RADIUS = 0.16;
export const CROSSARM_LENGTH = 2.6;
export const CROSSARM_HEIGHT = 8.1;
export const POLE_COLOUR = 0x4a3a2c;
// Wire attachment points, as offsets along the crossarm.
export const WIRE_OFFSETS = [-1.05, 0, 1.05];
// Segments per span, which is what gives the wire its sag.
export const WIRE_SEGMENTS = 6;
export const WIRE_SAG = 1.15;
export const WIRE_COLOUR = 0x14161a;

// Service lines into the buildings.
// A building further than this from every pole is not on the network.
export const DROP_MAX_DISTANCE = 26;
// Hard cap on service lines, however big the town gets.
export const DROP_MAX = 60;
export const DROP_SAG = 0.6;
// Connection height, as a fraction of the building's wall height, capped.
export const DROP_ATTACH_FRACTION = 0.8;
export const DROP_ATTACH_MAX = 6;
// Poles of two crossing streets closer than this are linked for the arc.
export const STREET_LINK_DISTANCE = 14;
// Where the top of a downed pole lies, for arcs that reach it.
export const DOWNED_POLE_TOP = 1.2;

// Arc walk.
export const ARC_HOP_DELAY = [0.08, 0.2];
// Hops a single fault can travel from where it started, over all branches.
export const ARC_MAX_HOPS = 7;
// Hop fronts running at once, across every fault in town.
export const ARC_MAX_FRONTS = 6;
// Chance a hop forks into a second neighbour as well as the first.
export const ARC_BRANCH_CHANCE = 0.35;
// Chance, at every hop after the first, that the fault earths itself out.
export const ARC_FIZZLE_CHANCE = 0.16;
// Seconds a node cannot arc again after arcing: no doubling back, no flood.
export const NODE_COOLDOWN = 2.5;
// A pole that arcs sets light to buildings within this radius.
export const ARC_IGNITE_RADIUS = 18;
// Chance that arcing at a pole brings that pole down too, so a run that has
// faulted looks like it.
export const ARC_DROP_CHANCE = 0.35;
export const ARC_SCORE = 12;
export const BUILDING_ARC_SCORE = 25;

// Bolts.
export const BOLT_MAX = 8;
export const BOLT_LIFE = [0.15, 0.25];
// Midpoint-displacement depth: 2^3 + 1 = 9 points per bolt.
export const BOLT_LEVELS = 3;
// Midpoint offset as a fraction of the segment it splits.
export const BOLT_ROUGHNESS = 0.24;
export const BOLT_POINTS = (1 << BOLT_LEVELS) + 1;
export const BOLT_WIDTH = 0.9;
// Frames between regenerating a live bolt's path.
export const BOLT_REGEN_FRAMES = [2, 4];
export const BOLT_CORE = new THREE.Color(4.0, 4.5, 5.0);
export const BOLT_GLOW = new THREE.Color(0.6, 1.2, 2.4);

// Light flashes, from the shared effect-light budget.
export const FLASH_COLOUR = 0xbfdcff;
export const FLASH_PRIORITY = 2;
export const HOP_FLASH = { life: 0.1, intensity: 160, distance: 22 };
export const BUILDING_FLASH = { life: 0.22, intensity: 320, distance: 28 };

// A building the arc reaches strobes its still-lit windows for this long.
export const WINDOW_FLICKER_TIME = 0.6;
export const WINDOW_ARC_COLOUR = new THREE.Color(1.4, 1.9, 2.6);

// Debris hitting the network.
export const POLE_HIT_RADIUS = 1.1;
// Of the funnel's radius: a pole this near its centre comes down (sweepFunnels).
export const FUNNEL_POLE_REACH = 0.6;
// How far above or below a wire's sagging height debris still cuts it.
export const WIRE_HIT_BAND = 0.9;

// Sparks.
export const SPARK_MAX = 320;
export const SPARK_PER_ARC = 26;
export const SPARK_PER_BUILDING = 40;
export const SPARK_LIFE = [0.25, 0.7];
export const SPARK_SPEED = 9;
export const SPARK_SIZE = 1.5;
export const SPARK_HOT = new THREE.Color(0.85, 0.95, 1.0);
export const SPARK_COOL = new THREE.Color(0.35, 0.55, 1.0);
// Flash colour a live wire takes while its span is arcing.
export const WIRE_LIVE_COLOUR = new THREE.Color(0.55, 0.78, 1.0);
export const WIRE_FLASH_TIME = 0.35;

// Exported, with lightningPath, for the EMP-charged funnel's arcs
// (engine/empCharge.js), which are the same bolts drawn on a funnel.
export const BOLT_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

// A bright core down the middle of the strip with a soft blue glow either
// side, from the one quad strip: vUv.x runs across it.
export const BOLT_FRAGMENT = /* glsl */`
  uniform vec3 uCore;
  uniform vec3 uGlow;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = min( abs( vUv.x * 2.0 - 1.0 ), 1.0 );
    float core = 1.0 - smoothstep( 0.0, 0.3, d );
    float glow = pow( 1.0 - d, 2.0 );
    gl_FragColor = vec4( uGlow * glow + uCore * core, uOpacity * max( core, glow * 0.6 ) );
  }
`;

/**
 * @typedef {Object} PowerNode
 * @property {string} id
 * @property {'pole'|'building'} kind
 * @property {THREE.Vector3} position where an arc attaches
 * @property {number} cooldown seconds before it can arc again
 * @property {Pole|null} pole
 * @property {SimObject|null} building
 * @property {Pole[]} connectedPoles buildings only: the pole feeding it
 */

/**
 * @typedef {Object} Pole
 * @property {number} x
 * @property {number} z
 * @property {number} yaw crossarm bearing, across the street
 * @property {number} run index of the run it belongs to
 * @property {number} at position along that run
 * @property {boolean} down whether it has been brought down
 * @property {number} index instance index in the pole meshes
 * @property {PowerNode} node
 * @property {{type: string, mesh: THREE.Object3D, userData: {pole: Pole|null}}} target the strike-provider stand-in
 */

/**
 * @typedef {Object} Span a wire (three conductors, or one service line)
 *   between two nodes, as a range of vertices in one LineSegments
 * @property {PowerNode} from
 * @property {PowerNode} to
 * @property {THREE.LineSegments} lines
 * @property {number} base first vertex
 * @property {number} count vertices
 * @property {number} flash seconds of live colour left
 */

/**
 * @typedef {Object} Front one hop of a fault, waiting to jump
 * @property {PowerNode} from
 * @property {PowerNode} to
 * @property {number} hops hops left after this one
 * @property {number} timer seconds until it jumps
 */

/**
 * @typedef {Object} Bolt
 * @property {THREE.Mesh} mesh
 * @property {THREE.ShaderMaterial} material
 * @property {THREE.Vector3[]} path current jagged centre line
 * @property {THREE.Vector3} a
 * @property {THREE.Vector3} b
 * @property {number} life seconds left; <= 0 means free
 * @property {number} regen frames until the path is regenerated
 */

/**
 * @param {number[]} range
 * @returns {number}
 */
export function between(range) {
  return range[0] + Math.random() * (range[1] - range[0]);
}

/**
 * @param {PowerNode} a
 * @param {PowerNode} b
 * @returns {string} the same key whichever way round the edge is walked
 */
export function edgeKey(a, b) {
  return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

/**
 * A classic midpoint-displacement lightning path from a to b: each level
 * splits every segment at its midpoint and pushes the midpoint sideways, at
 * random, by a fraction of that segment's length.
 * @param {THREE.Vector3} a
 * @param {THREE.Vector3} b
 * @param {number} levels
 * @param {number} roughness
 * @returns {THREE.Vector3[]}
 */
export function lightningPath(a, b, levels, roughness) {
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const perp = new THREE.Vector3();
  /**
   * @param {THREE.Vector3[]} points
   * @returns {THREE.Vector3[]}
   */
  const refine = (points) => points.flatMap((p, i) => {
    if (i === points.length - 1) return [p];
    const q = points[i + 1];
    // A random direction with its component along the bolt removed, so the
    // kink is sideways rather than along the line.
    perp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    perp.addScaledVector(dir, -perp.dot(dir)).normalize();
    const mid = new THREE.Vector3().lerpVectors(p, q, 0.5)
      .addScaledVector(perp, (Math.random() * 2 - 1) * roughness * p.distanceTo(q));
    return [p, mid];
  });
  return Array.from({ length: levels }).reduce(refine, [a.clone(), b.clone()]);
}
