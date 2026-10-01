// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION GM.0 — The gas mains' tunables
 * ===========================================================================
 * Every number the gas network, its ruptures and its fires are tuned by.
 */

export const GAS = {
  // The grid. These are the same street centre lines used by
  // environment/powerLines.js and environment/peopleMotion.js -- the mains
  // are under the roads, so they have to agree.
  zLines: [-20, -8, 8, 20],     // mains running along x, at these z
  xLines: [-30, 30],            // mains running along z, at these x
  halfLength: 105,              // each main runs from -this to +this
  // One segment is the unit of everything: the seam quad drawn for it, the
  // distance the flame front covers per hand-off, the patch of street it
  // lights. Short enough that the front reads as continuous, long enough
  // that six mains are 180 instances rather than a thousand.
  segment: 7,
  seamWidth: 2.9,               // how wide the torn street reads
  // Above the roads (0.01), the funnel's path scars (0.015), the debug grid
  // (0.02) and a meteor crater (0.025): a street torn open is the topmost
  // thing on the ground it covers.
  y: 0.05,
  // Propagation. 7 units per 0.42s is about 17 u/s -- fast enough to chase
  // and slow enough to watch coming, and roughly a third of the speed of the
  // chemical works' pressure wave so the two never read as the same effect.
  spreadInterval: 0.42,
  // How many segments a front can cover before the pressure behind it has
  // dropped too far to keep pushing gas out. Without this a single rupture
  // reaches every junction and burns all six mains end to end, which takes
  // three quarters of a minute and leaves nothing for a second press: the
  // whole network is spent on one button. At 22 (about 150 units) a rupture
  // burns most of the street it is under and turns a little way into the ones
  // it crosses, which is the shape that actually reads as a gas fire.
  // Raised from 22 when the main was made more of a catastrophe: a rupture now
  // burns well over half the length of its street and a good way down the
  // ones it crosses.
  pressure: 36,
  // What is left of that after turning a corner. Under a half, so branches are
  // visibly shorter than the trunk and a fire has a legible direction to it
  // rather than spreading as a blob.
  junctionLoss: 0.65,
  // A freshly ruptured segment hisses before it lights. This is the whole
  // "did you hear that" beat, so it is long enough to notice and short
  // enough that the player does not think nothing happened.
  ventSeconds: [0.7, 1.4],
  // How long a segment burns before the gas in it is gone. The front has
  // long moved on by then, so this is what leaves a burning street behind
  // the front rather than a travelling line of fire with darkness after it.
  burnSeconds: [8, 14],
  fadeSeconds: 2.6,             // burning -> spent
  // A cover every few segments, plus every junction. These are the ones that
  // get the vertical column of flame, the fireball, the screen shake and a
  // light -- if all 180 did, the effect would be a wall and the light budget
  // would be gone.
  manholeEvery: 2,
  igniteRadius: 15,             // buildings lit either side of a burning segment
  buildingShock: 2.2,           // enough to take the front off anything beside it
  manholeShock: 4.8,            // a cover going off next to you brings the building down
  manholeLift: 30,              // upward kick on anything loose over a cover
  manholeRadius: 16,
  manholeBlast: 3.4,            // fireball strength per cover (a collapse is 1.7)
  manholeKill: 5,               // anyone this close to a cover does not walk away
  // The rupture itself, from the panel: a blast in the street before the fire
  // runs off along it.
  ruptureBlast: 11,
  ruptureRadius: 30,
  poleFaultRadius: 6,
  // The crowd reads a burning main as one long hazard along the street
  // rather than as forty small ones, which is both cheaper to query and how
  // a person would actually see it: that street is on fire, use another.
  hazardWidth: 8,
  // Fire.
  jetMax: 780,
  jetRate: 40,                  // per second per burning segment
  jetLife: [0.45, 1.05],
  jetRise: [9, 19],
  jetSize: 3.4,
  columnRate: 38,               // extra, per second per burning manhole
  columnLife: [0.8, 1.7],
  columnRise: [40, 72],
  columnSize: 8,
  smokeMax: 340,
  smokeRate: 5,                 // per second per burning segment
  smokeLife: [1.8, 3.6],
  smokeRise: [4, 9],
  smokeSize: 7.5,
  // Gas before it lights: the same emitter, cold and pale, drifting instead
  // of rising hard.
  ventRate: 34,
  ventRise: [3, 7],
  ventSize: 4.2,
  hot: new THREE.Color(1.0, 0.72, 0.30),
  cool: new THREE.Color(0.55, 0.14, 0.04),
  gasColour: new THREE.Color(0.72, 0.80, 0.78),
  smokeColour: new THREE.Color(0.10, 0.09, 0.09),
  lightColour: 0xff8a3a,
  lightPeak: 300,
  lightDistance: 60,
  lightHeight: 3.4,
  lightPriority: 2,
  ruptureScore: 1500,
  segmentScore: 80,
  bannerSeconds: 3.4
};

// Hot enough to cross the bloom threshold in post.js, so an open main reads
// as a light source in the street rather than an orange decal on it.
export const SEAM_HDR = 2.9;

export const SEAM_VERTEX = /* glsl */`
  #include <fog_pars_vertex>
  attribute float aHeat;
  attribute float aScar;
  attribute float aSeed;
  varying vec2 vUv;
  varying float vHeat;
  varying float vScar;
  varying float vSeed;

  void main() {
    vUv = uv;
    vHeat = aHeat;
    vScar = aScar;
    vSeed = aSeed;
    vec4 world = instanceMatrix * vec4( position, 1.0 );
    world = modelMatrix * world;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const SEAM_FRAGMENT = /* glsl */`
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uHot;
  uniform vec3 uChar;
  varying vec2 vUv;
  varying float vHeat;
  varying float vScar;
  varying float vSeed;

  float hash( float n ) {
    return fract( sin( n * 127.1 ) * 43758.5453123 );
  }

  // Value noise along one axis. The crack's width is driven by it, so the
  // torn street narrows and widens instead of being a ruled line.
  float wobble( float x ) {
    float i = floor( x );
    float f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( hash( i ), hash( i + 1.0 ), f );
  }

  void main() {
    // 0 on the centre line of the street, 1 at the edge of the quad.
    float across = abs( vUv.y - 0.5 ) * 2.0;
    float along = vUv.x + vSeed * 31.0;
    // The tear: a wandering half-width, plus a second slower term so it is
    // not a single frequency.
    float edge = 0.26 + 0.30 * wobble( along * 7.0 ) + 0.16 * wobble( along * 2.3 );
    if ( across > edge || vScar + vHeat <= 0.001 ) discard;

    // 1 down the middle of the tear, 0 at its ragged lips.
    float core = 1.0 - across / edge;

    // Two flickers at unrelated rates, offset per segment, so neighbouring
    // segments never pulse together.
    float flicker = 0.80
      + 0.13 * sin( uTime * 14.0 + vSeed * 40.0 )
      + 0.07 * sin( uTime * 23.0 + vSeed * 17.0 );

    // The charred street underneath, which outlives the fire.
    vec3 colour = uChar;
    float alpha = vScar * ( 0.30 + 0.62 * core );

    // The fire in the trench: brightest in the core, and hot enough to bloom.
    float glow = vHeat * flicker * pow( core, 0.55 );
    colour += uHot * glow * ${SEAM_HDR.toFixed(1)};
    alpha = clamp( alpha + glow * 0.9, 0.0, 1.0 );

    gl_FragColor = vec4( colour, alpha );
    #include <fog_fragment>
  }
`;

// Shared types (JSDoc), imported by the files that use them.
/**
 * @typedef {Object} Segment
 * @property {Main} main
 * @property {number} index position along its main
 * @property {number} x centre, world
 * @property {number} z centre, world
 * @property {'sealed'|'venting'|'burning'|'spent'} state
 * @property {number} timer seconds left in the current state
 * @property {number} spread seconds until it hands the flame on
 * @property {number} pressure segments of run left in the front that lit it;
 *   it hands one less on, and less again round a corner, which is what stops
 *   a single rupture burning the whole network
 * @property {boolean} passed whether it has already handed the flame on
 * @property {boolean} manhole whether it has a cover to blow
 * @property {number} heat 0..1 fire drawn in the seam
 * @property {number} scar 0..1 charring, which only ever goes up
 * @property {number} burn seconds this segment burns for
 */
/**
 * @typedef {Object} Main
 * @property {'x'|'z'} axis the world axis it runs along
 * @property {number} line its fixed coordinate on the other axis
 * @property {Segment[]} segments
 * @property {Segment[][]} crossings indexed by segment, the segments on other
 *   mains that this one hands the flame to at a junction
 * @property {Object|null} hazard the crowd-AI hazard while it is alight
 */
