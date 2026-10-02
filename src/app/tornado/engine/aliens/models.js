// @ts-check
import * as THREE from 'three';
import { ALIEN_SKIN_GLOW, ALIENS } from './config.js';
import { createTouchState } from '../health/melee.js';

/**
 * ===========================================================================
 * SECTION AK.1 — The aliens' models
 * ===========================================================================
 * The ramp (a conveyor belt), the tractor beam and the alien itself, built
 * once from shared geometry; each alien has its own skin material.
 */

/** @returns {number} length of the ramp from the hatch to the ground */
export function alienRampLength() {
  return (ALIENS.hoverHeight + 1.2) / Math.sin(ALIENS.rampAngle);
}

/**
 * The ramp: an edged plate hinged at the hatch, pointing along the pivot's
 * +x and tipped down at rampAngle. Grown out along its length (scale.x of
 * the plate's parent) while it deploys. The aliens' is green; Landing
 * Support's samurai ship (engine/spaceship/samurai.js) has the same ramp in
 * its own colours.
 * @param {{glow?: THREE.Color, seam?: string, emissive?: number}} [colours]
 * @returns {THREE.Group}
 */
export function buildAlienRamp(colours = {}) {
  const pivot = new THREE.Group();
  pivot.name = 'alien_ramp';
  const tilt = new THREE.Group();
  tilt.rotation.z = -ALIENS.rampAngle;
  pivot.add(tilt);
  const L = alienRampLength();
  // Its own belt: the first ship's scrolls (beltTexture), the transport's
  // does not, and each is disposed with its ship.
  const belt = createBeltTexture(colours.seam || '#7dff9a');
  belt.repeat.set(L / ALIENS.beltStripe, 1);
  pivot.userData.belt = belt;
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(L, 0.3, ALIENS.rampWidth),
    new THREE.MeshStandardMaterial({
      color: 0xb0b6be, map: belt, metalness: 0.5, roughness: 0.45,
      emissive: colours.emissive === undefined ? 0x2cff5a : colours.emissive, emissiveMap: belt, emissiveIntensity: 0.35
    })
  );
  plate.position.x = L / 2;
  plate.castShadow = true;
  plate.receiveShadow = true;
  tilt.add(plate);
  const edgeMat = new THREE.MeshBasicMaterial({ color: (colours.glow || ALIENS.glow).clone() });
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(L, 0.18, 0.18), edgeMat);
    edge.position.set(L / 2, 0.22, side * (ALIENS.rampWidth / 2 - 0.1));
    tilt.add(edge);
  }
  pivot.userData.tilt = tilt;
  return pivot;
}

/**
 * Cross-slats of a conveyor belt, with a glowing seam between each: one
 * stripe of the pattern, repeated along the ramp and scrolled towards the
 * hatch every frame (see updateAliens).
 * @param {string} [seam] the seam's colour
 * @returns {THREE.CanvasTexture}
 */
function createBeltTexture(seam = '#7dff9a') {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 16;
  const g = canvas.getContext('2d');
  g.fillStyle = '#3a3f46';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#6c737c';
  g.fillRect(6, 0, 44, 16);
  g.fillStyle = seam;
  g.fillRect(56, 0, 4, 16);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienModels(ctx, S, api) {
  // ---------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------

  // The ramp and its belt (module level, above: the samurai ship has one too).
  const rampLength = alienRampLength;
  const buildRamp = () => buildAlienRamp();

  /**
   * The tractor glow down the middle of the ramp: a flat additive strip,
   * shown only while someone is being taken.
   * @returns {THREE.Mesh}
   */
  function buildBeam() {
    const L = rampLength();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(L, ALIENS.rampWidth * 0.8),
      new THREE.MeshBasicMaterial({
        color: ALIENS.glow.clone(), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(L / 2, 0.35, 0);
    mesh.name = 'alien_beam';
    return mesh;
  }

  /** @returns {Object<string, THREE.BufferGeometry>} */
  function buildAlienGeometry() {
    const leg = new THREE.CylinderGeometry(0.06, 0.05, 0.62, 6);
    leg.translate(0, -0.31, 0);
    const arm = new THREE.CylinderGeometry(0.04, 0.03, 0.55, 6);
    arm.translate(0, -0.275, 0);
    return {
      leg,
      arm,
      torso: new THREE.CapsuleGeometry(0.15, 0.32, 4, 8),
      neck: new THREE.CylinderGeometry(0.05, 0.06, 0.14, 6),
      // The big head: wide at the crown, narrowing to a small chin.
      head: new THREE.SphereGeometry(0.34, 14, 10),
      eye: new THREE.SphereGeometry(0.1, 10, 6),
      // The ray gun: a stubby body along the arm's -y, a ribbed barrel and a
      // glowing green emitter at the end.
      gunBody: new THREE.BoxGeometry(0.1, 0.2, 0.13),
      gunBarrel: new THREE.CylinderGeometry(0.035, 0.05, 0.2, 8),
      gunEmitter: new THREE.SphereGeometry(0.06, 10, 8)
    };
  }

  /**
   * A thin green body under a big green head with two black almond eyes,
   * jointed at hips and shoulders for the walk.
   * @param {boolean} [hat] a sombrero on it (the second wave)
   * @returns {Alien}
   */
  function buildAlien(hat = false) {
    const g = S.alienGeo;
    const skin = new THREE.MeshStandardMaterial({ color: ALIENS.skin, roughness: 0.55, emissive: ALIEN_SKIN_GLOW });
    const root = new THREE.Group();
    root.name = 'alien';
    root.rotation.order = 'YXZ';
    root.scale.setScalar(ALIENS.scale);

    /**
     * @param {THREE.BufferGeometry} geometry
     * @param {THREE.Material} material
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      // Only the torso and the big head cast (below): with a hundred and
      // more of them after a mutation, every limb, gun and hat drawn again
      // into the shadow map was thousands of extra draws (performance pass).
      mesh.castShadow = false;
      root.add(mesh);
      return mesh;
    };

    const legL = part(g.leg, skin, -0.09, 0.62, 0);
    const legR = part(g.leg, skin, 0.09, 0.62, 0);
    part(g.torso, skin, 0, 0.62 + 0.31, 0).castShadow = true;
    const armL = part(g.arm, skin, -0.2, 1.1, 0);
    const armR = part(g.arm, skin, 0.2, 1.1, 0);
    armL.rotation.z = -0.18;
    armR.rotation.z = 0.18;
    // The ray gun, in the right hand: it hangs pointing down at the side
    // while walking and points wherever the arm is raised to.
    const gunBody = new THREE.Mesh(g.gunBody, S.gunMat);
    gunBody.position.set(0, -0.6, 0.04);
    armR.add(gunBody);
    const gunBarrel = new THREE.Mesh(g.gunBarrel, S.gunMat);
    gunBarrel.position.set(0, -0.77, 0.04);
    armR.add(gunBarrel);
    const emitter = new THREE.Mesh(g.gunEmitter, S.emitterMat);
    emitter.position.set(0, -0.88, 0.04);
    armR.add(emitter);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -0.92, 0.04);
    armR.add(muzzle);
    part(g.neck, skin, 0, 1.22, 0);
    const head = part(g.head, skin, 0, 1.52, 0);
    head.castShadow = true;
    head.scale.set(1.15, 1.05, 1.05);
    for (const side of [-1, 1]) {
      const eye = part(g.eye, S.eyeMat, side * 0.14, 1.5, 0.27);
      eye.scale.set(1.25, 0.7, 0.55);
      eye.rotation.z = side * -0.45;
      eye.castShadow = false;
    }
    // The second wave's (see the header): a sombrero on the big head.
    if (hat && S.sombrero) {
      part(S.sombrero.brim, S.sombrero.straw, 0, 1.8, 0);
      part(S.sombrero.crown, S.sombrero.straw, 0, 1.97, 0);
      part(S.sombrero.band, S.sombrero.red, 0, 1.86, 0).rotation.x = Math.PI / 2;
    }
    return {
      root,
      limbs: { legL, legR, armL, armR },
      skin,
      phase: 'exiting',
      timer: 0,
      heading: 0,
      cycle: Math.random() * Math.PI * 2,
      tx: 0,
      tz: 0,
      pause: 0,
      rayTimer: 1 + Math.random() * 2,
      touch: createTouchState(),
      touchClock: 0,
      knockTimer: 0,
      knockX: 0,
      knockZ: 0,
      muzzle,
      aim: 0,
      side: 1
    };
  }

  return { rampLength, buildRamp, buildBeam, buildAlienGeometry, buildAlien };
}
