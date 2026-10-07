// @ts-check
import * as THREE from 'three';
import { fitShadowCameraToBox, SHADOW_BOUNDS } from './scene.js';
import { unsmooth } from './net/skyMirror.js';

/**
 * ===========================================================================
 * SECTION E.1 — Day / night scene preset
 * ===========================================================================
 * A purely visual environment toggle, independent of the storm's intensity:
 * night is the original storm-night look; Day Mode is a bright, clear sky
 * with a strong sun, raised ambient light, light haze instead of murk, and
 * the town's artificial lights off. The simulation itself -- tornado,
 * physics, damage, Chase Mode -- is untouched.
 *
 * One number drives it: DayNight.daylight, 0 (night) to 1 (day), eased over
 * TRANSITION_SECONDS when the mode is switched, so switching is a quick
 * fade rather than a hard cut and works the same whether the run is idle,
 * running or paused. This module applies it to what it owns outright
 * (lights, exposure, windows, streetlamps, backdrop, funnel tone); the
 * systems that already recompute their look every frame (scene.js's
 * atmosphere, clouds.js, weather.js, lightning.js) read it themselves.
 *
 * Both presets are just endpoints of a lerp: there is no second set of
 * lights, materials or render passes, so Day Mode costs nothing extra.
 */

const TRANSITION_SECONDS = 0.9;

// Lights: [night, day]. Night values are the original scene.js ones.
const HEMI_SKY = [new THREE.Color(0x9fbfe0), new THREE.Color(0xcfe3f5)];
const HEMI_GROUND = [new THREE.Color(0x241f1c), new THREE.Color(0x5c5040)];
const HEMI_INTENSITY = [0.65, 1.2];
const SUN_COLOUR = [new THREE.Color(0xfff2d8), new THREE.Color(0xfff0d6)];
const SUN_INTENSITY = [1.3, 3.0];
// Day sun: higher and swung round towards the default camera's side, so the
// town is front-lit from the opening view with shadows falling away from it.
const SUN_POSITION = [new THREE.Vector3(-80, 100, 40), new THREE.Vector3(-60, 140, 95)];
const FILL_COLOUR = [new THREE.Color(0x7d94b8), new THREE.Color(0xa9c2e0)];
const FILL_INTENSITY = [0.4, 0.5];
const AMBIENT_COLOUR = [new THREE.Color(0x404a5c), new THREE.Color(0x8a98ad)];
const AMBIENT_INTENSITY = [0.35, 0.3];
// post.js's exposure (1.45) was raised to lift the night scene; daylight
// needs none of that lift.
const EXPOSURE = [1.45, 1.0];
// The funnel was tuned to stand out as a pale veil against a dark sky;
// against a bright one the same pale grey washes out, so by day it is
// multiplied down to a darker, condensed-cloud grey.
const FUNNEL_TONE = [new THREE.Color(0xffffff), new THREE.Color(0x7c7f86)];
// Rim light on the funnel's silhouette, [night, day] (see vortex.js).
const RIM_STRENGTH = [0.45, 0.0];
// The fill light every scene gets on top of its preset (on request): the
// ambient (hemisphere + ambient) a quarter brighter than the preset, always.
const AMBIENT_BOOST = 1.25;
// After the first major destruction of a run (gamefeel.js heavy events: a
// collapse, a blast, a flood...), a further half again, eased in over two
// minutes and kept: the wrecked town was reading as too dark to follow.
const RECOVERY_BOOST = 1.5;
const RECOVERY_SECONDS = 120;

// Unlit streetlamp globe by day.
const LAMP_OFF_COLOUR = new THREE.Color(0x8d8a80);

/**
 * @typedef {Object} DayNightState
 * @property {boolean} day the selected mode
 * @property {number} daylight 0 (night) .. 1 (day), eased towards the selected mode
 * @property {number|null} follow a co-op guest shows the host's daylight (net/skyMirror.js); null otherwise
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   DayNight: DayNightState,
 *   setDayMode: (day: boolean) => void,
 *   initDayNight: () => void,
 *   updateDayNight: (dt: number) => void,
 *   noteDestruction: () => void,
 *   resetDayNight: () => void
 * }}
 */
export function createDayNightSystem(ctx) {
  const { Sim } = ctx;

  /** @type {DayNightState} */
  const DayNight = { day: false, daylight: 0, follow: null };
  ctx.DayNight = DayNight;

  // Linear transition progress; `daylight` is its smoothstep.
  let progress = 0;
  // Last daylight value applied, so a settled mode costs no per-frame writes.
  let applied = -1;
  // Seconds since the first major destruction of the run (see RECOVERY_*);
  // negative until there has been one.
  let recovery = -1;
  let appliedBoost = -1;
  /** @type {{hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight, fill: THREE.DirectionalLight, ambient: THREE.AmbientLight}|null} */
  let lights = null;
  /** @type {THREE.Color|null} */
  let lampOnColour = null;
  /** @type {number} */
  let poolOpacity = 0;
  /** @type {HTMLButtonElement|null} */
  let button = null;

  /**
   * @param {boolean} day
   * @returns {void}
   */
  function setDayMode(day) {
    DayNight.day = day;
    if (button) {
      button.textContent = day ? 'Night Mode' : 'Day Mode';
      button.setAttribute('aria-pressed', String(day));
      button.classList.toggle('active', day);
    }
  }

  /**
   * Finds the scene's lights and the town's lamp materials, and wires the
   * UI button. Called after the scene and the town decor exist.
   * @returns {void}
   */
  function initDayNight() {
    const scene = Sim.three.scene;
    lights = {
      hemi: /** @type {THREE.HemisphereLight} */ (scene.getObjectByName('light_hemisphere')),
      sun: /** @type {THREE.DirectionalLight} */ (scene.getObjectByName('light_sun')),
      fill: /** @type {THREE.DirectionalLight} */ (scene.getObjectByName('light_fill')),
      ambient: /** @type {THREE.AmbientLight} */ (scene.getObjectByName('light_ambient'))
    };
    const decor = ctx.Environment.decorMeshes;
    if (decor.streetlightLamp) lampOnColour = decor.streetlightLamp.material.color.clone();
    if (decor.streetlightPool) poolOpacity = decor.streetlightPool.material.opacity;

    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-daymode'));
    if (button) button.addEventListener('click', () => setDayMode(!DayNight.day), { signal: ctx.signal });
    setDayMode(DayNight.day);
  }

  /**
   * @param {THREE.Color} out
   * @param {THREE.Color[]} pair [night, day]
   * @param {number} k daylight
   * @returns {THREE.Color}
   */
  function mixColour(out, pair, k) {
    return out.copy(pair[0]).lerp(pair[1], k);
  }

  /**
   * @param {number[]} pair [night, day]
   * @param {number} k daylight
   * @returns {number}
   */
  function mix(pair, k) {
    return pair[0] + (pair[1] - pair[0]) * k;
  }

  /**
   * Writes the current daylight value into everything this module owns.
   * @param {number} k daylight, 0..1
   * @returns {void}
   */
  function applyDaylight(k) {
    const { hemi, sun, fill, ambient } = lights;
    mixColour(hemi.color, HEMI_SKY, k);
    mixColour(hemi.groundColor, HEMI_GROUND, k);
    hemi.intensity = mix(HEMI_INTENSITY, k) * boost();
    mixColour(sun.color, SUN_COLOUR, k);
    sun.intensity = mix(SUN_INTENSITY, k);
    sun.position.copy(SUN_POSITION[0]).lerp(SUN_POSITION[1], k);
    // The shadow frustum is fitted along the light direction, so it has to
    // follow the sun as it moves.
    fitShadowCameraToBox(sun, SHADOW_BOUNDS);
    mixColour(fill.color, FILL_COLOUR, k);
    fill.intensity = mix(FILL_INTENSITY, k);
    mixColour(ambient.color, AMBIENT_COLOUR, k);
    ambient.intensity = mix(AMBIENT_INTENSITY, k) * boost();

    const post = ctx.systems.post.Post;
    post.exposure = mix(EXPOSURE, k);

    // Artificial light off by day: windows turn to glass, lamps go out,
    // the backdrop town's lit facades fade.
    const win = ctx.systems.buildings.windowUniforms;
    win.uDaylight.value = k;
    const decor = ctx.Environment.decorMeshes;
    if (decor.streetlightLamp && lampOnColour) {
      decor.streetlightLamp.material.color.copy(lampOnColour).lerp(LAMP_OFF_COLOUR, k);
    }
    if (decor.streetlightPool) {
      decor.streetlightPool.material.opacity = poolOpacity * (1 - k);
      decor.streetlightPool.visible = k < 0.999;
    }
    const backdrop = Sim.three.scene.getObjectByName('backdrop_blocks');
    if (backdrop) backdrop.material.emissiveIntensity = 1 - k;

    // Every tornado, the Outbreak's hidden ones included, so they are
    // already the right tone when they appear.
    for (const { Vortex } of ctx.tornadoes.instances) {
      // The funnel's night rim light (vortex.js FUNNEL_LOOK) is for a dark
      // sky; by day the darker funnel tone does that job.
      Vortex.rim.value = RIM_STRENGTH[0] + (RIM_STRENGTH[1] - RIM_STRENGTH[0]) * k;
      if (Vortex.funnelMesh) {
        const tone = mixColour(Vortex.funnelMesh.material.color, FUNNEL_TONE, k);
        for (const sub of Vortex.subVortices) sub.mesh.material.color.copy(tone);
      }
    }
  }

  /**
   * Per frame: eases daylight towards the selected mode and applies it.
   * Runs whatever the simulation's state, so switching works while idle,
   * running or paused. Before the atmosphere, clouds and weather updates,
   * which read DayNight.daylight.
   * @param {number} dt
   * @returns {void}
   */
  function updateDayNight(dt) {
    if (!lights) return;
    if (DayNight.follow !== null) {
      // A co-op guest: the host's (already eased) daylight, no local ease.
      progress = unsmooth(DayNight.follow);
    } else {
      const target = DayNight.day ? 1 : 0;
      const step = dt / TRANSITION_SECONDS;
      progress = target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step);
    }
    DayNight.daylight = THREE.MathUtils.smoothstep(progress, 0, 1);
    if (recovery >= 0) recovery += dt;
    if (DayNight.daylight !== applied) {
      applied = DayNight.daylight;
      applyDaylight(applied);
      appliedBoost = boost();
      return;
    }
    // Only the two ambient lights change with the boost, so between daylight
    // changes that is all that is rewritten.
    const b = boost();
    if (Math.abs(b - appliedBoost) < 1e-4) return;
    appliedBoost = b;
    lights.hemi.intensity = mix(HEMI_INTENSITY, applied) * b;
    lights.ambient.intensity = mix(AMBIENT_INTENSITY, applied) * b;
  }

  /**
   * The multiplier on the ambient lights right now: AMBIENT_BOOST, and once
   * the town has taken its first big hit, climbing to RECOVERY_BOOST times
   * that over RECOVERY_SECONDS.
   * @returns {number}
   */
  function boost() {
    const u = recovery < 0 ? 0 : THREE.MathUtils.smoothstep(recovery, 0, RECOVERY_SECONDS);
    return AMBIENT_BOOST * (1 + (RECOVERY_BOOST - 1) * u);
  }

  /**
   * A major destruction has happened (gamefeel.js, on its heavy events):
   * starts the two-minute brightening if it has not already begun this run.
   * @returns {void}
   */
  function noteDestruction() {
    if (recovery < 0) recovery = 0;
  }

  /**
   * Back to the plain boost for a fresh run.
   * @returns {void}
   */
  function resetDayNight() {
    recovery = -1;
  }

  return { DayNight, setDayMode, initDayNight, updateDayNight, noteDestruction, resetDayNight };
}
