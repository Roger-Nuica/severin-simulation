// @ts-check
import * as THREE from 'three';
import { HERO, UP, Z_AXIS } from './config.js';

/**
 * ===========================================================================
 * SECTION HM.4b — The plasma beam's look (shared by both screens)
 * ===========================================================================
 * The rifle's beam drawn as pure meshes: a core, a sheath and a halo (each a
 * long cone along +y from its base), the splash where it lands, and the
 * MEGA BEAM's rings. Taken out of `hero/plasma.js` unchanged so the host's
 * own shot and the co-op mirror (`net/mirror.js`) draw the very same beam
 * (R-061). Nothing here is gameplay: no hit, no damage, no score, no shake.
 *
 * The functions work on the meshes they are given, so the owner keeps the
 * state and the lifecycle: Hero Mode keeps them on `S.beam`, `S.beamSplash`
 * and `S.rings` (removed in `endRun`), the mirror on its own small set
 * (released with the session, R-047). Geometries and materials go through
 * `kit.keepGeo` / `kit.keepMat` so the owner disposes them.
 */

/** Seconds between one ring and the next. */
export const RING_STAGGER = 0.1;

/**
 * @typedef {{keepGeo: <G extends THREE.BufferGeometry>(g: G) => G, keepMat: <M extends THREE.Material>(m: M) => M}} BeamKit
 */

/**
 * How long the rings run in all: the first ring's life plus the stagger of the rest.
 * @returns {number}
 */
export const ringsTotal = () => HERO.megaRingSeconds + (HERO.megaRings - 1) * RING_STAGGER;

/**
 * The beam's meshes, a unit length along +y from the base, stretched and
 * pointed per frame. The group is hidden and in the scene.
 * @param {THREE.Scene} scene
 * @param {BeamKit} kit
 * @returns {{beam: THREE.Group, splash: THREE.Mesh}}
 */
export function buildBeamMeshes(scene, kit) {
  const beam = new THREE.Group();
  beam.name = 'hero_plasma';
  // Each layer a long cone, thin at the muzzle and full width at the far
  // end: a sheath as wide as the target end right in front of the eye
  // whites out the whole view.
  /**
   * @param {number} radius at the far end
   * @param {THREE.Color} colour
   * @returns {THREE.Mesh}
   */
  const layer = (radius, colour) => {
    const geo = kit.keepGeo(new THREE.CylinderGeometry(radius, radius * 0.08, 1, 16, 1, true));
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geo, kit.keepMat(new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })));
    mesh.frustumCulled = false;
    beam.add(mesh);
    return mesh;
  };
  beam.userData.layers = [
    layer(0.3, new THREE.Color(3, 4.5, 7)),       // white-hot core
    layer(0.9, new THREE.Color(0.45, 1.35, 3.75)), // blue sheath (darker)
    layer(2, new THREE.Color(0.2, 0.55, 2))       // halo
  ];
  beam.visible = false;
  beam.frustumCulled = false;
  scene.add(beam);
  const splash = new THREE.Mesh(kit.keepGeo(new THREE.SphereGeometry(1, 16, 12)), kit.keepMat(new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.5, 3.2, 8), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  })));
  splash.visible = false;
  scene.add(splash);
  return { beam, splash };
}

/**
 * Points the beam from `from` to `to`.
 * @param {THREE.Group} beam
 * @param {THREE.Vector3} from
 * @param {THREE.Vector3} to
 * @param {THREE.Vector3} scratch a vector to work in
 * @returns {void}
 */
export function placeBeamMesh(beam, from, to, scratch) {
  const dir = scratch.subVectors(to, from);
  const length = dir.length();
  beam.position.copy(from);
  beam.quaternion.setFromUnitVectors(UP, dir.divideScalar(length || 1));
  beam.scale.set(1, length, 1);
}

/**
 * One frame of the burn-out: the layers' opacity, the width and the splash.
 * (Two `Math.random` draws, in this order: the flicker, then the width.)
 * @param {THREE.Group} beam
 * @param {THREE.Mesh} splash
 * @param {number} k life left, 1 at the shot down to 0
 * @param {number} beamWidth the shot's width factor (a charged shot is wider)
 * @param {boolean} mega
 * @returns {void}
 */
export function fadeBeamMeshes(beam, splash, k, beamWidth, mega) {
  const flicker = 0.85 + 0.15 * Math.random();
  const [core, sheath, halo] = beam.userData.layers;
  core.material.opacity = Math.min(1, k * 1.6) * flicker;
  // The mega beam's wider layers are thinner, or they add up to a glare.
  const thin = mega ? 0.55 : 1;
  sheath.material.opacity = 0.8 * k * flicker * thin;
  halo.material.opacity = 0.35 * k * flicker * thin;
  // Fat at the moment it fires, drawing thin as it burns out.
  const width = (0.4 + 0.9 * k + 0.12 * Math.random()) * beamWidth;
  beam.scale.x = beam.scale.z = width;
  /** @type {THREE.MeshBasicMaterial} */ (splash.material).opacity = 0.9 * k;
  splash.scale.setScalar((1.5 + (1 - k) * 4) * (mega ? 2.5 : 1));
}

/**
 * The mega beam's rings: tori round the beam's axis, hidden and in the scene.
 * @param {THREE.Scene} scene
 * @param {BeamKit} kit
 * @returns {THREE.Mesh[]}
 */
export function buildRingMeshes(scene, kit) {
  /** @type {THREE.Mesh[]} */
  const rings = [];
  for (let i = 0; i < HERO.megaRings; i++) {
    const ring = new THREE.Mesh(kit.keepGeo(new THREE.TorusGeometry(1, 0.09, 8, 40)), kit.keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.8, 2.2, 5), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));
    ring.name = 'hero_mega_ring';
    ring.frustumCulled = false;
    ring.visible = false;
    scene.add(ring);
    rings.push(ring);
  }
  return rings;
}

/**
 * The rings running out from `from` along the line to `to` and opening up as they fade.
 * @param {THREE.Mesh[]} rings
 * @param {number} since seconds since the first ring started
 * @param {THREE.Vector3} from the muzzle
 * @param {THREE.Vector3} to the beam's end
 * @param {THREE.Vector3} scratch a vector to work in
 * @returns {void}
 */
export function placeRingMeshes(rings, since, from, to, scratch) {
  const dir = scratch.subVectors(to, from);
  const length = dir.length() || 1;
  dir.divideScalar(length);
  rings.forEach((ring, i) => {
    const u = (since - i * RING_STAGGER) / HERO.megaRingSeconds;
    ring.visible = u > 0 && u < 1;
    if (!ring.visible) return;
    // Kept well out from the eye: a ring opening up right in front of the
    // camera whites out the view.
    ring.position.copy(from).addScaledVector(dir, Math.min(length, 10 + u * (18 + i * 14)));
    ring.quaternion.setFromUnitVectors(Z_AXIS, dir);
    ring.scale.setScalar(1 + u * (3 + i * 1.6));
    /** @type {THREE.MeshBasicMaterial} */ (ring.material).opacity = (1 - u) * 0.65;
  });
}
