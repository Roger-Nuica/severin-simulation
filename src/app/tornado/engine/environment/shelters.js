// @ts-check
import * as THREE from 'three';
import { hideBuildingWindows } from './buildings.js';

/**
 * ===========================================================================
 * SECTION D.7 — Environment: storm shelters
 * ===========================================================================
 * A few ordinary buildings in each town are storm shelters: somewhere a
 * fleeing person can run to and get inside. environment/index.js picks
 * which (SHELTER_SPOT_FRACTIONS there) and calls markShelter() on them.
 *
 *  - Each shelter gets a door and a small green sign on its front and back
 *    facades, so it reads as different from its neighbours. The sign is
 *    unlit (MeshBasicMaterial), so it shows at night like a lit sign.
 *  - Its two entrances are points just outside those doors, clear of the
 *    collision box people steer round (peopleMotion.js).
 *  - damage.js skips shelters entirely, so they stand whatever the storm:
 *    a shelter that could be torn apart would not be a refuge.
 *  - A person who reaches an entrance goes inside: they are removed from
 *    the scene and counted in Sim.stats.peopleSheltered.
 *
 * peopleMotion.js decides when a fleeing person heads for one
 * (pickShelterEntrance).
 */

// Out from the facade, past peopleMotion.js's PERSON_CLEARANCE (1.1), so
// the entrance lies outside the box people are kept out of.
const ENTRANCE_OFFSET = 2.2;
// A person this close to an entrance has made it inside.
export const SHELTER_ARRIVE_DISTANCE = 2.4;
// A shelter is only worth running to if the way there does not lead
// towards the funnel: the angle between "towards the shelter" and
// "towards the funnel" must be at least this.
const MIN_ANGLE_FROM_FUNNEL = THREE.MathUtils.degToRad(55);

const SIGN = { width: 3.6, height: 1.2, maxY: 3.6 };
const DOOR = { width: 2.2, height: 2.6 };
const DOOR_COLOUR = 0x1f5a3a;

/**
 * @typedef {Object} ShelterEntrance
 * @property {number} x
 * @property {number} z
 * @property {SimObject} building
 */

/**
 * Paints the sign: a green panel with a white house-and-arrow pictogram
 * and SHELTER beside it.
 * @returns {THREE.CanvasTexture}
 */
function createShelterSignTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 86;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1f9d55';
  g.beginPath();
  g.roundRect(0, 0, 256, 86, 12);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(5, 5, 246, 76, 9);
  g.stroke();
  // House outline with a downward arrow into it: "go inside".
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(18, 44); g.lineTo(46, 18); g.lineTo(74, 44);
  g.lineTo(66, 44); g.lineTo(66, 70); g.lineTo(26, 70); g.lineTo(26, 44);
  g.closePath();
  g.fill();
  g.fillStyle = '#1f9d55';
  g.beginPath();
  g.moveTo(39, 40); g.lineTo(53, 40); g.lineTo(53, 52); g.lineTo(60, 52);
  g.lineTo(46, 65); g.lineTo(32, 52); g.lineTo(39, 52);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 34px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('SHELTER', 86, 46);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   markShelter: (obj: SimObject) => void,
 *   pickShelterEntrance: (x: number, z: number, funnelX: number, funnelZ: number, distToFunnel: number, safeRadius: number) => ShelterEntrance|null,
 *   admitPerson: (person: SimObject) => void
 * }}
 */
// Ordinary buildings sit at 5.5-9.5 (see createBuilding). 34 was tried first
// and measured: an EF5 Monster flattened one shelter inside a sim-second and
// two within four, which is not "the last thing standing". The wind magnitude
// near an EF5 core is far larger than the ordinary building range suggests,
// so this needs to be an order above them rather than a multiple.
const SHELTER_BREAK_THRESHOLD = 90;

// Bunker dressing. A shelter used to be an ordinary building with a sign on
// it, which meant it kept the same pastel walls and the same grid of warmly
// lit windows as the flats next door -- so it read as an apartment block that
// happened to be indestructible rather than as somewhere to run to. Bare
// board-marked concrete and no glazing at all is what makes it obvious at a
// glance which building is the safe one.
const BUNKER_WALL_COLOUR = 0x7d7a73;
const BUNKER_ROOF_COLOUR = 0x5f5d58;
// A band around the base, so the silhouette is not one flat slab of grey.
const BUNKER_PLINTH_COLOUR = 0x4a4844;
const BUNKER_PLINTH_HEIGHT = 0.9;

export function createShelterSystem(ctx) {
  const { Sim } = ctx;

  // Shared by every shelter; built on first use.
  /** @type {{sign: THREE.MeshBasicMaterial, door: THREE.MeshStandardMaterial, signGeo: THREE.PlaneGeometry, doorGeo: THREE.BoxGeometry}|null} */
  let shared = null;
  /** @type {THREE.Material[]} materials made per shelter, for disposal */
  const materials = [];
  /** @type {ShelterEntrance[]} */
  let entrances = [];
  /** @type {SimObject[]|null} the Environment.buildings array entrances belong to */
  let entrancesSource = null;

  /** @returns {NonNullable<typeof shared>} */
  function sharedAssets() {
    if (!shared) {
      shared = {
        sign: new THREE.MeshBasicMaterial({ map: createShelterSignTexture(), toneMapped: false }),
        door: new THREE.MeshStandardMaterial({ color: DOOR_COLOUR, roughness: 0.6 }),
        signGeo: new THREE.PlaneGeometry(SIGN.width, SIGN.height),
        doorGeo: new THREE.BoxGeometry(DOOR.width, DOOR.height, 0.12)
      };
    }
    return shared;
  }

  /**
   * Turns a freshly created building into a shelter: door and sign on the
   * front (S) and back (N) walls, and its two entrances recorded.
   * @param {SimObject} obj
   * @returns {void}
   */
  function markShelter(obj) {
    // Built to take it. Shelters are no longer exempt from damage (that made
    // four buildings in town literally indestructible, sitting fully lit in
    // the middle of a flattened street), so this is what keeps them standing
    // long after everything around them has gone: roughly four times the
    // sturdiest ordinary building's threshold, which an EF5 can still beat.
    obj.breakThreshold = SHELTER_BREAK_THRESHOLD;
    const root = obj.mesh;
    const assets = sharedAssets();
    const walls = root.userData.pieces.walls;
    const wallHeight = root.userData.wallHeight;
    // Local depth: the footprint is swapped for turned buildings.
    const turned = Math.abs(root.rotation.y) > 0.1;
    const fp = root.userData.footprint;
    const depth = turned ? fp.width : fp.depth;
    const signY = Math.min(SIGN.maxY, wallHeight - SIGN.height / 2 - 0.2);

    root.updateMatrixWorld(true);
    /** @type {ShelterEntrance[]} */
    const own = [];
    for (const [wall, side] of [[walls[1], 1], [walls[0], -1]]) {
      // Children of the wall, in its frame: the wall's centre is at half its
      // height, and its outer face at +-0.2 (wall thickness 0.4).
      const face = side * 0.27;
      const door = new THREE.Mesh(assets.doorGeo, assets.door);
      door.position.set(0, DOOR.height / 2 - wallHeight / 2, face);
      const sign = new THREE.Mesh(assets.signGeo, assets.sign);
      sign.position.set(0, signY - wallHeight / 2, side * 0.3);
      if (side < 0) sign.rotation.y = Math.PI;
      wall.add(door, sign);
      const entrance = new THREE.Vector3(0, 0, side * (depth / 2 + ENTRANCE_OFFSET));
      root.localToWorld(entrance);
      own.push({ x: entrance.x, z: entrance.z, building: obj });
    }
    // Dressed as a bunker rather than a block of flats: bare concrete, a
    // heavier roof, a plinth around the base, and -- the thing that actually
    // sold it as an ordinary building before -- not one lit window.
    hideBuildingWindows(root);
    root.userData.windows = null;
    const wallMat = new THREE.MeshStandardMaterial({ color: BUNKER_WALL_COLOUR, roughness: 1 });
    const plinthMat = new THREE.MeshStandardMaterial({ color: BUNKER_PLINTH_COLOUR, roughness: 1 });
    materials.push(wallMat, plinthMat);
    for (const wall of walls) wall.material = wallMat;
    const roof = root.userData.pieces.roof;
    roof.traverse((/** @type {any} */ child) => {
      if (!child.isMesh) return;
      const roofMat = new THREE.MeshStandardMaterial({ color: BUNKER_ROOF_COLOUR, roughness: 1 });
      materials.push(roofMat);
      child.material = roofMat;
    });
    // Built in the root's own frame, which is turned for half the buildings,
    // so the footprint's world dimensions are swapped back here.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(
      (turned ? fp.depth : fp.width) + 0.6, BUNKER_PLINTH_HEIGHT, (turned ? fp.width : fp.depth) + 0.6
    ), plinthMat);
    plinth.position.y = BUNKER_PLINTH_HEIGHT / 2;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    root.add(plinth);

    obj.shelter = true;
    obj.shelterEntrances = own;
    root.userData.shelter = true;
  }

  /**
   * @returns {ShelterEntrance[]} every entrance in the current town
   */
  function currentEntrances() {
    const buildings = ctx.Environment.buildings;
    if (buildings !== entrancesSource) {
      entrancesSource = buildings;
      entrances = buildings.filter(b => b.shelter).flatMap(b => b.shelterEntrances);
    }
    return entrances;
  }

  /**
   * The nearest entrance worth running to from (x, z), or null. Worth it
   * means: nearer than the funnel, not itself inside the funnel's danger
   * radius, and not in the funnel's direction.
   * @param {number} x
   * @param {number} z
   * @param {number} funnelX
   * @param {number} funnelZ
   * @param {number} distToFunnel
   * @param {number} safeRadius an entrance nearer the funnel than this is not safe
   * @returns {ShelterEntrance|null}
   */
  function pickShelterEntrance(x, z, funnelX, funnelZ, distToFunnel, safeRadius) {
    const toFunnel = Math.atan2(funnelX - x, funnelZ - z);
    let best = null;
    let bestDist = distToFunnel;
    for (const e of currentEntrances()) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d >= bestDist) continue;
      if (Math.hypot(e.x - funnelX, e.z - funnelZ) < safeRadius) continue;
      const toShelter = Math.atan2(e.x - x, e.z - z);
      const angle = Math.abs(Math.atan2(Math.sin(toShelter - toFunnel), Math.cos(toShelter - toFunnel)));
      // Right next to the door, it is worth ducking in whatever the angle.
      if (angle < MIN_ANGLE_FROM_FUNNEL && d > SHELTER_ARRIVE_DISTANCE * 2) continue;
      best = e;
      bestDist = d;
    }
    return best;
  }

  /**
   * A person made it inside: out of the scene and the simulation, and
   * counted.
   * @param {SimObject} person
   * @returns {void}
   */
  function admitPerson(person) {
    removePerson(person);
    Sim.stats.peopleSheltered++;
  }

  /**
   * Takes a person out of the simulation, alive. The shared path for every
   * way someone can stop being the storm's problem: through a shelter door
   * (above), into an ambulance, or onto an evacuation bus
   * (engine/emergency/index.js, engine/evacuation.js). It is only the counter
   * that differs, so only the counter lives with the caller.
   * @param {SimObject} person
   * @returns {void}
   */
  function removePerson(person) {
    // The environment group, not the scene, is the parent (see
    // people.js explodePerson).
    person.mesh.removeFromParent();
    person.mesh.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    const objIdx = Sim.objects.indexOf(person);
    if (objIdx !== -1) Sim.objects.splice(objIdx, 1);
    const envIdx = ctx.Environment.people.indexOf(person);
    if (envIdx !== -1) ctx.Environment.people.splice(envIdx, 1);
  }

  return { markShelter, pickShelterEntrance, admitPerson, removePerson };
}
