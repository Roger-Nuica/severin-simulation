import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AI.1 — The chasm's tunables, shaders and colours
 * ===========================================================================
 * Moved out of engine/chasm.js unchanged (see its header for the design).
 */

export const CHASM = {
  length: 560,                  // end to end, across the whole map
  step: 7,                      // world units between path points
  wander: 0.55,                 // how hard the path's heading drifts per step
  halfWidth: 12,                // at the widest, in the middle
  endHalfWidth: 0.8,            // at the tips
  jag: [0.72, 1.25],            // per-point ragged edge, as a factor of width
  depth: 44,
  // How far each wall leans in by the bottom, as a fraction of the half-width:
  // a V rather than a slot, so from the usual raised camera the walls face
  // you and read as rock rather than as a dark stripe.
  wallLean: 0.72,
  wallRows: 7,
  rimWidth: 3.2,                // the broken lip either side
  rimLift: 1.1,                 // how far the lip is heaved up at the edge
  openSeconds: 2.6,
  maxChasms: 2,
  // Checks against the crowd and traffic, per second.
  checkRate: 12,
  buildingShockReach: 22,       // beyond the edge
  buildingShock: 3.4,
  hazardClearance: 7,           // how far past the edge people keep away
  fallGravity: 34,
  score: 3000,
  fallScore: 15,
  // Lava. It wells up from the bottom once the gap is open, to this fraction
  // of the way up the walls, over lavaRiseSeconds, and heats the rock above
  // it (the lower rows of the walls glow).
  lavaLevel: 0.62,             // of the depth below ground, at full
  lavaRiseSeconds: 4,
  lavaGlowFrom: 0.35,          // wall rows below this fraction of the depth glow
  lightColour: 0xff5a1a,
  lightPeak: 280,
  lightDistance: 75,
  lightHeight: 2.5,
  lightPriority: 2
};

/**
 * The lava: a slow churn of dark crust over glowing melt, the cracks between
 * crust plates hot enough to cross post.js's bloom threshold so the whole
 * gap glows from inside. Scrolled along the chasm so it visibly flows.
 */
export const LAVA_VERTEX = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4( position, 1.0 );
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const LAVA_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uHeat;
  varying vec3 vWorld;
  float hash( vec2 p ) {
    return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
  }
  float noise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
                mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  float fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    for ( int k = 0; k < 4; k++ ) {
      v += a * noise( p );
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }
  void main() {
    vec2 p = vWorld.xz * 0.12;
    vec2 flow = vec2( uTime * 0.05, uTime * 0.035 );
    float warp = fbm( p * 0.7 + flow );
    float n = fbm( p + warp * 1.6 - flow * 1.4 );
    // Crust where n is high; bright melt in the seams between plates.
    float seam = 1.0 - smoothstep( 0.02, 0.16, abs( n - 0.5 ) );
    float pulse = 0.85 + 0.15 * sin( uTime * 2.1 + warp * 9.0 );
    vec3 crust = vec3( 0.16, 0.035, 0.02 );
    vec3 melt = vec3( 3.2, 0.9, 0.12 ) * pulse;
    vec3 glow = vec3( 1.1, 0.22, 0.03 );
    vec3 colour = mix( crust + glow * smoothstep( 0.35, 0.75, 1.0 - n ), melt, seam );
    gl_FragColor = vec4( colour * uHeat, 1.0 );
  }
`;

// Drawn before the ground (renderOrder 0), see the header -- but after the
// sky dome (-10, clouds.js), which paints the background without a depth test
// and would otherwise paint straight over the walls.
export const WALL_ORDER = -5;
export const LID_ORDER = -4;
export const LID_Y = 0.07;

export const SOIL_TOP = new THREE.Color(0.52, 0.39, 0.26);
export const SOIL_MID = new THREE.Color(0.33, 0.24, 0.16);
export const ROCK_DEEP = new THREE.Color(0.035, 0.028, 0.022);
export const RIM_OUTER = new THREE.Color(0.3, 0.31, 0.22);
export const RIM_LIP = new THREE.Color(0.42, 0.32, 0.22);
