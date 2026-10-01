// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION PB.1 — The black hole's look
 * ===========================================================================
 * It used to be a black ball inside two flat yellow rings: Saturn, not a
 * hole in space. Now it is a living vortex:
 *
 *  - The core: a black sphere with volume, not a flat disc -- a thin
 *    fresnel rim (the "rim" mesh) lights its silhouette edge from every
 *    angle, white through violet, which doubles as the photon ring: light
 *    grazing the horizon, the brightest single line in the whole effect.
 *  - The swirl: one mesh, a ring shaped into a shallow funnel (deepest at
 *    the core, a gravity well), drawn entirely by its shader in polar
 *    coordinates -- the accretion disk. Spiral arms wound by a logarithmic
 *    twist and turning with differential rotation -- the inside spins much
 *    faster than the outside, so the arms visibly wind inwards and never
 *    repeat -- white-hot at the inner edge, through violet and indigo to a
 *    deep purple that fades to nothing at the rim. Doppler beaming shades
 *    one side brighter than the other as it turns (uViewLocal, the camera's
 *    direction in the disk's own tilted local space, recomputed every
 *    frame). Faint specks, like stars caught in the swirl, ride round with
 *    it. Additive, no depth write.
 *  - The glow: a soft purple halo round the core that breathes, tinted and
 *    kept faint enough that the bloom never whites out the screen.
 *  - The dark halo: a soft, normal-blended (not additive) dark sprite a
 *    little wider than the swirl, drawn first so everything else layers on
 *    top of it -- the one place in this additive scene something can
 *    actually dim the background behind it rather than only add light.
 *  - Motion: besides the spin, the whole thing slowly tilts and precesses,
 *    so from any camera angle it reads as a body in space rather than a
 *    disc turned to face the lens, and so the disk is seen edge-on enough
 *    for the screen-space lensing pass (engine/post.js) to visibly bend it
 *    over the top and under the bottom of the core, Interstellar-style; the
 *    core wobbles slightly.
 *
 * The screen-space bend itself is engine/post.js's job (lensSample(),
 * driven by blackHole.js's lensInfo()) -- this file only has to put a
 * tilted, volumetric body in the world for that pass to bend.
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
  glowPulse: [1.9, 0.12],  // rate, depth
  rimPower: 2.4,           // fresnel falloff: higher keeps the ring thinner
  rimSize: 1.1,            // x coreRadius
  doppler: 0.6,            // peak brightness swing between the disk's two sides
  haloSize: 34,            // metres across, the dark halo sprite
  haloDarken: 0.35         // its peak darkening (opacity, normal-blended)
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
  uniform vec2 uViewLocal;
  uniform float uDoppler;
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

    // Doppler beaming: the side turning towards the camera (its tangent
    // pointing the same way as the camera, in the disk's own tilted local
    // space) reads brighter, the receding side dimmer -- what sells the
    // rotation from a still frame.
    vec2 tangent = r > 0.001 ? vec2(-vPlane.y, vPlane.x) / r : vec2(0.0);
    float doppler = dot(tangent, uViewLocal);
    float beam = clamp(1.0 + uDoppler * doppler, 0.25, 1.0 + uDoppler);

    vec3 outColour = (colour * alpha + vec3(1.6, 1.4, 2.0) * speck) * beam;
    gl_FragColor = vec4(outColour * uFade, 1.0);
  }
`;

const RIM_VERTEX = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// The photon ring and the core's rim light are the same thing here: a thin
// fresnel glow at the sphere's silhouette, brightest exactly at the grazing
// edge and gone dead centre, so it reads as a bright line hugging the dark
// core from any angle rather than a lit hemisphere.
const RIM_FRAGMENT = /* glsl */`
  uniform float uPower;
  uniform vec3 uColour;
  uniform float uFade;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), uPower);
    gl_FragColor = vec4(uColour * fresnel * uFade, fresnel * uFade);
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
 * A soft dark radial gradient, opaque-ish at the centre fading to fully
 * transparent -- normal-blended rather than additive, the one piece of this
 * body that can actually dim what is behind it instead of only adding light.
 * @returns {THREE.CanvasTexture}
 */
function darkHaloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(10,4,18,0.9)');
  grad.addColorStop(0.4, 'rgba(14,6,24,0.55)');
  grad.addColorStop(0.75, 'rgba(14,6,24,0.18)');
  grad.addColorStop(1, 'rgba(14,6,24,0)');
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
 *   update: (t: number, size: number, camera?: THREE.Camera) => void,
 *   pulse: (x: number, y: number, z: number) => void,
 *   updateShockwave: (dt: number) => void,
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
      uFade: { value: 1 },
      uViewLocal: { value: new THREE.Vector2(1, 0) },
      uDoppler: { value: LOOK.doppler }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  // The dark halo: normal-blended, drawn first (lowest renderOrder) so every
  // additive thing after it (the swirl, the glow, the specks) layers on top
  // of an already-dimmed patch of background rather than the other way
  // round, which would have nothing left to darken.
  const darkMap = darkHaloTexture();
  const darkMat = new THREE.SpriteMaterial({
    map: darkMap, color: 0xffffff, transparent: true, depthWrite: false, opacity: LOOK.haloDarken
  });
  const darkHalo = new THREE.Sprite(darkMat);
  darkHalo.name = 'black_hole_dark_halo';
  darkHalo.renderOrder = 0;
  darkHalo.scale.setScalar(LOOK.haloSize);
  body.add(darkHalo);

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

  // The rim: a fresnel shell a touch bigger than the core, drawn last so it
  // sits over the core's silhouette -- the photon ring and the core's own
  // rim light in one mesh (see the header).
  const rimMat = new THREE.ShaderMaterial({
    vertexShader: RIM_VERTEX,
    fragmentShader: RIM_FRAGMENT,
    uniforms: {
      uPower: { value: LOOK.rimPower },
      uColour: { value: new THREE.Color(2.2, 1.7, 3.2) },
      uFade: { value: 1 }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });
  const rim = new THREE.Mesh(new THREE.SphereGeometry(LOOK.coreRadius * LOOK.rimSize, 32, 20), rimMat);
  rim.name = 'black_hole_rim';
  rim.renderOrder = 4;
  body.add(rim);

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
  const viewScratch = new THREE.Vector3();

  // The collapse's shockwave ring: a sibling of the body rather than one of
  // its children, so it can keep expanding and fading for its own short
  // while right after finish() has already hidden the rest. One mesh,
  // reused every time rather than made and thrown away.
  const waveMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 1.3, 2.2), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const wave = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), waveMat);
  wave.name = 'black_hole_wave';
  wave.visible = false;
  wave.rotation.x = -Math.PI / 2;
  wave.frustumCulled = false;
  scene.add(wave);
  const waveState = { active: false, t: 0, duration: 0.9, from: LOOK.coreRadius * 1.3, to: LOOK.swirlRadius * 1.5 };

  scene.add(group);

  /**
   * @param {number} t seconds since it opened
   * @param {number} size 0..1 opening / closing
   * @param {THREE.Camera} [camera] for the Doppler shading's view direction
   * @returns {void}
   */
  function update(t, size, camera) {
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
    rim.position.copy(core.position);
    rimMat.uniforms.uFade.value = size;
    darkHalo.position.copy(core.position);
    darkMat.opacity = LOOK.haloDarken * size;
    // The spawn's quick implosion: the horizon and its rim snap in from
    // oversized rather than simply growing with the rest of the body, read
    // as space itself pulled sharply inward right as it opens.
    const snap = t < 0.3 ? 1 + 2.4 * Math.pow(1 - t / 0.3, 2.5) : 1;
    core.scale.setScalar(snap);
    rim.scale.setScalar(snap);
    group.scale.setScalar(Math.max(0.01, size));
    if (camera) {
      // The disk's own tilt/precession just changed above, so its world
      // matrix is forced current here rather than waiting for the
      // renderer's own pass later this frame -- a small, local subtree,
      // not a scene-wide traversal.
      group.updateMatrixWorld(true);
      viewScratch.copy(camera.position);
      body.worldToLocal(viewScratch);
      const len = Math.hypot(viewScratch.x, viewScratch.y);
      if (len > 1e-4) swirlMat.uniforms.uViewLocal.value.set(viewScratch.x / len, viewScratch.y / len);
    }
  }

  /**
   * The collapse's shockwave: call once, from finish() (engine/player/
   * blackHole.js), as the hole winks out.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function pulse(x, y, z) {
    wave.position.set(x, y, z);
    wave.visible = true;
    waveState.active = true;
    waveState.t = 0;
  }

  /**
   * The shockwave ring's own short animation -- kept separate from update()
   * so it keeps running for its `duration` even once the hole itself (and
   * update()'s own per-frame calls) have stopped.
   * @param {number} dt
   * @returns {void}
   */
  function updateShockwave(dt) {
    if (!waveState.active) return;
    waveState.t += dt;
    const u = Math.min(1, waveState.t / waveState.duration);
    const r = waveState.from + (waveState.to - waveState.from) * (1 - Math.pow(1 - u, 2));
    wave.scale.set(r, r, 1);
    waveMat.opacity = 0.4 * (1 - u) * (1 - u);
    if (u >= 1) {
      waveState.active = false;
      wave.visible = false;
    }
  }

  /** @returns {void} */
  function dispose() {
    scene.remove(group);
    scene.remove(wave);
    swirl.geometry.dispose();
    swirlMat.dispose();
    core.geometry.dispose();
    coreMat.dispose();
    rim.geometry.dispose();
    rimMat.dispose();
    glowMat.dispose();
    glowMap.dispose();
    darkMat.dispose();
    darkMap.dispose();
    wave.geometry.dispose();
    waveMat.dispose();
  }

  return { group, update, pulse, updateShockwave, dispose };
}
