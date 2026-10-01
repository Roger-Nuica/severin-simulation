// @ts-check
import * as THREE from 'three';
import { mulberry32, createDecorGeometry, DECOR_KIND_DEFS } from './roadsDecor.js';

/**
 * ===========================================================================
 * SECTION D.3 — Environment: parks
 * ===========================================================================
 * A few small green spaces breaking up the building grid. Each park is:
 *  - a lusher grass patch (with a gravel footpath loop) laid over the ground,
 *    static and never reset, like the roads;
 *  - a denser cluster of ordinary trees from createTree(), so park trees are
 *    as destructible as any other tree -- they are regenerated with the rest
 *    of the town on reset (see generateEnvironment);
 *  - a couple of benches, reusing the street decor's bench geometry/colour.
 *
 * The positions are the three pockets the town layout leaves free: the
 * x = 0 gap between the z = 8 and z = 20 streets (building spots skip
 * i = 0 there), and two lots between the ring road and the outer rows.
 */

/** @typedef {{x:number, z:number, rx:number, rz:number}} ParkDef */

/** @type {ParkDef[]} */
export const PARKS = [
  { x: 0, z: 14, rx: 12.5, rz: 3.1 },
  { x: -62, z: -46, rx: 11, rz: 9 },
  { x: 64, z: 48, rx: 12, rz: 10 }
];

// Between the ground (0) and the roads (0.01), so a road crossing a park
// edge draws on top of it; the footpath sits a hair above the grass.
const PARK_GRASS_HEIGHT = 0.006;
const PARK_PATH_HEIGHT = 0.008;
const PARK_TREE_SPACING = 3.4;
const PARK_TREE_AREA_PER_TREE = 16;
const PARK_TREES_MIN = 4;
const PARK_TREES_MAX = 10;
const PARK_BENCHES = 2;

/**
 * Lusher, brighter grass than the town ground texture, so a park reads as
 * a kept lawn against the scrubby lots around it.
 * @returns {THREE.CanvasTexture}
 */
function createParkGrassTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#4f7a3c';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    const shade = Math.random();
    g.fillStyle = `rgba(${60 + shade * 40}, ${105 + shade * 45}, ${45 + shade * 20}, 0.35)`;
    g.beginPath();
    g.arc(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 4, 0, Math.PI * 2);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   generateParkGrounds: () => void,
 *   populateParks: (group: THREE.Group, firstTreeIndex: number) => SimObject[]
 * }}
 */
export function createParksSystem(ctx) {
  const { Sim } = ctx;

  /**
   * Lays the static lawn, footpath and benches for every park. Called once
   * at bootstrap alongside generateRoads().
   * @returns {void}
   */
  function generateParkGrounds() {
    const group = new THREE.Group();
    group.name = 'parks';
    const grassMat = new THREE.MeshStandardMaterial({ map: createParkGrassTexture(), roughness: 1 });
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 1 });
    const benchDef = DECOR_KIND_DEFS.bench;
    const benchMat = new THREE.MeshStandardMaterial({ color: benchDef.colour, roughness: 0.85 });
    const benchGeo = createDecorGeometry('bench');

    PARKS.forEach((park, i) => {
      const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 40), grassMat);
      lawn.name = `park_${i}_lawn`;
      lawn.rotation.x = -Math.PI / 2;
      lawn.scale.set(park.rx, park.rz, 1);
      lawn.position.set(park.x, PARK_GRASS_HEIGHT, park.z);
      lawn.receiveShadow = true;
      group.add(lawn);

      // Footpath loop at ~60% of the lawn's radii. A RingGeometry scaled
      // non-uniformly thins along the short axis, so its inner radius is
      // chosen per park to keep the path roughly 1 unit wide both ways.
      const minR = Math.min(park.rx, park.rz);
      const inner = 1 - 1.1 / (minR * 0.6);
      const path = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.5, inner), 1, 40), pathMat);
      path.name = `park_${i}_path`;
      path.rotation.x = -Math.PI / 2;
      path.scale.set(park.rx * 0.6, park.rz * 0.6, 1);
      path.position.set(park.x, PARK_PATH_HEIGHT, park.z);
      path.receiveShadow = true;
      group.add(path);

      for (let b = 0; b < PARK_BENCHES; b++) {
        const angle = (b / PARK_BENCHES) * Math.PI * 2 + i;
        const bench = new THREE.Mesh(benchGeo, benchMat);
        bench.name = `park_${i}_bench_${b}`;
        bench.position.set(
          park.x + Math.cos(angle) * park.rx * 0.6,
          benchDef.restHeight,
          park.z + Math.sin(angle) * park.rz * 0.6
        );
        // Long side along the path, i.e. tangent to the loop.
        bench.rotation.y = -angle;
        bench.castShadow = true;
        bench.receiveShadow = true;
        group.add(bench);
      }
    });

    Sim.three.scene.add(group);
  }

  /**
   * Plants each park's tree cluster. Called from generateEnvironment(), so
   * the trees are ordinary destructible SimObjects regenerated on reset.
   * @param {THREE.Group} group environment group to parent the trees to
   * @param {number} firstTreeIndex naming index to continue from
   * @returns {SimObject[]} the trees created
   */
  function populateParks(group, firstTreeIndex) {
    const { createTree } = ctx.systems.trees;
    const trees = [];
    let index = firstTreeIndex;

    PARKS.forEach((park, i) => {
      const rand = mulberry32(9001 + i * 97);
      const area = Math.PI * park.rx * park.rz;
      const target = THREE.MathUtils.clamp(
        Math.round(area / PARK_TREE_AREA_PER_TREE), PARK_TREES_MIN, PARK_TREES_MAX
      );
      /** @type {{x:number, z:number}[]} */
      const placed = [];
      for (let attempt = 0; attempt < target * 12 && placed.length < target; attempt++) {
        // Uniform in the ellipse, kept off the outer rim so canopies stay
        // over the lawn.
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * 0.85;
        const x = park.x + Math.cos(a) * park.rx * d;
        const z = park.z + Math.sin(a) * park.rz * d;
        if (placed.some(p => Math.hypot(p.x - x, p.z - z) < PARK_TREE_SPACING)) continue;
        placed.push({ x, z });
        const tree = createTree(x, z, index++);
        group.add(tree.mesh);
        trees.push(tree);
      }
    });
    return trees;
  }

  return { generateParkGrounds, populateParks };
}
