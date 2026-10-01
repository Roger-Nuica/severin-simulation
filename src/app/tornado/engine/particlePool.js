// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * Shared: pooled point particles with per-particle size and colour/alpha
 * ===========================================================================
 * Used by the chase car's burning tyres (chase/tireFire.js) and the
 * drifting embers (weather.js). The stock PointsMaterial has one size and
 * one opacity for the whole system; this small shader takes both per
 * particle, so particles can grow, shrink and fade independently -- smoke
 * that billows, embers that flicker. One draw call per pool, and every
 * buffer is allocated once up front.
 */

const PARTICLE_VERTEX = /* glsl */`
  attribute vec4 aColour;
  attribute float aSize;
  uniform float uScale;
  varying vec4 vColour;
  #include <fog_pars_vertex>
  void main() {
    vColour = aColour;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = aSize * uScale / max( -mvPosition.z, 0.1 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const PARTICLE_FRAGMENT = /* glsl */`
  uniform sampler2D uMap;
  varying vec4 vColour;
  #include <fog_pars_fragment>
  void main() {
    vec4 tex = texture2D( uMap, gl_PointCoord );
    float a = vColour.a * tex.a;
    #ifdef ALPHA_FROM_GREEN
      // The texture as its own alpha map too, the way PointsMaterial's
      // alphaMap reads it (green channel).
      a *= tex.g;
    #endif
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( vColour.rgb * tex.rgb, a );
    #include <fog_fragment>
  }
`;

/**
 * @typedef {Object} ParticlePool
 * @property {THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>} points
 * @property {Float32Array} positions
 * @property {Float32Array} velocities
 * @property {Float32Array} colours rgba per particle
 * @property {Float32Array} sizes world-space size per particle
 * @property {Float32Array} life remaining seconds; <= 0 means free
 * @property {Float32Array} maxLife
 * @property {Float32Array} seed per-particle random in [0, 1)
 * @property {number} next ring-buffer cursor
 * @property {number} accumulator fractional particles owed to the emitter
 */

/**
 * Creates a pool and adds its Points to the scene.
 * @param {THREE.Scene} scene
 * @param {number} count
 * @param {THREE.Texture} map
 * @param {THREE.Blending} blending
 * @param {string} name
 * @param {{alphaFromGreen?: boolean}} [options] alphaFromGreen: the texture is
 *   its own alpha map as well (as PointsMaterial with map and alphaMap both
 *   set to it), for effects moved over from PointsMaterial unchanged
 * @returns {ParticlePool}
 */
export function createParticlePool(scene, count, map, blending, name, options = {}) {
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uMap: { value: null }, uScale: { value: 1 } }
    ]),
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending,
    fog: true,
    defines: options.alphaFromGreen ? { ALPHA_FROM_GREEN: '' } : {}
  });
  material.uniforms.uMap.value = map;
  const points = new THREE.Points(geometry, material);
  points.name = name;
  // World-space positions spread wherever the emitter has been, so bounds
  // computed from the buffer would be stale immediately.
  points.frustumCulled = false;
  scene.add(points);
  return {
    points, positions, colours, sizes,
    velocities: new Float32Array(count * 3),
    life: new Float32Array(count),
    maxLife: new Float32Array(count),
    seed: new Float32Array(count),
    next: 0,
    accumulator: 0
  };
}

const sizeScratch = new THREE.Vector2();

/**
 * Pixels per world unit at distance 1 for the current canvas and camera,
 * which is what turns a particle's world size into a gl_PointSize.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.PerspectiveCamera} camera
 * @returns {number}
 */
export function pointScaleFor(renderer, camera) {
  return renderer.getDrawingBufferSize(sizeScratch).y * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
}

/**
 * Flags a pool's buffers for upload after the caller has written them.
 * @param {ParticlePool} pool
 * @returns {void}
 */
export function markPoolDirty(pool) {
  const attrs = pool.points.geometry.attributes;
  attrs.position.needsUpdate = true;
  attrs.aColour.needsUpdate = true;
  attrs.aSize.needsUpdate = true;
}

/**
 * Removes a pool from the scene and frees its GPU resources (the texture
 * included, which each pool owns).
 * @param {THREE.Scene} scene
 * @param {ParticlePool} pool
 * @returns {void}
 */
export function disposeParticlePool(scene, pool) {
  scene.remove(pool.points);
  pool.points.geometry.dispose();
  pool.points.material.uniforms.uMap.value.dispose();
  pool.points.material.dispose();
}
