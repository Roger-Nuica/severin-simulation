// @ts-check
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { routeBetween } from '../environment/streets.js';

/**
 * ===========================================================================
 * SECTION AC — Emergency vehicles (chassis and driving)
 * ===========================================================================
 * The bodies, and the part of them that drives. What they drive *to* is
 * emergency/index.js's problem and evacuation.js's.
 *
 * Every one of these is an ordinary SimObject of type 'car', which is the
 * whole point: the vortex, the flood, a blast and a falling deck all already
 * know what to do with a car, so a fire engine can be picked up and thrown
 * through a building without a single one of those systems learning that
 * emergency services exist. The only addition is the handover -- while a
 * vehicle is upright and on the ground its own AI writes its position, and
 * the moment anything else takes hold of it the AI lets go for good.
 *
 * "For good" is deliberate. A person dropped by a tornado gets up dazed and
 * carries on; a fire engine does not. The fleet is finite and every vehicle
 * the storm catches is one that will not answer the next call, so a town
 * that starts with three engines can end the run with none -- and the fires
 * it could have put out stay lit.
 */

// How a vehicle drives. Faster than the traffic on the viaduct, because
// these have their lights on.
const DRIVE = {
  cruise: 27,
  accel: 17,
  brake: 26,
  turnRate: 2.3,             // radians/sec
  // Below this heading error a vehicle is going flat out; above it, it slows
  // to get round the corner. Without this they lean into 90-degree turns at
  // full speed and cut the corner across the pavement.
  turnSlowFrom: 0.22,
  arrive: 3.4,               // how close counts as reaching a waypoint
  // The last waypoint is the tight one, and it cannot be tighter than the
  // vehicle's own turning circle: at 10 u/s and 2.3 rad/s that circle is over
  // four units across, so a two-unit target is one a vehicle physically
  // cannot hit -- it orbits the spot for ever, nose swinging, never arriving.
  // The real radius is whichever is larger (see driveVehicle).
  arriveFinal: 2.2,
  // Speed on the run-in, as a base plus a share of the distance left. Low, so
  // the turning circle on the final approach is small enough for the radius
  // above to stay near its floor.
  approachBase: 3,
  approachGain: 1.1,
  lean: 0.16,                // body roll into a turn, radians at full lock
  // A vehicle that has been stuck against something for this long gives up
  // on its route and asks for a new one. Buildings collapse into the road.
  stuckSeconds: 2.5,
  stuckSpeed: 2.5,
  // Traffic. Every one of these drives on the same six streets, and until
  // they knew about each other they drove straight through each other.
  // `cone` is how far off the nose something has to be to count as "ahead",
  // as a fraction of the distance to it.
  lookahead: 22,
  cone: 0.55,
  gap: 9,                    // the distance a vehicle wants to keep
  // The fuel tanker is not one of ours and does not brake for anybody
  // (environment/tanker.js). Ours brake for it; if it drives into one of them
  // anyway, this is how close that has to get before it goes up.
  tankerGap: 26,
  tankerContact: 5.5
};

// The light bar. Two lenses that alternate, fast enough to read as emergency
// rather than as a turn signal.
const BEACON = {
  rate: 3.4,                 // full cycles per second
  // HDR gain so the lenses cross post.js's bloom threshold and throw a halo,
  // which is most of what makes them visible at a distance at night.
  hdr: 4.5,
  size: 0.22
};

/**
 * @typedef {Object} VehicleKind
 * @property {number} body chassis colour
 * @property {number} trim the stripe down the side
 * @property {number[]} size length, height, width of the main body
 * @property {number} cab how far along the body the cab sits, 0..1
 * @property {number[]} lights the two beacon colours
 * @property {string} label
 */

/** @type {Object<string, VehicleKind>} */
export const VEHICLE_KINDS = {
  engine: {
    body: 0xc02718, trim: 0xf2f4f6, size: [7.4, 2.5, 2.7], cab: 0.3,
    lights: [0xff2a1a, 0xffd0c0], label: 'Fire engine'
  },
  ambulance: {
    body: 0xf2f4f6, trim: 0xd8342a, size: [6.2, 2.6, 2.5], cab: 0.34,
    lights: [0xff3322, 0x50b0ff], label: 'Ambulance'
  },
  police: {
    body: 0xf2f4f6, trim: 0x1b3f8c, size: [4.9, 1.6, 2.3], cab: 0.5,
    lights: [0x2f6bff, 0xff3322], label: 'Patrol car'
  },
  bus: {
    body: 0xe0a92a, trim: 0x2b2f36, size: [11.5, 3.2, 2.9], cab: 0.12,
    lights: [0xffc040, 0xffc040], label: 'Bus'
  }
};

/**
 * @typedef {Object} Vehicle
 * @property {SimObject} obj
 * @property {string} kind a key of VEHICLE_KINDS
 * @property {THREE.Group} mesh
 * @property {THREE.Mesh[]} lenses the beacon lenses, driven per frame
 * @property {THREE.Group} chassis what leans in a turn
 * @property {number} heading radians, in the atan2(x, z) convention
 * @property {number} speed world units/sec
 * @property {Array<{x: number, z: number}>} route waypoints left to drive
 * @property {boolean} lost whether the storm has taken it; never driven again
 * @property {number} stuck seconds spent going nowhere
 * @property {number} beaconPhase
 * @property {Object|null} job whatever dispatched it, for its owner to read
 * @property {string} state owner-defined; this module only reads `lost`
 */

/**
 * Builds the shared geometry for one kind of vehicle. One merged body (so a
 * vehicle is a handful of draw calls rather than a dozen) and one merged set
 * of wheels, both reused by every vehicle of that kind.
 * @param {VehicleKind} kind
 * @returns {{body: THREE.BufferGeometry, wheels: THREE.BufferGeometry}}
 */
function buildKindGeometry(kind) {
  const [length, height, width] = kind.size;
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];
  const colour = new THREE.Color();

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {number} hex
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function add(geo, hex, x, y, z) {
    geo.translate(x, y, z);
    colour.set(hex);
    const count = geo.attributes.position.count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(geo);
  }

  // The body, sitting on its axles. +Z is forward.
  const wheelR = 0.46;
  const floor = wheelR + 0.15;
  add(new THREE.BoxGeometry(width, height, length), kind.body, 0, floor + height / 2, 0);
  // The cab: a shorter, lower box at the front, so the silhouette is not a
  // single brick.
  const cabLength = length * kind.cab;
  add(
    new THREE.BoxGeometry(width * 0.97, height * 0.72, cabLength),
    kind.body, 0, floor + height * 0.86, length / 2 - cabLength / 2
  );
  // Windscreen and side glass, dark rather than transparent: at this size a
  // real glass material buys nothing and costs a sorted draw.
  add(
    new THREE.BoxGeometry(width * 0.99, height * 0.34, cabLength * 0.5),
    0x1a2029, 0, floor + height * 1.12, length / 2 - cabLength * 0.42
  );
  // The stripe down each flank, which is what actually identifies these at a
  // distance -- the body colours are too similar in a storm's light.
  for (const side of [-1, 1]) {
    add(
      new THREE.BoxGeometry(0.06, height * 0.26, length * 0.82),
      kind.trim, side * (width / 2 + 0.01), floor + height * 0.52, 0
    );
  }
  // Something on the roof to break the box: a ladder on the engine, a vent
  // on the ambulance and the bus, nothing on the patrol car.
  if (kind.size[0] > 5.5) {
    add(
      new THREE.BoxGeometry(width * 0.5, 0.16, length * 0.6),
      kind.trim, 0, floor + height + 0.09, -length * 0.1
    );
  }

  /** @type {THREE.BufferGeometry[]} */
  const wheelParts = [];
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.34, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const w = wheelGeo.clone();
      w.translate(side * (width / 2 - 0.1), wheelR, end * (length / 2 - 1.1));
      wheelParts.push(w);
    }
  }
  wheelGeo.dispose();

  return {
    body: mergeGeometries(parts, false),
    wheels: mergeGeometries(wheelParts, false)
  };
}

/**
 * @param {Object} ctx
 * @returns {{
 *   createVehicle: (kind: string, x: number, z: number, name: string) => Vehicle,
 *   setRoute: (vehicle: Vehicle, toX: number, toZ: number) => boolean,
 *   driveVehicle: (vehicle: Vehicle, dt: number) => boolean,
 *   faceVehicle: (vehicle: Vehicle, dt: number, towardX: number, towardZ: number) => void,
 *   updateBeacon: (vehicle: Vehicle, dt: number, on: boolean) => void,
 *   checkLost: (vehicle: Vehicle) => boolean,
 *   checkTankerContact: () => void,
 *   resetVehicleTraffic: () => void,
 *   disposeVehicleAssets: () => void
 * }}
 */
export function createVehicleSystem(ctx) {
  const { Sim, nextObjectId } = ctx;

  /** @type {Object<string, {body: THREE.BufferGeometry, wheels: THREE.BufferGeometry}>} */
  const geometries = {};
  // Every vehicle this system has built, from both fleets. They share six
  // streets, so each of them has to know the others are on them.
  /** @type {Vehicle[]} */
  const traffic = [];
  /** @type {THREE.Material[]} */
  const materials = [];
  /** @type {THREE.MeshStandardMaterial|null} */
  let bodyMaterial = null;
  /** @type {THREE.MeshStandardMaterial|null} */
  let wheelMaterial = null;
  /** @type {THREE.SphereGeometry|null} */
  let lensGeometry = null;

  /** @returns {void} */
  function ensureAssets() {
    if (bodyMaterial) return;
    // One material for every vehicle of every kind: the colours are baked
    // into the merged geometry as vertex colours, so the only thing that
    // varies between an engine and a bus is its geometry.
    bodyMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.1
    });
    wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.95 });
    lensGeometry = new THREE.SphereGeometry(BEACON.size, 8, 6);
    materials.push(bodyMaterial, wheelMaterial);
  }

  /**
   * @param {string} kind
   * @param {number} x
   * @param {number} z
   * @param {string} name
   * @returns {Vehicle}
   */
  function createVehicle(kind, x, z, name) {
    ensureAssets();
    const def = VEHICLE_KINDS[kind];
    if (!geometries[kind]) geometries[kind] = buildKindGeometry(def);

    const root = new THREE.Group();
    root.name = name;
    root.position.set(x, 0, z);

    // Everything above the axles, so it can roll into a corner without the
    // wheels leaving the road (the same split environment/cars.js uses).
    const chassis = new THREE.Group();
    root.add(chassis);

    const body = new THREE.Mesh(geometries[kind].body, bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    chassis.add(body);

    const wheels = new THREE.Mesh(geometries[kind].wheels, wheelMaterial);
    wheels.castShadow = true;
    root.add(wheels);

    // The light bar: two lenses with their own materials, because they are
    // the one thing that differs vehicle to vehicle every frame.
    /** @type {THREE.Mesh[]} */
    const lenses = [];
    const [length, height] = def.size;
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: def.lights[i] });
      materials.push(mat);
      const lens = new THREE.Mesh(lensGeometry, mat);
      lens.position.set(
        (i === 0 ? -1 : 1) * 0.42, 0.61 + height + (def.cab > 0.4 ? 0 : 0.18),
        length / 2 - length * def.cab * (def.cab > 0.4 ? 0.5 : 1.1)
      );
      chassis.add(lens);
      lenses.push(lens);
    }

    Sim.three.scene.add(root);

    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'car',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      // Heavier than a family car, so the funnel has to work harder for one
      // -- and a bus is heavier again.
      mass: kind === 'bus' ? 34 : 22,
      drag: 0.9,
      rooted: false,
      damageState: 'intact',
      breakThreshold: 5.5,
      liftEligible: 0.25,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    root.userData.simObject = obj;
    // Never parked: these are the only vehicles in town that are supposed to
    // be moving, and chase mode's collider pass reads this.
    root.userData.parked = false;
    root.userData.emergency = kind;

    /** @type {Vehicle} */
    const vehicle = {
      obj, kind, mesh: root, chassis, lenses,
      heading: 0, speed: 0, route: [], lost: false, stuck: 0,
      beaconPhase: Math.random() * Math.PI * 2,
      job: null, state: 'idle'
    };
    traffic.push(vehicle);
    return vehicle;
  }

  /**
   * How far ahead the road is clear, for a vehicle about to move.
   *
   * Only things actually in front count: something beside a vehicle on a
   * two-way street is not in its way, and a cone rather than a radius is what
   * lets two of them pass rather than deadlock nose to nose.
   * @param {Vehicle} vehicle
   * @returns {number} clear distance, or Infinity
   */
  function clearAhead(vehicle) {
    const p = vehicle.mesh.position;
    const fx = Math.sin(vehicle.heading);
    const fz = Math.cos(vehicle.heading);
    let nearest = Infinity;

    for (const other of traffic) {
      if (other === vehicle || other.lost) continue;
      const q = other.mesh.position;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > DRIVE.lookahead) continue;
      const across = Math.abs(dx * fz - dz * fx);
      if (across > along * DRIVE.cone + 1.5) continue;
      nearest = Math.min(nearest, along);
    }

    const tanker = ctx.systems.tanker && ctx.systems.tanker.tankerPosition
      ? ctx.systems.tanker.tankerPosition()
      : null;
    if (tanker) {
      const dx = tanker.x - p.x;
      const dz = tanker.z - p.z;
      const along = dx * fx + dz * fz;
      const across = Math.abs(dx * fz - dz * fx);
      // A wider berth than for one of ours, because of what is in it.
      if (along > 0 && along < DRIVE.tankerGap && across < along * DRIVE.cone + 3) {
        nearest = Math.min(nearest, along);
      }
    }
    return nearest;
  }

  /**
   * The truck running into somebody. It brakes for nothing and drives a fixed
   * ring road, so sooner or later it meets one of ours broadside -- and a
   * loaded evacuation bus is the one it is worth meeting.
   * @returns {void}
   */
  function checkTankerContact() {
    const tanker = ctx.systems.tanker;
    if (!tanker || !tanker.tankerPosition) return;
    // Only once a storm is running. The tanker drives its ring before Start
    // now (tornadoEngine.js runs the town's physics then too), and so do the
    // fire engines sent to whatever the aliens set alight: a bump there blew
    // the town's biggest explosion, and the gas mains and power lines with
    // it, while the town was still standing by.
    if (!Sim.state.running) return;
    const at = tanker.tankerPosition();
    if (!at) return;
    for (const vehicle of traffic) {
      if (vehicle.lost) continue;
      const p = vehicle.mesh.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) > DRIVE.tankerContact) continue;
      tanker.detonate();
      return;
    }
  }

  /**
   * Plots a route to a destination, along the streets and around whatever is
   * lying in them.
   * @param {Vehicle} vehicle
   * @param {number} toX
   * @param {number} toZ
   * @returns {boolean} whether a way through exists at all. False means every
   *   approach is buried (engine/rubble.js), which is a fire nobody is going
   *   to reach -- the caller's job is to say so rather than to keep trying.
   */
  function setRoute(vehicle, toX, toZ) {
    const p = vehicle.mesh.position;
    const rubble = ctx.systems.rubble;
    const route = routeBetween(
      p.x, p.z, toX, toZ,
      rubble ? (ax, az, bx, bz) => rubble.blocksSegment(ax, az, bx, bz) : null
    );
    vehicle.route = route || [];
    vehicle.stuck = 0;
    return Boolean(route);
  }

  /**
   * Whether the storm (or a blast, or a falling deck) has taken this vehicle.
   * Once it has, the vehicle is out of service permanently -- its owner drops
   * whatever job it was on and never dispatches it again.
   * @param {Vehicle} vehicle
   * @returns {boolean}
   */
  function checkLost(vehicle) {
    if (vehicle.lost) return true;
    if (vehicle.obj.captureState !== 'grounded' || vehicle.obj.damageState !== 'intact') {
      vehicle.lost = true;
      vehicle.route.length = 0;
      vehicle.speed = 0;
      // Physics owns the body from here, including its rotation, so the AI
      // stops writing either.
      return true;
    }
    return false;
  }

  /**
   * Turns a vehicle towards a bearing at its turn rate.
   * @param {Vehicle} vehicle
   * @param {number} dt
   * @param {number} desired
   * @returns {number} the heading error that remained, in radians
   */
  function turnToward(vehicle, dt, desired) {
    let error = desired - vehicle.heading;
    while (error > Math.PI) error -= Math.PI * 2;
    while (error < -Math.PI) error += Math.PI * 2;
    const step = Math.min(Math.abs(error), DRIVE.turnRate * dt) * Math.sign(error);
    vehicle.heading += step;
    return error;
  }

  /**
   * Turns a stationary vehicle to point at something -- a fire it is playing
   * a jet onto, the kerb it is pulling up against.
   * @param {Vehicle} vehicle
   * @param {number} dt
   * @param {number} towardX
   * @param {number} towardZ
   * @returns {void}
   */
  function faceVehicle(vehicle, dt, towardX, towardZ) {
    if (checkLost(vehicle)) return;
    const p = vehicle.mesh.position;
    turnToward(vehicle, dt, Math.atan2(towardX - p.x, towardZ - p.z));
    vehicle.speed = Math.max(0, vehicle.speed - DRIVE.brake * dt);
    vehicle.mesh.rotation.y = vehicle.heading;
    vehicle.chassis.rotation.z *= Math.max(0, 1 - 6 * dt);
  }

  /**
   * One frame of driving. Writes the vehicle's own position, which is why
   * this has to run *after* integratePhysics -- the same handover
   * environment/peopleMotion.js uses for a walking person.
   * @param {Vehicle} vehicle
   * @param {number} dt
   * @returns {boolean} whether it has arrived (the route is finished)
   */
  function driveVehicle(vehicle, dt) {
    if (checkLost(vehicle)) return false;
    if (!vehicle.route.length) {
      vehicle.speed = Math.max(0, vehicle.speed - DRIVE.brake * dt);
      return true;
    }

    const p = vehicle.mesh.position;
    const target = vehicle.route[0];
    const last = vehicle.route.length === 1;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const distance = Math.hypot(dx, dz);

    const reach = last
      ? Math.max(DRIVE.arriveFinal, vehicle.speed / DRIVE.turnRate * 0.9)
      : DRIVE.arrive;
    if (distance < reach) {
      vehicle.route.shift();
      if (!vehicle.route.length) return true;
      return false;
    }

    const error = Math.abs(turnToward(vehicle, dt, Math.atan2(dx, dz)));

    // Slow for the corner, and slow again on the run-in so it stops at the
    // kerb rather than through it.
    let wanted = DRIVE.cruise;
    if (error > DRIVE.turnSlowFrom) {
      wanted *= Math.max(0.24, 1 - (error - DRIVE.turnSlowFrom) / (Math.PI * 0.55));
    }
    if (last) wanted = Math.min(wanted, DRIVE.approachBase + distance * DRIVE.approachGain);
    // Whatever is in front sets the ceiling: matched at the gap, stopped
    // inside it.
    const ahead = clearAhead(vehicle);
    if (ahead < DRIVE.lookahead) {
      wanted = Math.min(wanted, Math.max(0, (ahead - DRIVE.gap) * 2.4));
    }
    vehicle.speed += THREE.MathUtils.clamp(
      wanted - vehicle.speed, -DRIVE.brake * dt, DRIVE.accel * dt
    );

    const moved = vehicle.speed * dt;
    p.x += Math.sin(vehicle.heading) * moved;
    p.z += Math.cos(vehicle.heading) * moved;
    p.y = 0;
    vehicle.mesh.rotation.y = vehicle.heading;
    // Roll into the corner, proportional to how hard it is turning and how
    // fast it is going.
    const lean = -THREE.MathUtils.clamp(error, -1, 1) * DRIVE.lean
      * (vehicle.speed / DRIVE.cruise);
    vehicle.chassis.rotation.z += (lean - vehicle.chassis.rotation.z) * Math.min(1, 7 * dt);

    // Rubble in the road, or a route that has become nonsense because what it
    // was driving to has gone. Either way, ask again.
    if (vehicle.speed < DRIVE.stuckSpeed) {
      vehicle.stuck += dt;
      if (vehicle.stuck > DRIVE.stuckSeconds) {
        vehicle.stuck = 0;
        vehicle.route.length = 0;
        return true;
      }
    } else {
      vehicle.stuck = 0;
    }
    return false;
  }

  /**
   * @param {Vehicle} vehicle
   * @param {number} dt
   * @param {boolean} on
   * @returns {void}
   */
  function updateBeacon(vehicle, dt, on) {
    if (!on || vehicle.lost) {
      for (const lens of vehicle.lenses) {
        lens.material.color.set(VEHICLE_KINDS[vehicle.kind].lights[vehicle.lenses.indexOf(lens)]);
        lens.material.color.multiplyScalar(0.25);
      }
      return;
    }
    vehicle.beaconPhase += dt * BEACON.rate * Math.PI * 2;
    const wave = Math.sin(vehicle.beaconPhase);
    for (let i = 0; i < vehicle.lenses.length; i++) {
      const lens = vehicle.lenses[i];
      // The two lenses are half a cycle apart, so they alternate rather than
      // pulsing together.
      const lit = Math.max(0, i === 0 ? wave : -wave);
      lens.material.color.set(VEHICLE_KINDS[vehicle.kind].lights[i]);
      lens.material.color.multiplyScalar(0.2 + lit * lit * BEACON.hdr);
    }
  }

  /** @returns {void} */
  function disposeVehicleAssets() {
    for (const kind of Object.values(geometries)) {
      kind.body.dispose();
      kind.wheels.dispose();
    }
    for (const key of Object.keys(geometries)) delete geometries[key];
    for (const mat of materials) mat.dispose();
    materials.length = 0;
    if (lensGeometry) lensGeometry.dispose();
    lensGeometry = null;
    bodyMaterial = null;
    wheelMaterial = null;
  }

  /** @returns {void} */
  function resetVehicleTraffic() {
    traffic.length = 0;
  }

  return {
    createVehicle, setRoute, driveVehicle, faceVehicle, updateBeacon, checkLost,
    checkTankerContact, resetVehicleTraffic, disposeVehicleAssets
  };
}
