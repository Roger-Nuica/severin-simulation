// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION VC — The funnel's churn, on the graphics card
 * ===========================================================================
 * A funnel is a lathe (a surface of revolution) that writhes: every vertex
 * is pushed out from the axis, or pulled in, by a few octaves of 3D simplex
 * noise sampled through frames that spin with the vortex, then pinched by
 * the rope-out and widened by the wedge (vortex.js updateFunnelGeometry has
 * the why of each of those). That used to be done on the CPU for every
 * vertex of the funnel, the core, the dirt skirt and every sub-vortex, with
 * the normals recomputed after -- about 2 ms a frame per tornado (measured,
 * `?bench=1`), even redrawn only 30 times a second.
 *
 * It is the same sum here, in the vertex shader: the lathe keeps its rest
 * shape and the displacement is worked out per vertex, per frame, on the
 * graphics card, which does ten thousand of them in no time at all. What the
 * CPU does each frame is fill in a handful of numbers (the uniforms below):
 * each octave's rotation, amplitude, frequencies and scroll. The normal is
 * found the same way the old computeVertexNormals found it, from the
 * displaced neighbours -- here two points a small step away on the surface,
 * one around the axis and one along it.
 *
 * The noise is the usual GLSL simplex noise (Ashima Arts / Stefan Gustavson,
 * MIT), not three's SimplexNoise, so the writhe is not the identical
 * pattern, but it is the same kind at the same scales and speeds. Frame to
 * frame it is smoother than before: it no longer steps at 30 Hz.
 *
 * Nothing on the CPU reads the funnel's vertices (the physics works from the
 * vortex's own radius), so nothing else had to change. The meshes are not
 * frustum culled, since their rest bounds no longer cover them.
 */

export const CHURN_OCTAVES = 3;

const CHURN_GLSL = /* glsl */ `
uniform vec4 uChurnOct[${CHURN_OCTAVES}];
uniform vec4 uChurnScroll[${CHURN_OCTAVES}];
uniform vec4 uChurnShape;
uniform vec4 uChurnRope;
attribute float aWedge;

vec3 churnMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 churnMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 churnPermute(vec4 x) { return churnMod289(((x * 34.0) + 10.0) * x); }
vec4 churnTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float churnNoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = churnMod289(i);
  vec4 p = churnPermute(churnPermute(churnPermute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = churnTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// uChurnOct[i]    = (cos, sin of the octave's frame, amplitude, horizontal frequency)
// uChurnScroll[i] = (vertical frequency, vertical scroll, horizontal offset, -)
// uChurnShape     = (height damping, 1 / height, clamp low, clamp high)
// uChurnRope      = (rope gate, time, 1 / funnel height, wedge)
vec3 churnAt(vec3 b, float wedgeRatio) {
  float n = 0.0;
  for (int k = 0; k < ${CHURN_OCTAVES}; k++) {
    vec4 o = uChurnOct[k];
    if (o.z == 0.0) continue;
    vec4 s = uChurnScroll[k];
    float rx = b.x * o.x - b.z * o.y;
    float rz = b.x * o.y + b.z * o.x;
    n += o.z * churnNoise(vec3(rx * o.w + s.z, b.y * s.x - s.y, rz * o.w));
  }
  n *= 1.0 - uChurnShape.x * b.y * uChurnShape.y;
  float rope = 1.0;
  if (uChurnRope.x > 0.0) {
    float y = b.y;
    float hT = clamp(y * uChurnRope.z, 0.0, 1.0);
    float pinch = sin(y * 0.23 - uChurnRope.y * 1.7) * sin(y * 0.061 + uChurnRope.y * 0.53);
    rope = 1.0 + uChurnRope.x * pinch * 0.22 * (1.0 - 0.35 * hT);
  }
  float scale = clamp((1.0 + n) * rope, uChurnShape.z, uChurnShape.w) * (1.0 + uChurnRope.w * wedgeRatio);
  return vec3(b.x * scale, b.y, b.z * scale);
}
`;

/**
 * The uniforms one churned shell reads, filled in by vortex.js every frame.
 * @typedef {{
 *   uChurnOct: {value: THREE.Vector4[]},
 *   uChurnScroll: {value: THREE.Vector4[]},
 *   uChurnShape: {value: THREE.Vector4},
 *   uChurnRope: {value: THREE.Vector4}
 * }} ChurnUniforms
 */

/**
 * Makes a lathe mesh churn on the graphics card (see the header). Wraps
 * whatever onBeforeCompile the material already has (vortex.js
 * applyFunnelLook), so the two compose.
 * @param {THREE.Mesh} mesh
 * @param {(y: number) => number} [wedgeRatioAt] how much this height widens at
 *   a full wedge, as a fraction (0: not at all); baked per vertex
 * @returns {ChurnUniforms}
 */
export function installChurn(mesh, wedgeRatioAt) {
  const geo = mesh.geometry;
  const position = geo.attributes.position;
  const wedge = new Float32Array(position.count);
  if (wedgeRatioAt) {
    for (let i = 0; i < position.count; i++) wedge[i] = wedgeRatioAt(position.getY(i));
  }
  geo.setAttribute('aWedge', new THREE.BufferAttribute(wedge, 1));

  /** @type {ChurnUniforms} */
  const uniforms = {
    uChurnOct: { value: Array.from({ length: CHURN_OCTAVES }, () => new THREE.Vector4()) },
    uChurnScroll: { value: Array.from({ length: CHURN_OCTAVES }, () => new THREE.Vector4()) },
    uChurnShape: { value: new THREE.Vector4(0, 0, 0.3, 1.6) },
    uChurnRope: { value: new THREE.Vector4() }
  };

  const material = /** @type {THREE.Material} */ (mesh.material);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CHURN_GLSL}`)
      .replace('#include <beginnormal_vertex>', `
vec3 churnPosition = churnAt(position, aWedge);
vec3 objectNormal;
{
  // Two neighbours a small step away on the rest surface -- around the axis
  // and along the lathe's profile -- displaced the same way; the normal is
  // across them, turned to face the way the rest normal faced.
  float churnR = length(position.xz);
  vec3 around = churnR > 1e-4 ? vec3(-position.z, 0.0, position.x) / churnR : vec3(1.0, 0.0, 0.0);
  vec3 along = normalize(cross(normal, around));
  float churnStep = max(0.05, churnR * 0.04);
  vec3 a = churnAt(position + around * churnStep, aWedge) - churnPosition;
  vec3 b = churnAt(position + along * churnStep, aWedge) - churnPosition;
  objectNormal = normalize(cross(a, b));
  if (dot(objectNormal, normal) < 0.0) objectNormal = -objectNormal;
}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = churnPosition;');
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}-churn`;
  material.needsUpdate = true;
  mesh.frustumCulled = false;
  return uniforms;
}

/**
 * Sets one octave of a shell's churn.
 * @param {ChurnUniforms} u
 * @param {number} k octave, 0..CHURN_OCTAVES-1
 * @param {number} cos of the octave's frame angle
 * @param {number} sin of the octave's frame angle
 * @param {number} amplitude fractional displacement (0: octave off)
 * @param {number} horizontal frequency across the lathe
 * @param {number} vertical frequency up it
 * @param {number} scroll subtracted from the vertical coordinate (time x speed)
 * @param {number} [offset] added to the horizontal coordinate
 * @returns {void}
 */
export function setChurnOctave(u, k, cos, sin, amplitude, horizontal, vertical, scroll, offset = 0) {
  u.uChurnOct.value[k].set(cos, sin, amplitude, horizontal);
  u.uChurnScroll.value[k].set(vertical, scroll, offset, 0);
}
