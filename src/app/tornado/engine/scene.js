// @ts-check
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGroundTexture } from '../utils/textures.js';

/**
 * ===========================================================================
 * SECTION B — Scene, camera, renderer, lighting
 * ===========================================================================
 */

const ATMOSPHERE_BASE_COLOUR = new THREE.Color(0x1a2233);
const ATMOSPHERE_STORM_COLOUR = new THREE.Color(0x11161c);
// Day Mode (engine/dayNight.js): light haze instead of storm murk, turning
// only a little greyer as intensity rises.
const ATMOSPHERE_DAY_COLOUR = new THREE.Color(0xb8d0e6);
const ATMOSPHERE_DAY_STORM_COLOUR = new THREE.Color(0x9aabbb);
const atmosphereScratch = new THREE.Color();
const atmosphereDayScratch = new THREE.Color();

// Sun shadow map, fitted to SHADOW_BOUNDS. It was 4096 (16 million texels
// redrawn every frame, with PCFSoft filtering over them) -- the heaviest
// single pass on integrated graphics. 1024 with plain PCF, on request for
// weak laptops: a softer-edged shadow, at a sixteenth of the fill. The
// adaptive quality (engine/quality.js) drops it to 512 if the frame rate
// still cannot keep up.
export const SHADOW_MAP_SIZE = 1024;
// The drawing buffer's pixel ratio, at most: 2 on a Retina screen is four
// times the pixels of 1, for a difference hardly visible under the grade
// and bloom. quality.js may bring it down to 1.
export const MAX_PIXEL_RATIO = 1.5;
// Everything that should cast or receive: people spawn up to ~128 from the
// centre (building spots at +-88 plus +-40 jitter), and debris is lifted to
// well above rooftop height, hence the tall box.
export const SHADOW_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-130, 0, -130), new THREE.Vector3(130, 80, 130)
);

/**
 * Fits a directional light's orthographic shadow camera tightly around a
 * world-space box, as seen from the light. three rebuilds the shadow
 * camera's view matrix from the light's position and target every frame,
 * so fitting against a camera placed the same way gives the same space.
 * @param {THREE.DirectionalLight} light
 * @param {THREE.Box3} box
 * @returns {void}
 */
export function fitShadowCameraToBox(light, box) {
  const view = new THREE.OrthographicCamera();
  view.position.copy(light.position);
  view.lookAt(light.target.position);
  view.updateMatrixWorld();
  const toLight = view.matrixWorld.clone().invert();

  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).applyMatrix4(toLight);
    min.min(corner);
    max.max(corner);
  }

  const cam = light.shadow.camera;
  cam.left = min.x;
  cam.right = max.x;
  cam.bottom = min.y;
  cam.top = max.y;
  // The camera looks down -z, so view-space z is negated distance.
  cam.near = -max.z - 1;
  cam.far = -min.z + 1;
  cam.updateProjectionMatrix();
}

/**
 * The frame clock: a THREE.Timer (Clock is deprecated since r183), on the
 * Page Visibility API so a tab coming back from the background does not
 * hand the game one enormous step. Stepped by animate (tornadoEngine.js).
 * @returns {THREE.Timer}
 */
function makeTimer() {
  const timer = new THREE.Timer();
  if (typeof document !== 'undefined') timer.connect(document);
  return timer;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initScene: () => void,
 *   onWindowResize: (camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) => void,
 *   updateAtmosphere: () => void,
 *   disposeScene: () => void
 * }}
 */
export function createSceneSystem(ctx) {
  const { container, Sim } = ctx;

  /** @type {(() => void)|null} */
  let resizeHandler = null;

  /** @returns {void} */
  function initScene() {
    const scene = new THREE.Scene();
    scene.name = 'tornadoScene';
    scene.background = new THREE.Color(0x1a2233);
    scene.fog = new THREE.FogExp2(0x1a2233, 0.0055);

    const camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 2000
    );
    camera.name = 'mainCamera';
    camera.position.set(60, 45, 80);

    // No antialias on the canvas: the scene is drawn into post.js's own
    // multisampled target and only a full-screen quad ever reaches the
    // canvas, so canvas MSAA was paid for and never seen. High performance:
    // on a laptop with two GPUs, ask for the discrete one.
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    // Shader compile errors are looked for only in development: the check
    // asks the driver for every program's info log, which stalls on each
    // new material (getProgramInfoLog was 9% of a heavy run's CPU, measured
    // with ?bench=1). three's own advice for production.
    renderer.debug.checkShaderErrors = process.env.NODE_ENV === 'development';
    renderer.shadowMap.enabled = true;
    // Plain PCF: PCFSoft's extra taps were most of the shadow cost per pixel.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 15;
    controls.maxDistance = 260;
    controls.target.set(0, 8, 0);
    // OrbitControls captures the pointer on every press; while the pointer is
    // locked (first-person aim, a co-op guest's look) the browser has no such
    // pointer and throws. The capture is only a convenience, so a refusal is ignored.
    const guardCapture = (/** @type {'setPointerCapture'|'releasePointerCapture'} */ name) => {
      const native = renderer.domElement[name].bind(renderer.domElement);
      renderer.domElement[name] = (/** @type {number} */ id) => { try { native(id); } catch { /* no such active pointer */ } };
    };
    guardCapture('setPointerCapture');
    guardCapture('releasePointerCapture');

    // Ground term desaturated and darkened versus the original warm brown,
    // for a stormier ambient mood.
    const hemi = new THREE.HemisphereLight(0x9fbfe0, 0x241f1c, 0.65);
    hemi.name = 'light_hemisphere';
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.3);
    sun.name = 'light_sun';
    sun.position.set(-80, 100, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    fitShadowCameraToBox(sun, SHADOW_BOUNDS);
    // The old bias of -0.0015 was a fraction of a 400-unit depth range, i.e.
    // ~0.6 world units: enough to detach every shadow from the object
    // casting it by about half a unit on the ground, which is what made
    // cars, people and walls look like they hovered. Acne is now handled
    // mostly by normalBias (an offset along the surface normal, which does
    // not open a gap at contact points) with only a sliver of depth bias.
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.045;
    scene.add(sun);

    // Cool, shadow-less fill light on the opposite side standing in for
    // storm-cloud bounce light, so shadow-side surfaces aren't pure black.
    const fill = new THREE.DirectionalLight(0x7d94b8, 0.4);
    fill.name = 'light_fill';
    fill.position.set(70, 60, -60);
    fill.castShadow = false;
    scene.add(fill);

    const ambient = new THREE.AmbientLight(0x404a5c, 0.35);
    ambient.name = 'light_ambient';
    scene.add(ambient);

    const groundGeo = new THREE.PlaneGeometry(600, 600, 1, 1);
    // Pushed back in depth so the roads (0.01 above it) and every decal on
    // them win cleanly at any distance, rather than z-fighting in stripes.
    const groundMat = new THREE.MeshStandardMaterial({
      map: createGroundTexture(), roughness: 1,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.name = 'ground';
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(600, 60, 0x2c3648, 0x2c3648);
    grid.name = 'groundGrid';
    grid.position.y = 0.02;
    scene.add(grid);

    resizeHandler = () => onWindowResize(camera, renderer);
    window.addEventListener('resize', resizeHandler, { signal: ctx.signal });

    Sim.three = { scene, camera, renderer, controls, clock: makeTimer() };
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @returns {void}
   */
  function onWindowResize(camera, renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    ctx.systems.post.resizePostProcessing();
  }

  /**
   * Darkens the sky background and thickens fog as intensity rises, giving
   * a visibly stormier look with no postprocessing/bloom involved. Called
   * once per frame from animate(), independent of running state -- but
   * weighted by Sim.state.stormRamp (see context.js), so the sky sits calm
   * while standing by and only reads as severe once a run (or Chase Mode) is
   * actually under way, rather than the whole scene opening mid-storm.
   * @returns {void}
   */
  function updateAtmosphere() {
    const intensity = Sim.params.intensity * Sim.state.stormRamp;
    const daylight = ctx.DayNight ? ctx.DayNight.daylight : 0;
    atmosphereScratch.copy(ATMOSPHERE_BASE_COLOUR).lerp(ATMOSPHERE_STORM_COLOUR, intensity);
    atmosphereDayScratch.copy(ATMOSPHERE_DAY_COLOUR).lerp(ATMOSPHERE_DAY_STORM_COLOUR, intensity);
    atmosphereScratch.lerp(atmosphereDayScratch, daylight);
    Sim.three.scene.background.copy(atmosphereScratch);
    Sim.three.scene.fog.color.copy(atmosphereScratch);
    const nightDensity = 0.0055 + intensity * 0.0045;
    const dayDensity = 0.0018 + intensity * 0.0022;
    Sim.three.scene.fog.density = nightDensity + (dayDensity - nightDensity) * daylight;
  }

  /** @returns {void} */
  function disposeScene() {
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  }

  return { initScene, onWindowResize, updateAtmosphere, disposeScene };
}
