// @ts-check
import * as THREE from 'three';
import { STREET_Z_LINES, STREET_HALF_LENGTH, STREET_LANE_OFFSET } from './streets.js';

/**
 * ===========================================================================
 * SECTION D.6 — Street traffic
 * ===========================================================================
 * The town before the storm was people walking between parked cars: nothing
 * moved on the roads. Now cars come and go. One drives into town from the
 * end of a street, in its lane, up to the first building standing on the
 * road (the town's buildings sit across its streets in places), and parks
 * there as if it had arrived at someone's door. A while later it pulls out,
 * makes a U-turn into the other lane and drives back out of town. New cars
 * keep arriving, so a handful are always about.
 *   - A driver stops for anyone in the road in front of them.
 *   - Once a tornado is on the ground nobody new comes in: the cars on the
 *     move put their foot down and leave, the parked ones stay where they
 *     are, as parked cars.
 * They are ordinary cars (cars.js createCar), on Sim.objects and
 * Environment.cars, so the instancer draws them, and the capture state
 * machine, damage and debris treat them exactly as a parked one: the moment
 * the vortex takes one (or the wind flips it) it stops being traffic and
 * physics has it. The same hand-off as the viaduct's traffic.
 *
 * Where a car can drive is worked out once, when the town is built: for
 * each street and each end, the open stretch from the end of the street to
 * the first building footprint on the road (`openStretches`, tested).
 * Parked cars left standing in a lane are moved to the kerb first.
 */

export const STREET_TRAFFIC = Object.freeze({
  /** Cars about at once (arriving, parked, leaving). */
  cars: 8,
  /** Seconds between two arrivals, at most. */
  arriveEvery: 4,
  /** Town speed, and leaving a tornado behind (m/s). */
  speed: 9,
  fleeSpeed: 17,
  accel: 4,
  decel: 9,
  /** Seconds a car stays parked before leaving: [min, max]. */
  park: [14, 34],
  /** Shortest open stretch worth driving (m), and how far short of a building a car parks. */
  minStretch: 18,
  parkShort: 4.5,
  /** The road is 5 wide; a building nearer than this to a street's centre line blocks it. */
  roadHalfWidth: 2.6,
  /** How far ahead a driver looks for people in the road (m), and the lane's half width. */
  lookAhead: 8,
  laneHalfWidth: 1.5,
  /** Seconds a U-turn takes. */
  turnSeconds: 2.4
});

/**
 * One way into town: a street, the end it comes in from (dir +1 drives
 * toward +x, from the west end), where it starts and where it parks.
 * @typedef {{line: number, dir: number, from: number, park: number, busy: boolean}} Stretch
 */

/**
 * The open stretches of a set of streets, given what blocks them. Pure (no
 * three.js), tested in tests/street-traffic.test.mjs.
 * @param {readonly number[]} lines the streets' centre lines (z)
 * @param {{x: number, z: number, hw: number, hd: number}[]} blocks footprints: centre and half sizes
 * @param {{halfLength: number, roadHalfWidth: number, parkShort: number, minStretch: number}} o
 * @returns {Stretch[]}
 */
export function openStretches(lines, blocks, o) {
  /** @type {Stretch[]} */
  const out = [];
  for (const line of lines) {
    const onRoad = blocks.filter((b) => Math.abs(b.z - line) < b.hd + o.roadHalfWidth);
    for (const dir of [1, -1]) {
      const from = -dir * o.halfLength;
      // The first block met driving in from this end.
      let stop = dir * o.halfLength;
      for (const b of onRoad) {
        const near = b.x - dir * b.hw;
        if ((b.x + dir * b.hw - from) * dir > 0 && (near - stop) * dir < 0) stop = near;
      }
      const park = stop - dir * o.parkShort;
      if ((park - from) * dir >= o.minStretch) out.push({ line, dir, from, park, busy: false });
    }
  }
  return out;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initStreetTraffic: () => void, updateStreetTraffic: (dt: number) => void,
 *   resetStreetTraffic: () => void, disposeStreetTraffic: () => void,
 *   leaving: () => boolean
 * }}
 */
export function createStreetTrafficSystem(ctx) {
  const { Sim } = ctx;
  /** @type {THREE.Group|null} */
  let group = null;
  /**
   * @typedef {{obj: any, stretch: Stretch, x: number, z: number, yaw: number, speed: number,
   *   phase: 'arriving'|'parked'|'turning'|'leaving', timer: number, turnX: number, driving: boolean}} TrafficCar
   */
  /** @type {TrafficCar[]} */
  let cars = [];
  /** @type {Stretch[]} */
  let stretches = [];
  let leaving = false;
  let arriveIn = 0;
  let made = 0;
  const qYaw = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  /** @param {readonly number[]} range */
  const rand = (range) => range[0] + Math.random() * (range[1] - range[0]);

  /** @returns {void} */
  function initStreetTraffic() {
    group = new THREE.Group();
    group.name = 'streetTraffic';
    Sim.three.scene.add(group);
    leaving = false;
    made = 0;
    clearLanes();
    stretches = openStretches(STREET_Z_LINES, footprints(), {
      halfLength: STREET_HALF_LENGTH,
      roadHalfWidth: STREET_TRAFFIC.roadHalfWidth,
      parkShort: STREET_TRAFFIC.parkShort,
      minStretch: STREET_TRAFFIC.minStretch
    });
    // The town starts with some cars already parked and some on their way in.
    const start = Math.min(STREET_TRAFFIC.cars - 2, stretches.length);
    for (let i = 0; i < start; i++) {
      const s = stretches[i];
      if (i % 2) arrive(s, s.park, 'parked');
      else arrive(s, s.from + (s.park - s.from) * (0.3 + Math.random() * 0.4), 'arriving');
    }
    arriveIn = 1 + Math.random() * STREET_TRAFFIC.arriveEvery;
  }

  /** Building footprints, as openStretches wants them, with a little room round each. */
  function footprints() {
    /** @type {{x: number, z: number, hw: number, hd: number}[]} */
    const out = [];
    for (const b of ctx.Environment.buildings) {
      const f = b.mesh.userData.footprint;
      if (!f) continue;
      out.push({ x: b.mesh.position.x, z: b.mesh.position.z, hw: f.width / 2 + 0.6, hd: f.depth / 2 + 0.3 });
    }
    return out;
  }

  /** Parked cars standing in a lane of a street go to the kerb. @returns {void} */
  function clearLanes() {
    for (const car of ctx.Environment.cars) {
      if (!car.mesh.userData.parked) continue;
      const p = car.mesh.position;
      if (Math.abs(p.x) > STREET_HALF_LENGTH) continue;
      for (const line of STREET_Z_LINES) {
        const d = p.z - line;
        if (Math.abs(d) < 3.2) {
          p.z = line + (d >= 0 ? 4.2 : -4.2);
          car.mesh.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.1;
        }
      }
    }
  }

  /**
   * A car on a stretch, in its lane.
   * @param {Stretch} stretch
   * @param {number} x where along it
   * @param {'arriving'|'parked'} phase
   */
  function arrive(stretch, x, phase) {
    const { createCar } = ctx.systems.cars;
    const z = stretch.line + stretch.dir * STREET_LANE_OFFSET;
    const obj = createCar(x, z, `streetCar_${made++}`);
    obj.mesh.userData.parked = false;
    group?.add(obj.mesh);
    Sim.objects.push(obj);
    ctx.Environment.cars.push(obj);
    stretch.busy = true;
    /** @type {TrafficCar} */
    const car = {
      obj, stretch, x, z, yaw: Math.atan2(stretch.dir, 0), speed: phase === 'arriving' ? STREET_TRAFFIC.speed : 0,
      phase, timer: phase === 'parked' ? rand(STREET_TRAFFIC.park) * Math.random() : 0, turnX: x, driving: true
    };
    cars.push(car);
    place(car);
  }

  /** @param {TrafficCar} car */
  function place(car) {
    const { obj } = car;
    obj.mesh.position.set(car.x, 0, car.z);
    qYaw.setFromAxisAngle(UP, car.yaw);
    obj.mesh.quaternion.copy(qYaw);
    // The velocity the vortex blends its pull into if it takes this car now.
    obj.velocity.set(Math.sin(car.yaw) * car.speed, 0, Math.cos(car.yaw) * car.speed);
  }

  /** Whether a tornado is on the ground: from then on the drivers leave. @returns {boolean} */
  function stormDown() {
    if (!Sim.state.running) return false;
    for (const v of ctx.tornadoes ? ctx.tornadoes.activeVortices : []) if ((v.birth ?? 1) > 0.25) return true;
    return false;
  }

  /**
   * How far in front of a car the nearest person in its lane is, or Infinity.
   * @param {TrafficCar} car
   * @param {number} dir which way it is driving along x
   * @returns {number}
   */
  function personAhead(car, dir) {
    let best = Infinity;
    for (const person of ctx.Environment.people) {
      if (person.captureState !== 'grounded' || !person.mesh.parent) continue;
      const p = person.mesh.position;
      if (Math.abs(p.z - car.z) > STREET_TRAFFIC.laneHalfWidth) continue;
      const ahead = (p.x - car.x) * dir;
      if (ahead > 0 && ahead < best) best = ahead;
    }
    return best;
  }

  /**
   * Drives a car toward a speed along x, stopping for people.
   * @param {TrafficCar} car
   * @param {number} dir
   * @param {number} target
   * @param {number} dt
   */
  function drive(car, dir, target, dt) {
    if (personAhead(car, dir) < STREET_TRAFFIC.lookAhead) target = 0;
    if (ctx.systems.solarStorm && ctx.systems.solarStorm.stalled()) target = 0;
    const rate = target < car.speed ? STREET_TRAFFIC.decel : STREET_TRAFFIC.accel;
    car.speed += THREE.MathUtils.clamp(target - car.speed, -rate * dt, rate * dt);
    car.x += dir * car.speed * dt;
  }

  /** @param {TrafficCar} car */
  function startTurn(car) {
    car.phase = 'turning';
    car.timer = 0;
    car.turnX = car.x;
  }

  /** @param {number} dt @returns {void} */
  function updateStreetTraffic(dt) {
    if (!group || dt <= 0) return;
    if (!leaving && stormDown()) leaving = true;
    // New arrivals while the town is calm.
    if (!leaving) {
      arriveIn -= dt;
      if (arriveIn <= 0) {
        arriveIn = STREET_TRAFFIC.arriveEvery * (0.5 + Math.random());
        const free = stretches.filter((s) => !s.busy);
        if (free.length && cars.filter((c) => c.driving).length < STREET_TRAFFIC.cars) {
          const s = free[Math.floor(Math.random() * free.length)];
          arrive(s, s.from, 'arriving');
        }
      }
    }
    for (const car of cars) {
      if (!car.driving) continue;
      const { obj, stretch } = car;
      if (!obj.mesh.parent || obj.captureState !== 'grounded' || obj.damageState !== 'intact') {
        // The storm has it now (or it was taken off the map): physics, not traffic.
        car.driving = false;
        if (car.phase !== 'leaving') stretch.busy = false;
        continue;
      }
      const dir = stretch.dir;
      if (car.phase === 'arriving') {
        if (leaving) {
          startTurn(car);
        } else {
          // Braking to a stop at the door.
          const room = (stretch.park - car.x) * dir;
          drive(car, dir, Math.min(STREET_TRAFFIC.speed, Math.sqrt(Math.max(0, 1.2 * STREET_TRAFFIC.decel * room))), dt);
          if (room <= 0.05) {
            car.x = stretch.park;
            car.speed = 0;
            car.phase = 'parked';
            car.timer = rand(STREET_TRAFFIC.park);
          }
        }
      } else if (car.phase === 'parked') {
        // Parked through a storm: a parked car now, not traffic.
        if (leaving) {
          car.driving = false;
          obj.mesh.userData.parked = true;
          continue;
        }
        car.timer -= dt;
        if (car.timer <= 0) startTurn(car);
      } else if (car.phase === 'turning') {
        // A U-turn into the other lane, round a point on the centre line.
        car.timer += dt;
        const k = Math.min(1, car.timer / STREET_TRAFFIC.turnSeconds);
        const a = k * k * (3 - 2 * k) * Math.PI;
        car.x = car.turnX + dir * STREET_LANE_OFFSET * Math.sin(a);
        car.z = stretch.line + dir * STREET_LANE_OFFSET * Math.cos(a);
        car.yaw = Math.atan2(dir * Math.cos(a), -dir * Math.sin(a));
        car.speed = 3;
        if (k >= 1) {
          car.phase = 'leaving';
          stretch.busy = false;
        }
      } else {
        drive(car, -dir, leaving ? STREET_TRAFFIC.fleeSpeed : STREET_TRAFFIC.speed, dt);
        // Out of the end of the street: gone.
        if (Math.abs(car.x) > STREET_HALF_LENGTH) {
          removeCar(car);
          continue;
        }
      }
      place(car);
    }
    // Forget the cars that have gone.
    if (cars.length > STREET_TRAFFIC.cars * 3) cars = cars.filter((c) => c.driving || c.obj.mesh.parent);
  }

  /** @param {TrafficCar} car */
  function removeCar(car) {
    car.driving = false;
    car.obj.mesh.removeFromParent();
    const idx = Sim.objects.indexOf(car.obj);
    if (idx !== -1) Sim.objects.splice(idx, 1);
    const envIdx = ctx.Environment.cars.indexOf(car.obj);
    if (envIdx !== -1) ctx.Environment.cars.splice(envIdx, 1);
    // Each car's own paint; the geometry and the rest are cars.js's, shared.
    car.obj.mesh.traverse((/** @type {any} */ child) => {
      if (child.material && !child.material.userData?.shared) child.material.dispose();
    });
  }

  /** @returns {void} */
  function resetStreetTraffic() {
    disposeStreetTraffic();
    initStreetTraffic();
  }

  /** @returns {void} */
  function disposeStreetTraffic() {
    for (const car of cars) if (car.obj.mesh.parent || Sim.objects.includes(car.obj)) removeCar(car);
    cars = [];
    stretches = [];
    group?.removeFromParent();
    group = null;
  }

  return { initStreetTraffic, updateStreetTraffic, resetStreetTraffic, disposeStreetTraffic, leaving: () => leaving };
}
