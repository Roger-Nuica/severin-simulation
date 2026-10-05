// @ts-check
import * as THREE from 'three';
import { GUNNER } from './config.js';

/**
 * ===========================================================================
 * SECTION GN.2 — HAVOC: the model
 * ===========================================================================
 * A heavy gunner in olive armour plate with orange hazard trim: a helmet
 * with a red visor slit, broad pauldrons, a big ammunition drum on his back
 * feeding two brass belts over his shoulders into two six-barrel rotary
 * guns that are his forearms (on request, 2026-10-05: the one gun at the
 * hip left his right hand stuck inside his body). Each gun (`guns`) has
 * its barrels that spin, a muzzle flash and a laser sight; the barrel tips
 * glow as they heat (`heat`, per unit). Local axes: +z forward, feet at
 * y = 0; built at 2.3 m.
 *
 * Geometries and most materials are shared by every HAVOC (made once,
 * `buildGunnerKit`); the heat glow and the visor are per unit so one can
 * glow or flash on its own.
 */

/**
 * @returns {{geos: Record<string, THREE.BufferGeometry>, mats: Record<string, THREE.Material>, all: {geos: THREE.BufferGeometry[], mats: THREE.Material[]}}}
 */
export function buildGunnerKit() {
  const geos = {
    boot: new THREE.BoxGeometry(0.34, 0.22, 0.5),
    shin: new THREE.CylinderGeometry(0.15, 0.13, 0.55, 8),
    shinPlate: new THREE.BoxGeometry(0.2, 0.42, 0.08),
    knee: new THREE.SphereGeometry(0.14, 10, 8),
    thigh: new THREE.CylinderGeometry(0.19, 0.16, 0.55, 8),
    hips: new THREE.BoxGeometry(0.66, 0.3, 0.4),
    belly: new THREE.BoxGeometry(0.58, 0.32, 0.38),
    chest: new THREE.BoxGeometry(0.86, 0.55, 0.52),
    chestPlate: new THREE.BoxGeometry(0.7, 0.42, 0.1),
    gorget: new THREE.CylinderGeometry(0.2, 0.26, 0.14, 10),
    helmet: new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    jaw: new THREE.BoxGeometry(0.34, 0.2, 0.34),
    visor: new THREE.BoxGeometry(0.3, 0.05, 0.04),
    pauldron: new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    upperArm: new THREE.CylinderGeometry(0.11, 0.1, 0.42, 8),
    forearm: new THREE.CylinderGeometry(0.1, 0.12, 0.4, 8),
    glove: new THREE.SphereGeometry(0.11, 8, 6),
    drum: new THREE.CylinderGeometry(0.3, 0.3, 0.55, 16),
    drumCap: new THREE.CylinderGeometry(0.31, 0.31, 0.05, 16),
    frame: new THREE.BoxGeometry(0.5, 0.75, 0.14),
    barrel: new THREE.CylinderGeometry(0.028, 0.028, 1.15, 6),
    barrelTip: new THREE.CylinderGeometry(0.032, 0.032, 0.14, 6),
    clamp: new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12),
    housing: new THREE.BoxGeometry(0.3, 0.3, 0.62),
    cuff: new THREE.CylinderGeometry(0.15, 0.17, 0.2, 10),
    handle: new THREE.BoxGeometry(0.06, 0.16, 0.26),
    flash: new THREE.PlaneGeometry(0.9, 0.9),
    laser: new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2),
    marker: new THREE.ConeGeometry(0.22, 0.42, 4).rotateX(Math.PI)
  };
  // The belts: brass tubes from the drum, over each shoulder, into each gun.
  for (const sx of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.18, 1.45, -0.42),
      new THREE.Vector3(sx * 0.38, 1.86, -0.22),
      new THREE.Vector3(sx * 0.62, 1.7, -0.02),
      new THREE.Vector3(sx * 0.6, 1.4, 0.02)
    ]);
    geos[sx > 0 ? 'beltR' : 'beltL'] = new THREE.TubeGeometry(curve, 16, 0.04, 6, false);
  }
  const mats = {
    armour: new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.55, metalness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.6, metalness: 0.5 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xd9761a, roughness: 0.5, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.3, metalness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a043, roughness: 0.35, metalness: 0.9, emissive: 0x1a1203 }),
    flash: new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.5, 2.2, 0.9), transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false
    }),
    laser: new THREE.MeshBasicMaterial({
      color: new THREE.Color(3, 0.15, 0.1), transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    })
  };
  return {
    geos, mats,
    all: { geos: Object.values(geos), mats: Object.values(mats) }
  };
}

/**
 * One HAVOC.
 * @param {ReturnType<typeof buildGunnerKit>} kit
 * @returns {{root: THREE.Group, body: THREE.Group, legs: THREE.Object3D[],
 *   guns: {gun: THREE.Group, barrels: THREE.Group, flash: THREE.Mesh, laser: THREE.Mesh, muzzle: THREE.Object3D}[],
 *   heat: THREE.MeshStandardMaterial, visor: THREE.MeshBasicMaterial, marker: THREE.Mesh, own: THREE.Material[]}}
 */
export function buildGunner(kit) {
  const { geos: G, mats: M } = kit;
  const heat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.85, emissive: 0x000000 });
  const visor = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.15, 0.1), toneMapped: false });
  const root = new THREE.Group();
  root.name = 'havoc';
  const body = new THREE.Group();
  root.add(body);
  /**
   * @param {THREE.BufferGeometry} g @param {THREE.Material} m @param {THREE.Object3D} parent
   * @param {number} x @param {number} y @param {number} z
   */
  const add = (g, m, parent, x, y, z, shadow = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    parent.add(mesh);
    return mesh;
  };
  // Legs, each on a hip pivot so they can stride.
  /** @type {THREE.Object3D[]} */
  const legs = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.2, 1.05, 0);
    body.add(hip);
    add(G.thigh, M.armour, hip, 0, -0.27, 0);
    add(G.knee, M.trim, hip, 0, -0.55, 0.08, false);
    add(G.shin, M.dark, hip, 0, -0.8, 0);
    add(G.shinPlate, M.armour, hip, 0, -0.78, 0.12, false);
    add(G.boot, M.dark, hip, 0, -1.0, 0.07);
    legs.push(hip);
  }
  add(G.hips, M.dark, body, 0, 1.08, 0);
  add(G.belly, M.armour, body, 0, 1.33, 0.01);
  add(G.chest, M.armour, body, 0, 1.68, 0);
  add(G.chestPlate, M.trim, body, 0, 1.7, 0.27, false).scale.set(1, 1, 0.6);
  add(G.chestPlate, M.dark, body, 0, 1.62, 0.29, false).scale.set(0.82, 0.55, 0.6);
  add(G.gorget, M.dark, body, 0, 2.0, 0);
  // The head: helmet, jaw guard and the red slit.
  add(G.jaw, M.dark, body, 0, 2.12, 0.02);
  add(G.helmet, M.armour, body, 0, 2.16, 0);
  add(G.visor, visor, body, 0, 2.18, 0.18, false);
  for (const sx of [-1, 1]) {
    const p = add(G.pauldron, sx > 0 ? M.trim : M.armour, body, sx * 0.5, 1.9, 0);
    p.scale.set(1.15, 0.9, 1.1);
  }
  // The pack: a frame and the big drum, lying across his back.
  add(G.frame, M.dark, body, 0, 1.55, -0.33);
  const drum = add(G.drum, M.dark, body, 0, 1.45, -0.55);
  drum.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const cap = add(G.drumCap, M.trim, body, sx * 0.29, 1.45, -0.55, false);
    cap.rotation.z = Math.PI / 2;
  }
  add(G.beltL, M.brass, body, 0, 0, 0, false);
  add(G.beltR, M.brass, body, 0, 0, 0, false);
  // The arms: an upper arm hanging from each shoulder, and below the elbow
  // no hand but a minigun, pointing forward.
  /** @type {{gun: THREE.Group, barrels: THREE.Group, flash: THREE.Mesh, laser: THREE.Mesh, muzzle: THREE.Object3D}[]} */
  const guns = [];
  for (const sx of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.56, 1.84, 0);
    body.add(shoulder);
    const upper = add(G.upperArm, M.dark, shoulder, 0, -0.22, 0);
    upper.scale.set(1.25, 1.1, 1.25);
    // The gun, from the elbow: a cuff, the housing, the six barrels.
    const gun = new THREE.Group();
    gun.position.set(sx * 0.56, 1.38, 0.02);
    body.add(gun);
    const cuff = add(G.cuff, M.trim, gun, 0, 0.02, 0, false);
    cuff.rotation.x = Math.PI / 2;
    add(G.housing, M.dark, gun, 0, 0, 0.26);
    add(G.handle, M.steel, gun, 0, 0.21, 0.26, false);
    const barrels = new THREE.Group();
    barrels.position.set(0, 0, 0.5);
    gun.add(barrels);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const b = add(G.barrel, M.steel, barrels, Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0.58, false);
      b.rotation.x = Math.PI / 2;
      const tip = add(G.barrelTip, heat, barrels, Math.cos(a) * 0.075, Math.sin(a) * 0.075, 1.1, false);
      tip.rotation.x = Math.PI / 2;
    }
    for (const z of [0.25, 0.8, 1.12]) {
      const c = add(G.clamp, z > 1 ? heat : M.dark, barrels, 0, 0, z, false);
      c.rotation.x = Math.PI / 2;
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, 1.75);
    gun.add(muzzle);
    // The flash: two crossed planes, spun and scaled per shot.
    const flash = add(G.flash, M.flash, muzzle, 0, 0, 0.2, false);
    const cross = new THREE.Mesh(G.flash, M.flash);
    cross.rotation.y = Math.PI / 2;
    flash.add(cross);
    flash.visible = false;
    // The laser: unit length along +z from the muzzle, stretched to its target.
    const laser = add(G.laser, M.laser, muzzle, 0, 0, 0, false);
    laser.visible = false;
    guns.push({ gun, barrels, flash, laser, muzzle });
  }
  // A marker over his head, drawn through anything in the way, so he can
  // always be found (a downward chevron, orange, bobbing).
  const markerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.6, 1.1, 0.25), transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false
  });
  const marker = new THREE.Mesh(G.marker, markerMat);
  marker.position.set(0, 3.05, 0);
  marker.renderOrder = 10;
  root.add(marker);
  root.scale.setScalar(GUNNER.height / 2.38);
  return { root, body, legs, guns, heat, visor, marker, own: [heat, visor, markerMat] };
}
