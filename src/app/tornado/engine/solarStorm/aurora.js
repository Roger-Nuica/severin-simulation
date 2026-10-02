// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION SS.1 — The aurora
 * ===========================================================================
 * What the solar storm (engine/solarStorm.js) puts in the sky, drawn the
 * way the real thing is built:
 *
 *  - curtains: tall ribbons hung in a ring above the clouds, each a single
 *    strip folded in the vertex shader (three sines drifting at different
 *    speeds, so the folds roll along it). The fragment shader draws the
 *    rays -- fine vertical striations sliding sideways -- over a bright,
 *    rippling lower hem, green (oxygen at 557.7 nm) low down shading into
 *    red (oxygen at 630 nm) at the top; during a surge the hem picks up the
 *    pink-violet fringe of nitrogen. On impact they unroll from the top
 *    down (uDrop);
 *  - the corona: at the height of a surge, when the aurora is straight
 *    overhead, its rays seem to converge on one point above the viewer --
 *    a disc high above the camera with rays running into its middle;
 *  - the light it throws: a hemisphere light, created once and left at
 *    zero intensity, tinting the town green-violet while it lasts.
 *
 * Costs: four strips and a disc, one draw each, additive, no depth write,
 * hidden whenever there is no storm. The light is always in the scene (so
 * no material recompiles when the storm starts) but at zero it adds
 * nothing.
 */

const CURTAINS = [
  // start angle, span (radians), ring radius, base, height, seed
  { start: -0.4, span: 1.9, radius: 430, base: 185, height: 260, seed: 0.0 },
  { start: 1.7, span: 1.6, radius: 470, base: 200, height: 230, seed: 3.1 },
  { start: 3.5, span: 1.7, radius: 410, base: 190, height: 280, seed: 5.7 },
  { start: 5.0, span: 1.4, radius: 500, base: 210, height: 220, seed: 8.3 }
];

const CORONA = { height: 270, radius: 260 };
// The light at full aurora, and the two colours it swings between.
const GLOW = { intensity: 0.4, green: new THREE.Color(0x3dff9a), violet: new THREE.Color(0xb36bff), ground: new THREE.Color(0x0b1a14) };

const CURTAIN_VERTEX = /* glsl */`
  uniform float uTime;
  uniform float uStart;
  uniform float uSpan;
  uniform float uRadius;
  uniform float uBase;
  uniform float uHeight;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float s = uv.x;
    float a = uStart + s * uSpan;
    // The folds: a slow sweep, a middle roll and a fast ripple.
    float fold = sin( s * 6.0 + uTime * 0.12 + uSeed ) * 34.0
      + sin( s * 17.0 + uTime * 0.33 + uSeed * 1.7 ) * 14.0
      + sin( s * 43.0 - uTime * 0.71 + uSeed * 2.3 ) * 5.0;
    float r = uRadius + fold;
    vec3 p = vec3( cos( a ) * r, uBase + uv.y * uHeight, sin( a ) * r );
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( p, 1.0 );
  }
`;

const NOISE = /* glsl */`
  float auroraHash( float n ) { return fract( sin( n ) * 43758.5453 ); }
  float auroraNoise( float x ) {
    float i = floor( x );
    float f = fract( x );
    return mix( auroraHash( i ), auroraHash( i + 1.0 ), f * f * ( 3.0 - 2.0 * f ) );
  }
`;

const CURTAIN_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uSeed;
  uniform float uOpacity;
  uniform float uDrop;
  uniform float uSurge;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float s = vUv.x;
    float y = vUv.y;
    // The rays, sliding along the curtain: soft and broad, a few sharper
    // ones over them, and a glowing body between -- never a barcode.
    float rays = auroraNoise( s * 70.0 + uTime * 0.9 + uSeed * 13.0 ) * 0.5
      + auroraNoise( s * 23.0 - uTime * 0.4 + uSeed * 5.0 ) * 0.35
      + auroraNoise( s * 170.0 + uTime * 2.2 + uSeed * 3.0 ) * 0.15;
    rays = pow( 0.3 + 0.7 * rays, 1.6 );
    // The hem: the sharp, bright lower edge, rippling.
    float hem = 0.05 + 0.035 * sin( s * 70.0 + uTime * 2.4 + uSeed ) + 0.02 * sin( s * 23.0 - uTime * 1.1 );
    float above = y - hem;
    float edge = smoothstep( -0.015, 0.015, above );
    float glow = edge * ( 0.3 + 0.9 * exp( -above * 9.0 ) );
    float fadeUp = 1.0 - smoothstep( 0.3, 1.0, y );
    float ends = smoothstep( 0.0, 0.1, s ) * ( 1.0 - smoothstep( 0.9, 1.0, s ) );
    // Brighter patches travelling along it.
    float pulse = 0.65 + 0.35 * sin( s * 24.0 - uTime * 1.6 + uSeed );
    // Unrolling from the top on impact.
    float drop = smoothstep( 1.0 - uDrop * 1.15, 1.0 - uDrop * 1.15 + 0.12, y );
    vec3 green = vec3( 0.12, 1.0, 0.42 );
    vec3 red = vec3( 0.9, 0.12, 0.42 );
    vec3 fringe = vec3( 0.95, 0.35, 1.0 );
    vec3 col = mix( green, red, smoothstep( 0.4, 0.95, y ) );
    col = mix( col, fringe, uSurge * ( 1.0 - smoothstep( 0.0, 0.06, above ) ) * edge );
    float k = rays * glow * fadeUp * ends * pulse * drop * uOpacity * ( 1.0 + 0.8 * uSurge );
    gl_FragColor = vec4( col * k * 0.8, 1.0 );
  }
`;

const CORONA_VERTEX = /* glsl */`
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

const CORONA_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vPos;
  ${NOISE}
  void main() {
    float r = length( vPos );
    float a = atan( vPos.y, vPos.x );
    // Rays converging on the middle, turning slowly.
    float rays = auroraNoise( a * 30.0 + uTime * 0.6 ) * 0.6 + auroraNoise( a * 9.0 - uTime * 0.25 ) * 0.4;
    rays = pow( 0.2 + 0.8 * rays, 2.0 );
    float body = smoothstep( 0.06, 0.35, r ) * ( 1.0 - smoothstep( 0.6, 1.0, r ) );
    float flicker = 0.7 + 0.3 * sin( r * 18.0 - uTime * 4.0 );
    vec3 col = mix( vec3( 0.15, 1.0, 0.5 ), vec3( 0.75, 0.3, 1.0 ), smoothstep( 0.45, 0.95, r ) );
    gl_FragColor = vec4( col * rays * body * flicker * uOpacity * 0.9, 1.0 );
  }
`;

/**
 * @param {Object} ctx
 * @returns {{
 *   initAurora: () => void,
 *   updateAurora: (dt: number, level: number, drop: number, surge: number, corona: number) => void,
 *   hideAurora: () => void,
 *   disposeAurora: () => void
 * }}
 */
export function createAurora(ctx) {
  const { Sim } = ctx;
  /** @type {THREE.Mesh[]} */
  const curtains = [];
  /** @type {THREE.Mesh|null} */
  let corona = null;
  /** @type {THREE.HemisphereLight|null} */
  let light = null;
  /** @type {THREE.BufferGeometry|null} */
  let stripGeo = null;
  let time = 0;

  /**
   * @param {THREE.ShaderMaterial} material
   * @returns {THREE.ShaderMaterial}
   */
  function additive(material) {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    return material;
  }

  /** @returns {void} */
  function initAurora() {
    const scene = Sim.three.scene;
    stripGeo = new THREE.PlaneGeometry(1, 1, 240, 1);
    for (const c of CURTAINS) {
      const mesh = new THREE.Mesh(stripGeo, additive(new THREE.ShaderMaterial({
        vertexShader: CURTAIN_VERTEX,
        fragmentShader: CURTAIN_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uStart: { value: c.start },
          uSpan: { value: c.span },
          uRadius: { value: c.radius },
          uBase: { value: c.base },
          uHeight: { value: c.height },
          uSeed: { value: c.seed },
          uOpacity: { value: 0 },
          uDrop: { value: 0 },
          uSurge: { value: 0 }
        }
      })));
      mesh.name = 'solarStorm_aurora';
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      curtains.push(mesh);
    }
    // Left in its own xy plane (the shader reads position.xy) and laid flat
    // by the mesh's rotation, facing down.
    const discGeo = new THREE.CircleGeometry(1, 96);
    corona = new THREE.Mesh(discGeo, additive(new THREE.ShaderMaterial({
      vertexShader: CORONA_VERTEX,
      fragmentShader: CORONA_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } }
    })));
    corona.rotation.x = Math.PI / 2;
    corona.scale.setScalar(CORONA.radius);
    corona.name = 'solarStorm_corona';
    corona.frustumCulled = false;
    corona.visible = false;
    scene.add(corona);

    light = new THREE.HemisphereLight(GLOW.green, GLOW.ground, 0);
    light.name = 'solarStorm_auroraLight';
    scene.add(light);
  }

  /**
   * Per frame while the storm is on.
   * @param {number} dt
   * @param {number} level 0..1 how bright the aurora is
   * @param {number} drop 0..1 how far the curtains have unrolled
   * @param {number} surge 0..1 a surge running
   * @param {number} coronaLevel 0..1 the corona overhead
   * @returns {void}
   */
  function updateAurora(dt, level, drop, surge, coronaLevel) {
    time += dt;
    // Fainter by day: it is there, but the sky washes it out.
    const daylight = ctx.DayNight ? ctx.DayNight.daylight : 0;
    const shown = level * (1 - 0.65 * daylight);
    for (const mesh of curtains) {
      const u = /** @type {THREE.ShaderMaterial} */ (mesh.material).uniforms;
      u.uTime.value = time;
      u.uOpacity.value = shown;
      u.uDrop.value = drop;
      u.uSurge.value = surge;
      mesh.visible = shown > 0.002;
    }
    if (corona) {
      const cam = Sim.three.camera.position;
      corona.position.set(cam.x, CORONA.height, cam.z);
      const u = /** @type {THREE.ShaderMaterial} */ (corona.material).uniforms;
      u.uTime.value = time;
      u.uOpacity.value = coronaLevel * (1 - 0.65 * daylight);
      corona.visible = coronaLevel > 0.002;
    }
    if (light) {
      light.color.copy(GLOW.green).lerp(GLOW.violet, Math.min(1, 0.25 + 0.2 * Math.sin(time * 0.4) + surge * 0.45));
      light.intensity = GLOW.intensity * level * (1 + 0.5 * surge) * (1 - 0.8 * daylight);
    }
  }

  /** @returns {void} */
  function hideAurora() {
    for (const mesh of curtains) mesh.visible = false;
    if (corona) corona.visible = false;
    if (light) light.intensity = 0;
  }

  /** @returns {void} */
  function disposeAurora() {
    const scene = Sim.three.scene;
    for (const mesh of curtains) {
      scene.remove(mesh);
      /** @type {THREE.Material} */ (mesh.material).dispose();
    }
    curtains.length = 0;
    if (stripGeo) stripGeo.dispose();
    stripGeo = null;
    if (corona) {
      scene.remove(corona);
      corona.geometry.dispose();
      /** @type {THREE.Material} */ (corona.material).dispose();
    }
    corona = null;
    if (light) scene.remove(light);
    light = null;
  }

  return { initAurora, updateAurora, hideAurora, disposeAurora };
}
