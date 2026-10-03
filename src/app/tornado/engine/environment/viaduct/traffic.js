import * as THREE from 'three';
import { VIADUCT_Z, HALF_LENGTH, ROUTE, TRAFFIC, BRAKE, SCORE } from './config.js';
/** @typedef {import('./config.js').Segment} Segment */

/**
 * ===========================================================================
 * SECTION VD.2 — The traffic
 * ===========================================================================
 * The cars on the deck, keeping their distance, and stopping short of (or
 * going over) a broken edge.
 *
 * They drive a route (routeAt), not just the deck: from the junction with
 * the town's street at the west end, south along the ground road, round the
 * bend, up the west ramp, across, down the east ramp, round and north to
 * the east junction -- the other lane the opposite way. A car reaching the
 * end of the route is taken away there and comes back in at its start. A
 * car's `along` is its distance along the route's centre line.
 */

// The route's pieces (see ROUTE): the two links north to the street, the
// two bends, and the straight that carries the ramps and the deck.
const CX = ROUTE.connectorX;
const R = ROUTE.cornerRadius;
const LINK = ROUTE.junctionZ - (VIADUCT_Z + R);
const BEND = (Math.PI * R) / 2;
const STRAIGHT = HALF_LENGTH * 2;
const ROUTE_LENGTH = LINK * 2 + BEND * 2 + STRAIGHT;

/**
 * Where the route is at a distance along it, and which way it runs there.
 * @param {number} s metres from the west junction
 * @param {{x: number, z: number, dx: number, dz: number, straight: boolean}} out
 *   `straight`: on the line of the ramps and the deck, where x says which span
 * @returns {{x: number, z: number, dx: number, dz: number, straight: boolean}}
 */
export function routeAt(s, out) {
  out.straight = false;
  if (s < LINK) {
    out.x = -CX; out.z = ROUTE.junctionZ - s; out.dx = 0; out.dz = -1;
    return out;
  }
  s -= LINK;
  if (s < BEND) {
    // Round from heading south to heading east.
    const a = Math.PI + s / R;
    out.x = -CX + R + Math.cos(a) * R; out.z = VIADUCT_Z + R + Math.sin(a) * R;
    out.dx = -Math.sin(a); out.dz = Math.cos(a);
    return out;
  }
  s -= BEND;
  if (s <= STRAIGHT) {
    out.x = -HALF_LENGTH + s; out.z = VIADUCT_Z; out.dx = 1; out.dz = 0; out.straight = true;
    return out;
  }
  s -= STRAIGHT;
  if (s < BEND) {
    // Round from heading east to heading north.
    const a = -Math.PI / 2 + s / R;
    out.x = CX - R + Math.cos(a) * R; out.z = VIADUCT_Z + R + Math.sin(a) * R;
    out.dx = -Math.sin(a); out.dz = Math.cos(a);
    return out;
  }
  s -= BEND;
  out.x = CX; out.z = VIADUCT_Z + R + s; out.dx = 0; out.dz = 1;
  return out;
}

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see viaduct.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createViaductTraffic(ctx, S, api) {
  const { Sim, nextObjectId } = ctx;

  const here = { x: 0, z: 0, dx: 1, dz: 0, straight: false };
  const look = { x: 0, z: 0, dx: 1, dz: 0, straight: false };
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const SIDE = new THREE.Vector3(1, 0, 0);

  /**
   * Puts a car on the route. Ordinary car objects, so the capture state
   * machine, the damage passes and the debris impact tests all treat them
   * exactly as they treat a parked one.
   * @param {number} index
   * @returns {void}
   */
  function createTrafficCar(index) {
    const { createCar } = ctx.systems.cars;
    const lane = index % 2 === 0 ? 1 : -1;
    const along = ((index + 0.5) / TRAFFIC.cars) * ROUTE_LENGTH;
    routeAt(along, here);
    const obj = createCar(here.x, here.z, `viaductCar_${index}`);
    obj.mesh.userData.parked = false;
    S.group.add(obj.mesh);
    Sim.objects.push(obj);
    ctx.Environment.cars.push(obj);
    const car = {
      obj, along, lane, onDeck: true,
      // Per-car now that they no longer all travel at the same constant
      // speed: braking, queueing and shunts all live in these three.
      speed: TRAFFIC.speed,
      swerve: 0,
      shunted: false,
      // Seconds left of this driver's reaction to the gap ahead; -1 when
      // there is nothing ahead to react to.
      reacting: -1
    };
    S.cars.push(car);
    place(car, null);
  }

  /**
   * The span under a point of the route, if it is on the ramps or the deck.
   * @param {{x: number, straight: boolean}} at
   * @returns {Segment|null|undefined} the span; null where one should be and
   *   none is; undefined on the ground road
   */
  function spanUnder(at) {
    if (!at.straight || Math.abs(at.x) > HALF_LENGTH) return undefined;
    return api.segmentAt(at.x);
  }

  /**
   * Distance from a point on the route to the near edge of the first span
   * ahead that a car cannot drive onto, or null if the road ahead is sound
   * for as far as the driver is looking.
   *
   * "Cannot drive onto" is any span that is missing, fallen, or has already
   * started to sag -- a driver can see a deck dropping away in front of them.
   * A span that is merely damaged still looks like road, and they take it.
   * @param {number} along
   * @param {number} lane +1 driving along the route, -1 back along it
   * @param {Segment|null} current the span the car is on, which is never the
   *   hazard ahead -- a car already riding a span that has begun to sag goes
   *   down with it rather than being thrown off the front of it
   * @returns {number|null}
   */
  function distanceToBrokenEdge(along, lane, current) {
    for (let d = 0; d <= BRAKE.lookahead; d += 1) {
      const s = along + lane * d;
      // Past the end of the route: where traffic leaves, not a hazard.
      if (s < 0 || s > ROUTE_LENGTH) return null;
      const segment = spanUnder(routeAt(s, look));
      if (segment === undefined || segment === current) continue;
      if (!segment || segment.state !== 'intact') return d;
    }
    return null;
  }

  /**
   * The gap to the next car ahead in the same lane, or Infinity if the road
   * in front of this one is clear. Wraps with the traffic.
   * @param {Object} car
   * @returns {{gap: number, ahead: Object|null}}
   */
  function carAhead(car) {
    let bestGap = Infinity;
    let ahead = null;
    for (const other of S.cars) {
      if (other === car || !other.onDeck || other.lane !== car.lane) continue;
      // Positive distance in this car's direction of travel, wrapped.
      let gap = (other.along - car.along) * car.lane;
      if (gap < 0) gap += ROUTE_LENGTH;
      if (gap < bestGap) { bestGap = gap; ahead = other; }
    }
    return { gap: bestGap, ahead };
  }

  /**
   * Two cars meeting. Both stop, both get slewed, and the one behind is
   * pushed back out of the one in front so they do not sit inside each other.
   * @param {Object} car the one that ran into the back
   * @param {Object} ahead
   * @returns {void}
   */
  function shunt(car, ahead) {
    const fresh = !car.shunted;
    car.shunted = true;
    ahead.shunted = true;
    car.speed = Math.min(car.speed, BRAKE.shuntSpeed);
    // Held apart rather than allowed to occupy the same stretch of road.
    car.along = ahead.along - car.lane * BRAKE.crashGap;
    if (!fresh) return;
    // The shove forward, the slew and the score all belong to the moment of
    // contact -- applying them every frame the two stay touching would push
    // a stopped queue off the edge a nudge at a time.
    ahead.speed = Math.max(ahead.speed, BRAKE.shuntSpeed);
    car.swerve += (Math.random() - 0.5) * BRAKE.shuntYaw * 2;
    ahead.swerve += (Math.random() - 0.5) * BRAKE.shuntYaw * 2;
    ctx.systems.explosions.spawnImpactBurst(car.obj.mesh.position.clone(), 0.7);
    ctx.systems.gamefeel.event('impact', car.obj.mesh.position);
    ctx.systems.damage.addDamageScore(SCORE.shunt);
  }

  /**
   * Sets a car where it is along the route: in its lane (to the right of
   * its way), on the road surface -- the span's, sloping on a ramp, or the
   * ground -- facing its way and pitched with the slope.
   * @param {Object} car
   * @param {Segment|null|undefined} segment under it (see spanUnder)
   * @returns {void}
   */
  function place(car, segment) {
    const { obj } = car;
    routeAt(car.along, here);
    // Its way, and the route's right-hand side (lane +1 drives on it).
    const tx = here.dx * car.lane;
    const tz = here.dz * car.lane;
    const off = car.lane * TRAFFIC.laneOffset + car.swerve;
    // The right of (dx, dz), looking down from above: (-dz, dx).
    const x = here.x - here.dz * off;
    const z = here.z + here.dx * off;
    let y = 0;
    let slope = 0;
    if (segment) {
      y = api.surfaceAt(segment, x);
      slope = Math.tan(segment.group.rotation.z) * tx;
    }
    obj.mesh.position.set(x, y + TRAFFIC.rideHeight, z);
    const yaw = Math.atan2(tx, tz) + (car.swerve / BRAKE.swerve) * BRAKE.swerveYaw * car.lane;
    qYaw.setFromAxisAngle(UP, yaw);
    qPitch.setFromAxisAngle(SIDE, -Math.atan(slope));
    obj.mesh.quaternion.copy(qYaw).multiply(qPitch);
    // Kept live rather than zeroed, exactly as the train does: this is the
    // velocity the vortex blends its pull into on the frame it takes them.
    obj.velocity.set(tx * car.speed, slope * car.speed, tz * car.speed);
  }

  /**
   * Drives the traffic. A car stays on the route until the tornado takes it
   * or the span under it goes; after that it is ordinary physics and this
   * leaves it alone.
   * @param {number} dt
   * @returns {void}
   */
  function updateTraffic(dt) {
    for (const car of S.cars) {
      if (!car.onDeck) continue;
      const { obj } = car;
      if (!obj.mesh.parent) { car.onDeck = false; continue; }

      // Taken by the storm, or flipped by the wind where it stands
      // (updateCarDamage): either way it stops being traffic. Handed to
      // physics with the speed it already had, so it is yanked off the deck
      // rather than stopped and then lifted.
      if (obj.captureState !== 'grounded' || obj.damageState !== 'intact') {
        car.onDeck = false;
        obj.mesh.userData.parked = false;
        ctx.systems.gamefeel.event('viaductCar', obj.mesh.position);
        ctx.systems.damage.addDamageScore(SCORE.car);
        continue;
      }

      const segment = spanUnder(routeAt(car.along, here));
      if (segment === null || (segment && segment.state === 'fallen')) {
        // There is no longer any road under it. Drop with it, keeping the
        // speed it was doing: a car that braked almost to a stop tips over
        // the edge, and one that was still at speed launches off it.
        car.onDeck = false;
        obj.velocity.set(here.dx * car.lane * car.speed, 0, here.dz * car.lane * car.speed);
        obj.angularVelocity.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3);
        obj.mesh.userData.parked = false;
        continue;
      }

      // --- Driving ------------------------------------------------------
      // What the driver can see, and how fast that lets them go.
      let target = TRAFFIC.speed;
      let braking = false;
      // A solar storm (engine/solarStorm.js): the engine has died, and the
      // car rolls to a stop where it is.
      if (ctx.systems.solarStorm && ctx.systems.solarStorm.stalled()) target = 0;

      const edge = distanceToBrokenEdge(car.along, car.lane, segment || null);
      if (edge === null) {
        car.reacting = -1;
      } else if (car.reacting < 0) {
        // First sight of it: they have not done anything yet.
        car.reacting = BRAKE.reaction[0]
          + Math.random() * (BRAKE.reaction[1] - BRAKE.reaction[0]);
      } else if (car.reacting > 0) {
        car.reacting = Math.max(0, car.reacting - dt);
      }

      if (edge !== null && car.reacting <= 0) {
        const room = edge - BRAKE.edgeMargin;
        if (room <= 0 && car.speed > BRAKE.edgeGiveUpSpeed) {
          // Out of road, and too fast to do anything about it. Whether a given
          // car makes it is decided by the braking curve rather than by a
          // flag, which is the whole point: the ones that go over are the ones
          // that were closest when the span went.
          car.onDeck = false;
          obj.velocity.set(here.dx * car.lane * car.speed, 0, here.dz * car.lane * car.speed);
          obj.angularVelocity.set(0, (Math.random() - 0.5) * 2, car.lane * (1 + Math.random()));
          obj.mesh.userData.parked = false;
          ctx.systems.gamefeel.event('viaductCar', obj.mesh.position);
          ctx.systems.damage.addDamageScore(SCORE.car);
          continue;
        }
        // The speed they could still stop from in the room they have left,
        // times a safety factor. The bare curve is the speed from which a car
        // stops *exactly* at the edge, and tracking it means arriving there
        // still moving -- which had the queue creeping over the brink at
        // seven units a second, one car at a time. Braking short of it means
        // a driver who sees the gap in time actually stops.
        target = room <= 1
          ? 0
          : Math.min(target, Math.sqrt(2 * BRAKE.decel * room) * BRAKE.safety);
        braking = true;
      }

      // And whoever is in front of them.
      const { gap, ahead } = carAhead(car);
      if (gap < BRAKE.crashGap && ahead) {
        shunt(car, ahead);
        target = 0;
        braking = true;
      } else if (gap < BRAKE.gap) {
        const room = (gap - BRAKE.crashGap) / (BRAKE.gap - BRAKE.crashGap);
        target = Math.min(target, TRAFFIC.speed * room);
        braking = true;
      }

      // Brakes bite harder than the throttle pulls.
      const rate = target < car.speed ? BRAKE.decel : BRAKE.accel;
      car.speed = THREE.MathUtils.clamp(
        car.speed + Math.sign(target - car.speed) * rate * dt,
        0, TRAFFIC.speed
      );
      if (!braking && car.speed >= TRAFFIC.speed - 0.01) car.shunted = false;

      // The veer. Toward the outside of the lane while braking, back to the
      // lane centre once they are rolling again.
      const swerveTarget = braking ? BRAKE.swerve * car.lane : 0;
      car.swerve += (swerveTarget - car.swerve)
        * Math.min(1, BRAKE.swerveRate * dt);

      car.along += car.lane * car.speed * dt;
      // A car on a span that is sagging slides toward the low end, on top of
      // whatever it is doing under its own power.
      if (segment && segment.state === 'sagging') {
        car.along -= Math.sin(segment.group.rotation.z - segment.tilt) * 9 * dt;
      }
      // The end of the route: away at the far junction, back in at the start.
      if (car.along > ROUTE_LENGTH || car.along < 0) {
        car.along = car.lane > 0 ? 0 : ROUTE_LENGTH;
        car.speed = TRAFFIC.speed;
        car.swerve = 0;
        car.shunted = false;
        car.reacting = -1;
      }
      place(car, spanUnder(routeAt(car.along, here)));
    }
  }

  return { createTrafficCar, distanceToBrokenEdge, carAhead, shunt, updateTraffic };
}
