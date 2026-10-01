import * as THREE from 'three';
import { createCloudPuffAtlas } from '../utils/textures.js';

/**
 * ===========================================================================
 * SECTION M — Storm sky: gradient dome + layered volumetric-looking clouds
 * ===========================================================================
 * Purely visual: reads Sim.params.intensity and the lightning flash, never
 * writes to physics, debris or damage state.
 *
 * SKY DOME. A large inward-facing sphere that follows the camera, shaded
 * from the fog colour at the horizon (so it meets the fogged ground with no
 * seam) up through a sickly green-teal band -- the classic tornado-sky cast
 * -- to a heavy, near-black zenith, with slow low-frequency mottling so it
 * never reads as one flat fill. Its horizon colour is copied from
 * scene.fog.color every frame, so the existing intensity-driven darkening
 * in updateAtmosphere() carries straight through to the sky.
 *
 * CLOUDS. Each cloud is a cluster of overlapping soft puffs; each puff is a
 * camera-facing quad drawn from a 2x2 atlas of irregular puff shapes (see
 * createCloudPuffAtlas). Three layers at different altitudes and distances
 * rotate about the town at different rates, which is what gives the sky
 * parallax depth. Every layer is one InstancedMesh with a small billboard
 * shader, so the whole cloudscape is three draw calls however many puffs
 * it has; as individual THREE.Sprites it would be one draw call per puff.
 *
 * Shading is done in the shader rather than by scene lights (clouds are
 * far outside every light's useful range): puffs are lighter on top and
 * darker underneath, both across each puff (baked into the atlas's red
 * channel) and across each cluster (lower puffs get a darker per-instance
 * shade). A nearby lightning flash adds warm amber, strongest on the thin
 * puff edges -- rim light -- and pushed past 1.0 so post.js's bloom picks
 * it up for the instant it lasts.
 *
 * Intensity thickens (bigger, more opaque puffs, plus extra puffs that only
 * fade in above a per-puff threshold), darkens, and speeds up the layers.
 */

/**
 * @typedef {Object} CloudLayerDef
 * @property {string} name
 * @property {number} clusters
 * @property {number[]} puffsPerCluster [min, max]
 * @property {number[]} ringRadius [min, max] distance of cluster centres from the town centre
 * @property {number[]} altitude [min, max]
 * @property {number[]} puffSize [min, max] world units
 * @property {number[]} clusterSpread [horizontal, vertical] puff scatter within a cluster
 * @property {number} spin radians/second of drift at intensity 0
 * @property {number} spinIntensity extra radians/second at intensity 1
 * @property {number} opacity base opacity
 * @property {number} tone 0 = calm grey, 1 = heavy storm grey (per-layer darkness bias)
 * @property {number} renderOrder draw order, far layers first
 * @property {boolean} [stormOnly] only shown once the storm is on (stormRamp)
 * @property {boolean} [topFade] thins out when the camera is above it
 */

/** @type {CloudLayerDef[]} */
const CLOUD_LAYERS = [
  // Far, high, slow: the broad overcast deck, lighter and hazier.
  {
    name: 'cloudLayer_high', clusters: 12, puffsPerCluster: [7, 10],
    ringRadius: [170, 430], altitude: [135, 175], puffSize: [70, 110],
    clusterSpread: [70, 12], spin: 0.004, spinIntensity: 0.012,
    opacity: 0.7, tone: 0.55, renderOrder: -3
  },
  // Distant storm bank low on the horizon: the dark wall behind the town.
  {
    name: 'cloudLayer_bank', clusters: 11, puffsPerCluster: [6, 8],
    ringRadius: [360, 480], altitude: [45, 95], puffSize: [110, 160],
    clusterSpread: [95, 22], spin: 0.002, spinIntensity: 0.008,
    opacity: 0.85, tone: 0.9, renderOrder: -2
  },
  // Near, low, fast scud: the ragged heavy clouds right over the town.
  {
    name: 'cloudLayer_low', clusters: 15, puffsPerCluster: [9, 14],
    ringRadius: [60, 280], altitude: [62, 88], puffSize: [26, 48],
    clusterSpread: [38, 9], spin: 0.012, spinIntensity: 0.05,
    opacity: 0.85, tone: 0.8, renderOrder: -1
  },
  // The storm cell itself: the heavy deck directly over the town that the
  // tornado hangs from and the lightning comes out of. The other layers are
  // all rings around the town, so without this the sky straight overhead was
  // empty and every bolt started in clear air. `stormOnly`: it builds in
  // with the storm (Sim.state.stormRamp) rather than hanging over the calm
  // town before Start. `topFade`: seen from above -- the camera pulled high
  // over the town -- it thins out rather than hiding the whole map.
  {
    name: 'cloudLayer_cell', clusters: 10, puffsPerCluster: [8, 12],
    ringRadius: [0, 150], altitude: [98, 116], puffSize: [38, 62],
    clusterSpread: [60, 10], spin: 0.008, spinIntensity: 0.035,
    opacity: 0.8, tone: 0.9, renderOrder: -1.5, stormOnly: true, topFade: true
  }
];

// Bolts leave the cloud this far up from the underside of the puff they
// come out of, so the channel visibly starts inside it.
const BOLT_ORIGIN_INSET = 0.12;

// Share of puffs that only appear as intensity rises, and the highest
// intensity at which such a puff starts fading in.
const THICKEN_PUFF_FRACTION = 0.4;
const THICKEN_THRESHOLD_MAX = 0.8;

// Cloud colours (linear, before post.js's exposure and grade).
const CLOUD_TOP_CALM = new THREE.Color(0x8e98a6);
const CLOUD_TOP_STORM = new THREE.Color(0x4a525e);
const CLOUD_BELLY_CALM = new THREE.Color(0x3a414c);
const CLOUD_BELLY_STORM = new THREE.Color(0x14181e);
const CLOUD_FLASH_COLOUR = new THREE.Color(0xffb35c);
// How far (world units, horizontally) a strike lights clouds around it.
const CLOUD_FLASH_RADIUS = 170;
// Normalises Lightning.flashLight.intensity (peaks at 220-1120) to ~0-1.
const CLOUD_FLASH_NORMALISE = 700;
// Height used for the flash's position when lighting clouds: the bolt
// leaves the cloud base around here (see spawnBolt's start height).
const CLOUD_FLASH_ALTITUDE = 105;

// Sky dome.
const SKY_RADIUS = 900;
const SKY_ZENITH_CALM = new THREE.Color(0x1b2331);
const SKY_ZENITH_STORM = new THREE.Color(0x07090d);
const SKY_BAND_CALM = new THREE.Color(0x283444);
const SKY_BAND_STORM = new THREE.Color(0x1b2527);
const SKY_FLASH_COLOUR = new THREE.Color(0x6b5a3e);
// Day Mode (engine/dayNight.js): clear blue sky, greying a little with
// intensity, and a few light fair-weather clouds instead of the storm deck.
const SKY_ZENITH_DAY = new THREE.Color(0x4a8bd4);
const SKY_ZENITH_DAY_STORM = new THREE.Color(0x6d87a3);
const SKY_BAND_DAY = new THREE.Color(0x9cc4ea);
const SKY_BAND_DAY_STORM = new THREE.Color(0x9fb2c4);
const CLOUD_TOP_DAY = new THREE.Color(0xf5f7fa);
const CLOUD_BELLY_DAY = new THREE.Color(0xb4bcc7);
const CLOUD_BELLY_DAY_STORM = new THREE.Color(0x8a939f);
// Fraction of each layer's night opacity kept by day: "much sparser".
const CLOUD_DAY_OPACITY = 0.4;

const BILLBOARD_VERTEX = /* glsl */`
  attribute float aSize;
  attribute float aShade;
  attribute float aVariant;
  attribute float aThreshold;
  attribute float aRotation;
  uniform float uSizeScale;
  uniform float uIntensity;
  varying vec2 vUv;
  varying float vShade;
  varying float vFade;
  varying vec3 vWorldCentre;
  varying float vViewDepth;

  void main() {
    // Instance centre in world space; the layer's own rotation (drift) is
    // in modelMatrix.
    vec4 world = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
    vWorldCentre = world.xyz;
    vec4 view = viewMatrix * world;

    // Spherical billboard, with a fixed per-puff roll so neighbouring puffs
    // from the same atlas cell never line up identically.
    float c = cos( aRotation );
    float s = sin( aRotation );
    vec2 corner = mat2( c, s, -s, c ) * position.xy;
    view.xy += corner * aSize * uSizeScale;
    gl_Position = projectionMatrix * view;

    // Atlas cell (2x2). Rotation is applied to the quad, not the UVs, so
    // the baked light-top/dark-bottom shading in the texture would roll
    // with it; aRotation is kept small for that reason.
    vec2 cell = vec2( mod( aVariant, 2.0 ), floor( aVariant / 2.0 ) );
    vUv = ( uv + cell ) * 0.5;

    vShade = aShade;
    vFade = smoothstep( aThreshold, aThreshold + 0.15, uIntensity );
    vViewDepth = -view.z;
  }
`;

const BILLBOARD_FRAGMENT = /* glsl */`
  uniform sampler2D uAtlas;
  uniform vec3 uTopColour;
  uniform vec3 uBellyColour;
  uniform vec3 uHazeColour;
  uniform float uOpacity;
  uniform vec3 uFlashPos;
  uniform float uFlash;
  uniform vec3 uFlashColour;
  uniform float uFlashRadius;
  uniform float uTopFade;
  varying vec2 vUv;
  varying float vShade;
  varying float vFade;
  varying vec3 vWorldCentre;
  varying float vViewDepth;

  void main() {
    vec4 tex = texture2D( uAtlas, vUv );
    // r = baked vertical light (1 top .. 0 underside), a = puff coverage.
    float alpha = tex.a * uOpacity * vFade;
    // A deck the camera can get above or into (the storm cell overhead)
    // thins out from above and right up close, rather than turning into a
    // wall of grey over the town the moment the view is pulled up high.
    float above = smoothstep( -12.0, 30.0, cameraPosition.y - vWorldCentre.y );
    float close = 1.0 - smoothstep( 10.0, 55.0, vViewDepth );
    alpha *= 1.0 - uTopFade * max( above * 0.85, close );
    if ( alpha < 0.004 ) discard;

    float light = tex.r * vShade;
    vec3 colour = mix( uBellyColour, uTopColour, light );

    // Lightning: a soft glow through the whole puff plus a stronger rim on
    // its thin edges, fading with horizontal distance from the strike.
    float d = length( vWorldCentre.xz - uFlashPos.xz );
    float near = 1.0 - smoothstep( 0.0, uFlashRadius, d );
    // The rim band is kept wide and gentle: a narrow, strong one stacks up
    // across overlapping puffs into visible contour rings.
    float rim = smoothstep( 0.02, 0.45, tex.a ) * ( 1.0 - smoothstep( 0.4, 0.95, tex.a ) );
    colour += uFlashColour * uFlash * near * near * ( 0.55 + 0.8 * rim );

    // Distant puffs sink into the sky's horizon haze instead of the scene
    // fog, which at this range would erase them entirely.
    float haze = smoothstep( 250.0, 700.0, vViewDepth ) * 0.55;
    colour = mix( colour, uHazeColour, haze );

    gl_FragColor = vec4( colour, alpha );
  }
`;

const SKY_VERTEX = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize( position );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const SKY_FRAGMENT = /* glsl */`
  uniform vec3 uHorizon;
  uniform vec3 uBand;
  uniform vec3 uZenith;
  uniform float uTime;
  uniform vec3 uFlashDir;
  uniform float uFlash;
  uniform vec3 uFlashColour;
  varying vec3 vDir;

  // Cheap value noise, enough for large soft mottling.
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float noise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
                mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
  }

  void main() {
    vec3 dir = normalize( vDir );
    float h = max( dir.y, 0.0 );
    // Horizon -> sickly band just above it -> heavy zenith.
    vec3 colour = mix( uHorizon, uBand, smoothstep( 0.0, 0.12, h ) );
    colour = mix( colour, uZenith, smoothstep( 0.1, 0.6, h ) );

    // Slow mottling, fading out towards the horizon so it never fights the
    // fog line.
    vec2 p = dir.xz / ( 0.35 + h ) * 2.2 + vec2( uTime * 0.01, uTime * 0.006 );
    float n = noise( p ) * 0.6 + noise( p * 2.7 ) * 0.4;
    colour *= mix( 1.0, 0.72 + 0.56 * n, smoothstep( 0.03, 0.25, h ) );

    // A strike briefly lights the sky around its direction.
    float toward = max( dot( dir, uFlashDir ), 0.0 );
    colour += uFlashColour * uFlash * pow( toward, 6.0 );

    // Below the horizon (only ever visible past the ground plane's edge):
    // the horizon colour, so it merges with the fog.
    if ( dir.y < 0.0 ) colour = uHorizon;
    gl_FragColor = vec4( colour, 1.0 );
  }
`;

/**
 * @param {Object} ctx
 * @returns {{
 *   Clouds: Object,
 *   initClouds: () => void,
 *   updateClouds: (dt: number) => void,
 *   disposeClouds: () => void,
 *   pickBoltOrigin: (x: number, z: number, out: THREE.Vector3) => THREE.Vector3|null,
 *   randomCloudPoint: (out: THREE.Vector3) => THREE.Vector3|null
 * }}
 */
export function createCloudsSystem(ctx) {
  const { Sim } = ctx;

  const Clouds = {
    group: /** @type {THREE.Group|null} */ (null),
    layers: /** @type {{mesh:THREE.InstancedMesh, def:CloudLayerDef, material:THREE.ShaderMaterial}[]} */ ([]),
    sky: /** @type {THREE.Mesh|null} */ (null),
    atlas: /** @type {THREE.Texture|null} */ (null),
    time: 0
  };

  const scratch = new THREE.Color();

  /**
   * @param {number[]} range [min, max]
   * @returns {number}
   */
  function inRange(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Builds one cloud layer: `clusters` cloud formations around a ring, each
   * a flattened heap of overlapping puffs, as a single InstancedMesh.
   * @param {CloudLayerDef} def
   * @returns {{mesh:THREE.InstancedMesh, def:CloudLayerDef, material:THREE.ShaderMaterial}}
   */
  function buildLayer(def) {
    /** @type {{x:number, y:number, z:number, size:number, shade:number, variant:number, threshold:number, rotation:number}[]} */
    const puffs = [];
    for (let c = 0; c < def.clusters; c++) {
      const angle = (c / def.clusters) * Math.PI * 2 + Math.random() * 0.4;
      const radius = inRange(def.ringRadius);
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      const cy = inRange(def.altitude);
      const count = Math.round(inRange(def.puffsPerCluster));
      for (let p = 0; p < count; p++) {
        // A heap, not a ball: wide horizontally, puffs piled higher towards
        // the middle, flat-ish underneath like a real cloud base.
        const u = (Math.random() * 2 - 1);
        const w = (Math.random() * 2 - 1);
        const centrality = 1 - Math.min(1, Math.hypot(u, w));
        const dy = Math.random() * def.clusterSpread[1] * (0.3 + centrality);
        const size = inRange(def.puffSize) * (0.75 + centrality * 0.5);
        puffs.push({
          x: cx + u * def.clusterSpread[0] * 0.5,
          y: cy + dy,
          z: cz + w * def.clusterSpread[0] * 0.35,
          size,
          // Lower puffs sit in the cluster's shadow.
          shade: 0.55 + 0.45 * (dy / (def.clusterSpread[1] * 1.3)),
          variant: Math.floor(Math.random() * 4),
          threshold: Math.random() < THICKEN_PUFF_FRACTION ? Math.random() * THICKEN_THRESHOLD_MAX : -1,
          rotation: (Math.random() - 0.5) * 0.5
        });
      }
    }

    const geometry = new THREE.PlaneGeometry(1, 1);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: Clouds.atlas },
        uTopColour: { value: new THREE.Color() },
        uBellyColour: { value: new THREE.Color() },
        uHazeColour: { value: new THREE.Color() },
        uOpacity: { value: def.opacity },
        uSizeScale: { value: 1 },
        uIntensity: { value: 0 },
        uFlashPos: { value: new THREE.Vector3() },
        uFlash: { value: 0 },
        uFlashColour: { value: CLOUD_FLASH_COLOUR.clone() },
        uFlashRadius: { value: CLOUD_FLASH_RADIUS },
        uTopFade: { value: def.topFade ? 1 : 0 }
      },
      vertexShader: BILLBOARD_VERTEX,
      fragmentShader: BILLBOARD_FRAGMENT,
      transparent: true,
      depthWrite: false
    });

    const mesh = new THREE.InstancedMesh(geometry, material, puffs.length);
    mesh.name = def.name;
    mesh.renderOrder = def.renderOrder;
    // Billboards are expanded in the shader, so the geometry's own bounds
    // say nothing about where the puffs are drawn.
    mesh.frustumCulled = false;

    // Back-to-front from the town centre, so within the layer the far side
    // of each ring blends under the near side for the default views.
    const sorted = [...puffs].sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z));
    const dummy = new THREE.Object3D();
    sorted.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    /** @type {[string, 'size'|'shade'|'variant'|'threshold'|'rotation'][]} */
    const attributes = [['aSize', 'size'], ['aShade', 'shade'], ['aVariant', 'variant'], ['aThreshold', 'threshold'], ['aRotation', 'rotation']];
    for (const [name, key] of attributes) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(sorted.map(p => p[key])), 1));
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, def, material, puffs };
  }

  /**
   * @returns {THREE.Mesh}
   */
  function buildSky() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: new THREE.Color() },
        uBand: { value: new THREE.Color() },
        uZenith: { value: new THREE.Color() },
        uTime: { value: 0 },
        uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
        uFlash: { value: 0 },
        uFlashColour: { value: SKY_FLASH_COLOUR.clone() }
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
    sky.name = 'skyDome';
    // Drawn before everything else, behind it all.
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    return sky;
  }

  /**
   * Builds the sky dome and every cloud layer. Called once at bootstrap.
   * @returns {void}
   */
  function initClouds() {
    Clouds.atlas = createCloudPuffAtlas();
    const group = new THREE.Group();
    group.name = 'stormSky';

    Clouds.sky = buildSky();
    group.add(Clouds.sky);
    for (const def of CLOUD_LAYERS) {
      const layer = buildLayer(def);
      group.add(layer.mesh);
      Clouds.layers.push(layer);
    }
    Sim.three.scene.add(group);
    Clouds.group = group;
  }

  /**
   * Current lightning flash as clouds see it: normalised strength and the
   * strike's position lifted to cloud-base height. Read lazily, since the
   * lightning system is initialised after this one.
   * @returns {{strength:number, x:number, y:number, z:number}}
   */
  function currentFlash() {
    const light = ctx.Lightning && ctx.Lightning.flashLight;
    if (!light || light.intensity <= 0) return { strength: 0, x: 0, y: CLOUD_FLASH_ALTITUDE, z: 0 };
    return {
      strength: Math.min(1.5, light.intensity / CLOUD_FLASH_NORMALISE),
      x: light.position.x,
      y: CLOUD_FLASH_ALTITUDE,
      z: light.position.z
    };
  }

  /**
   * Per-frame drift, intensity response and lightning response. Runs every
   * frame regardless of running state (matching updateAtmosphere()), weighted
   * by Sim.state.stormRamp so the deck sits calm while standing by and only
   * builds into the heavier storm sky once a run (or Chase Mode) is under way.
   * @param {number} dt
   * @returns {void}
   */
  function updateClouds(dt) {
    if (!Clouds.group) return;
    const intensity = Sim.params.intensity * Sim.state.stormRamp;
    const camera = Sim.three.camera;
    const fogColour = Sim.three.scene.fog.color;
    Clouds.time += dt;
    const flash = currentFlash();

    // Sky follows the camera so it is always "at infinity".
    const sky = Clouds.sky;
    sky.position.copy(camera.position);
    const su = sky.material.uniforms;
    su.uHorizon.value.copy(fogColour);
    const daylight = ctx.DayNight ? ctx.DayNight.daylight : 0;
    su.uBand.value.copy(SKY_BAND_CALM).lerp(SKY_BAND_STORM, intensity)
      .lerp(scratch.copy(SKY_BAND_DAY).lerp(SKY_BAND_DAY_STORM, intensity), daylight);
    su.uZenith.value.copy(SKY_ZENITH_CALM).lerp(SKY_ZENITH_STORM, intensity)
      .lerp(scratch.copy(SKY_ZENITH_DAY).lerp(SKY_ZENITH_DAY_STORM, intensity), daylight);
    su.uTime.value = Clouds.time;
    su.uFlash.value = flash.strength;
    su.uFlashDir.value.set(flash.x - camera.position.x, flash.y - camera.position.y, flash.z - camera.position.z).normalize();

    for (const { mesh, def, material } of Clouds.layers) {
      mesh.rotation.y += dt * (def.spin + intensity * def.spinIntensity);
      const u = material.uniforms;
      // Each layer's `tone` biases it towards the storm palette, so the
      // bank and the low scud stay heavier than the high deck.
      const storminess = Math.min(1, intensity * 0.8 + def.tone * 0.35);
      u.uTopColour.value.copy(CLOUD_TOP_CALM).lerp(CLOUD_TOP_STORM, storminess).lerp(CLOUD_TOP_DAY, daylight);
      u.uBellyColour.value.copy(CLOUD_BELLY_CALM).lerp(CLOUD_BELLY_STORM, storminess)
        .lerp(scratch.copy(CLOUD_BELLY_DAY).lerp(CLOUD_BELLY_DAY_STORM, storminess), daylight);
      u.uHazeColour.value.copy(scratch.copy(fogColour));
      u.uOpacity.value = Math.min(1, def.opacity * (0.75 + intensity * 0.35)) * (1 - (1 - CLOUD_DAY_OPACITY) * daylight)
        * (def.stormOnly ? Sim.state.stormRamp : 1);
      u.uSizeScale.value = 1 + intensity * 0.5;
      u.uIntensity.value = intensity;
      u.uFlash.value = flash.strength;
      // World space: the shader's puff centres already include the drift.
      u.uFlashPos.value.set(flash.x, flash.y, flash.z);
    }
  }

  /**
   * World position of one puff of a layer, including the layer's drift
   * (its mesh's rotation about the town centre).
   * @param {{mesh: THREE.InstancedMesh}} layer
   * @param {{x: number, y: number, z: number}} puff
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3}
   */
  function puffWorld(layer, puff, out) {
    const a = layer.mesh.rotation.y;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return out.set(puff.x * c + puff.z * s, puff.y, -puff.x * s + puff.z * c);
  }

  /**
   * The layers lightning can come out of: the storm cell overhead once it
   * has built in, and the low scud around it.
   * @returns {Object[]}
   */
  function stormLayers() {
    return Clouds.layers.filter(l => l.def.name === 'cloudLayer_low'
      || (l.def.name === 'cloudLayer_cell' && Sim.state.stormRamp > 0.25));
  }

  /**
   * Where a bolt aimed at (x, z) leaves the cloud: inside the underside of
   * one of the puffs nearest above that point -- one of the closest few
   * rather than always the closest, so strikes on the same spot do not all
   * drop out of the same spot in the sky.
   * @param {number} x
   * @param {number} z
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3|null} null if there is no cloud to use
   */
  function pickBoltOrigin(x, z, out) {
    const intensity = Sim.params.intensity * Sim.state.stormRamp;
    const best = [];
    for (const layer of stormLayers()) {
      for (const puff of layer.puffs) {
        if (puff.threshold > intensity) continue;
        puffWorld(layer, puff, out);
        const d = Math.hypot(out.x - x, out.z - z);
        best.push({ d, layer, puff });
      }
    }
    if (!best.length) return null;
    best.sort((a, b) => a.d - b.d);
    const pick = best[Math.floor(Math.random() * Math.min(5, best.length))];
    puffWorld(pick.layer, pick.puff, out);
    out.y -= pick.puff.size * BOLT_ORIGIN_INSET;
    return out;
  }

  /**
   * A random puff of the storm's own cloud, for flashes that stay inside it.
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3|null}
   */
  function randomCloudPoint(out) {
    const layers = stormLayers();
    if (!layers.length) return null;
    const layer = layers[Math.floor(Math.random() * layers.length)];
    const puff = layer.puffs[Math.floor(Math.random() * layer.puffs.length)];
    return puffWorld(layer, puff, out);
  }

  /**
   * Releases the sky and cloud GPU resources.
   * @returns {void}
   */
  function disposeClouds() {
    if (!Clouds.group) return;
    Sim.three.scene.remove(Clouds.group);
    Clouds.sky.geometry.dispose();
    Clouds.sky.material.dispose();
    for (const { mesh, material } of Clouds.layers) {
      mesh.geometry.dispose();
      material.dispose();
    }
    Clouds.atlas.dispose();
    Clouds.group = null;
  }

  return { Clouds, initClouds, updateClouds, disposeClouds, pickBoltOrigin, randomCloudPoint };
}
