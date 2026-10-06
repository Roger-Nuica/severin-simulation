// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION HW.1 — The close-up weapon models, shared
 * ===========================================================================
 * The first-person models of the Minigun, the Railgun, the Black Hole Gun and
 * the Gravitron, with the gloved hands and muzzle every close-up model has.
 * They were heroWeapons.js's own; they are made here so the co-op guest's
 * viewmodel (net/viewModel.js) builds the very same meshes instead of a copy.
 * Nothing here holds state: a factory takes the scene to add to and the
 * `keepGeo`/`keepMat` of whoever owns the meshes (Hero Mode's run, or the
 * co-op session), so each instance releases its own geometry and materials.
 */

// The railgun's yellow: its coils, its flash, its ring.
// Held to ~1-1.5 so the core stays yellow instead of clipping to white.
export const RAIL_YELLOW = new THREE.Color(1.5, 1.15, 0.1);

/**
 * @typedef {Object} ModelKit what owns the meshes made
 * @property {THREE.Object3D} scene the scene (or group) the model is added to
 * @property {<G extends THREE.BufferGeometry>(geometry: G) => G} keepGeo records a geometry for disposal
 * @property {<M extends THREE.Material>(material: M) => M} keepMat records a material for disposal
 * @property {(texture: THREE.CanvasTexture) => THREE.CanvasTexture} [keepTexture] records a texture for disposal; given, the rifle carries its charge readout
 */

/** @typedef {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh}} ViewBase */
/** @typedef {ViewBase & {barrels: THREE.Group}} ViewMinigun */
/** @typedef {ViewBase & {energy: THREE.MeshBasicMaterial, panel: THREE.CanvasTexture|null}} ViewRifle */
/** @typedef {ViewBase & {pilot: THREE.Mesh}} ViewFire */
/** @typedef {ViewBase & {glow: THREE.MeshBasicMaterial}} ViewGlow */
/** @typedef {ViewBase & {glow: THREE.MeshBasicMaterial, core: THREE.Mesh, rings: THREE.Group}} ViewHole */
/** @typedef {ViewBase & {glow: THREE.MeshBasicMaterial, rings: THREE.Group}} ViewGrav */

/**
 * @param {ModelKit} kit
 * @returns {{
 *   addHandsAndMuzzle: (group: THREE.Group, muzzleZ: number, flashColour: THREE.Color) => {muzzle: THREE.Object3D, flash: THREE.Mesh},
 *   buildRifle: () => ViewRifle,
 *   buildFireGun: () => ViewFire,
 *   buildMinigun: () => ViewMinigun,
 *   buildRailgun: () => ViewGlow,
 *   buildHoleGun: () => ViewHole,
 *   buildGravitron: () => ViewGrav
 * }}
 */
export function createWeaponModels(kit) {
  const { scene, keepGeo, keepMat } = kit;

  /**
   * The parts every close-up model shares: the gloved hands and red sleeves,
   * and a muzzle with a flash on it.
   * @param {THREE.Group} group
   * @param {number} muzzleZ
   * @param {THREE.Color} flashColour
   * @returns {{muzzle: THREE.Object3D, flash: THREE.Mesh}}
   */
  function addHandsAndMuzzle(group, muzzleZ, flashColour) {
    const glove = keepMat(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
    const sleeve = keepMat(new THREE.MeshStandardMaterial({ color: 0xc0282d, roughness: 0.7 }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.13, 0.14, 0.2), glove, 0.01, -0.16, -0.22);
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.7, 10), sleeve, 0.06, -0.35, 0.1).rotation.x = 1.0;
    add(new THREE.BoxGeometry(0.12, 0.1, 0.18), glove, -0.04, -0.14, -0.72);
    add(new THREE.CylinderGeometry(0.07, 0.085, 0.9, 10), sleeve, -0.22, -0.4, -0.45).rotation.set(0.9, 0, -0.6);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, muzzleZ);
    group.add(muzzle);
    const flash = new THREE.Mesh(keepGeo(new THREE.SphereGeometry(0.1, 10, 8)), keepMat(new THREE.MeshBasicMaterial({
      color: flashColour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    flash.visible = false;
    flash.frustumCulled = false;
    muzzle.add(flash);
    return { muzzle, flash };
  }

  /**
   * The minigun: a squat receiver, an ammo box on its side and six barrels
   * round a spindle that spins up while the trigger is held.
   * @returns {ViewMinigun}
   */
  function buildMinigun() {
    const group = new THREE.Group();
    group.name = 'hero_view_minigun';
    const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x33373d, metalness: 0.8, roughness: 0.35, emissive: 0x0c0e11 }));
    const steel = keepMat(new THREE.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.9, roughness: 0.25, emissive: 0x15181c }));
    const olive = keepMat(new THREE.MeshStandardMaterial({ color: 0x4b5233, roughness: 0.7 }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {THREE.Object3D} [parent]
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z, parent = group) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.24, 0.22, 0.5), dark, 0, 0, -0.3);            // receiver
    add(new THREE.BoxGeometry(0.2, 0.2, 0.26), olive, -0.2, -0.05, -0.28);     // ammo box
    add(new THREE.BoxGeometry(0.05, 0.14, 0.05), dark, 0, 0.16, -0.22);        // carry handle posts
    add(new THREE.BoxGeometry(0.05, 0.03, 0.3), dark, 0, 0.23, -0.3);
    const barrels = new THREE.Group();
    barrels.position.set(0, 0, -0.55);
    group.add(barrels);
    const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.75, 8);
    barrelGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(barrelGeo, steel, Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.37, barrels);
    }
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 6).rotateX(Math.PI / 2), dark, 0, 0, -0.37, barrels);
    for (const z of [-0.12, -0.7]) {
      add(new THREE.TorusGeometry(0.075, 0.015, 6, 18), steel, 0, 0, z, barrels);
    }
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.3, new THREE.Color(3, 1.8, 0.5));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    scene.add(group);
    return { group, muzzle, flash, barrels };
  }

  /**
   * The railgun: two long rails with a gap between them, violet coils
   * glowing along it (brighter as it recharges to the next bolt) and a
   * stock.
   * @returns {ViewGlow}
   */
  function buildRailgun() {
    const group = new THREE.Group();
    group.name = 'hero_view_railgun';
    const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.8, roughness: 0.3, emissive: 0x0b0c10 }));
    const steel = keepMat(new THREE.MeshStandardMaterial({ color: 0xb4bac6, metalness: 0.9, roughness: 0.2, emissive: 0x16181d }));
    const glow = /** @type {THREE.MeshBasicMaterial} */ (keepMat(new THREE.MeshBasicMaterial({ color: RAIL_YELLOW.clone() })));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.18, 0.2, 0.55), dark, 0, 0, -0.28);            // body
    add(new THREE.BoxGeometry(0.12, 0.16, 0.3), dark, 0, -0.04, 0.05);         // stock
    for (const y of [0.07, -0.05]) add(new THREE.BoxGeometry(0.1, 0.035, 1.05), steel, 0, y, -0.95);
    for (let i = 0; i < 5; i++) {
      const coil = add(new THREE.TorusGeometry(0.085, 0.018, 6, 18), glow, 0, 0.01, -0.6 - i * 0.17);
      coil.rotation.y = 0;
    }
    add(new THREE.BoxGeometry(0.02, 0.02, 0.9), glow, 0, 0.01, -0.95);         // the charge between the rails
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.5, new THREE.Color(3, 2.6, 0.6));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    scene.add(group);
    return { group, muzzle, flash, glow };
  }

  /**
   * The Black Hole Gun: a squat dark emitter with a black sphere held in
   * spinning violet rings at the muzzle, glowing brighter when the bar can
   * pay for a shot.
   * @returns {ViewHole}
   */
  function buildHoleGun() {
    const group = new THREE.Group();
    group.name = 'hero_view_blackhole';
    const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x1a1622, metalness: 0.8, roughness: 0.3, emissive: 0x0a0610 }));
    const glow = /** @type {THREE.MeshBasicMaterial} */ (keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.5, 2.4) })));
    const black = keepMat(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {THREE.Object3D} [parent]
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z, parent = group) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.22, 0.22, 0.6), dark, 0, 0, -0.3);
    add(new THREE.CylinderGeometry(0.09, 0.13, 0.4, 12).rotateX(Math.PI / 2), dark, 0, 0, -0.75);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.24, 0.02, 0.05), glow, 0, 0.12, -0.15 - i * 0.14);
    const core = add(new THREE.SphereGeometry(0.075, 16, 12), black, 0, 0, -1.08);
    const rings = new THREE.Group();
    rings.position.set(0, 0, -1.08);
    group.add(rings);
    for (let i = 0; i < 2; i++) {
      const ring = add(new THREE.TorusGeometry(0.13 + i * 0.04, 0.008, 6, 32), glow, 0, 0, 0, rings);
      ring.rotation.set(i ? 1.1 : 0.4, i ? 0.5 : -0.3, 0);
    }
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.08, new THREE.Color(1.4, 0.6, 2.8));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    scene.add(group);
    return { group, muzzle, flash, glow, core, rings };
  }

  /**
   * The Gravitron: a pale emitter with three rings stacked along the
   * barrel, turning, glowing mint when the bar can pay for a shot.
   * @returns {ViewGrav}
   */
  function buildGravitron() {
    const group = new THREE.Group();
    group.name = 'hero_view_gravitron';
    const body = keepMat(new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.7, roughness: 0.35 }));
    const glow = /** @type {THREE.MeshBasicMaterial} */ (keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 1.6) })));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {THREE.Object3D} [parent]
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z, parent = group) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.2, 0.2, 0.55), body, 0, 0, -0.28);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 10).rotateX(Math.PI / 2), body, 0, 0, -0.85);
    add(new THREE.SphereGeometry(0.06, 14, 10), glow, 0, 0, -1.25);
    const rings = new THREE.Group();
    group.add(rings);
    for (let i = 0; i < 3; i++) {
      add(new THREE.TorusGeometry(0.11 - i * 0.015, 0.012, 6, 28), glow, 0, 0, -0.62 - i * 0.2, rings);
    }
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.25, new THREE.Color(0.8, 2.6, 1.9));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    scene.add(group);
    return { group, muzzle, flash, glow, rings };
  }

  /**
   * The close-up model: a fuel tank under a stubby barrel, a wide nozzle
   * with a blue pilot flame at its lip.
   * @returns {ViewFire}
   */
  function buildFireGun() {
    const group = new THREE.Group();
    group.name = 'hero_view_firegun';
    const steel = keepMat(new THREE.MeshStandardMaterial({ color: 0x5c5f66, metalness: 0.85, roughness: 0.35, emissive: 0x101114 }));
    const red = keepMat(new THREE.MeshStandardMaterial({ color: 0xa3261b, metalness: 0.4, roughness: 0.5 }));
    const blue = keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14).rotateX(Math.PI / 2), red, 0, -0.12, -0.3);      // the tank
    add(new THREE.BoxGeometry(0.12, 0.12, 0.5), steel, 0, 0.04, -0.3);                                  // body
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10).rotateX(Math.PI / 2), steel, 0, 0.04, -0.82); // barrel
    add(new THREE.CylinderGeometry(0.07, 0.045, 0.14, 12).rotateX(Math.PI / 2), steel, 0, 0.04, -1.16); // nozzle
    const pilot = add(new THREE.SphereGeometry(0.03, 8, 6), blue, 0, 0.04, -1.25);
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.25, new THREE.Color(3, 1.6, 0.5));
    muzzle.position.y = 0.04;
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    scene.add(group);
    return { group, muzzle, flash, pilot };
  }

  /**
   * The rifle as seen down its length from Roger's eyes, for aim mode: the
   * plasma rifle built bigger and in more detail along the camera's -z, with
   * his gloved hand on the grip. With `kit.keepTexture` it carries a readout of
   * the charge on its back (hero/models.js draws it); without it (the co-op
   * guest's) the back is plain.
   * @returns {ViewRifle}
   */
  function buildRifle() {
    const group = new THREE.Group();
    group.name = 'hero_view_rifle';
    const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x2c323d, metalness: 0.75, roughness: 0.32, emissive: 0x0c1016 }));
    const trim = keepMat(new THREE.MeshStandardMaterial({ color: 0x8d98aa, metalness: 0.85, roughness: 0.22, emissive: 0x151a22 }));
    // His armoured fist and the Storm Ranger's navy sleeve (hero/rogerLook.js).
    const glove = keepMat(new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.25, metalness: 0.6 }));
    const sleeve = keepMat(new THREE.MeshStandardMaterial({ color: 0x1a2440, roughness: 0.55, metalness: 0.15 }));
    // Barely over 1: this close to the eye, anything brighter blooms the
    // whole rifle into one blue glare.
    const energy = keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.8, 1.35) }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const part = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.17, 0.2, 0.62), dark, 0, 0, -0.35);            // receiver
    part(new THREE.BoxGeometry(0.14, 0.16, 0.5), dark, 0, 0.01, -0.86);         // fore-end
    part(new THREE.BoxGeometry(0.09, 0.05, 0.9), trim, 0, 0.125, -0.55);        // top rail
    part(new THREE.BoxGeometry(0.03, 0.03, 0.95), energy, 0, 0.16, -0.56);      // energy strip
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.02, 0.045, 0.8), energy, side * 0.088, 0.01, -0.58);
      const fin = part(new THREE.BoxGeometry(0.2, 0.015, 0.2), trim, side * 0.12, 0.03, -0.98);
      fin.rotation.z = side * 0.35;
    }
    const barrel = part(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 12), trim, 0, 0.02, -1.3);
    barrel.rotation.x = Math.PI / 2;
    const ring = part(new THREE.TorusGeometry(0.07, 0.018, 8, 20), energy, 0, 0.02, -1.55);
    ring.rotation.y = 0;
    const tip = part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), energy, 0, 0.02, -1.58);
    tip.rotation.x = Math.PI / 2;
    // The readout, on the back of the receiver facing the eye.
    /** @type {THREE.CanvasTexture|null} */
    let panel = null;
    if (kit.keepTexture) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 80;
      panel = kit.keepTexture(new THREE.CanvasTexture(canvas));
      panel.colorSpace = THREE.SRGBColorSpace;
      const screen = part(new THREE.PlaneGeometry(0.15, 0.094), keepMat(new THREE.MeshBasicMaterial({ map: panel, toneMapped: false })), 0, 0.16, -0.12);
      screen.rotation.x = -0.55;
    }
    // His hand on the grip and the red sleeve running out of shot.
    part(new THREE.BoxGeometry(0.13, 0.14, 0.2), glove, 0.01, -0.14, -0.22);
    const arm = part(new THREE.CylinderGeometry(0.075, 0.09, 0.7, 10), sleeve, 0.06, -0.33, 0.1);
    arm.rotation.x = 1.0;
    // The other hand, under the fore-end.
    part(new THREE.BoxGeometry(0.12, 0.1, 0.18), glove, -0.02, -0.12, -0.9);
    const arm2 = part(new THREE.CylinderGeometry(0.07, 0.085, 0.9, 10), sleeve, -0.2, -0.38, -0.62);
    arm2.rotation.set(0.9, 0, -0.6);
    const muzzleNode = new THREE.Object3D();
    muzzleNode.position.set(0, 0.02, -1.62);
    group.add(muzzleNode);
    const flashMesh = new THREE.Mesh(keepGeo(new THREE.SphereGeometry(0.12, 12, 8)), keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.8, 1.8, 4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    flashMesh.visible = false;
    flashMesh.frustumCulled = false;
    muzzleNode.add(flashMesh);
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    scene.add(group);
    return { group, muzzle: muzzleNode, flash: flashMesh, energy, panel };
  }

  return { addHandsAndMuzzle, buildRifle, buildFireGun, buildMinigun, buildRailgun, buildHoleGun, buildGravitron };
}
