// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * Shared: the scene's budget of point lights
 * ===========================================================================
 * Every point light in the scene costs every lit pixel on screen, whether it
 * is shining or not: three.js compiles the light count into each lit
 * material and loops over all of them per fragment, and a light at intensity
 * zero is still in that loop. The game had grown 27 of them (fires, the
 * funnels, explosions, ships, the chemical works...), almost all dark at
 * any moment -- the single largest GPU cost on integrated graphics.
 *
 * Now there are LIGHT_POOL.size real point lights, and every effect gets its
 * light from here in one of two ways:
 *  - a **virtual light** (createLight): an Object3D with a point light's
 *    fields -- position, color, intensity, distance, decay -- that the
 *    system keeps and drives exactly as it drove its own PointLight (added
 *    to the scene, intensity and position set per frame, removed on
 *    dispose). It costs nothing to render;
 *  - a **request** (requestLight), made afresh every frame, for effects
 *    that come and go in numbers (lava vents, arcs, burning mains).
 * Once a frame, flushLightPool() scores every lit virtual light and request
 * by how much it would show -- its brightness, fading with its distance from
 * the camera -- and copies the best onto the real lights; the rest go dark
 * for that frame. The lightning flash keeps its own light (lightning.js):
 * it lights the whole sky and must never lose its slot.
 *
 * The real lights are created at start-up at zero intensity and never
 * removed: changing the scene's light count makes three.js recompile every
 * lit material. Colour, distance, decay and position change freely from
 * frame to frame without that cost.
 */

const LIGHT_POOL = {
  // Real point lights. Was 4 (for the requests alone) beside 23 lights owned
  // by the effects themselves.
  size: 6,
  decay: 2,
  // A request's priority (1-2) counts this much extra per step.
  priorityWeight: 0.25,
  // A light this far from the camera, in multiples of its own reach, counts
  // for half: what is near the camera is what the player can see lit.
  cameraFalloff: 1.5,
  // Kept by the light that had a slot last frame over an equal newcomer, so
  // two similar lights do not swap slots every frame and flicker.
  stickiness: 1.3
};

/**
 * @typedef {Object} LightRequest
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} colour hex
 * @property {number} intensity
 * @property {number} distance
 * @property {number} priority higher wins; ties go to the brighter request
 */

/**
 * A point light that is not one: the fields a PointLight has, for a system
 * to drive as it always did, and nothing for the renderer to draw. The pool
 * copies it onto a real light when it earns a slot.
 */
class VirtualLight extends THREE.Object3D {
  /**
   * @param {THREE.ColorRepresentation} colour
   * @param {number} intensity
   * @param {number} distance
   * @param {number} decay
   */
  constructor(colour, intensity, distance, decay) {
    super();
    this.isVirtualLight = true;
    this.type = 'VirtualLight';
    this.color = new THREE.Color(colour);
    this.intensity = intensity;
    this.distance = distance;
    this.decay = decay;
    /** @type {THREE.PointLight|null} the real light it had last frame */
    this.slot = null;
  }

  /** Nothing on the GPU to release; kept so callers' dispose() still works. @returns {void} */
  dispose() {}
}

/**
 * @param {Object} ctx
 * @returns {{
 *   LightStats: {wanted: number, lit: number},
 *   initLightPool: () => void,
 *   createLight: (colour: THREE.ColorRepresentation, intensity?: number, distance?: number, decay?: number) => VirtualLight,
 *   requestLight: (request: LightRequest) => void,
 *   flushLightPool: () => void,
 *   resetLightPool: () => void,
 *   disposeLightPool: () => void
 * }}
 */
export function createLightPoolSystem(ctx) {
  const { Sim } = ctx;

  /** @type {THREE.PointLight[]} */
  const lights = [];
  /** @type {LightRequest[]} */
  let requests = [];
  /** @type {VirtualLight[]} every virtual light handed out */
  let virtuals = [];
  // Last flush, for the performance overlay (engine/perf/monitor.js): how
  // many lights wanted to shine, and how many of them got a real light.
  const LightStats = { wanted: 0, lit: 0 };
  /**
   * Scratch candidates, reused frame to frame so the flush allocates
   * nothing: [score, x, y, z, colourHex|Color, intensity, distance, decay, owner].
   * @type {{score: number, x: number, y: number, z: number, colour: THREE.Color, intensity: number, distance: number, decay: number, owner: VirtualLight|null}[]}
   */
  const candidates = [];
  const world = new THREE.Vector3();

  /** @returns {void} */
  function initLightPool() {
    for (let i = 0; i < LIGHT_POOL.size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, LIGHT_POOL.decay);
      light.name = `effectLight_${i}`;
      Sim.three.scene.add(light);
      lights.push(light);
    }
  }

  /**
   * A virtual point light (see the header), in place of `new
   * THREE.PointLight(...)`. The caller adds it to the scene, drives it and
   * removes it as before.
   * @param {THREE.ColorRepresentation} colour
   * @param {number} [intensity]
   * @param {number} [distance]
   * @param {number} [decay]
   * @returns {VirtualLight}
   */
  function createLight(colour, intensity = 1, distance = 0, decay = 2) {
    const light = new VirtualLight(colour, intensity, distance, decay);
    virtuals.push(light);
    return light;
  }

  /**
   * Asks for a light this frame. Requests do not carry over: an effect that
   * wants to stay lit asks again every frame.
   * @param {LightRequest} request
   * @returns {void}
   */
  function requestLight(request) {
    if (request.intensity > 0) requests.push(request);
  }

  /**
   * How much a light would show from where the camera is.
   * @param {number} intensity
   * @param {number} distance its reach (0 for unlimited)
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  function score(intensity, distance, x, y, z) {
    const cam = Sim.three.camera.position;
    const reach = Math.max(distance || 60, 10) * LIGHT_POOL.cameraFalloff;
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z) / reach;
    return intensity / (1 + d * d);
  }

  /**
   * @param {number} i
   * @returns {Object} the i'th scratch candidate
   */
  function candidate(i) {
    if (!candidates[i]) {
      candidates[i] = { score: 0, x: 0, y: 0, z: 0, colour: new THREE.Color(), intensity: 0, distance: 0, decay: 2, owner: null };
    }
    return candidates[i];
  }

  /**
   * Once per frame, after every effect has set its lights and made its
   * requests: the real lights go to the lights that would show most, and
   * any left over go dark.
   * @returns {void}
   */
  function flushLightPool() {
    let n = 0;
    // three ships no types, so what VirtualLight inherits from Object3D
    // (visible, parent, getWorldPosition) is unknown to the type checker.
    for (const v of /** @type {any[]} */ (virtuals)) {
      if (!(v.intensity > 0) || !v.visible || !v.parent) continue;
      v.getWorldPosition(world);
      const c = candidate(n++);
      c.x = world.x;
      c.y = world.y;
      c.z = world.z;
      c.colour.copy(v.color);
      c.intensity = v.intensity;
      c.distance = v.distance;
      c.decay = v.decay;
      c.owner = v;
      c.score = score(v.intensity, v.distance, c.x, c.y, c.z) * (v.slot ? LIGHT_POOL.stickiness : 1);
    }
    for (const r of requests) {
      const c = candidate(n++);
      c.x = r.x;
      c.y = r.y;
      c.z = r.z;
      c.colour.setHex(r.colour);
      c.intensity = r.intensity;
      c.distance = r.distance;
      c.decay = LIGHT_POOL.decay;
      c.owner = null;
      c.score = score(r.intensity, r.distance, r.x, r.y, r.z) * (1 + LIGHT_POOL.priorityWeight * (r.priority || 0));
    }
    // Partial selection of the best `lights.length` by score: a handful of
    // passes over a short list, rather than sorting (and allocating) it.
    for (const v of virtuals) v.slot = null;
    for (let i = 0; i < lights.length; i++) {
      let best = -1;
      for (let j = i; j < n; j++) {
        if (best === -1 || candidates[j].score > candidates[best].score) best = j;
      }
      const light = lights[i];
      if (best === -1) {
        light.intensity = 0;
        continue;
      }
      const c = candidates[best];
      candidates[best] = candidates[i];
      candidates[i] = c;
      light.color.copy(c.colour);
      light.intensity = c.intensity;
      light.distance = c.distance;
      light.decay = c.decay;
      light.position.set(c.x, c.y, c.z);
      if (c.owner) c.owner.slot = light;
    }
    requests = [];
    LightStats.wanted = n;
    LightStats.lit = Math.min(n, lights.length);
  }

  /** @returns {void} */
  function resetLightPool() {
    requests = [];
    for (const light of lights) light.intensity = 0;
    // Virtual lights belong to their systems, which outlive a Reset.
  }

  /** @returns {void} */
  function disposeLightPool() {
    for (const light of lights) Sim.three.scene.remove(light);
    lights.length = 0;
    requests = [];
    virtuals = [];
  }

  return { LightStats, initLightPool, createLight, requestLight, flushLightPool, resetLightPool, disposeLightPool };
}
