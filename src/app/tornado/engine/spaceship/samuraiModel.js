// @ts-check
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PERSON } from '../scale.js';

/**
 * ===========================================================================
 * SECTION SS.4 — The samurai: tunables and model
 * ===========================================================================
 * Landing Support's squad (engine/spaceship/samurai.js), built from
 * primitives like everything else in the scene, but merged: each rigid part
 * -- the body with its head, helmet and sheath, each leg, each arm -- is one
 * mesh with its colours baked into the vertices, so a samurai is seven draws
 * (body, two legs, two arms, the blade, the banner) and the slash trail
 * while it swings. Original armour: a lacquered cuirass laced in gold, broad
 * shoulder plates, a skirt of plates, a black helmet with a flared neck
 * guard and a gold crest, a half-mask, wide hakama; a katana in the right
 * hand, its scabbard on the left hip, and a small banner on the back. Four
 * colours of armour across the squad; the first is the leader.
 */

export const SAMURAI = {
  count: 10,
  height: PERSON.height,       // a man (engine/scale.js)
  runSpeed: 8.5,               // m/s: a sprinting man, a little over the T-Rex's walk (7.3)
  guardSpeed: 2.4,             // walking round the drop point with nothing to fight
  turnRate: 9,                 // radians a second
  guardRadius: [6, 22],        // where they stand guard, round the drop point
  // The fight.
  reach: 1.3,                  // metres past the target's edge a cut lands from
  slashEvery: [0.9, 1.3],      // seconds between two cuts
  windup: 0.26,                // the blade going up
  swing: 0.13,                 // and coming down: the cut lands at its end
  recover: 0.3,
  // The T-Rex (40 hp, engine/trex/config.js): ten of them round it take it
  // down in 20-30 s once they are on it. 0.2 took 32 s in the bench (not all
  // ten are in reach at once while it walks); 0.27, about 24.
  trexCut: 0.27,
  retarget: 0.3,               // seconds between two looks for a target
  keepMargin: 15,              // a target this far past the coverage is let go
  // Their voices.
  shoutChance: 0.35,           // of a charge starting
  // Roger's weapons (the only thing that can hurt them).
  bulletHits: 3,               // minigun rounds to bring one down
  deathSeconds: 0.8,           // falling
  lieSeconds: 2.5,             // then lying there, then sinking away
  sinkSeconds: 1.2,
  // The colours.
  armour: [0x8e1b1b, 0x1d1d22, 0x23305e, 0x2c4a30],
  lacing: 0xc9a43a,
  hakama: [0x1b1d26, 0x2b2420, 0x1b1d26, 0x23201a],
  skin: 0xc99a74,
  helmet: 0x141416,
  mask: 0x5a1212,
  steel: 0xdfe6ee
};

/**
 * @typedef {Object} SamuraiRig
 * @property {THREE.Group} root on the ground, turned to its heading
 * @property {THREE.Group} pelvis leans and bobs the whole figure
 * @property {THREE.Object3D} legL
 * @property {THREE.Object3D} legR
 * @property {THREE.Object3D} armL
 * @property {THREE.Object3D} armR the sword arm
 * @property {THREE.Mesh} trail the cut's arc, shown while it swings
 * @property {THREE.MeshBasicMaterial} trailMat its own, for its fade
 */

/**
 * Geometry and materials every samurai shares, built once (buildSamuraiKit)
 * and disposed with the system.
 * @typedef {Object} SamuraiKit
 * @property {THREE.BufferGeometry[]} bodies one per armour colour
 * @property {THREE.BufferGeometry[]} legs one per armour colour
 * @property {THREE.BufferGeometry[]} arms one per armour colour
 * @property {THREE.BufferGeometry} armR the sword arm: hilt and guard in the hand
 * @property {THREE.BufferGeometry} blade
 * @property {THREE.BufferGeometry} banner
 * @property {THREE.BufferGeometry} trail
 * @property {THREE.MeshStandardMaterial} lacquer vertex-coloured, every part
 * @property {THREE.MeshStandardMaterial} steel
 * @property {THREE.MeshLambertMaterial} flag
 * @property {THREE.CanvasTexture} flagTexture
 */

/**
 * A piece, coloured into its vertices, ready to merge.
 * @param {THREE.BufferGeometry} geo
 * @param {number} colour
 * @returns {THREE.BufferGeometry}
 */
function tinted(geo, colour) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
  const c = new THREE.Color(colour);
  const n = flat.attributes.position.count;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return flat;
}

/**
 * A box, placed and turned.
 * @param {number} w
 * @param {number} h
 * @param {number} d
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} colour
 * @param {number} [rx]
 * @param {number} [ry]
 * @param {number} [rz]
 * @returns {THREE.BufferGeometry}
 */
function box(w, h, d, x, y, z, colour, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return tinted(g, colour);
}

/**
 * The body from the hips up: the skirt of plates, the cuirass with its gold
 * lacing, the shoulder plates, the head under its helmet and mask, the
 * crest, the scabbard and the banner's pole. Facing +z, feet at y = 0.
 * @param {number} armour
 * @returns {THREE.BufferGeometry}
 */
function bodyGeometry(armour) {
  const S = SAMURAI;
  const parts = [];
  // The skirt of plates round the hips (kusazuri), each with a gold edge.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.sin(a) * 0.17;
    const z = Math.cos(a) * 0.13;
    parts.push(box(0.2, 0.26, 0.035, x, 0.9, z, armour, 0.12 * Math.cos(a), a, -0.12 * Math.sin(a)));
    parts.push(box(0.205, 0.025, 0.04, x, 0.78, z, S.lacing, 0.12 * Math.cos(a), a, -0.12 * Math.sin(a)));
  }
  // The cuirass, laced across in gold.
  parts.push(box(0.42, 0.44, 0.27, 0, 1.22, 0, armour));
  for (const y of [1.06, 1.16, 1.26, 1.36]) parts.push(box(0.425, 0.022, 0.275, 0, y, 0, S.lacing));
  // A darker belt.
  parts.push(box(0.4, 0.06, 0.26, 0, 1.0, 0, 0x2a1a12));
  // The shoulder plates, hanging out over the arms.
  for (const side of [-1, 1]) {
    parts.push(box(0.17, 0.22, 0.22, side * 0.31, 1.33, 0, armour, 0, 0, side * 0.32));
    parts.push(box(0.172, 0.02, 0.222, side * 0.33, 1.25, 0, S.lacing, 0, 0, side * 0.32));
  }
  // The neck and the head.
  const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8);
  neck.translate(0, 1.47, 0);
  parts.push(tinted(neck, S.skin));
  const head = new THREE.SphereGeometry(0.11, 12, 10);
  head.translate(0, 1.57, 0);
  parts.push(tinted(head, S.skin));
  // The half-mask over the lower face, and its dark eye slits above it.
  parts.push(box(0.17, 0.085, 0.07, 0, 1.53, 0.075, S.mask));
  parts.push(box(0.12, 0.02, 0.02, 0, 1.6, 0.105, 0x060606));
  // The helmet: a black bowl, a flared neck guard in the armour's colour
  // behind and to the sides, the two turned-back wings, and the gold crest.
  const bowl = new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  bowl.translate(0, 1.6, 0);
  parts.push(tinted(bowl, S.helmet));
  const guard = new THREE.CylinderGeometry(0.15, 0.24, 0.13, 14, 1, true, Math.PI * 0.35, Math.PI * 1.3);
  guard.translate(0, 1.55, -0.01);
  parts.push(tinted(guard, armour));
  for (const side of [-1, 1]) parts.push(box(0.07, 0.07, 0.015, side * 0.15, 1.62, 0.06, armour, 0, side * 0.9));
  for (const side of [-1, 1]) parts.push(box(0.028, 0.24, 0.014, side * 0.06, 1.79, 0.1, S.lacing, -0.15, 0, side * -0.38));
  parts.push(box(0.05, 0.04, 0.02, 0, 1.69, 0.13, S.lacing));
  // The scabbard on the left hip, slung back and down.
  parts.push(box(0.035, 0.035, 0.82, 0.22, 0.95, -0.08, 0x0e0b0b, 0.45, 0, 0));
  parts.push(box(0.04, 0.04, 0.05, 0.22, 1.11, 0.24, S.lacing, 0.45, 0, 0));
  // The banner's pole, up the back.
  const pole = new THREE.CylinderGeometry(0.012, 0.012, 1.15, 5);
  pole.translate(0, 1.72, -0.17);
  parts.push(tinted(pole, 0x2a1a12));
  return mergeGeometries(parts);
}

/**
 * A leg, hanging from the hip (y = 0 at the hip): wide hakama, a shin plate
 * in the armour's colour, a dark split-toe boot.
 * @param {number} armour
 * @param {number} hakama
 * @returns {THREE.BufferGeometry}
 */
function legGeometry(armour, hakama) {
  const trousers = new THREE.CylinderGeometry(0.12, 0.19, 0.78, 10);
  trousers.translate(0, -0.39, 0);
  return mergeGeometries([
    tinted(trousers, hakama),
    box(0.14, 0.28, 0.05, 0, -0.6, 0.15, armour, -0.1),
    box(0.13, 0.08, 0.26, 0, -0.9, 0.05, 0x161414)
  ]);
}

/**
 * An arm, hanging from the shoulder (y = 0 there): an armoured upper arm,
 * a dark mailed sleeve laced in gold, the hand.
 * @param {number} armour
 * @param {boolean} sword the right arm: the hilt and guard in the hand,
 *   along the arm's +z (forward when the arm hangs)
 * @returns {THREE.BufferGeometry}
 */
function armGeometry(armour, sword) {
  const upper = new THREE.CylinderGeometry(0.06, 0.055, 0.3, 8);
  upper.translate(0, -0.15, 0);
  const fore = new THREE.CylinderGeometry(0.052, 0.045, 0.28, 8);
  fore.translate(0, -0.44, 0);
  const hand = new THREE.SphereGeometry(0.048, 8, 6);
  hand.translate(0, -0.62, 0);
  const parts = [
    tinted(upper, armour),
    tinted(fore, 0x24242a),
    box(0.105, 0.02, 0.105, 0, -0.38, 0, SAMURAI.lacing),
    tinted(hand, SAMURAI.skin)
  ];
  if (sword) {
    // The grip, wrapped dark with a gold pommel, and the round guard.
    parts.push(box(0.03, 0.034, 0.27, 0, -0.62, -0.08, 0x1a1414));
    parts.push(box(0.036, 0.04, 0.03, 0, -0.62, -0.22, SAMURAI.lacing));
    const guard = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12);
    guard.rotateX(Math.PI / 2);
    guard.translate(0, -0.62, 0.06);
    parts.push(tinted(guard, SAMURAI.lacing));
  }
  return mergeGeometries(parts);
}

/**
 * The banner on the back: white, a red disc, a gold edge.
 * @returns {THREE.CanvasTexture}
 */
function flagTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f1ece0';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#c0282d';
  g.beginPath();
  g.arc(32, 52, 19, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c9a43a';
  g.fillRect(0, 0, 64, 5);
  g.fillRect(0, 123, 64, 5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** @returns {SamuraiKit} */
export function buildSamuraiKit() {
  const S = SAMURAI;
  const blade = new THREE.BoxGeometry(0.012, 0.034, 0.74);
  blade.translate(0, -0.62, 0.43);
  const banner = new THREE.PlaneGeometry(0.3, 0.56);
  banner.translate(0.16, 2.0, -0.17);
  // The cut: a wide arc in the body's plane, overhead to low in front.
  const trail = new THREE.RingGeometry(0.55, 1.35, 20, 1, -0.5, 2.4);
  trail.rotateY(-Math.PI / 2);
  trail.translate(-0.25, 1.35, 0.1);
  const flagTex = flagTexture();
  return {
    bodies: S.armour.map(c => bodyGeometry(c)),
    legs: S.armour.map((c, i) => legGeometry(c, S.hakama[i])),
    arms: S.armour.map(c => armGeometry(c, false)),
    armR: armGeometry(S.armour[0], true),
    blade,
    banner,
    trail,
    lacquer: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 }),
    steel: new THREE.MeshStandardMaterial({ color: S.steel, metalness: 1, roughness: 0.18, emissive: 0x1a2028 }),
    flag: new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }),
    flagTexture: flagTex
  };
}

/**
 * The right arm in each armour colour, built on first use (the leader's is
 * in the kit).
 * @type {Map<number, THREE.BufferGeometry>}
 */
const swordArms = new Map();

/**
 * One samurai, from the kit. Its armour is the kit's `variant`th colour.
 * @param {SamuraiKit} kit
 * @param {number} variant
 * @returns {SamuraiRig}
 */
export function buildSamurai(kit, variant) {
  const v = variant % SAMURAI.armour.length;
  const root = new THREE.Group();
  root.name = 'samurai';
  root.rotation.order = 'YXZ';
  const pelvis = new THREE.Group();
  root.add(pelvis);
  const body = new THREE.Mesh(kit.bodies[v], kit.lacquer);
  body.castShadow = true;
  pelvis.add(body);
  /**
   * @param {THREE.BufferGeometry} geo
   * @param {number} x
   * @param {number} y
   * @returns {THREE.Group}
   */
  const limb = (geo, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(new THREE.Mesh(geo, kit.lacquer));
    pelvis.add(pivot);
    return pivot;
  };
  const legL = limb(kit.legs[v], 0.11, 0.95);
  const legR = limb(kit.legs[v], -0.11, 0.95);
  const armL = limb(kit.arms[v], 0.27, 1.38);
  let swordArm = v === 0 ? kit.armR : swordArms.get(v);
  if (!swordArm) {
    swordArm = armGeometry(SAMURAI.armour[v], true);
    swordArms.set(v, swordArm);
  }
  const armR = limb(swordArm, -0.27, 1.38);
  armR.add(new THREE.Mesh(kit.blade, kit.steel));
  pelvis.add(new THREE.Mesh(kit.banner, kit.flag));
  const trailMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 1.8, 2.2), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const trail = new THREE.Mesh(kit.trail, trailMat);
  trail.visible = false;
  pelvis.add(trail);
  root.traverse((child) => { child.frustumCulled = true; });
  return { root, pelvis, legL, legR, armL, armR, trail, trailMat };
}

/**
 * @param {SamuraiKit} kit
 * @returns {void}
 */
export function disposeSamuraiKit(kit) {
  for (const g of [...kit.bodies, ...kit.legs, ...kit.arms, kit.armR, kit.blade, kit.banner, kit.trail, ...swordArms.values()]) g.dispose();
  swordArms.clear();
  kit.lacquer.dispose();
  kit.steel.dispose();
  kit.flag.dispose();
  kit.flagTexture.dispose();
}
