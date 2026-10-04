// @ts-check
import * as THREE from 'three';
import { HANK } from './moves.js';

/**
 * ===========================================================================
 * SECTION AH.2 — Hank Granite: the Human Landslide's body
 * ===========================================================================
 * A man of faceted granite boulders held together by magma: every joint is
 * a glowing orange core showing between the stones, and glowing seams run
 * across his chest. He keeps what made Hank Hank: the red bandana and the
 * dark glasses, and a beard of darker stone. Huge stone fists. 3.2 m.
 *
 * Built in his own frame (+z forward, feet at y = 0) with pivots for hips,
 * shoulders and elbows, plus `torso` (the whole upper body, to twist and
 * crouch). `magma` is the one emissive material his rage drives
 * (emissiveIntensity). Also the boulder he arrives in, and loose chunks.
 */

/**
 * @returns {{group: THREE.Group, torso: THREE.Group, hips: THREE.Object3D[], shoulders: THREE.Object3D[], elbows: THREE.Object3D[],
 *   fists: THREE.Object3D[], magma: THREE.MeshStandardMaterial, materials: THREE.Material[], geometries: THREE.BufferGeometry[]}}
 */
export function buildHank() {
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  const rock = (/** @type {number} */ r, detail = 0) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    geometries.push(g);
    return g;
  };
  const stoneA = new THREE.MeshStandardMaterial({ color: 0x8d8780, roughness: 0.95, metalness: 0.05, flatShading: true });
  const stoneB = new THREE.MeshStandardMaterial({ color: 0x6f6a64, roughness: 0.95, metalness: 0.05, flatShading: true });
  const stoneC = new THREE.MeshStandardMaterial({ color: 0x4a4541, roughness: 1, flatShading: true });
  const magma = new THREE.MeshStandardMaterial({
    color: 0x3a1204, emissive: new THREE.Color(1, 0.38, 0.06), emissiveIntensity: 1.2, roughness: 0.6
  });
  const bandana = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.8 });
  const glasses = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.08, metalness: 0.6 });
  const materials = [stoneA, stoneB, stoneC, magma, bandana, glasses];

  const group = new THREE.Group();
  group.name = 'hank_granite';
  /**
   * @param {THREE.BufferGeometry} g @param {THREE.Material} m @param {THREE.Object3D} parent
   * @param {number} x @param {number} y @param {number} z @param {number[]} [s] scale
   */
  const add = (g, m, parent, x, y, z, s) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    if (s) mesh.scale.set(s[0], s[1], s[2]);
    mesh.rotation.set(x * 3.1, y * 1.7, z * 2.3);
    mesh.castShadow = m !== magma;
    parent.add(mesh);
    return mesh;
  };

  // Legs.
  /** @type {THREE.Object3D[]} */
  const hips = [];
  for (const sx of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.38, 1.38, 0);
    group.add(hip);
    add(rock(0.34), stoneA, hip, 0, -0.36, 0, [1, 1.35, 1]);
    add(rock(0.17, 1), magma, hip, 0, -0.74, 0.02);
    add(rock(0.3), stoneB, hip, 0, -1.0, 0, [1, 1.2, 1]);
    add(rock(0.3), stoneC, hip, 0, -1.28, 0.12, [1.25, 0.5, 1.55]);
    hips.push(hip);
  }
  // The upper body, as one piece that twists and crouches.
  const torso = new THREE.Group();
  torso.position.set(0, 1.45, 0);
  group.add(torso);
  add(rock(0.46), stoneB, torso, 0, 0, 0, [1.35, 0.7, 0.95]);
  add(rock(0.36, 1), magma, torso, 0, 0.32, 0);
  add(rock(0.66), stoneA, torso, 0, 0.72, 0, [1.4, 0.95, 0.85]);
  for (const sx of [-1, 1]) add(rock(0.32), stoneB, torso, sx * 0.32, 0.82, 0.36, [1.1, 0.8, 0.6]);
  // Glowing seams across the chest.
  const seamGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06);
  geometries.push(seamGeo);
  for (const [x, y, r] of [[-0.12, 0.62, 0.5], [0.18, 0.78, -0.4], [0.02, 0.46, 0.1], [-0.4, 0.86, -0.9], [0.44, 0.5, 0.8]]) {
    const seam = new THREE.Mesh(seamGeo, magma);
    seam.position.set(x, y, 0.58);
    seam.rotation.z = r;
    torso.add(seam);
  }
  // Neck, head, beard, bandana, glasses.
  add(rock(0.2, 1), magma, torso, 0, 1.18, 0);
  add(rock(0.33), stoneA, torso, 0, 1.42, 0.02, [1, 1.12, 1]);
  add(rock(0.24), stoneC, torso, 0, 1.24, 0.2, [1.2, 0.8, 0.8]);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.06, 6, 16), bandana);
  geometries.push(band.geometry);
  band.position.set(0, 1.56, 0.02);
  band.rotation.x = Math.PI / 2;
  torso.add(band);
  const knotGeo = new THREE.BoxGeometry(0.12, 0.08, 0.22);
  geometries.push(knotGeo);
  for (const sx of [-1, 1]) {
    const tail = new THREE.Mesh(knotGeo, bandana);
    tail.position.set(sx * 0.06, 1.5, -0.36);
    tail.rotation.set(0.7, 0, sx * 0.4);
    torso.add(tail);
  }
  const shadesGeo = new THREE.BoxGeometry(0.46, 0.1, 0.06);
  geometries.push(shadesGeo);
  const shades = new THREE.Mesh(shadesGeo, glasses);
  shades.position.set(0, 1.45, 0.32);
  torso.add(shades);
  // Shoulders and arms, ending in huge fists.
  /** @type {THREE.Object3D[]} */
  const shoulders = [];
  /** @type {THREE.Object3D[]} */
  const elbows = [];
  /** @type {THREE.Object3D[]} */
  const fists = [];
  for (const sx of [-1, 1]) {
    add(rock(0.4), stoneB, torso, sx * 0.88, 1.0, 0, [1, 0.85, 1]);
    add(rock(0.2, 1), magma, torso, sx * 0.7, 0.86, 0);
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.92, 0.9, 0);
    torso.add(shoulder);
    add(rock(0.26), stoneA, shoulder, 0, -0.36, 0, [1, 1.45, 1]);
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.72, 0);
    shoulder.add(elbow);
    add(rock(0.15, 1), magma, elbow, 0, 0, 0);
    add(rock(0.27), stoneB, elbow, 0, -0.3, 0, [1, 1.35, 1]);
    const fist = add(rock(0.34), stoneC, elbow, 0, -0.66, 0.04, [1.05, 1, 1.05]);
    shoulder.rotation.z = sx * 0.18;
    shoulders.push(shoulder);
    elbows.push(elbow);
    fists.push(fist);
  }
  group.scale.setScalar(HANK.height / 3.2);
  return { group, torso, hips, shoulders, elbows, fists, magma, materials, geometries };
}

/**
 * The boulder he arrives in: one big stone with magma glowing through its
 * cracks, and the chunks it bursts into.
 * @param {THREE.MeshStandardMaterial} magma
 * @returns {{boulder: THREE.Group, chunks: THREE.Mesh[], materials: THREE.Material[], geometries: THREE.BufferGeometry[]}}
 */
export function buildBoulder(magma) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x7c766f, roughness: 0.95, flatShading: true });
  const shell = new THREE.IcosahedronGeometry(1.9, 1);
  const core = new THREE.IcosahedronGeometry(1.75, 1);
  const chunkGeo = new THREE.IcosahedronGeometry(0.45, 0);
  const boulder = new THREE.Group();
  boulder.name = 'hank_boulder';
  const outer = new THREE.Mesh(shell, stone);
  outer.castShadow = true;
  boulder.add(outer);
  // The core shows through as the shell is scaled down a touch per axis: cracks.
  boulder.add(new THREE.Mesh(core, magma));
  outer.scale.set(1, 0.97, 1.02);
  /** @type {THREE.Mesh[]} */
  const chunks = [];
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Mesh(chunkGeo, stone);
    c.castShadow = true;
    c.visible = false;
    chunks.push(c);
  }
  return { boulder, chunks, materials: [stone], geometries: [shell, core, chunkGeo] };
}
