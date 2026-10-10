// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION MT.0 — The meteors' tunables and crater texture
 * ===========================================================================
 * Every number the meteors are tuned by, and the crater texture (also
 * used by the spaceship's touchdown).
 */

export const METEOR = {
  // What the panel's button calls down, and it can be pressed again: a
  // volley is a handful of rocks on demand, at random spots. There is no
  // scheduled bombardment any more -- starting the tornado brings none.
  // Five rather than ten: at this blast radius ten craters cover the whole
  // town and stop reading as separate impacts.
  volley: 5,
  // Craters kept on the ground. Volleys are unlimited, so without a ceiling a
  // long session would end up with hundreds of decals; the oldest is dropped
  // when a new one lands.
  craterMax: 26,
  // The gap between two rocks of a volley. Jitter keeps the rhythm ragged
  // so they do not fall like a metronome.
  stagger: 1.5,
  staggerJitter: 0.7,
  // Seconds each spends falling, so the player sees it coming.
  fallTime: 2.6,
  // Where they come down: anywhere in this ring around the town centre, so
  // they hit the built-up part rather than the empty outskirts.
  impactRadius: [10, 86],
  // Entry point: this far up and this far out along the incoming bearing.
  entryHeight: 260,
  entryDistance: 150,
  // The rock, at three times its old [3.2, 4.6].
  radius: [9.6, 13.8],
  colour: 0x2a2320,
  hotColour: 0xff7a26,
  // The blast. Everything here is up with the size of the rock: a 14-unit
  // boulder coming in at terminal velocity should not land like a grenade.
  blastStrength: 8,            // spawnImpactBurst's ceiling; vs 1.7 for a collapse
  satellites: 7,               // offset secondaries, so the fireball reads wide
  blastRadius: 78,             // buildings shocked, objects thrown
  throwForce: 70,
  killRadius: 22,              // people this near the impact are killed outright
  killEnergy: 50000,           // damage.js impact energy: well past a person's
  fireRadius: 52,
  buildingShock: 7,            // several times any building's chain resistance
  score: 2400,
  // The crater. Not tripled with the rock: ten craters at three times the old
  // size would tile the whole map into one continuous burn and stop reading
  // as separate impacts at all, so they are doubled instead.
  craterRadius: [30, 44],
  // Above the roads (0.01), the tornado's path scars (0.015) and the debug
  // grid (0.02), so a crater is the topmost thing on the ground it covers.
  craterY: 0.025,
  // Trail and debris. The per-meteor trail rate is *down* while the pool is
  // up: ten of these can be falling at once where three could, and the old
  // 90/s each would have churned the whole pool in a third of a second,
  // leaving every trail a stub.
  //
  // Raised again for the continuous tail (see spawnTrailFor): puffs are now
  // laid along the whole path covered each frame and live shorter, so the
  // tail is a solid streak that tapers off rather than a string of blobs.
  trailRate: 150,
  trailLife: [0.3, 0.85],
  trailSize: 13,
  ejectaCount: 70,
  ejectaLife: [1.2, 2.6],
  ejectaSpeed: [18, 46],
  ejectaSize: 2.4,
  maxParticles: 2400,
  // The dark smoke column behind a rock, on its own pool because it wants
  // normal blending where the fire trail wants additive. It is most of what
  // gives the fall a sense of scale.
  smokeMax: 520,
  smokeRate: 26,
  smokeLife: [1.8, 4.2],
  smokeSize: 14,
  smokeColour: new THREE.Color(0.11, 0.095, 0.085),
  // Pieces breaking off on the way down, each on its own diverging line.
  fragments: [2, 4],
  fragmentRadius: [0.16, 0.30],   // of the parent
  fragmentSpread: 14,             // world units apart by the time they land
  fragmentStart: 0.25,            // fraction of the fall at which they separate
  // ---------------------------------------------------------------------
  // Airburst: the rock that never lands.
  //
  // It comes apart in the upper air and the shock wave arrives on its own.
  // Nothing is cratered, nothing is thrown up, and the only evidence on the
  // ground afterwards is a forest lying flat with every trunk pointing away
  // from a spot where nothing happened. It is the one thing in this whole
  // simulation that destroys without touching anything.
  //
  // Which rock of a group it is. Index 1, so a volley opens with an ordinary
  // impact for scale and then does this -- an airburst on its own reads as
  // "the meteor missed" until you see what it did.
  airburstIndex: 1,
  burstHeight: 210,
  // An airburst comes in steeply where an impactor comes in on a slant.
  //
  // This is not decoration. A rock that detonates at 210 units of altitude is
  // only a fifth of the way down its path, so on the ordinary entry -- 150
  // units out and 260 up -- it goes off a hundred and twenty units short of
  // where it was aimed, out over the backdrop, and the town never sees the
  // front. Coming in steeply puts the burst where the aim point is.
  burstEntryDistance: 22,
  burstSpeed: 150,              // how fast the front crosses the ground, u/s
  burstRadius: 175,             // far wider than an impact: no energy goes down
  burstFlash: 1,
  burstSatellites: 12,
  // What the front does as it passes. Trees go flat; roofs are stripped and
  // the frames left standing are shaken, hard near the middle and barely at
  // the edge.
  burstTreeRadius: 0.92,        // of burstRadius -- trees go over almost to the edge
  burstBuildingShock: 6.5,
  burstThrow: 34,
  burstScore: 3200,
  bannerSeconds: 3.4,
  lightPeak: 320,
  lightDistance: 130
};

export const TRAIL_HOT = new THREE.Color(3.2, 1.5, 0.35);
export const TRAIL_COOL = new THREE.Color(0.35, 0.12, 0.05);

/**
 * The rock's surface. It used to be a MeshStandardMaterial with an emissive
 * orange over a near-black base, on a regular twelve-sided solid -- which at
 * three times the original size rendered as exactly what it was: a flat
 * orange polygon with enormous facets.
 *
 * What it should read as is a burnt lump of stone with the heat coming
 * *through* it, so the surface is dark basalt and the light comes out of a
 * network of cracks, hottest on the face that is into the airflow. The crack
 * network is generated from object-space position rather than world space, so
 * it stays painted on the rock as it tumbles instead of swimming across it.
 */
export const ROCK_VERTEX = /* glsl */`
  varying vec3 vPos;
  varying vec3 vNrm;
  #include <fog_pars_vertex>
  void main() {
    vPos = position;
    vNrm = normal;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export const ROCK_FRAGMENT = /* glsl */`
  uniform vec3 uLead;      // direction of travel, in object space
  uniform float uHeat;     // 0..1, how far into the fall it is
  uniform float uScale;    // the rock's radius, to keep crack density even
  varying vec3 vPos;
  varying vec3 vNrm;
  #include <fog_pars_fragment>

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
    vec3 n = normalize( vNrm );
    vec3 p = vPos / uScale;

    // Two octaves, ridged: the ridges are the seams between plates of crust,
    // which is where the molten interior shows through.
    float a = noise( p * 2.4 );
    float b = noise( p * 6.1 + 11.3 );
    float ridge = 1.0 - abs( ( a * 0.7 + b * 0.3 ) * 2.0 - 1.0 );
    float crack = smoothstep( 0.74, 0.97, ridge );

    // Into the airflow: the leading face is ablating, the trailing side is
    // comparatively cold. This is what stops it reading as a uniform ball.
    float facing = clamp( dot( n, uLead ), 0.0, 1.0 );
    float heat = uHeat * crack * ( 0.18 + 0.82 * facing * facing );
    float sear = uHeat * smoothstep( 0.55, 1.0, facing );

    // The stone itself, lit by one fixed key so the facets read against each
    // other -- the rock is its own main light source, so this only has to
    // separate the planes, not light the scene.
    float key = 0.35 + 0.65 * clamp( dot( n, normalize( vec3( 0.4, 0.8, 0.45 ) ) ), 0.0, 1.0 );
    vec3 rock = vec3( 0.055, 0.046, 0.040 ) * key * ( 0.55 + 0.7 * a );

    vec3 glow = mix( vec3( 1.4, 0.16, 0.02 ), vec3( 4.2, 1.9, 0.45 ), heat );
    rock += glow * heat;
    // The windward face glows even between the cracks.
    rock += vec3( 1.7, 0.55, 0.12 ) * sear * 0.45;

    gl_FragColor = vec4( rock, 1.0 );
    #include <fog_fragment>
  }
`;

/**
 * An irregular lump of stone, rather than a Platonic solid. Every rock gets
 * its own displacement, so no two in a barrage of ten are the same shape.
 * @param {number} radius
 * @returns {THREE.BufferGeometry}
 */
export function createRockGeometry(radius) {
  // Non-indexed, so computeVertexNormals leaves hard facets -- which is what
  // an asteroid wants.
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  // Three fixed random bearings per rock, so its lumps are its own.
  const seed = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const lump =
      0.20 * Math.sin(v.x * 3.1 + seed[0]) * Math.cos(v.y * 2.7 + seed[1])
      + 0.12 * Math.sin(v.y * 6.3 + seed[1]) * Math.cos(v.z * 5.1 + seed[2])
      + 0.07 * Math.cos(v.z * 11.2 + seed[2] + v.x * 9.4);
    v.multiplyScalar(radius * (1 + lump));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * @typedef {Object} Meteor
 * @property {THREE.Group} mesh the rock, its glowing envelope and its
 *   fragments, aimed down the fall line
 * @property {THREE.Mesh} body the rock itself, which tumbles inside the group
 * @property {THREE.Group} shock the incandescent glow round it (two sprites)
 * @property {THREE.Vector3} [last] where it was last frame, for the trail
 * @property {Array<{mesh: THREE.Mesh, radius: number, driftX: number,
 *   driftZ: number, spin: THREE.Vector3}>} fragments pieces that break off
 * @property {THREE.Vector3} from
 * @property {THREE.Vector3} to
 * @property {number} delay seconds until it starts falling
 * @property {number} t 0..1 along its fall
 * @property {number} radius
 * @property {boolean} airburst whether it comes apart in the air
 * @property {number} burstAt the fall fraction it detonates at, or 2 for one
 *   that reaches the ground
 * @property {THREE.Material[]} materials its own, freed when it has landed
 * @property {'waiting'|'falling'|'done'} state
 * @property {boolean} [shown] co-op guest: the host's rock, drawn only (net/meteorFx.js)
 * @property {boolean} [sound] a shown rock's landing may sound
 * @property {() => number} [rand] a shown rock's seeded generator (ejecta, crater turn)
 */

/**
 * Scorched crater decal: a radial burn, black at the centre through charred
 * brown to nothing at the rim, with a ragged edge so it is not a clean disc.
 * Exported for the spaceship's landing scar (engine/spaceship.js), which is
 * the same burn under a different cause.
 * @returns {THREE.CanvasTexture}
 */
export function createCraterTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const c = size / 2;

  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(10, 8, 7, 0.97)');
  g.addColorStop(0.32, 'rgba(22, 16, 12, 0.9)');
  g.addColorStop(0.62, 'rgba(46, 31, 18, 0.62)');
  g.addColorStop(0.85, 'rgba(70, 50, 30, 0.26)');
  g.addColorStop(1, 'rgba(80, 60, 36, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Radial cracks out of the centre, like the fissure seams.
  ctx.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const len = c * (0.35 + Math.random() * 0.55);
    ctx.strokeStyle = `rgba(6, 4, 3, ${(0.3 + Math.random() * 0.4).toFixed(2)})`;
    ctx.lineWidth = 0.8 + Math.random() * 2.4;
    ctx.beginPath();
    ctx.moveTo(c, c);
    let x = c;
    let y = c;
    let angle = a;
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      angle += (Math.random() - 0.5) * 0.5;
      x += Math.cos(angle) * (len / steps);
      y += Math.sin(angle) * (len / steps);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Ragged rim: bite irregular notches out of the outer edge so the crater
  // never reads as a stamped circle.
  const image = ctx.getImageData(0, 0, size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (px - c) / c;
      const dy = (py - c) / c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const wobble = 0.86 + 0.09 * Math.sin(a * 7) + 0.05 * Math.sin(a * 13 + 1.7);
      const i = (py * size + px) * 4;
      if (r > wobble) image.data[i + 3] = 0;
      else if (r > wobble - 0.12) {
        image.data[i + 3] = Math.round(image.data[i + 3] * (wobble - r) / 0.12);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}
export const UP = new THREE.Vector3(0, 1, 0);
