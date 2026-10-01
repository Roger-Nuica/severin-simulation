import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION FS.0 — The fissures' tunables
 * ===========================================================================
 * Every number the earthquake's fissures and their eruptions are tuned by:
 * the cracks, the calderas, the vents, the lava, the spatter and the ash.
 */

export const FISSURE = {
  triggerStrength: 0.6,       // quake strength at which the ground tears
  count: [3, 6],              // fissures, by severity
  length: [12, 36],           // world units, by severity
  segment: 1.8,               // world units per random-walk step
  maxTurn: 0.38,              // radians a step may turn
  straighten: 0.18,           // pull back towards the fissure's heading per step
  width: [1.2, 2.8],          // at the epicentre, by severity; tapers to a point
  growSeconds: [1.1, 1.9],
  stagger: 0.5,               // seconds the last fissure may start after the first
  lavaSeconds: 1.2,           // black to glowing once a fissure has opened
  coolSeconds: 5.5,           // heat falls from full to nothing no faster than this
  scarHold: 5,                // seconds cold scars stay after cooling
  scarFade: 3,
  epicentreRadius: [6, 50],   // the epicentre lands in this ring around the origin
  y: 0.05,                    // above the roads (0.01) and skid marks (0.02)
  glow: [0.55, 1],            // lava brightness, by severity
  ventRise: 0.9,              // seconds for a vent to push up out of the ground
  ventsPerFissure: [1, 2],
  ventAlong: [0.35, 0.8],     // where along a fissure its vents sit
  epicentreVent: 2.4,         // radius
  ventRadius: [0.9, 1.5],
  ventHeight: 0.4,            // of radius
  lightColour: 0xff6a1f,
  lightPeak: 90,
  lightDistance: 18,
  lightHeight: 1.6,
  lightPriority: 1,           // below the power-line arcs' brief flashes
  poleFaultMargin: 1.5,       // how near a pole a crack must pass to fault it
  // The same idea for the buried gas mains, but wider: a pipe is under the
  // road rather than beside it, so ground moving anywhere near it shears it.
  pipeRuptureMargin: 4,
  shock: [0.7, 1.35]          // shock to a building a fissure opens under, by severity
};

/**
 * The main rift: the ground splitting in two, rather than the handful of
 * short radiating cracks the eruption used to be. Built as two arms leaving
 * the epicentre in exactly opposite directions, so together they read as one
 * continuous tear running clean across the map.
 *
 * The radiating fissures above are unchanged and still open around it -- they
 * are now branches off the rift rather than the whole event. Sizing: the town
 * spans roughly +-130 units, so arms of up to 150 each guarantee the rift
 * reaches both edges at high severity; at 12-36 units long and 1.2-2.8 wide,
 * the old cracks simply could not be seen as a split at all.
 */
export const RIFT = {
  armLength: [70, 150],       // each arm, by severity; two arms per rift
  width: [5, 11],             // at the epicentre, by severity
  growSeconds: [1.6, 2.6],    // slower than a branch: it is far longer
  // Straighter than a branch crack. The random walk's own maxTurn wanders
  // pleasingly over 20 units and aimlessly over 150, and a rift that
  // meanders back on itself stops reading as a split.
  maxTurn: 0.12,
  straighten: 0.45,
  vents: 3,                   // per arm, spread along it
  ventRadius: [1.6, 2.8],
  // Buildings the rift opens under are hit far harder than a branch does:
  // the ground is leaving from under them.
  shockMul: 2.2
};

/**
 * The caldera: a wide crater at the epicentre with a lake of lava boiling in
 * it. The centre of an eruption used to be a half-sphere dome of radius 2.4 --
 * the same little crusted cap used for the vents dotted along each crack --
 * so the most violent point on the map was a bump.
 *
 * Built raised rather than sunk. The terrain is one flat opaque plane, so a
 * bowl dug below y=0 would simply be hidden by the ground covering it; a rim
 * wall pushed *up* around a lake set just above the ground reads as a crater
 * from every angle the camera can reach, and has the bonus of breaking the
 * skyline.
 *
 * It outlives the eruption. Everything else here cools, fades and is disposed
 * (see clearEruption), but a caldera is the one piece of this that should
 * still be there at the end of the run, so it keeps its own glow and opacity
 * uniforms rather than sharing the eruption's, and goes cold and black in
 * place instead of disappearing.
 */
export const CALDERA = {
  radius: [14, 26],          // outer rim, by severity
  rimHeight: [1.7, 3.4],
  lakeFraction: 0.72,        // of the outer radius
  lakeY: 0.07,               // above the fissure strips (0.05)
  growSeconds: 2.2,
  segments: 56,
  // Bubbles bursting throw spatter, on their own budget rather than competing
  // with the seam spatter along the cracks.
  burstRate: 30,
  lightPeak: 240,
  lightDistance: 70,
  lightPriority: 2,          // above the vents, below the power-line arcs
  // Old calderas are kept, but not for ever: a long run with a lot of quakes
  // should not end up carrying twenty lava lakes' worth of geometry.
  maxKept: 5
};

/**
 * The lava fountain at the epicentre: a sustained vertical jet, which is the
 * single thing that makes an eruption read as volcanic rather than as a
 * glowing crack in the floor. Reuses the spatter pool and its gravity, just
 * thrown far harder and far straighter up.
 */
export const FOUNTAIN = {
  rate: 90,                   // particles/sec at full glow
  rise: [26, 46],             // vs SPATTER's 5-10: this is the jet
  spread: [0.6, 3.5],         // narrow cone, so it goes up rather than out
  life: [1.8, 3.2],
  size: 1.5
};

export const SPATTER = {
  // Raised from 110 to carry the fountain as well as the seam spatter: at
  // FOUNTAIN.rate over FOUNTAIN.life the jet alone needs ~250 live particles,
  // and a pool that wrapped early cut the jet off halfway up.
  max: 320,
  rate: 42,                   // particles/sec at full glow
  ventShare: 0.65,            // the rest spit from fissure seams
  life: [1.0, 1.8],
  rise: [5, 10],
  spread: [1, 3.2],
  gravity: 9.8,               // positive: real gravity, unlike the buoyant dust
  size: 0.9,
  hot: new THREE.Color(3.0, 1.6, 0.35),
  warm: new THREE.Color(1.6, 0.3, 0.03),
  cold: new THREE.Color(0.08, 0.03, 0.02)
};

export const ASH = {
  max: 40,
  rate: 9,                    // well under the quake dust's 55/sec
  life: [2.5, 4],
  gravity: -0.9,              // negative: buoyant, like the quake dust
  drag: 0.35,
  size: 4.5,
  colour: new THREE.Color(0.13, 0.12, 0.11)
};

export const LAVA_VERTEX = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

// vUv.x runs across a fissure (0..1, seam at 0.5) and vUv.y along it (0 at
// the epicentre, 1 at the tip); on a vent dome vUv.y is 1 at the crown.
export const LAVA_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uGlow;
  uniform float uLava;
  uniform float uReveal;
  uniform float uOpacity;
  uniform float uVent;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float noise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ),
      f.y
    );
  }

  void main() {
    if ( vUv.y > uReveal ) discard;
    vec2 p = vWorld.xz;
    float grit = noise( p * 2.3 );
    float flow = noise( p * 0.9 + vec2( uTime * 0.35, -uTime * 0.22 ) ) * 0.6
      + noise( p * 2.7 - vec2( uTime * 0.5, uTime * 0.3 ) ) * 0.4;

    float seam;
    float alpha;
    if ( uVent > 0.5 ) {
      // Dark crust plates with glowing cracks between them, hottest at the crown.
      float plates = abs( noise( p * 1.6 + uTime * 0.08 ) - 0.5 ) * 2.0;
      seam = ( 1.0 - smoothstep( 0.05, 0.35, plates ) ) * 0.8 + smoothstep( 0.55, 1.0, vUv.y );
      alpha = 1.0;
    } else {
      // Ragged edges fading into the ground, a hot seam down the middle.
      float edge = abs( vUv.x - 0.5 ) * 2.0 + ( grit - 0.5 ) * 0.35;
      alpha = 1.0 - smoothstep( 0.75, 1.0, edge );
      seam = 1.0 - smoothstep( 0.0, 0.55, edge );
      alpha *= 1.0 - smoothstep( uReveal - 0.03, uReveal, vUv.y );
    }

    vec3 rock = vec3( 0.045, 0.032, 0.024 ) * ( 0.55 + 0.6 * grit );
    float heat = uGlow * uLava * seam * ( 0.55 + 0.75 * flow );
    vec3 lava = mix( vec3( 0.0 ), vec3( 0.6, 0.05, 0.0 ), smoothstep( 0.0, 0.35, heat ) );
    lava = mix( lava, vec3( 2.2, 0.55, 0.05 ), smoothstep( 0.35, 0.75, heat ) );
    lava = mix( lava, vec3( 3.4, 2.0, 0.5 ), smoothstep( 0.75, 1.1, heat ) );

    gl_FragColor = vec4( rock + lava, alpha * uOpacity );
    #include <fog_fragment>
  }
`;

// The lake surface. Two things are happening at once: plates of cooled crust
// drifting apart on a slow convection flow, with molten rock showing in the
// seams between them; and bubbles of gas swelling up through it, brightening
// as they grow and vanishing when they burst. The second is what makes it
// read as boiling rather than as a glowing disc.
export const LAKE_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uGlow;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }

  float noise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
      mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ),
      f.y
    );
  }

  void main() {
    vec2 p = vWorld.xz;
    float r = length( vUv - 0.5 ) * 2.0;

    // Convection: a slow field that the crust rides on.
    float flow = noise( p * 0.15 + vec2( uTime * 0.06, -uTime * 0.045 ) );
    float churn = noise( p * 0.44 - vec2( uTime * 0.13, uTime * 0.10 ) );

    // Plates of crust, drifting. The seams between them are where the melt
    // shows through, so they are the hot part.
    float plates = abs( noise( p * 0.30 + flow * 0.9 + uTime * 0.025 ) - 0.5 ) * 2.0;
    float seam = 1.0 - smoothstep( 0.02, 0.26, plates );

    // Bubbles, on a jittered grid. Each cell runs its own swell-and-burst
    // cycle on a phase taken from its own hash, so they are all out of step.
    vec2 bp = p * 0.30;
    vec2 cell = floor( bp );
    vec2 f = fract( bp );
    float h = hash( cell );
    float h2 = hash( cell + 17.3 );
    float phase = fract( uTime * ( 0.22 + 0.40 * h ) + h2 );
    // Swells over most of the cycle, then is gone: a burst, not a fade.
    float swell = smoothstep( 0.0, 0.72, phase ) * ( 1.0 - smoothstep( 0.80, 0.94, phase ) );
    vec2 centre = vec2( 0.25 + 0.5 * h, 0.25 + 0.5 * h2 );
    float d = length( f - centre );
    float dome = smoothstep( 0.30 * swell, 0.0, d ) * swell;
    // A brighter ring right at the skin of the bubble, where it is thinnest.
    float skin = smoothstep( 0.06, 0.0, abs( d - 0.26 * swell ) ) * swell;

    float heat = uGlow * clamp( seam * 0.85 + dome * 1.25 + skin * 0.9 + churn * 0.22, 0.0, 1.6 );

    vec3 crust = vec3( 0.040, 0.030, 0.024 ) * ( 0.45 + 0.85 * churn );
    vec3 lava = mix( vec3( 0.0 ), vec3( 0.7, 0.06, 0.0 ), smoothstep( 0.0, 0.30, heat ) );
    lava = mix( lava, vec3( 2.6, 0.62, 0.05 ), smoothstep( 0.30, 0.72, heat ) );
    lava = mix( lava, vec3( 4.2, 2.4, 0.6 ), smoothstep( 0.72, 1.15, heat ) );

    // Meets the rim wall rather than ending on a hard circle.
    float edge = 1.0 - smoothstep( 0.88, 1.0, r );
    gl_FragColor = vec4( crust + lava, uOpacity * edge );
    #include <fog_fragment>
  }
`;

/**
 * @typedef {{ value: number }} FloatUniform
 */

/**
 * @typedef {Object} Caldera
 * @property {THREE.Group} root
 * @property {THREE.Mesh} rim
 * @property {THREE.Mesh} lake
 * @property {FloatUniform} glow its own, not the eruption's: it outlives it
 * @property {FloatUniform} opacity
 * @property {number} x
 * @property {number} z
 * @property {number} radius outer rim
 * @property {number} lakeR
 * @property {number} rise 0..1, how far it has opened
 * @property {boolean} quenched put out for good by the flood (see quench)
 * @property {HotSpot} spot its entry in the molten-ground list, reused rather
 *   than rebuilt each frame (see hotSpots)
 */

/**
 * @typedef {Object} HotSpot
 * @property {number} x
 * @property {number} z
 * @property {number} radius how far out the ground is molten
 * @property {number} level 0..1 how molten it is right now
 * @property {Vent|null} vent the vent it stands for, if it is one
 * @property {Caldera|null} caldera the caldera it stands for, if it is one
 */

/**
 * @typedef {Object} Fissure
 * @property {THREE.Vector2[]} points centre line, world x/z, epicentre first
 * @property {number[]} cumulative distance along the line at each point
 * @property {number} total length in world units
 * @property {number} width at the epicentre
 * @property {number} growthProgress 0..1 how far it has torn open
 * @property {number} growSeconds
 * @property {number} delay seconds before it starts to open
 * @property {boolean} opened
 * @property {FloatUniform} reveal eased growthProgress, as the shader sees it
 * @property {FloatUniform} lava 0..1 how far its seam has heated up
 * @property {THREE.Mesh} mesh
 */

/**
 * @typedef {Object} Vent
 * @property {THREE.Mesh} mesh
 * @property {Fissure|null} fissure null for the epicentre vent
 * @property {number} along where on its fissure it sits, 0..1
 * @property {number} x
 * @property {number} z
 * @property {number} radius
 * @property {boolean} active
 * @property {boolean} quenched put out for good by the flood (see quench)
 * @property {number} rise 0..1 how far it has pushed up
 * @property {number} level current glow, for spatter and lights
 * @property {number} seed per-vent random, for its flicker
 * @property {FloatUniform} lava
 */

/**
 * @param {number[]} range
 * @returns {number}
 */
export function between(range) {
  return range[0] + Math.random() * (range[1] - range[0]);
}

/**
 * @param {number[]} range
 * @param {number} t 0..1
 * @returns {number}
 */
export function lerpRange(range, t) {
  return THREE.MathUtils.lerp(range[0], range[1], t);
}

/**
 * Half the fissure's width at a fraction along it: full at the epicentre,
 * a point at the tip.
 * @param {Fissure} fissure
 * @param {number} v 0..1
 * @returns {number}
 */
export function halfWidthAt(fissure, v) {
  return fissure.width * 0.5 * Math.pow(Math.max(0, 1 - v), 0.75);
}

/**
 * A random walk out from the epicentre: each step turns by at most
 * FISSURE.maxTurn and is pulled gently back towards the fissure's heading,
 * so the crack wanders without curling back on itself.
 * @param {number} cx
 * @param {number} cz
 * @param {number} heading radians
 * @param {number} length world units
 * @returns {THREE.Vector2[]}
 */
export function walkFissure(cx, cz, heading, length, maxTurn = FISSURE.maxTurn, straighten = FISSURE.straighten) {
  const steps = Math.max(4, Math.round(length / FISSURE.segment));
  const step = length / steps;
  const points = [new THREE.Vector2(cx, cz)];
  let angle = heading;
  for (let s = 0; s < steps; s++) {
    angle += (Math.random() * 2 - 1) * maxTurn;
    angle += (heading - angle) * straighten;
    const last = points[points.length - 1];
    points.push(new THREE.Vector2(last.x + Math.cos(angle) * step, last.y + Math.sin(angle) * step));
  }
  return points;
}

/**
 * @param {THREE.Vector2[]} points
 * @returns {number[]} distance along the line at each point
 */
export function cumulativeLengths(points) {
  return points.reduce((acc, point, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + point.distanceTo(points[i - 1]));
    return acc;
  }, /** @type {number[]} */ ([]));
}

/**
 * A flat, tapering triangle strip along a fissure's centre line, two
 * vertices per point, with uv.x across and uv.y along.
 * @param {THREE.Vector2[]} points
 * @param {number[]} cumulative
 * @param {number} width
 * @returns {THREE.BufferGeometry}
 */
export function buildStripGeometry(points, cumulative, width) {
  const n = points.length;
  const total = cumulative[n - 1];
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = [];
  const tangent = new THREE.Vector2();
  for (let i = 0; i < n; i++) {
    tangent.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]).normalize();
    const v = cumulative[i] / total;
    const half = width * 0.5 * Math.pow(1 - v, 0.75);
    const nx = -tangent.y * half;
    const nz = tangent.x * half;
    positions.set([points[i].x + nx, FISSURE.y, points[i].y + nz, points[i].x - nx, FISSURE.y, points[i].y - nz], i * 6);
    uvs.set([0, v, 1, v], i * 4);
    if (i < n - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The point a fraction of the way along a fissure.
 * @param {Fissure} fissure
 * @param {number} f 0..1
 * @returns {{x: number, z: number}}
 */
export function pointAlong(fissure, f) {
  const target = f * fissure.total;
  const { points, cumulative } = fissure;
  let i = 0;
  while (i < points.length - 2 && cumulative[i + 1] < target) i++;
  const span = cumulative[i + 1] - cumulative[i];
  const t = span > 0 ? (target - cumulative[i]) / span : 0;
  return {
    x: THREE.MathUtils.lerp(points[i].x, points[i + 1].x, t),
    z: THREE.MathUtils.lerp(points[i].y, points[i + 1].y, t)
  };
}
