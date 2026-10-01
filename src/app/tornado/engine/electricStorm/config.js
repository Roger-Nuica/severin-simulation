import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION ES.0 — The Electric Tornado's tunables
 * ===========================================================================
 * Every number the Electric Tornado is tuned by: the bolts and their
 * branches, the orbs, motes and shells round the funnel, the EMP waves, the
 * electrocutions. The behaviour is described in electricStorm.js.
 */

export const ELECTRIC = {
  // The shared arc buffer. Every arc in the system draws from this.
  maxSegments: 5400,
  // --- Detail ------------------------------------------------------------
  // A bolt is not a line. Three things turn one into something worth looking
  // at, and all three are nearly free because they ride on geometry that is
  // being rebuilt every frame anyway.
  //
  // `writhe`: an arc holds its *base* path for its whole life and is
  // re-displaced around it every frame, each point on its own fixed random
  // bearing with an oscillating magnitude. A static jagged line drawn for a
  // fifth of a second reads as a crack in the air; the same line squirming
  // reads as current.
  writheAmp: 0.85,
  writheRate: 30,
  // `forks`: branches leaving the main channel partway along and dying
  // sooner. This is most of what makes real lightning look like lightning.
  forkChance: 0.85,
  forkCount: [1, 3],
  forkStart: [0.25, 0.8],     // where along the parent it leaves
  forkLength: [0.2, 0.55],    // as a fraction of the parent's remaining run
  forkSpread: 26,             // degrees off the parent's bearing
  forkPoints: 7,
  forkJitter: 2.4,
  forkGain: 0.55,
  // `glow`: a halo of soft additive sprites sampled along every live arc.
  // Browsers clamp line width to 1px, so the channels alone are hairlines
  // however bright they are -- this is what gives them thickness.
  glowMax: 2600,
  glowStride: 2,              // one sprite every N points of an arc
  // Wider and fainter than when the channels were hairlines: the ribbon now
  // carries the body of the bolt, and the halo is only the air around it.
  glowSize: 3.4,
  glowGain: 0.2,
  // Sparks shed where an arc lands.
  sparkMax: 420,
  sparkPerStrike: [6, 14],
  sparkLife: [0.35, 1.1],
  sparkSpeed: [6, 20],
  sparkGravity: 26,
  sparkSize: 1.5,
  // Channel widths, world units. Arcs are drawn as camera-facing ribbons with
  // a white-hot core and a soft blue falloff (see ARC_FRAGMENT), not as
  // lines: WebGL clamps line width to one pixel, and a funnel wrapped in
  // dozens of hairlines read as a wire cage rather than as current.
  heroWidth: 0.6,             // ground strikes, chains, crown arcs, orb discharges
  sheathWidth: 0.26,
  filamentWidth: 0.2,
  crackleWidth: 0.14,
  forkWidth: 0.55,            // of the parent channel's
  // The sheath crawling up the funnel. Fewer than there were -- five
  // overlapping helices every tenth of a second were the cage.
  sheathCount: 3,             // alive at once, per funnel
  sheathInterval: [0.05, 0.13],
  sheathLife: [0.16, 0.32],
  sheathTurns: [1.4, 3.4],
  sheathPoints: 30,
  sheathJitter: 1.5,
  // Ground strikes out of the funnel.
  strikeInterval: [0.1, 0.26],
  strikeRange: 110,           // how far from the funnel it will reach
  strikeLife: [0.1, 0.2],
  strikePoints: 16,
  strikeJitter: 3.4,
  strikeShock: 1.9,           // building shock, vs 1.7 for a collapse next door
  strikeIgnite: 12,           // radius of the fire it starts
  strikeScore: 40,
  // Chain lightning between buildings.
  chainChance: 0.75,
  chainReach: 36,
  chainDepth: 3,              // how many buildings a strike can walk through
  chainShock: 1.35,
  // Crown arcs jumping off the top of the column into the cloud base.
  crownInterval: [0.06, 0.16],
  crownLife: [0.1, 0.22],
  crownReach: 34,
  // --- The interior -----------------------------------------------------
  // What used to be here was a single smooth lathe cone with bands painted on
  // it, drawn additively through the funnel's own translucent white shell.
  // The bands averaged out and it read as a flat pale blue cone -- one
  // surface, uniform, which is the opposite of what current looks like.
  //
  // It is now made of pieces. Filaments running up the inside wall, a dense
  // column of charged motes spiralling up through it, and a handful of
  // partial plasma shells that each discard most of their own area on a noise
  // field and flicker out of step with each other. Nothing in here is a
  // continuous surface, and no two frames are the same.
  filamentCount: 5,           // arcs alive inside the funnel, per funnel
  filamentInterval: [0.1, 0.18],
  filamentLife: [0.22, 0.45],
  filamentTurns: [0.3, 1.1],  // far straighter than the outer sheath
  filamentPoints: 22,
  filamentInset: [0.42, 0.88], // fraction of the funnel radius they run at
  filamentJitter: 1.1,
  // Short sparks jumping between two nearby points on the funnel wall.
  crackleRate: 34,            // per second, per funnel
  crackleLife: [0.05, 0.13],
  crackleSpan: [2.5, 9],
  cracklePoints: 6,
  // The charged column.
  moteMax: 1500,
  moteRate: 260,              // per second while the mode is on
  moteLife: [0.5, 1.4],
  moteRise: [14, 42],
  moteSize: [0.35, 1.3],
  moteSpin: [1.4, 4.2],       // radians/sec around the axis
  // The plasma shells: veins of current running through the column (see
  // SHELL_FRAGMENT).
  shellCount: 3,
  shellRadius: [0.5, 0.98],   // fraction of the funnel radius
  shellSpin: [-0.5, 0.65],    // radians/sec, some each way
  // Ball lightning.
  orbCount: 7,
  orbSize: 2.6,
  orbRise: [0.35, 1.1],       // world units/sec climbed
  orbSpin: [0.5, 1.4],        // radians/sec around the column
  orbDischarge: [1.4, 4.2],   // seconds between one letting go
  // The EMP ring. Reach raised by half (240 -> 360) on request, and the
  // speed with it so a pulse still crosses the town in about a second and a
  // half.
  empInterval: 9,
  empSpeed: 240,
  empRadius: 360,
  empShock: 1.25,
  empScore: 900,
  // Electrocution: the chance a person on the ground the ring passes over is
  // killed, from electrocuteChance right under the funnel down to nothing at
  // electrocuteReach. Capped per pulse, or one pulse would empty the town.
  electrocuteChance: 0.55,
  electrocuteReach: 170,
  electrocuteMax: 8,
  electrocuteScore: 60,
  joltSeconds: 1.1,           // convulsing, lit up
  charSeconds: 1.4,           // then charred and falling, then gone
  joltColour: new THREE.Color(1.6, 3.2, 5.5),
  // Colours. Well past 1 so the bloom in post.js catches the channels; the
  // core of a fresh arc is the brightest thing in the scene by some way.
  hotColour: new THREE.Color(5.5, 6.2, 7),
  arcColour: new THREE.Color(0.55, 1.5, 3.4),
  coreColour: 0x8fd6ff,
  ringColour: 0x9fe4ff,
  lightColour: 0x7fc8ff,
  lightPeak: 220,
  lightDistance: 200,
  flashTint: '#cfeaff',
  bannerSeconds: 3.2
};

/**
 * The arcs, as ribbons. Every arc is a strip of quads turned to face the
 * camera (built in writeArcs), and `aEdge` runs -1..1 across its width: the
 * fragment shader turns that into a white-hot core down the middle fading
 * through the arc's own colour to nothing at the edges, so a channel has a
 * body and a glow rather than being a hard-edged line.
 */
export const ARC_VERTEX = /* glsl */`
  attribute vec3 aColour;
  attribute float aEdge;
  varying vec3 vColour;
  varying float vEdge;
  void main() {
    vColour = aColour;
    vEdge = aEdge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

export const ARC_FRAGMENT = /* glsl */`
  varying vec3 vColour;
  varying float vEdge;
  void main() {
    // Clamped: interpolation can carry |vEdge| a hair past 1, and pow() of a
    // negative base is NaN -- which the bloom's mip pyramid then smeared into
    // a screen-sized black block.
    float x = min( abs( vEdge ), 1.0 );
    float halo = pow( 1.0 - x, 2.2 );
    float core = smoothstep( 0.34, 0.0, x );
    float heat = min( 1.0, dot( vColour, vec3( 0.333 ) ) );
    vec3 colour = vColour * halo * 0.55 + vec3( 1.2, 1.3, 1.4 ) * core * heat * 1.5;
    gl_FragColor = vec4( colour, halo );
  }
`;

/**
 * The column's interior: veins of current running up through it -- thin
 * lines along one contour of a domain-warped noise field, broken up along
 * their length, which is what current crawling through a medium looks like.
 * Scrolled upward so the veins writhe and climb, plus a faint fresnel so the
 * column has an edge.
 *
 * The noise is sampled in 3D on the cylinder's own surface (angle as a unit
 * circle, height), so it wraps round without a seam -- the old shells tiled a
 * 2D grid in UV space, which is where their rectangular patches came from.
 */
export const SHELL_VERTEX = /* glsl */`
  varying vec3 vCyl;
  varying float vHeight;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    vec2 around = normalize( position.xz + vec2( 1e-5 ) );
    vCyl = vec3( around.x * 1.7, position.y * 5.0, around.y * 1.7 );
    vHeight = position.y + 0.5;
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    vNormalView = normalize( normalMatrix * normal );
    vViewDir = normalize( -mv.xyz );
    gl_Position = projectionMatrix * mv;
  }
`;

export const SHELL_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uCharge;
  uniform float uSeed;
  uniform vec3 uColour;
  varying vec3 vCyl;
  varying float vHeight;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  float hash( vec3 p ) {
    return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
  }
  float noise( vec3 p ) {
    vec3 i = floor( p );
    vec3 f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( mix( hash( i ), hash( i + vec3( 1, 0, 0 ) ), f.x ),
           mix( hash( i + vec3( 0, 1, 0 ) ), hash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
      mix( mix( hash( i + vec3( 0, 0, 1 ) ), hash( i + vec3( 1, 0, 1 ) ), f.x ),
           mix( hash( i + vec3( 0, 1, 1 ) ), hash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
      f.z );
  }
  void main() {
    vec3 p = vCyl + vec3( uSeed, -uTime * 1.1 + uSeed, uSeed * 0.7 );
    vec3 warp = vec3(
      noise( p * 0.8 + vec3( 0.0, uTime * 0.35, 0.0 ) ),
      noise( p * 0.8 + vec3( 5.2, -uTime * 0.3, 1.3 ) ),
      noise( p * 0.8 + vec3( 2.1, uTime * 0.25, 7.7 ) )
    ) * 1.4;
    // The veins are the 0.5 contour of the warped noise, drawn a pixel or
    // two wide whatever the distance (fwidth). Thresholding the ridge value
    // instead lit up broad areas: smooth value noise sits near 0.5 much of
    // the time, so "near the ridge" was most of the shell.
    float n1 = noise( p + warp );
    float n2 = noise( p * 2.1 + warp * 0.6 + 3.3 );
    float veins = 1.0 - smoothstep( 0.0, fwidth( n1 ) * 1.6 + 0.002, abs( n1 - 0.5 ) );
    veins += ( 1.0 - smoothstep( 0.0, fwidth( n2 ) * 1.2 + 0.002, abs( n2 - 0.5 ) ) ) * 0.6;
    // Broken up along their length, so they read as crawling current
    // rather than as closed contour loops.
    veins *= smoothstep( 0.35, 0.7, noise( p * 1.7 + vec3( 0.0, uTime * 2.3, 0.0 ) ) );
    // The whole web flickers, each shell out of step with the others.
    float flicker = 0.7 + 0.3 * sin( uTime * 41.0 + uSeed * 13.0 ) * sin( uTime * 17.0 + uSeed );
    float fresnel = pow( clamp( 1.0 - abs( dot( vNormalView, vViewDir ) ), 0.0, 1.0 ), 3.0 );
    float ends = smoothstep( 0.0, 0.1, vHeight ) * ( 1.0 - smoothstep( 0.82, 1.0, vHeight ) );
    float a = ( veins * 0.9 + fresnel * 0.06 ) * ends * uCharge * flicker;
    if ( a < 0.004 ) discard;
    vec3 colour = mix( uColour, vec3( 1.0 ), clamp( veins * 0.6, 0.0, 1.0 ) ) * ( 1.0 + veins * 1.8 );
    gl_FragColor = vec4( colour, a );
  }
`;
