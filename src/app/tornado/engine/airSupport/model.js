// @ts-check
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * ===========================================================================
 * SECTION AS.2 — GHOST flight: the fighter and its cloak
 * ===========================================================================
 * A fifth-generation stealth fighter in the American style: a faceted,
 * chined nose, diamond wings, twin tails canted outwards, square nozzles
 * and a gold-tinted canopy, in air-superiority grey. About life size
 * (19 m long, 14 m across). Local axes: +z forward, +y up.
 *
 * The cloak. Each jet's skin and canopy have a cut along the fuselage
 * (`uReveal`, in local z): behind it the jet is solid, ahead of it it is
 * gone. Sweeping the cut from tail to nose materialises it, back again
 * makes it vanish, with a cyan scan line burning along the edge (`uEdge`)
 * and a ragged, flickering front. Where the skin is gone a glassy shell
 * (fresnel rim, ripples running down the body) is left: a heat-haze ghost
 * you can just make out against the sky, the way a cloaked ship reads in
 * films. A handful of draw calls per jet, no shadows (it flies at 90 m).
 */

/** Half the fighter's length, plus a margin: the cut runs from -REACH (gone) to +REACH (all there). */
export const REACH = 10.6;

const CLOAK_VERTEX_HEAD = 'varying vec3 vCloakLocal;\n';
const CLOAK_FRAGMENT_HEAD = `
varying vec3 vCloakLocal;
uniform float uReveal;
uniform float uEdge;
uniform float uTime;
float cloakFront() {
  // A ragged front that flickers: the cut is not a clean plane.
  return vCloakLocal.z - uReveal
    + 0.35 * sin(vCloakLocal.x * 3.7 + uTime * 11.0) * sin(vCloakLocal.y * 9.0 - uTime * 7.0)
    + 0.18 * sin(vCloakLocal.x * 13.0 - uTime * 23.0);
}
`;

/**
 * Makes a lit material cloakable: fragments ahead of the cut are discarded,
 * the cut itself glows.
 * @param {THREE.MeshStandardMaterial} material
 * @param {{uReveal: {value: number}, uEdge: {value: number}, uTime: {value: number}}} uniforms
 * @returns {THREE.MeshStandardMaterial}
 */
function cloakable(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uniforms.uReveal;
    shader.uniforms.uEdge = uniforms.uEdge;
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = CLOAK_VERTEX_HEAD + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vCloakLocal = position;'
    );
    shader.fragmentShader = CLOAK_FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  float cloakEdge = cloakFront();\n  if (cloakEdge > 0.0) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3(0.35, 0.9, 1.0) * 4.0 * uEdge * (1.0 - smoothstep(0.0, 0.8, -cloakEdge));');
  };
  material.customProgramCacheKey = () => 'ghost-cloak';
  return material;
}

const SHELL_VERTEX = `
varying vec3 vCloakLocal;
varying vec3 vNormalView;
varying vec3 vViewDir;
void main() {
  vCloakLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FRAGMENT = `
${CLOAK_FRAGMENT_HEAD}
uniform float uShell;
varying vec3 vNormalView;
varying vec3 vViewDir;
void main() {
  float cloakEdge = cloakFront();
  if (cloakEdge < 0.0 || uShell <= 0.001) discard;
  float rim = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir))), 2.2);
  float ripple = 0.55 + 0.45 * sin(vCloakLocal.z * 2.4 - uTime * 9.0 + vCloakLocal.x * 0.8);
  float a = uShell * (rim * 0.75 + 0.04) * ripple;
  gl_FragColor = vec4(vec3(0.62, 0.86, 1.0) * a, a);
}
`;

/**
 * A flat outline in the shape plane, extruded and laid down: x stays x,
 * the outline's y becomes z (forward), thickness goes down.
 * @param {number[][]} points
 * @param {number} depth
 * @returns {THREE.BufferGeometry}
 */
function flatPanel(points, depth) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A four-sided (faceted) section of fuselage along z, from `zFront` to
 * `zBack`, flattened into a chine.
 * @param {number} rFront
 * @param {number} rBack
 * @param {number} zFront
 * @param {number} zBack
 * @param {number} wide x scale
 * @param {number} tall y scale
 * @returns {THREE.BufferGeometry}
 */
function facet(rFront, rBack, zFront, zBack, wide, tall) {
  const g = new THREE.CylinderGeometry(rFront, rBack, zFront - zBack, 4, 1);
  g.rotateX(Math.PI / 2);
  g.scale(wide, tall, 1);
  g.translate(0, 0, (zFront + zBack) / 2);
  return g;
}

/**
 * The shared geometries of the fighter (every jet uses the same ones).
 * @returns {{body: THREE.BufferGeometry, canopy: THREE.BufferGeometry, flame: THREE.BufferGeometry,
 *   core: THREE.BufferGeometry, light: THREE.BufferGeometry, collar: THREE.BufferGeometry,
 *   wingtips: THREE.Vector3[], nozzles: THREE.Vector3[], pylons: THREE.Vector3[], tail: THREE.Vector3, muzzle: THREE.Vector3}}
 */
export function buildFighterGeometry() {
  const parts = [
    // Fuselage: the chined nose, the middle, the wide twin-engine tail.
    facet(0.06, 1.1, 9.6, 3.4, 1.45, 0.62),
    facet(1.1, 1.3, 3.4, -5.0, 1.6, 0.66),
    facet(1.3, 1.0, -5.0, -9.2, 1.75, 0.6),
    // The intakes either side of the cockpit.
    new THREE.BoxGeometry(0.85, 0.9, 4.6).translate(1.55, -0.12, 0.9),
    new THREE.BoxGeometry(0.85, 0.9, 4.6).translate(-1.55, -0.12, 0.9),
    // Diamond wings (leading edges swept back, trailing edges forward).
    flatPanel([[1.0, 2.3], [6.9, -3.9], [6.9, -5.1], [2.6, -4.2], [1.0, -4.8]], 0.2).translate(0, 0.05, 0),
    flatPanel([[-1.0, 2.3], [-6.9, -3.9], [-6.9, -5.1], [-2.6, -4.2], [-1.0, -4.8]], 0.2).translate(0, 0.05, 0),
    // Tailplanes.
    flatPanel([[1.0, -6.2], [4.5, -8.4], [4.5, -9.4], [1.0, -9.0]], 0.16),
    flatPanel([[-1.0, -6.2], [-4.5, -8.4], [-4.5, -9.4], [-1.0, -9.0]], 0.16),
    // Square nozzles.
    new THREE.BoxGeometry(0.95, 0.62, 1.1).translate(0.72, 0, -9.6),
    new THREE.BoxGeometry(0.95, 0.62, 1.1).translate(-0.72, 0, -9.6)
  ];
  // Twin tails, canted outwards.
  for (const side of [-1, 1]) {
    const fin = new THREE.Shape([
      new THREE.Vector2(-5.4, 0.4), new THREE.Vector2(-8.1, 3.9), new THREE.Vector2(-9.4, 3.9), new THREE.Vector2(-9.3, 0.4)
    ]);
    const g = new THREE.ExtrudeGeometry(fin, { depth: 0.16, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    g.rotateZ(-side * 0.47);
    g.translate(side * 1.5, 0.2, 0);
    parts.push(g);
  }
  const body = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    g.deleteAttribute('uv');
    return g;
  }), false);
  body.computeVertexNormals();
  for (const g of parts) g.dispose();

  const canopy = new THREE.SphereGeometry(0.72, 16, 10);
  canopy.scale(0.85, 0.7, 3.1);
  canopy.translate(0, 0.55, 4.7);

  // The afterburner: an open cone pointing back, base at the nozzle; a
  // shorter, brighter core inside it.
  const flame = new THREE.ConeGeometry(0.42, 3.4, 12, 1, true);
  flame.rotateX(-Math.PI / 2);
  flame.translate(0, 0, -1.7);
  const core = new THREE.ConeGeometry(0.25, 1.6, 10, 1, true);
  core.rotateX(-Math.PI / 2);
  core.translate(0, 0, -0.8);
  const light = new THREE.SphereGeometry(0.16, 8, 6);
  // The vapour cone of a transonic pass: an open cone round the middle.
  const collar = new THREE.ConeGeometry(3.4, 7, 24, 1, true);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 0, 0.5);
  return {
    body, canopy, flame, core, light, collar,
    wingtips: [new THREE.Vector3(6.9, 0.05, -4.5), new THREE.Vector3(-6.9, 0.05, -4.5)],
    nozzles: [new THREE.Vector3(0.72, 0, -10.2), new THREE.Vector3(-0.72, 0, -10.2)],
    pylons: [new THREE.Vector3(2.4, -0.45, -0.6), new THREE.Vector3(-2.4, -0.45, -0.6)],
    tail: new THREE.Vector3(0, 4.0, -9.0),
    muzzle: new THREE.Vector3(1.3, 0.35, 3.0)
  };
}

/**
 * One fighter: its own cloak uniforms and materials (they are per jet), the
 * shared geometries, and the shared glow materials.
 * @param {ReturnType<typeof buildFighterGeometry>} geo
 * @param {{flame: THREE.Material, core: THREE.Material, red: THREE.Material, green: THREE.Material, strobe: THREE.Material}} glow
 * @returns {{group: THREE.Group, uniforms: {uReveal: {value: number}, uEdge: {value: number}, uTime: {value: number}, uShell: {value: number}},
 *   materials: THREE.Material[], flames: THREE.Object3D[], lights: THREE.Object3D[], strobe: THREE.Object3D, collar: THREE.Mesh}}
 */
export function buildFighter(geo, glow) {
  const uniforms = { uReveal: { value: -REACH }, uEdge: { value: 0 }, uTime: { value: 0 }, uShell: { value: 0 } };
  const skin = cloakable(new THREE.MeshStandardMaterial({ color: 0x6b737d, roughness: 0.55, metalness: 0.45, flatShading: true }), uniforms);
  const glass = cloakable(new THREE.MeshStandardMaterial({ color: 0xd8a640, roughness: 0.12, metalness: 0.95, emissive: 0x2a1a00 }), uniforms);
  const shell = new THREE.ShaderMaterial({
    uniforms, vertexShader: SHELL_VERTEX, fragmentShader: SHELL_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const collarMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  });
  const group = new THREE.Group();
  group.name = 'ghostFighter';
  const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    return mesh;
  };
  add(geo.body, skin);
  add(geo.canopy, glass);
  add(geo.body, shell).renderOrder = 2;
  /** @type {THREE.Object3D[]} */
  const flames = [];
  for (const n of geo.nozzles) {
    const f = add(geo.flame, glow.flame);
    f.position.copy(n);
    const c = add(geo.core, glow.core);
    c.position.copy(n);
    flames.push(f, c);
  }
  const red = add(geo.light, glow.red);
  red.position.copy(geo.wingtips[1]);
  const green = add(geo.light, glow.green);
  green.position.copy(geo.wingtips[0]);
  const strobe = add(geo.light, glow.strobe);
  strobe.position.copy(geo.tail);
  const collar = add(geo.collar, collarMat);
  collar.visible = false;
  return { group, uniforms, materials: [skin, glass, shell, collarMat], flames, lights: [red, green], strobe, collar };
}
