// @ts-check
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LIGHTING } from '../lightingTuning.js';
import { createSoftDotTexture } from '../../utils/textures.js';

/**
 * Deterministic pseudo-random generator so environment layout is stable
 * across reloads for a given seed.
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @typedef {'streetlight'|'fence'|'bench'|'mailbox'} DecorKind
 */

/** @type {Object<DecorKind, {colour:number, count:number, restHeight:number}>} */
export const DECOR_KIND_DEFS = {
  streetlight: { colour: 0x3a3f47, count: 26, restHeight: 2.1 },
  fence: { colour: 0x6b5a45, count: 40, restHeight: 0.45 },
  bench: { colour: 0x2f4a34, count: 16, restHeight: 0.21 },
  mailbox: { colour: 0x7a2f2f, count: 16, restHeight: 0.45 }
};

// Streets run on out through the backdrop town (see backdrop.js) nearly to
// the edge of the 600-unit ground plane, so the grid visibly continues
// towards the horizon instead of stopping at the edge of the playable town.
const ROAD_LENGTH = 580;
// Exported so the elevated highway (environment/viaduct.js) is surfaced in
// the same material as the roads it flies over, rather than merely a similar
// grey.
export const ROAD_COLOUR = 0x232830;

/**
 * @typedef {'trashCan'|'hydrant'|'sign'|'bicycle'} ClutterKind
 */

// Small street clutter on the pavements, for close-range richness. Each
// kind is one InstancedMesh with baked vertex colours (so a hydrant can be
// red with a grey cap, a sign grey with a blue plate) and one draw call.
/** @type {Object<ClutterKind, {count:number, yaw:'along'|'across'|'random'}>} */
const CLUTTER_KIND_DEFS = {
  trashCan: { count: 34, yaw: 'random' },
  hydrant: { count: 22, yaw: 'random' },
  sign: { count: 20, yaw: 'across' },
  bicycle: { count: 18, yaw: 'along' }
};
// Distance from a street's centre line to the pavement strip clutter sits
// on (roads are 5 wide), and clearance kept from building footprints.
const CLUTTER_PAVEMENT_OFFSET = [3.0, 3.8];
const CLUTTER_BUILDING_CLEARANCE = 0.8;
const CLUTTER_STREET_EXTENT = 100;
const BICYCLE_FRAME_COLOURS = [0x9b2f2f, 0x2f4f8a, 0x2f6b4a, 0xb07a24, 0x6a6d73].map(h => new THREE.Color(h));

// Streetlight lamps. The pole is 4.2 tall and centred at restHeight 2.1, so
// its top is at y = 4.2; the globe sits just above it.
const STREETLIGHT_POLE_TOP = 4.2;
const STREETLIGHT_LAMP_RADIUS = 0.22;
const STREETLIGHT_LAMP_COLOUR = 0xffc27a;
// HDR gain so the globe crosses the bloom threshold in post.js (its
// luminance goes from ~0.6 to ~2) -- the halo is the "glow"; the globe
// itself is only a few pixels across at normal viewing distance.
const STREETLIGHT_LAMP_HDR = 3.2 * LIGHTING.buildingEmissiveScale;
// The pool of light each lamp throws on the ground: an additive decal
// rather than a real PointLight, since 26 real lights would add a per-light
// term to the fragment shader of every lit material in the scene.
const STREETLIGHT_POOL_SIZE = 7;
const STREETLIGHT_POOL_COLOUR = 0xffb866;
const STREETLIGHT_POOL_OPACITY = 0.3 * LIGHTING.buildingHaloScale;
// Above the roads (0.01) and the grid (0.02), so the decal is never
// z-fought by either.
const STREETLIGHT_POOL_HEIGHT = 0.035;

/**
 * @param {DecorKind} kind
 * @returns {THREE.BufferGeometry}
 */
export function createDecorGeometry(kind) {
  switch (kind) {
    case 'streetlight': return new THREE.CylinderGeometry(0.06, 0.09, 4.2, 6);
    case 'fence': return new THREE.BoxGeometry(2, 0.9, 0.08);
    case 'bench': return new THREE.BoxGeometry(1.2, 0.42, 0.5);
    case 'mailbox': return new THREE.BoxGeometry(0.35, 0.9, 0.35);
    default: return new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }
}

/**
 * Paints one flat colour into a geometry's vertex-colour attribute, so parts
 * can be merged into a single multi-coloured geometry.
 * @param {THREE.BufferGeometry} geo
 * @param {number} hex
 * @returns {THREE.BufferGeometry}
 */
function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  // mergeGeometries needs every part to carry the same attribute set, and
  // ExtrudeGeometry/TorusGeometry disagree on some; normals and uvs are all
  // these flat-coloured parts need.
  for (const name of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
  }
  return geo.index ? geo.toNonIndexed() : geo;
}

/**
 * Low-poly clutter geometry, feet at y = 0, built from a few primitives with
 * baked colours.
 * @param {ClutterKind} kind
 * @returns {THREE.BufferGeometry}
 */
function createClutterGeometry(kind) {
  switch (kind) {
    case 'trashCan': {
      const body = new THREE.CylinderGeometry(0.32, 0.27, 0.95, 10).translate(0, 0.475, 0);
      const lid = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10).translate(0, 0.99, 0);
      return mergeGeometries([tint(body, 0x2f4a3a), tint(lid, 0x23262b)]);
    }
    case 'hydrant': {
      const body = new THREE.CylinderGeometry(0.16, 0.19, 0.62, 8).translate(0, 0.31, 0);
      const cap = new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0);
      const nozzles = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0);
      return mergeGeometries([tint(body, 0xa8261f), tint(cap, 0x8c8f94), tint(nozzles, 0xa8261f)]);
    }
    case 'sign': {
      const post = new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6).translate(0, 1.15, 0);
      const plate = new THREE.BoxGeometry(0.75, 0.55, 0.04).translate(0, 2.05, 0.05);
      const band = new THREE.BoxGeometry(0.6, 0.1, 0.045).translate(0, 2.05, 0.06);
      return mergeGeometries([tint(post, 0x8c8f94), tint(plate, 0x2456a8), tint(band, 0xe8e8e8)]);
    }
    case 'bicycle':
    default: {
      // Wheels in the local YZ plane, so the bike's length runs along z.
      const wheelA = new THREE.TorusGeometry(0.34, 0.035, 5, 14).rotateY(Math.PI / 2).translate(0, 0.34, 0.52);
      const wheelB = new THREE.TorusGeometry(0.34, 0.035, 5, 14).rotateY(Math.PI / 2).translate(0, 0.34, -0.52);
      const frame = new THREE.CylinderGeometry(0.03, 0.03, 1.05, 5).rotateX(Math.PI / 2).translate(0, 0.62, 0);
      const seatPost = new THREE.CylinderGeometry(0.025, 0.025, 0.45, 5).translate(0, 0.55, -0.2);
      const bars = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5).rotateZ(Math.PI / 2).translate(0, 0.86, 0.42);
      // Near-white so the per-instance colour (BICYCLE_FRAME_COLOURS) sets
      // the frame's paint; the black parts stay black under any tint.
      const frameColour = 0xeeeeee;
      return mergeGeometries([
        tint(wheelA, 0x1b1c1f), tint(wheelB, 0x1b1c1f),
        tint(frame, frameColour), tint(seatPost, frameColour), tint(bars, 0x1b1c1f)
      ]);
    }
  }
}

/**
 * @param {Object} ctx
 * @returns {{ generateRoads: () => void, generateDecor: () => void }}
 */
export function createRoadsDecorSystem(ctx) {
  const { Sim, Environment } = ctx;

  /**
   * Builds flat, static asphalt road strips along the town's street grid
   * plus an outer ring road. Purely decorative/ground-level: added directly
   * to the scene (not to Environment.groups, which is cleared on reset) and
   * never touched by integratePhysics/updateDamage/computeVortexForce, so it
   * costs nothing per frame regardless of visual density.
   * @returns {void}
   */
  function generateRoads() {
    const roadGroup = new THREE.Group();
    roadGroup.name = 'roads';
    const roadMat = new THREE.MeshStandardMaterial({ color: ROAD_COLOUR, roughness: 1 });

    const horizontalRoadZs = [-20, -8, 8, 20];
    for (const z of horizontalRoadZs) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_LENGTH, 5), roadMat);
      road.name = `roads_horizontal_${z}`;
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.01, z);
      road.receiveShadow = true;
      roadGroup.add(road);
    }

    const verticalRoadXs = [-30, 30];
    for (const x of verticalRoadXs) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(5, ROAD_LENGTH), roadMat);
      road.name = `roads_vertical_${x}`;
      road.rotation.x = -Math.PI / 2;
      road.position.set(x, 0.01, 0);
      road.receiveShadow = true;
      roadGroup.add(road);
    }

    // Secondary ring road encircling the town centre.
    const ringRoad = new THREE.Mesh(new THREE.RingGeometry(46, 51, 48), roadMat);
    ringRoad.name = 'roads_ring';
    ringRoad.rotation.x = -Math.PI / 2;
    ringRoad.position.y = 0.01;
    ringRoad.receiveShadow = true;
    roadGroup.add(ringRoad);

    Sim.three.scene.add(roadGroup);
    Environment.roadsGroup = roadGroup;
  }

  /**
   * Scatters small static decor (streetlights, fences, benches, mailboxes)
   * along the town's building lots, one InstancedMesh per kind, with
   * matrices set once here and never updated per frame. Purely visual
   * clutter: never pushed into Sim.objects, so it is invisible to the
   * physics/damage loops no matter how much of it exists.
   * @returns {void}
   */
  function generateDecor() {
    const dummy = new THREE.Object3D();
    const spots = Environment.buildingSpots;
    if (!spots.length) return;
    /** @type {{x:number, z:number}[]} */
    const lampSpots = [];

    for (const kind of /** @type {DecorKind[]} */ (Object.keys(DECOR_KIND_DEFS))) {
      const def = DECOR_KIND_DEFS[kind];
      const geo = createDecorGeometry(kind);
      const mat = new THREE.MeshStandardMaterial({ color: def.colour, roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(geo, mat, def.count);
      // 'streetlight' | 'fence' | 'bench' | 'mailbox' -> decor_streetlight, etc.
      mesh.name = `decor_${kind}`;
      // No shadow: too small to show in a 1024 shadow map, and every caster
      // is drawn a second time into it (performance pass).
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      for (let i = 0; i < def.count; i++) {
        const spot = spots[i % spots.length];
        const angle = (i / def.count) * Math.PI * 2 + i * 0.7;
        const offset = 3.5 + (i % 3) * 1.5;
        dummy.position.set(
          spot.x + Math.cos(angle) * offset, def.restHeight, spot.z + Math.sin(angle) * offset
        );
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (kind === 'streetlight') lampSpots.push({ x: dummy.position.x, z: dummy.position.z });
      }
      mesh.count = def.count;
      mesh.instanceMatrix.needsUpdate = true;

      Sim.three.scene.add(mesh);
      Environment.decorMeshes[kind] = mesh;
    }

    addStreetlightGlow(lampSpots);
    addStreetClutter();
  }

  /**
   * Whether a ground point falls inside (or within `margin` of) any
   * building's footprint.
   * @param {number} x
   * @param {number} z
   * @param {number} margin
   * @returns {boolean}
   */
  function insideBuilding(x, z, margin) {
    for (const b of Environment.buildings) {
      const fp = b.mesh.userData.footprint;
      const p = b.mesh.position;
      if (Math.abs(x - p.x) < fp.width / 2 + margin && Math.abs(z - p.z) < fp.depth / 2 + margin) return true;
    }
    return false;
  }

  /**
   * Scatters trash cans, hydrants, signs and parked bicycles along the
   * pavements of the straight streets, skipping spots that land inside a
   * building. Static like the rest of the decor: placed once, never
   * simulated. The building check uses the town as first generated, so
   * after a reset re-rolls building positions an item can occasionally end
   * up tucked against a wall -- acceptable for background clutter.
   * @returns {void}
   */
  function addStreetClutter() {
    const rand = mulberry32(4242);
    const dummy = new THREE.Object3D();
    const streets = [
      ...[-20, -8, 8, 20].map(z => ({ axis: 'x', line: z })),
      ...[-30, 30].map(x => ({ axis: 'z', line: x }))
    ];

    for (const kind of /** @type {ClutterKind[]} */ (Object.keys(CLUTTER_KIND_DEFS))) {
      const def = CLUTTER_KIND_DEFS[kind];
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
      const mesh = new THREE.InstancedMesh(createClutterGeometry(kind), mat, def.count);
      mesh.name = `decor_${kind}`;
      // Street clutter: too small for the shadow map (performance pass).
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      let placed = 0;
      for (let attempt = 0; attempt < def.count * 20 && placed < def.count; attempt++) {
        const street = streets[Math.floor(rand() * streets.length)];
        const side = rand() < 0.5 ? -1 : 1;
        const offset = side * (CLUTTER_PAVEMENT_OFFSET[0] + rand() * (CLUTTER_PAVEMENT_OFFSET[1] - CLUTTER_PAVEMENT_OFFSET[0]));
        const along = (rand() * 2 - 1) * CLUTTER_STREET_EXTENT;
        const x = street.axis === 'x' ? along : street.line + offset;
        const z = street.axis === 'x' ? street.line + offset : along;
        if (insideBuilding(x, z, CLUTTER_BUILDING_CLEARANCE)) continue;

        // Yaw rotates local +z to (sin yaw, cos yaw) on the ground.
        const streetYaw = street.axis === 'x' ? Math.PI / 2 : 0;
        let yaw = rand() * Math.PI * 2;
        if (def.yaw === 'along') yaw = streetYaw + (rand() < 0.5 ? 0 : Math.PI);
        if (def.yaw === 'across') {
          // Plate (local +z) turned to face the carriageway it stands beside.
          yaw = street.axis === 'x' ? Math.atan2(0, -side) : Math.atan2(-side, 0);
        }

        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, yaw, 0);
        dummy.updateMatrix();
        if (kind === 'bicycle') {
          mesh.setColorAt(placed, BICYCLE_FRAME_COLOURS[Math.floor(rand() * BICYCLE_FRAME_COLOURS.length)]);
        }
        mesh.setMatrixAt(placed++, dummy.matrix);
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      Sim.three.scene.add(mesh);
      Environment.decorMeshes[kind] = mesh;
    }
  }

  /**
   * Gives every streetlight pole a lit globe and a pool of warm light on the
   * ground beneath it, as two InstancedMeshes (one draw call each for all
   * lamps). Static, like the poles they sit on.
   * @param {{x:number, z:number}[]} lampSpots pole positions on the ground plane
   * @returns {void}
   */
  function addStreetlightGlow(lampSpots) {
    if (!lampSpots.length) return;
    const dummy = new THREE.Object3D();

    const lampMat = new THREE.MeshBasicMaterial({ color: STREETLIGHT_LAMP_COLOUR });
    lampMat.color.multiplyScalar(STREETLIGHT_LAMP_HDR);
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(STREETLIGHT_LAMP_RADIUS, 12, 8), lampMat, lampSpots.length
    );
    lamps.name = 'decor_streetlightLamp';

    const poolMat = new THREE.MeshBasicMaterial({
      color: STREETLIGHT_POOL_COLOUR,
      map: createSoftDotTexture(),
      transparent: true,
      opacity: STREETLIGHT_POOL_OPACITY,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const poolGeo = new THREE.PlaneGeometry(STREETLIGHT_POOL_SIZE, STREETLIGHT_POOL_SIZE);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampSpots.length);
    pools.name = 'decor_streetlightPool';

    lampSpots.forEach((spot, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(spot.x, STREETLIGHT_POLE_TOP + STREETLIGHT_LAMP_RADIUS * 0.6, spot.z);
      dummy.updateMatrix();
      lamps.setMatrixAt(i, dummy.matrix);
      dummy.position.set(spot.x, STREETLIGHT_POOL_HEIGHT, spot.z);
      dummy.updateMatrix();
      pools.setMatrixAt(i, dummy.matrix);
    });
    lamps.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;

    Sim.three.scene.add(lamps, pools);
    Environment.decorMeshes.streetlightLamp = lamps;
    Environment.decorMeshes.streetlightPool = pools;
  }

  return { generateRoads, generateDecor };
}
