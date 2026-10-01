import * as THREE from 'three';
import { mulberry32 } from './roadsDecor.js';

/**
 * ===========================================================================
 * SECTION D.6 — Environment: fuel stations
 * ===========================================================================
 * A few petrol stations dotted through the town: a small sales kiosk at the
 * back and a wide, flat canopy on four pillars over two pumps at the front.
 * Destroying one is what sets off the Firenado (engine/firenado.js).
 *
 * Built to the same contract as buildings.js's createBuilding() -- a
 * 'building' SimObject whose root carries four detachable walls and one
 * detachable "roof" in userData.pieces -- so damage.js's existing building
 * damage (roof loss, wall loss, collapse at three walls) drives it with no
 * special case beyond the Firenado hook on collapse. Here the walls are the
 * kiosk's and the "roof" is the whole canopy, pillars and pumps included,
 * which tears off as one piece.
 */

export const FUEL_STATION_VARIANT = 'fuelStation';

const KIOSK = { width: 5.5, depth: 4, height: 3.2 };
const CANOPY = { width: 10, depth: 6.5, height: 4.6, thickness: 0.5 };
// Weaker than every regular building variant (buildings.js), so a station
// in the funnel's path is one of the first things to come apart.
const BREAK_THRESHOLD = [4.2, 5.4];

const COLOUR_KIOSK = 0xd8d2c4;
const COLOUR_KIOSK_TRIM = 0x3a3f47;
const COLOUR_CANOPY = 0xe9ecef;
const COLOUR_STRIPE = 0xc8322b;
const COLOUR_PILLAR = 0xb9bec6;
const COLOUR_PUMP = 0xc8322b;
const COLOUR_PUMP_PANEL = 0x2b2f36;

/**
 * @param {Object} ctx
 * @returns {{ createFuelStation: (x: number, z: number, seed: number) => SimObject }}
 */
export function createFuelStationSystem(ctx) {
  const { nextObjectId } = ctx;

  /**
   * Builds one pump: a red cabinet with a dark display panel on each face.
   * @param {THREE.Material} bodyMat
   * @param {THREE.Material} panelMat
   * @returns {THREE.Group}
   */
  function createPump(bodyMat, panelMat) {
    const pump = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.7, 0.6), bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.66), panelMat);
    panel.position.y = 1.25;
    const island = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.1), panelMat);
    island.position.y = 0.1;
    pump.add(body, panel, island);
    return pump;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} seed
   * @returns {SimObject}
   */
  function createFuelStation(x, z, seed) {
    const rand = mulberry32(seed + 7919);
    const root = new THREE.Group();
    root.name = `fuelStation_${seed}`;
    root.position.set(x, 0, z);
    const turned = rand() < 0.5;
    if (turned) root.rotation.y = Math.PI / 2;

    // Kiosk at the back (-z), canopy over the forecourt at the front (+z).
    const kioskZ = -CANOPY.depth / 2 + KIOSK.depth / 2 - 1.2;
    const wallMat = new THREE.MeshStandardMaterial({ color: COLOUR_KIOSK, roughness: 0.85 });
    const trimMat = new THREE.MeshStandardMaterial({ color: COLOUR_KIOSK_TRIM, roughness: 0.6 });
    const t = 0.35;
    const wallDefs = [
      { name: 'N', w: KIOSK.width, d: t, x: 0, z: kioskZ - KIOSK.depth / 2 },
      { name: 'S', w: KIOSK.width, d: t, x: 0, z: kioskZ + KIOSK.depth / 2 },
      { name: 'E', w: t, d: KIOSK.depth, x: KIOSK.width / 2, z: kioskZ },
      { name: 'W', w: t, d: KIOSK.depth, x: -KIOSK.width / 2, z: kioskZ }
    ];
    const walls = wallDefs.map(wd => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wd.w, KIOSK.height, wd.d), wallMat);
      mesh.position.set(wd.x, KIOSK.height / 2, wd.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${root.name}_wall_${wd.name}`;
      mesh.userData.pieceName = 'wall-' + wd.name;
      mesh.userData.lost = false;
      root.add(mesh);
      return mesh;
    });
    // Shop window and flat kiosk roof ride on the front and back walls, so
    // they leave with them rather than floating once the walls are gone.
    const shopWindow = new THREE.Mesh(new THREE.BoxGeometry(KIOSK.width * 0.7, 1.3, 0.08), trimMat);
    shopWindow.position.set(0, 0.2, t / 2 + 0.02);
    walls[1].add(shopWindow);
    const kioskRoof = new THREE.Mesh(new THREE.BoxGeometry(KIOSK.width + 0.4, 0.3, KIOSK.depth + 0.4), trimMat);
    kioskRoof.position.set(0, KIOSK.height / 2 + 0.15, KIOSK.depth / 2);
    kioskRoof.castShadow = true;
    walls[0].add(kioskRoof);

    // Canopy: slab with a red fascia stripe, four pillars and two pumps, all
    // one group so it detaches as the station's "roof" piece.
    const canopy = new THREE.Group();
    canopy.name = `${root.name}_roof`;
    canopy.userData.pieceName = 'roof';
    canopy.userData.lost = false;
    const slabMat = new THREE.MeshStandardMaterial({ color: COLOUR_CANOPY, roughness: 0.5 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: COLOUR_STRIPE, roughness: 0.5 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(CANOPY.width, CANOPY.thickness, CANOPY.depth), slabMat);
    slab.position.y = CANOPY.height;
    slab.castShadow = true;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(CANOPY.width + 0.06, CANOPY.thickness * 0.45, CANOPY.depth + 0.06), stripeMat
    );
    stripe.position.y = CANOPY.height - CANOPY.thickness * 0.1;
    canopy.add(slab, stripe);
    const pillarMat = new THREE.MeshStandardMaterial({ color: COLOUR_PILLAR, roughness: 0.6 });
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, CANOPY.height, 8), pillarMat);
      pillar.position.set(px * (CANOPY.width / 2 - 0.8), CANOPY.height / 2, pz * (CANOPY.depth / 2 - 0.8) + 1.4);
      pillar.castShadow = true;
      canopy.add(pillar);
    }
    const pumpMat = new THREE.MeshStandardMaterial({ color: COLOUR_PUMP, roughness: 0.55 });
    const panelMat = new THREE.MeshStandardMaterial({ color: COLOUR_PUMP_PANEL, roughness: 0.4 });
    for (const px of [-2.2, 2.2]) {
      const pump = createPump(pumpMat, panelMat);
      pump.position.set(px, 0, 1.6);
      canopy.add(pump);
    }
    canopy.position.z = 1.4;
    root.add(canopy);

    const width = CANOPY.width;
    const depth = CANOPY.depth + 2.8;
    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'building',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mass: 300,
      drag: 0,
      rooted: true,
      damageState: 'intact',
      breakThreshold: BREAK_THRESHOLD[0] + rand() * (BREAK_THRESHOLD[1] - BREAK_THRESHOLD[0]),
      liftEligible: 0,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0
    };
    root.userData.simObject = obj;
    root.userData.variant = FUEL_STATION_VARIANT;
    root.userData.pieces = { roof: canopy, walls };
    root.userData.wallHeight = KIOSK.height;
    root.userData.footprint = turned ? { width: depth, depth: width } : { width, depth };
    root.userData.windows = null;
    return obj;
  }

  return { createFuelStation };
}
