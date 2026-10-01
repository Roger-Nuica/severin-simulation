// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION PB.1 — The black hole's look
 * ===========================================================================
 * It used to be a black ball inside two flat yellow rings: Saturn, not a
 * hole in space. Now it is a living vortex:
 *
 *  - The core: a perfectly black sphere, unlit -- the event horizon.
 *  - The swirl: one mesh, a ring shaped into a shallow funnel (deepest at
 *    the core, a gravity well), drawn entirely by its shader in polar
 *    coordinates. Spiral arms wound by a logarithmic twist and turning
 *    with differential rotation -- the inside spins much faster than the
 *    outside, so the arms visibly wind inwards and never repeat -- white-hot
 *    at the inner edge, through violet and indigo to a deep purple that
 *    fades to nothing at the rim. Faint specks, like stars caught in the
 *    swirl, ride round with it. Additive, no depth write.
 *  - The glow: a soft purple halo round the core that breathes, tinted and
 *    kept faint enough that the bloom never whites out the screen.
 *  - Motion: besides the spin, the whole thing slowly tilts and precesses,
 *    so from any camera angle it reads as a body in space rather than a
 *    disc turned to face the lens; the core wobbles slightly.
 *
 * No lens distortion: it would need a screen-space pass of its own, and the
 * funnel's depth already does the job of "space bending into it".
 *
 * Built once (initBlackHole) and shown when a hole opens; dispose() frees
 * every geometry, material and texture.
 */

export const LOOK = {
  swirlRadius: 26,         // metres: the visible vortex (the no-escape line is 40)
  coreRadius: 3,           // the event horizon, as HOLE.horizon
  funnelDepth: 7,          // how far the centre sinks below the rim
  arms: 3,
  twist: 3.2,              // how tightly the arms wind (radians per e-fold of radius)
  spinInner: 3.4,          // radians a second at the horizon
  spinOuter: 0.35,         // and at the rim
  tilt: 0.32,              // radians of the slow precession
  precession: 0.21,        // radians a second round it
  glowSize: 13,
  glowPulse: [1.9, 0.12]   // rate, depth
};

const SWIRL_VERTEX = /* glsl */`
  uniform float uDepth;
  uniform float uOuter;
  varying vec2 vPlane;
  void main() {
    vPlane = position.xy;
    float r = length(position.xy) / uOuter;
    // A gravity well: the centre sinks, steepest near the horizon.
    vec3 p = position;
    p.z = -uDepth * pow(1.0 - clamp(r, 0.0, 1.0), 2.4);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const SWIRL_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uOuter;
  uniform float uInner;
  uniform float uArms;
  uniform float uTwist;
  uniform float uSpinIn;
  uniform float uSpinOut;
  uniform float uFade;
  varying vec2 vPlane;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float r = length(vPlane);
    float u = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);   // 0 at the horizon, 1 at the rim
    float a = atan(vPlane.y, vPlane.x);
    // Differential rotation: the angle each ring has turned by now. Faster
    // inside, so the arms wind inwards all the time.
    float spin = mix(uSpinIn, uSpinOut, sqrt(u)) * uTime;
    // A logarithmic spiral, turning with it.
    float phase = a * uArms + uTwist * uArms * log(max(r, 0.01) / uInner) - spin * uArms;
    float arm = 0.5 + 0.5 * cos(phase);
    arm = pow(arm, 2.2);
    // Turbulence carried round with the flow, so the arms are ragged.
    float swirlA = a - spin + uTwist * log(max(r, 0.01) / uInner);
    vec2 q = vec2(cos(swirlA), sin(swirlA)) * (2.0 + u * 6.0);
    float grain = noise(q * 2.3 + vec2(u * 7.0, 0.0)) * 0.6 + noise(q * 5.1) * 0.4;
    float density = arm * (0.55 + 0.75 * grain) + 0.12 * grain;

    // White-hot inside, violet, indigo, deep purple, gone at the rim.
    vec3 hot = vec3(1.9, 1.75, 2.1);
    vec3 violet = vec3(1.25, 0.45, 2.1);
    vec3 indigo = vec3(0.42, 0.22, 1.25);
    vec3 deep = vec3(0.22, 0.05, 0.45);
    vec3 colour = mix(hot, violet, smoothstep(0.0, 0.12, u));
    colour = mix(colour, indigo, smoothstep(0.18, 0.55, u));
    colour = mix(colour, deep, smoothstep(0.55, 0.95, u));
    float alpha = density * (1.0 - smoothstep(0.62, 1.0, u)) * smoothstep(0.0, 0.04, u);
    // A brighter inner edge, where the matter goes in.
    alpha += (1.0 - smoothstep(0.0, 0.07, u)) * 0.4;

    // Specks: sparse points in a polar grid that turns with the flow.
    vec2 cell = vec2(swirlA * 9.0, u * 38.0);
    vec2 id = floor(cell);
    float star = step(0.93, hash(id));
    float d = length(fract(cell) - 0.5);
    float speck = star * smoothstep(0.22, 0.0, d) * (1.0 - u) * 1.6;

    vec3 outColour = colour * alpha + vec3(1.6, 1.4, 2.0) * speck;
    gl_FragColor = vec4(outColour * uFade, 1.0);
  }
`;

/**
 * A soft radial glow for the halo.
 * @returns {THREE.CanvasTexture}
 */
function glowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(210,170,255,0.75)');
  grad.addColorStop(0.45, 'rgba(120,60,220,0.28)');
  grad.addColorStop(1, 'rgba(40,0,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {THREE.Scene} scene
 * @returns {{
 *   group: THREE.Group,
 *   update: (t: number, size: number) => void,
 *   dispose: () => void
 * }}
 */
export function createBlackHoleLook(scene) {
  const group = new THREE.Group();
  group.name = 'black_hole';
  group.visible = false;
  // The tilt and the precession: the disc lies in this group's xy plane.
  const body = new THREE.Group();
  group.add(body);

  const swirlMat = new THREE.ShaderMaterial({
    vertexShader: SWIRL_VERTEX,
    fragmentShader: SWIRL_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uOuter: { value: LOOK.swirlRadius },
      uInner: { value: LOOK.coreRadius * 0.95 },
      uArms: { value: LOOK.arms },
      uTwist: { value: LOOK.twist },
      uSpinIn: { value: LOOK.spinInner },
      uSpinOut: { value: LOOK.spinOuter },
      uDepth: { value: LOOK.funnelDepth },
      uFade: { value: 1 }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const swirl = new THREE.Mesh(new THREE.RingGeometry(LOOK.coreRadius * 0.95, LOOK.swirlRadius, 128, 24), swirlMat);
  swirl.name = 'black_hole_swirl';
  swirl.frustumCulled = false;
  swirl.renderOrder = 1;
  body.add(swirl);

  // The horizon: black, unlit, a touch in front of the swirl's deepest point.
  // Drawn after the swirl and the halo (transparent, a later renderOrder),
  // so it blots out the light behind it -- additive light piled up in front
  // of an opaque black ball had washed it out to a white blob.
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(LOOK.coreRadius, 32, 20), coreMat);
  core.name = 'black_hole_core';
  core.renderOrder = 3;
  core.position.z = -LOOK.funnelDepth * 0.82;
  body.add(core);

  // The halo, round the core.
  const glowMap = glowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowMap, color: new THREE.Color(0.75, 0.45, 1.25), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7
  });
  const glow = new THREE.Sprite(glowMat);
  glow.name = 'black_hole_glow';
  glow.renderOrder = 2;
  body.add(glow);
  glow.position.copy(core.position);

  scene.add(group);

  /**
   * @param {number} t seconds since it opened
   * @param {number} size 0..1 opening / closing
   * @returns {void}
   */
  function update(t, size) {
    swirlMat.uniforms.uTime.value = t;
    swirlMat.uniforms.uFade.value = size;
    // Lying roughly flat (the disc's plane is the group's xy, turned down),
    // tilted and precessing round the vertical.
    const tiltA = LOOK.tilt * (0.75 + 0.25 * Math.sin(t * 0.37));
    body.rotation.set(-Math.PI / 2 + Math.cos(t * LOOK.precession) * tiltA, 0, 0);
    group.rotation.set(0, t * LOOK.precession, Math.sin(t * LOOK.precession) * tiltA);
    // The core wobbles; the halo breathes.
    const [rate, depth] = LOOK.glowPulse;
    const pulse = 1 + depth * Math.sin(t * rate) + depth * 0.5 * Math.sin(t * rate * 2.7);
    core.position.set(Math.sin(t * 3.1) * 0.18, Math.cos(t * 2.3) * 0.18, -LOOK.funnelDepth * 0.82);
    glow.position.copy(core.position);
    glow.scale.setScalar(LOOK.glowSize * pulse * size);
    glowMat.opacity = 0.55 + 0.15 * Math.sin(t * rate);
    group.scale.setScalar(Math.max(0.01, size));
  }

  /** @returns {void} */
  function dispose() {
    scene.remove(group);
    swirl.geometry.dispose();
    swirlMat.dispose();
    core.geometry.dispose();
    coreMat.dispose();
    glowMat.dispose();
    glowMap.dispose();
  }

  return { group, update, dispose };
}
