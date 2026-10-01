// @ts-check
import * as THREE from 'three';
import { FLOOD, CREST_PROFILE } from './config.js';

/**
 * ===========================================================================
 * SECTION FL.3 — The flood water's look
 * ===========================================================================
 * The water used to be a pale translucent blue: you saw the streets through
 * it and it read as a sheet of tinted glass. Now it is flood water:
 *
 *  - **Opaque**, written to the depth buffer like anything solid, so what is
 *    under it is hidden: a car half under shows only its roof.
 *  - **Murky**: silt brown in the shallows and the churned front, a dark
 *    green-blue where it is deep (FLOOD.waterColour / deepColour).
 *  - **Lit**: the sun's light on its slopes, a fresnel reflection of the sky
 *    that takes over at grazing angles, and a hard sun glint.
 *  - **Moving**: two scrolled samples of a tiling normal map (made here
 *    once, from periodic noise, so it tiles with no seam) ripple the surface
 *    downstream on top of the chop the vertex shader puts in it.
 *  - **Foam**: on the wave's face and lip, on the chop's crests, and in a
 *    ring round every building standing in the water, trailing a wake
 *    downstream (FLOOD.obstacles of them, nearest the front first, passed as
 *    uniforms by flood/water.js).
 *
 * Two meshes share it, both shaped entirely in the vertex shader from the
 * same uniforms, so the surge costs uniform writes and no remeshing:
 *  - the body: a grid laid from the dam to the back of the wave, fanned out
 *    to the corridor's width at each x, shoaling to the ground at its edges;
 *  - the crest: CREST_PROFILE swept across the corridor -- up the face, a
 *    plunging lip, over the top and down onto the body -- bowed forward in
 *    the middle, and tapering to nothing at the sides.
 */

const COMMON = /* glsl */`
  uniform float uTime;
  uniform float uFrontX;
  uniform float uDamX;
  uniform float uEndX;
  uniform float uSpreadDam;
  uniform float uSpreadEnd;
  uniform float uDepth;
  uniform float uCrest;
  uniform float uBow;
  uniform float uAmp;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vFoam;
  varying float vDeep;

  float spreadAt(float x) {
    float t = clamp((x - uDamX) / (uEndX - uDamX), 0.0, 1.0);
    return mix(uSpreadDam, uSpreadEnd, t);
  }
  // Crossing sine trains and a long swell: cheap, seamless, periodic.
  float chop(vec2 p, float t) {
    return sin(p.x * 0.22 - t * 3.1) * 0.5
         + sin(p.y * 0.31 - t * 2.3) * 0.38
         + sin((p.x + p.y) * 0.13 - t * 1.7) * 0.62
         + sin(p.x * 0.055 - t * 1.1) * 1.0;
  }
  float edgeOf(float a) {
    return 1.0 - smoothstep(0.78, 1.0, abs(a));
  }
`;

const BODY_VERTEX = /* glsl */`
  #include <fog_pars_vertex>
  ${COMMON}
  float bodyHeight(vec2 p) {
    float a = p.y / spreadAt(p.x);
    float e = edgeOf(a);
    return (uDepth + chop(p, uTime) * uAmp) * e - (1.0 - e) * 0.5;
  }
  void main() {
    float along = position.x + 0.5;
    float a = position.y * 2.0;
    float bodyEnd = max(uDamX + 2.0, uFrontX - uBow * a * a - ${(1.6 * 0.98).toFixed(3)} * uCrest);
    float x = mix(uDamX + 2.0, bodyEnd, along);
    float z = a * spreadAt(x);
    vec2 p = vec2(x, z);
    float h = bodyHeight(p);
    float hx = bodyHeight(p + vec2(1.0, 0.0));
    float hz = bodyHeight(p + vec2(0.0, 1.0));
    vNormal = normalize(vec3(h - hx, 1.0, h - hz));
    vec3 world = vec3(x, h, z);
    vWorld = world;
    float w = chop(p, uTime);
    float e = edgeOf(a);
    // Froth on the chop's crests, and the shallows at the edges churned up.
    vFoam = clamp(max(w - 0.9, 0.0) * 0.3 + (1.0 - e) * 0.1, 0.0, 1.0);
    vDeep = 0.75 * e * clamp(uDepth / 9.0, 0.0, 1.0);
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const CREST_VERTEX = /* glsl */`
  #include <fog_pars_vertex>
  ${COMMON}
  void main() {
    float a = position.z;
    float toe = uFrontX - uBow * a * a;
    float sp = spreadAt(toe);
    float e = edgeOf(a);
    float up = clamp(position.y, 0.0, 1.1);
    float yRaw = position.y < 0.0 ? uDepth : position.y * uCrest;
    float x = toe + position.x * uCrest;
    float w = chop(vec2(x, a * sp), uTime);
    // Churned hardest at the top: the lip boils forward and back.
    x += (w * 0.9 + sin(uTime * 4.0 + a * 9.0) * 0.6) * up * up;
    x = max(x, uDamX + 1.0);
    float y = (yRaw + w * uAmp * (0.4 + up)) * e - (1.0 - e) * 0.5;
    vec3 world = vec3(x, y, a * sp);
    vWorld = world;
    vNormal = normalize(normal);
    // White on the face's upper half and the lip, streaked by the chop.
    float face = position.x > -0.2 ? 1.0 : 0.35;
    vFoam = clamp((smoothstep(0.35, 0.95, up) * face + max(w, 0.0) * 0.18) * e, 0.0, 1.0);
    vDeep = 0.25 * e;
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */`
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColour;
  uniform float uLight;
  uniform float uFoamBoost;
  uniform sampler2D uNormalMap;
  uniform vec4 uObstacles[${FLOOD.obstacles}];
  uniform float uObstacleCount;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vFoam;
  varying float vDeep;

  void main() {
    vec2 p = vWorld.xz;
    // Ripples running downstream (+x), two scales crossing.
    vec4 s1 = texture2D(uNormalMap, p * 0.045 + vec2(-uTime * 0.11, uTime * 0.017));
    vec4 s2 = texture2D(uNormalMap, p * 0.12 + vec2(-uTime * 0.26, -uTime * 0.04));
    vec2 ripple = (s1.xy * 2.0 - 1.0) + (s2.xy * 2.0 - 1.0) * 0.6;
    vec3 n = normalize(normalize(vNormal) + vec3(ripple.x, 0.0, ripple.y) * 0.5);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uSky * 0.85, uSky * 1.2 + vec3(0.04, 0.06, 0.09), clamp(R.y, 0.0, 1.0));
    float glint = pow(max(dot(R, uSunDir), 0.0), 160.0) * 0.7 + pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.05;

    // The water itself: lit silt.
    vec3 base = mix(uShallow, uDeep, vDeep);
    float diffuse = 0.5 + 0.5 * max(dot(n, uSunDir), 0.0);
    vec3 colour = base * diffuse * uLight;
    colour = mix(colour, sky * uLight, fres * 0.7) + uSunColour * glint * uLight;

    // Foam: the wave's, and a ring round each building in the water with a
    // wake trailing downstream.
    float foam = vFoam;
    for (int i = 0; i < ${FLOOD.obstacles}; i++) {
      if (float(i) >= uObstacleCount) break;
      vec4 o = uObstacles[i];
      vec2 d = p - o.xy;
      float down = max(d.x, 0.0);
      float dist = length(vec2(d.x - down * 0.75, d.y)) - o.z - down * 0.12;
      foam += smoothstep(3.0, 0.0, dist) * exp(-down / 22.0) * o.w * 0.65;
    }
    float grain = s1.w * 0.6 + s2.w * 0.4;
    float mask = smoothstep(0.32, 0.72, foam * (0.55 + 0.9 * grain) * uFoamBoost);
    colour = mix(colour, uFoam * uLight * (0.6 + 0.25 * diffuse), mask * 0.9);

    gl_FragColor = vec4(colour, 1.0);
    #include <fog_fragment>
  }
`;

/**
 * A tiling normal map (xy: the slope, z: up) with a noise channel in alpha
 * for the foam's grain, from a sum of periodic waves with seeded phases --
 * so it tiles exactly, and draws nothing from Math.random (the benchmark's
 * fingerprint).
 * @returns {THREE.DataTexture}
 */
export function createRippleTexture() {
  const size = 128;
  let seed = 9173;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  /** @type {{kx: number, kz: number, phase: number, amp: number}[]} */
  const waves = [];
  for (let i = 0; i < 18; i++) {
    const k = 1 + Math.floor(rand() * 7);
    const angle = rand() * Math.PI * 2;
    waves.push({
      kx: Math.round(Math.cos(angle) * k), kz: Math.round(Math.sin(angle) * k),
      phase: rand() * Math.PI * 2, amp: 1 / (0.6 + k)
    });
  }
  const height = new Float32Array(size * size);
  const grain = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * Math.PI * 2;
      const v = (j / size) * Math.PI * 2;
      let h = 0;
      let g = 0;
      for (const w of waves) {
        h += Math.sin(u * w.kx + v * w.kz + w.phase) * w.amp;
        g += Math.sin(u * (w.kx * 2 + 1) + v * (w.kz * 2 - 1) + w.phase * 1.7) * w.amp;
      }
      height[j * size + i] = h;
      grain[j * size + i] = g;
    }
  }
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const g of grain) { gMin = Math.min(gMin, g); gMax = Math.max(gMax, g); }
  const data = new Uint8Array(size * size * 4);
  const at = (/** @type {number} */ i, /** @type {number} */ j) => height[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * 1.4;
      const dz = (at(i, j + 1) - at(i, j - 1)) * 1.4;
      const len = Math.hypot(dx, dz, 1);
      const k = (j * size + i) * 4;
      data[k] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((-dz / len * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[k + 3] = Math.round(((grain[j * size + i] - gMin) / (gMax - gMin)) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The crest's mesh: CREST_PROFILE swept across the corridor. Positions are
 * kept in profile units (x, y: fractions of the crest height, y -1 for the
 * point that lands on the body; z: -1..1 across), which the vertex shader
 * scales; the normals are worked out once on a wave of typical size.
 * @returns {THREE.BufferGeometry}
 */
export function createCrestGeometry() {
  const across = 64;
  const rows = CREST_PROFILE.length;
  const H = 20;
  const halfWidth = 60;
  const unit = [];
  const metres = [];
  for (let r = 0; r < rows; r++) {
    const [dx, h] = CREST_PROFILE[r];
    const last = r === rows - 1;
    for (let c = 0; c <= across; c++) {
      const a = (c / across) * 2 - 1;
      unit.push(dx, last ? -1 : h, a);
      metres.push(dx * H, (last ? FLOOD.depth / H : h) * H, a * halfWidth);
    }
  }
  const index = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < across; c++) {
      const i0 = r * (across + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + across + 1;
      const i3 = i2 + 1;
      index.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(metres, 3));
  geometry.computeVertexNormals();
  // Facing out of the water (up and forward), whichever way the winding went.
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) {
    if (normals.getY(i) < -0.2) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(unit, 3));
  return geometry;
}

/**
 * The material, for the body or the crest. UniformsUtils.merge clones its
 * inputs, so the shared texture and obstacle list are put in afterwards:
 * both materials read the same ones.
 * @param {'body'|'crest'} part
 * @param {THREE.Texture} ripples createRippleTexture's
 * @param {THREE.Vector4[]} obstacles FLOOD.obstacles of them, (x, z, radius, strength)
 * @returns {THREE.ShaderMaterial}
 */
export function createWaterMaterial(part, ripples, obstacles) {
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uFrontX: { value: FLOOD.damX },
        uDamX: { value: FLOOD.damX },
        uEndX: { value: FLOOD.endX },
        uSpreadDam: { value: FLOOD.spreadAtDam },
        uSpreadEnd: { value: FLOOD.spreadAtEnd },
        uDepth: { value: FLOOD.depth },
        uCrest: { value: FLOOD.crestHeight },
        uBow: { value: FLOOD.frontBow },
        uAmp: { value: FLOOD.waveAmp },
        uShallow: { value: new THREE.Color(FLOOD.waterColour) },
        uDeep: { value: new THREE.Color(FLOOD.deepColour) },
        uFoam: { value: new THREE.Color(FLOOD.foamColour) },
        uSky: { value: new THREE.Color(0x9fb4c4) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
        uSunColour: { value: new THREE.Color(1, 0.95, 0.85) },
        uLight: { value: 1 },
        uFoamBoost: { value: 1 },
        uNormalMap: { value: null },
        uObstacleCount: { value: 0 }
      }
    ]),
    vertexShader: part === 'crest' ? CREST_VERTEX : BODY_VERTEX,
    fragmentShader: FRAGMENT
  });
  material.uniforms.uNormalMap = { value: ripples };
  material.uniforms.uObstacles = { value: obstacles };
  return material;
}
