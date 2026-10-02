import * as THREE from 'three';
import { mulberry32 } from './roadsDecor.js';
import { basinFootprint } from '../flood/basin.js';
import { VIADUCT_Z, ROUTE } from './viaduct/config.js';
import { STOREY } from '../scale.js';
import { LIGHTING } from '../lightingTuning.js';

/**
 * ===========================================================================
 * SECTION D.4 — Environment: backdrop town
 * ===========================================================================
 * Fills the ground beyond the playable town out to the edge of the 600-unit
 * ground plane with low-detail buildings and tree clumps, so the town reads
 * as part of a larger one fading into the storm rather than stopping dead a
 * short way from the camera.
 *
 * Never in Sim.objects, so physics and the vortex force field never see it --
 * but it is not untouchable. A funnel passing over it, or anything else that
 * hits the ground hard out there (a meteor, a landing ship, the chasm, the
 * flood), brings the blocks down and flattens the trees: see damageAt and
 * updateBackdrop. It is the cheap version of destruction -- a block sinks to
 * a heap of rubble, throws some debris into the storm and kicks up dust --
 * which is all a building a hundred and fifty units away needs. Everything is
 * four InstancedMeshes (blocks, hip roofs, trunks, canopies) -- four draw
 * calls for the whole backdrop, a few thousand triangles in total. None of
 * it casts or receives shadows: it all lies outside the sun's shadow
 * frustum (fitted to the playable town in scene.js) anyway.
 *
 * Lit windows come from an emissive map rather than per-pane geometry. The
 * emissive intensity is pushed past 1.0 like the real windows, so the far
 * town picks up the same glowing highlights from post.js's bloom -- faded,
 * correctly, by the scene fog.
 */

// Filler starts just past where people can wander (WORLD_BOUND 128 in
// peopleMotion.js) and runs to just inside the ground plane's +-300 edge.
const BACKDROP_INNER = 132;
const BACKDROP_OUTER = 292;
const BACKDROP_CELL = 17;
// Keep the extended streets (roadsDecor.js, ROAD_LENGTH) clear.
const BACKDROP_STREET_Z = [-20, -8, 8, 20];
const BACKDROP_STREET_X = [-30, 30];
const BACKDROP_STREET_CLEARANCE = 7;
const BACKDROP_BUILDING_CHANCE = 0.62;
const BACKDROP_TREE_CHANCE = 0.26;
const BACKDROP_HIP_ROOF_CHANCE = 0.45;
const BACKDROP_MAX_BUILDINGS = 900;
const BACKDROP_MAX_TREES = 1400;
const BACKDROP_WINDOW_GLOW = 0xffc070;
const BACKDROP_WINDOW_HDR = 1.9 * LIGHTING.buildingEmissiveScale;
const BACKDROP_WINDOW_LIT_FRACTION = 0.45;
// Destruction. A block goes down over this long, to this fraction of its
// height, leaning a little; the funnel takes anything inside this multiple
// of its radius.
const COLLAPSE_SECONDS = 1.3;
const RUBBLE_HEIGHT = 0.14;
const FUNNEL_REACH = 1.15;
const COLLAPSE_SCORE = 45;
const TREE_SCORE = 6;
const RUBBLE_TINT = new THREE.Color(0.42, 0.38, 0.34);

/**
 * A tileable facade: dark wall with a grid of panes, a share of them lit.
 * Used as an emissive map, so only the lit panes contribute; the 4-pixel
 * dark border is where the roof/floor faces' UVs are pinned so they carry
 * no windows (see createBlockGeometry).
 * @param {() => number} rand
 * @returns {THREE.CanvasTexture}
 */
function createFacadeTexture(rand) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const cells = 4;
  const cell = (size - 8) / cells;
  for (let cx = 0; cx < cells; cx++) {
    for (let cy = 0; cy < cells; cy++) {
      if (rand() > BACKDROP_WINDOW_LIT_FRACTION) continue;
      const shade = 0.7 + rand() * 0.3;
      g.fillStyle = `rgb(${Math.round(255 * shade)}, ${Math.round(255 * shade)}, ${Math.round(255 * shade)})`;
      g.fillRect(4 + cx * cell + cell * 0.3, 4 + cy * cell + cell * 0.25, cell * 0.4, cell * 0.5);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Unit box with its base at y = 0, whose top and bottom faces sample the
 * facade texture's dark border so windows only appear on the walls.
 * @returns {THREE.BoxGeometry}
 */
function createBlockGeometry() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z, four vertices each.
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.01, 0.01);
  uv.needsUpdate = true;
  return geo;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   generateBackdrop: () => void,
 *   updateBackdrop: (dt: number) => void,
 *   damageAt: (x: number, z: number, radius: number) => number,
 *   solidBlocks: () => Object[],
 *   resetBackdrop: () => void
 * }}
 */
export function createBackdropSystem(ctx) {
  const { Sim } = ctx;

  /**
   * @typedef {Object} BackdropBlock
   * @property {number} x
   * @property {number} z
   * @property {number} w
   * @property {number} h
   * @property {number} d
   * @property {number} yaw
   * @property {number} roof instance index of its roof, or -1
   * @property {number} roofH
   * @property {THREE.Color} colour
   * @property {0|1|2} state intact, falling, rubble
   * @property {number} t seconds into the fall
   * @property {number} lean random tilt it goes down with
   * @property {number} hw half its extent along x, its yaw applied
   * @property {number} hd half its extent along z
   */
  /** @type {BackdropBlock[]} */
  const blockList = [];
  /** @type {{x: number, z: number, trunkH: number, r: number, yaw: number, down: boolean}[]} */
  const treeList = [];
  /** @type {THREE.InstancedMesh|null} */
  let blocksMesh = null;
  /** @type {THREE.InstancedMesh|null} */
  let roofsMesh = null;
  /** @type {THREE.InstancedMesh|null} */
  let trunksMesh = null;
  /** @type {THREE.InstancedMesh|null} */
  let canopiesMesh = null;
  const falling = new Set();
  const dummy = new THREE.Object3D();
  const scratchColour = new THREE.Color();
  const scratchPos = new THREE.Vector3();
  const scratchVel = new THREE.Vector3();

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether a cell centre is clear of the extended streets
   */
  function clearOfStreets(x, z) {
    for (const lineZ of BACKDROP_STREET_Z) if (Math.abs(z - lineZ) < BACKDROP_STREET_CLEARANCE) return false;
    for (const lineX of BACKDROP_STREET_X) if (Math.abs(x - lineX) < BACKDROP_STREET_CLEARANCE) return false;
    // The highway's ground roads past its ramps (viaduct.js), out to the
    // bend and north along x = +-ROUTE.connectorX to the street: nothing
    // in front of a ramp, nothing on the road.
    const reach = ROUTE.connectorX + ROUTE.roadWidth / 2 + BACKDROP_STREET_CLEARANCE;
    const clear = ROUTE.roadWidth / 2 + BACKDROP_STREET_CLEARANCE;
    if (Math.abs(z - VIADUCT_Z) < clear && Math.abs(x) < reach) return false;
    if (Math.abs(Math.abs(x) - ROUTE.connectorX) < clear && z > VIADUCT_Z - clear && z < ROUTE.junctionZ) return false;
    return true;
  }

  /**
   * Builds the whole backdrop. Called once at bootstrap; never reset.
   * @returns {void}
   */
  function generateBackdrop() {
    const rand = mulberry32(1337);
    // The dam's lake and the banks round it (flood/basin.js): nothing
    // stands in the water or pokes through the earth.
    const basin = basinFootprint();

    const blockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      emissive: new THREE.Color(BACKDROP_WINDOW_GLOW).multiplyScalar(BACKDROP_WINDOW_HDR),
      emissiveMap: createFacadeTexture(rand)
    });
    const blocks = new THREE.InstancedMesh(createBlockGeometry(), blockMat, BACKDROP_MAX_BUILDINGS);
    blocks.name = 'backdrop_blocks';

    const roofGeo = new THREE.ConeGeometry(1, 1, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.5, 0);
    const roofs = new THREE.InstancedMesh(
      roofGeo, new THREE.MeshStandardMaterial({ color: 0x4a3129, roughness: 0.9 }), BACKDROP_MAX_BUILDINGS
    );
    roofs.name = 'backdrop_roofs';

    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 5);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(
      trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4f3a2a, roughness: 1 }), BACKDROP_MAX_TREES
    );
    trunks.name = 'backdrop_trunks';
    const canopies = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a5f36, roughness: 1, flatShading: true }),
      BACKDROP_MAX_TREES
    );
    canopies.name = 'backdrop_canopies';

    const colour = new THREE.Color();
    let nBlocks = 0;
    let nRoofs = 0;
    let nTrees = 0;

    for (let gx = -BACKDROP_OUTER; gx <= BACKDROP_OUTER; gx += BACKDROP_CELL) {
      for (let gz = -BACKDROP_OUTER; gz <= BACKDROP_OUTER; gz += BACKDROP_CELL) {
        const x = gx + (rand() - 0.5) * BACKDROP_CELL * 0.4;
        const z = gz + (rand() - 0.5) * BACKDROP_CELL * 0.4;
        if (Math.max(Math.abs(x), Math.abs(z)) < BACKDROP_INNER) continue;
        if (!clearOfStreets(x, z)) continue;
        // Nothing in the basin or on its banks.
        if (x < basin.maxX && x > basin.minX && Math.abs(z) < basin.halfZ) continue;

        const roll = rand();
        if (roll < BACKDROP_BUILDING_CHANCE && nBlocks < BACKDROP_MAX_BUILDINGS) {
          const w = 7 + rand() * 7;
          const d = 7 + rand() * 7;
          // Mostly low-rise with the odd tall block, so the skyline has
          // peaks rather than being a uniform wall: whole storeys, like the
          // town's own (engine/scale.js STOREY), one to three or six to nine.
          const h = rand() < 0.15 ? STOREY * (6 + Math.floor(rand() * 4)) : STOREY * (1 + Math.floor(rand() * 3));
          const yaw = rand() < 0.5 ? 0 : Math.PI / 2;
          dummy.position.set(x, 0, z);
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(w, h, d);
          dummy.updateMatrix();
          blocks.setMatrixAt(nBlocks, dummy.matrix);
          colour.setHSL(0.06 + rand() * 0.08, 0.12 + rand() * 0.12, 0.34 + rand() * 0.2);
          blocks.setColorAt(nBlocks, colour);
          const turned = yaw !== 0;
          const block = {
            x, z, w, h, d, yaw, roof: -1, roofH: 0, colour: colour.clone(), state: 0, t: 0, lean: 0,
            hw: (turned ? d : w) / 2, hd: (turned ? w : d) / 2
          };
          blockList.push(block);
          nBlocks++;

          if (h < 12 && rand() < BACKDROP_HIP_ROOF_CHANCE) {
            // A 4-sided cone of radius 1 has a square base of side sqrt(2).
            block.roofH = 2 + rand() * 1.2;
            block.roof = nRoofs;
            dummy.position.set(x, h, z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set((w / Math.SQRT2) * 1.05, block.roofH, (d / Math.SQRT2) * 1.05);
            dummy.updateMatrix();
            roofs.setMatrixAt(nRoofs++, dummy.matrix);
          }
        } else if (roll < BACKDROP_BUILDING_CHANCE + BACKDROP_TREE_CHANCE) {
          const clump = 2 + Math.floor(rand() * 4);
          for (let t = 0; t < clump && nTrees < BACKDROP_MAX_TREES; t++) {
            const tx = x + (rand() - 0.5) * BACKDROP_CELL * 0.7;
            const tz = z + (rand() - 0.5) * BACKDROP_CELL * 0.7;
            const trunkH = 3 + rand() * 2.5;
            dummy.rotation.set(0, rand() * Math.PI, 0);
            dummy.position.set(tx, 0, tz);
            dummy.scale.set(1, trunkH, 1);
            dummy.updateMatrix();
            trunks.setMatrixAt(nTrees, dummy.matrix);
            const r = 1.8 + rand() * 1.2;
            dummy.position.set(tx, trunkH + r * 0.6, tz);
            dummy.scale.set(r, r * 1.1, r);
            dummy.updateMatrix();
            canopies.setMatrixAt(nTrees, dummy.matrix);
            treeList.push({ x: tx, z: tz, trunkH, r, yaw: dummy.rotation.y, down: false });
            nTrees++;
          }
        }
      }
    }

    blocks.count = nBlocks;
    roofs.count = nRoofs;
    trunks.count = nTrees;
    canopies.count = nTrees;
    for (const mesh of [blocks, roofs, trunks, canopies]) mesh.instanceMatrix.needsUpdate = true;
    blocks.instanceColor.needsUpdate = true;

    const group = new THREE.Group();
    group.name = 'backdrop';
    group.add(blocks, roofs, trunks, canopies);
    Sim.three.scene.add(group);
    blocksMesh = blocks;
    roofsMesh = roofs;
    trunksMesh = trunks;
    canopiesMesh = canopies;
  }

  // -------------------------------------------------------------------
  // Destruction
  // -------------------------------------------------------------------

  /**
   * Writes one block's instance for how far down it has come.
   * @param {BackdropBlock} b
   * @param {number} u 0 standing .. 1 rubble
   * @param {number} index its instance
   * @returns {void}
   */
  function poseBlock(b, u, index) {
    const height = b.h * (1 - (1 - RUBBLE_HEIGHT) * u);
    dummy.position.set(b.x, 0, b.z);
    dummy.rotation.set(b.lean * u, b.yaw, b.lean * 0.6 * u);
    dummy.scale.set(b.w * (1 + 0.25 * u), height, b.d * (1 + 0.25 * u));
    dummy.updateMatrix();
    blocksMesh.setMatrixAt(index, dummy.matrix);
    scratchColour.copy(b.colour).lerp(RUBBLE_TINT, u);
    blocksMesh.setColorAt(index, scratchColour);
    if (b.roof >= 0) {
      // The roof goes first: it drops in with the walls and is gone.
      dummy.position.set(b.x, height, b.z);
      dummy.rotation.set(0, 0, 0);
      const s = Math.max(0.0001, 1 - u * 1.5);
      dummy.scale.set((b.w / Math.SQRT2) * 1.05 * s, b.roofH * s, (b.d / Math.SQRT2) * 1.05 * s);
      dummy.updateMatrix();
      roofsMesh.setMatrixAt(b.roof, dummy.matrix);
    }
  }

  /**
   * Brings one block down: the fall is animated in updateBackdrop, and the
   * fanfare happens now.
   * @param {number} index
   * @param {boolean} [intoStorm] whether a funnel took it, so its debris is
   *   thrown up to be carried off rather than just scattered
   * @returns {void}
   */
  function knockDown(index, intoStorm) {
    const b = blockList[index];
    if (b.state !== 0) return;
    b.state = 1;
    b.t = 0;
    b.lean = (Math.random() - 0.5) * 0.35;
    falling.add(index);
    scratchPos.set(b.x, 0, b.z);
    const quake = ctx.systems.earthquake;
    if (quake) quake.kickDust(b.x, b.z, 3, 1.4 + b.h / 12);
    const debris = ctx.systems.debris;
    if (debris && debris.spawnDebris) {
      const pieces = intoStorm ? 4 : 2;
      for (let k = 0; k < pieces; k++) {
        scratchPos.set(b.x + (Math.random() - 0.5) * b.w, 1 + Math.random() * b.h * 0.5, b.z + (Math.random() - 0.5) * b.d);
        scratchVel.set((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6);
        const kind = Math.random() < 0.5 ? 'box' : (Math.random() < 0.5 ? 'rock' : 'roofPiece');
        debris.spawnDebris(scratchPos, scratchVel, 40 + Math.random() * 60, 0.8 + Math.random() * 0.8, kind);
      }
    }
    if (ctx.systems.gamefeel) ctx.systems.gamefeel.event('collapse', scratchPos.set(b.x, 2, b.z));
    if (ctx.systems.damage) ctx.systems.damage.addDamageScore(COLLAPSE_SCORE);
    Sim.stats.buildingsCollapsed++;
  }

  /**
   * @param {number} index
   * @returns {void}
   */
  function knockTree(index) {
    const t = treeList[index];
    if (t.down) return;
    t.down = true;
    // Laid flat on a random bearing and left there.
    const bearing = Math.random() * Math.PI * 2;
    dummy.position.set(t.x, 0.3, t.z);
    dummy.rotation.set(Math.PI / 2 - 0.1, bearing, 0);
    dummy.scale.set(1, t.trunkH, 1);
    dummy.updateMatrix();
    trunksMesh.setMatrixAt(index, dummy.matrix);
    dummy.position.set(t.x + Math.sin(bearing) * t.trunkH, t.r * 0.7, t.z + Math.cos(bearing) * t.trunkH);
    dummy.scale.set(t.r, t.r * 0.8, t.r);
    dummy.updateMatrix();
    canopiesMesh.setMatrixAt(index, dummy.matrix);
    trunksMesh.instanceMatrix.needsUpdate = true;
    canopiesMesh.instanceMatrix.needsUpdate = true;
    if (ctx.systems.damage) ctx.systems.damage.addDamageScore(TREE_SCORE);
  }

  /**
   * Everything out here within a radius of a ground point goes down: for the
   * disasters that hit an area rather than following a funnel.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {number} how many blocks came down
   */
  function damageAt(x, z, radius) {
    if (!blocksMesh) return 0;
    let n = 0;
    for (let i = 0; i < blockList.length; i++) {
      const b = blockList[i];
      if (b.state !== 0) continue;
      if (Math.hypot(b.x - x, b.z - z) > radius + Math.max(b.w, b.d) * 0.5) continue;
      knockDown(i, false);
      n++;
    }
    for (let i = 0; i < treeList.length; i++) {
      if (treeList[i].down) continue;
      if (Math.hypot(treeList[i].x - x, treeList[i].z - z) <= radius) knockTree(i);
    }
    return n;
  }

  /**
   * Per frame: whatever a funnel is passing over comes down, and the blocks
   * already falling carry on sinking.
   * @param {number} dt
   * @returns {void}
   */
  function updateBackdrop(dt) {
    if (!blocksMesh) return;
    for (const tornado of ctx.tornadoes.active) {
      const v = tornado.Vortex;
      if (!v.birth || v.birth < 0.5) continue;
      // Only once it is out past the playable town, where the backdrop is.
      if (Math.max(Math.abs(v.center.x), Math.abs(v.center.z)) < 100) continue;
      const reach = Sim.params.radius * FUNNEL_REACH * (v.sizeMul || 1) * v.birth;
      for (let i = 0; i < blockList.length; i++) {
        const b = blockList[i];
        if (b.state !== 0) continue;
        if (Math.hypot(b.x - v.center.x, b.z - v.center.z) < reach + Math.max(b.w, b.d) * 0.5) knockDown(i, true);
      }
      for (let i = 0; i < treeList.length; i++) {
        if (treeList[i].down) continue;
        if (Math.hypot(treeList[i].x - v.center.x, treeList[i].z - v.center.z) < reach) knockTree(i);
      }
    }
    if (!falling.size) return;
    for (const index of falling) {
      const b = blockList[index];
      b.t += dt;
      const u = Math.min(1, b.t / COLLAPSE_SECONDS);
      // Slow to start, then all at once.
      poseBlock(b, u * u, index);
      if (u >= 1) {
        b.state = 2;
        falling.delete(index);
      }
    }
    blocksMesh.instanceMatrix.needsUpdate = true;
    blocksMesh.instanceColor.needsUpdate = true;
    roofsMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Stands the whole backdrop back up, for a fresh run.
   * @returns {void}
   */
  function resetBackdrop() {
    if (!blocksMesh) return;
    falling.clear();
    for (let i = 0; i < blockList.length; i++) {
      const b = blockList[i];
      if (b.state === 0) continue;
      b.state = 0;
      poseBlock(b, 0, i);
    }
    for (let i = 0; i < treeList.length; i++) {
      const t = treeList[i];
      if (!t.down) continue;
      t.down = false;
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.yaw, 0);
      dummy.scale.set(1, t.trunkH, 1);
      dummy.updateMatrix();
      trunksMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.set(t.x, t.trunkH + t.r * 0.6, t.z);
      dummy.scale.set(t.r, t.r * 1.1, t.r);
      dummy.updateMatrix();
      canopiesMesh.setMatrixAt(i, dummy.matrix);
    }
    for (const mesh of [blocksMesh, roofsMesh, trunksMesh, canopiesMesh]) mesh.instanceMatrix.needsUpdate = true;
    blocksMesh.instanceColor.needsUpdate = true;
  }

  /**
   * The blocks still standing, for Roger to walk round (heroMode.js): he
   * can now go out as far as the last of them, and stops against them
   * rather than walking through. Skip any whose `state` is not 0.
   * @returns {BackdropBlock[]}
   */
  function solidBlocks() {
    return blockList;
  }

  return { generateBackdrop, updateBackdrop, damageAt, solidBlocks, resetBackdrop };
}
