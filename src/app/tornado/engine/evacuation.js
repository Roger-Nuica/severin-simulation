// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION AE — Evacuation
 * ===========================================================================
 * The crowd stops being scenery.
 *
 * Until now the people in this town existed to be thrown. They had no value
 * that could be added up, so nothing was lost when one went under a wall --
 * the score went *up*. This puts a number on the other side of the ledger:
 * how many of them got out.
 *
 * The loop is deliberately slow and visible, because the point is that the
 * player can see it happening and decide to interfere:
 *
 *  1. A **patrol car** drives to a muster point on the grid and opens it.
 *  2. Everyone within reach walks in and **queues** -- readable from a
 *     distance as a crowd converging on one spot, which is the signal that
 *     something is worth pointing a tornado at.
 *  3. A **bus** arrives, loads the queue a few at a time, and drives off the
 *     map. Only when it *reaches the edge* does anyone count as evacuated.
 *
 * That last point is the whole design. A loaded bus is the single most
 * valuable object in the simulation and it is a slow box on a straight road,
 * so the player is always being offered the same trade: let it go, or take
 * twenty people at once. A bus the storm catches does not cost you the
 * score you had -- it costs you the score you were about to get, which is a
 * far better feeling than a counter going down.
 *
 * The patrol car and the bus are ordinary emergency vehicles
 * (engine/emergency/vehicles.js) and so ordinary SimObjects: everything that
 * can happen to a car can happen to either.
 */

const EVAC = {
  // Muster points, on junctions of the street grid so a bus can reach them
  // along a road and a crowd has somewhere to stand. Spread out, so which
  // one opens changes where the town's attention is.
  points: [
    { x: -30, z: -8 },
    { x: 30, z: 8 },
    { x: -30, z: 20 },
    { x: 30, z: -20 }
  ],
  police: 2,
  buses: 2,
  // Where the buses start and where they are heading when they leave: off
  // the east edge, past the end of the streets.
  depot: { x: 118, z: -30 },
  exit: { x: 168, z: -8 },
  // How far from a point people are called in.
  draw: 62,
  // A point needs this many waiting before a bus is worth sending.
  busThreshold: 3,
  // ...but one that has been open this long gets a bus regardless, so a
  // thinly populated corner is not ignored for ever.
  busPatience: 26,
  capacity: 20,
  boardRadius: 9,
  boardInterval: 0.32,         // seconds per person up the steps
  // The wait after the last person boards before the doors close, so a
  // straggler who is nearly there still makes it.
  doorsSeconds: 3.5,
  // Nobody musters next to a tornado. A point inside this of a funnel does
  // not open, and an open one inside `scatter` closes and everyone runs.
  keepAway: 96,
  scatter: 70,
  reopenSeconds: 8,
  // How long a point is passed over once it turns out there is no way to
  // drive to it (engine/rubble.js).
  blockedSeconds: 14,
  // The marker on the ground at an open point.
  markerRadius: 8.5,
  markerColour: 0x46d0ff,
  bannerSeconds: 3.4
};

/**
 * @typedef {Object} MusterPoint
 * @property {number} x
 * @property {number} z
 * @property {boolean} open whether it is taking people -- read directly by
 *   environment/peopleMotion.js, which is the only thing it tells
 * @property {THREE.Mesh} marker
 * @property {Object|null} police the unit holding it
 * @property {Object|null} bus the bus assigned to it
 * @property {number} age seconds it has been open
 * @property {number} cooldown seconds before it may open again
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initEvacuation: () => void,
 *   updateEvacuation: (dt: number) => void,
 *   queuedCount: () => number,
 *   busiestPoint: () => MusterPoint|null,
 *   closePointAt: (x: number, z: number, radius: number) => void,
 *   resetEvacuation: () => void,
 *   disposeEvacuation: () => void
 * }}
 */
export function createEvacuationSystem(ctx) {
  const { Sim } = ctx;

  /** @type {MusterPoint[]} */
  const points = [];
  /** @type {Object[]} */
  const police = [];
  /** @type {Object[]} */
  const buses = [];
  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {THREE.Material[]} */
  const materials = [];
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  let time = 0;

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    bannerTimer = EVAC.bannerSeconds;
  }

  /** @returns {void} */
  function initEvacuation() {
    group = new THREE.Group();
    group.name = 'evacuation';
    Sim.three.scene.add(group);

    // A ring on the road at each point, lit only while it is open. Additive
    // and flat, like the streetlight pools it sits between.
    const geometry = new THREE.RingGeometry(EVAC.markerRadius * 0.72, EVAC.markerRadius, 40);
    for (const spec of EVAC.points) {
      const material = new THREE.MeshBasicMaterial({
        color: EVAC.markerColour,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      materials.push(material);
      const marker = new THREE.Mesh(geometry, material);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(spec.x, 0.045, spec.z);
      marker.visible = false;
      marker.name = 'muster_marker';
      group.add(marker);
      points.push({
        x: spec.x, z: spec.z, open: false, marker,
        police: null, bus: null, age: 0, cooldown: 0
      });
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'evac-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }

    const { createVehicle } = ctx.systems.vehicles;
    for (let i = 0; i < EVAC.police; i++) {
      const unit = createVehicle('police', EVAC.depot.x - i * 7, EVAC.depot.z + 8, `evac_police_${i}`);
      unit.home = { x: EVAC.depot.x - i * 7, z: EVAC.depot.z + 8 };
      unit.state = 'idle';
      unit.point = null;
      police.push(unit);
      Sim.objects.push(unit.obj);
    }
    for (let i = 0; i < EVAC.buses; i++) {
      const bus = createVehicle('bus', EVAC.depot.x - i * 15, EVAC.depot.z, `evac_bus_${i}`);
      bus.home = { x: EVAC.depot.x - i * 15, z: EVAC.depot.z };
      bus.state = 'idle';
      bus.point = null;
      bus.aboard = 0;
      bus.boardTimer = 0;
      bus.doorTimer = 0;
      buses.push(bus);
      Sim.objects.push(bus.obj);
    }
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function funnelDistance(x, z) {
    if (!Sim.state.running) return Infinity;
    const centre = ctx.tornadoes.nearest(x, z).center;
    return Math.hypot(x - centre.x, z - centre.z);
  }

  /**
   * Everyone standing at a point, waiting.
   * @param {MusterPoint} point
   * @returns {number}
   */
  function queueAt(point) {
    if (!ctx.Environment) return 0;
    let n = 0;
    for (const person of ctx.Environment.people) {
      const m = person.motion;
      if (!m || m.pickup !== point || m.mode !== 'muster') continue;
      if (Math.hypot(person.mesh.position.x - point.x, person.mesh.position.z - point.z) > EVAC.boardRadius) continue;
      n++;
    }
    return n;
  }

  /**
   * The open point with the most people standing at it, or null. Read by
   * engine/sinkhole.js, which opens under one by preference: a queue waiting
   * for a bus is the densest crowd that will ever exist in this town, and it
   * is one the player built themselves.
   * @returns {MusterPoint|null}
   */
  function busiestPoint() {
    let best = null;
    let bestQueue = 0;
    for (const point of points) {
      if (!point.open) continue;
      const waiting = queueAt(point);
      if (waiting <= bestQueue) continue;
      bestQueue = waiting;
      best = point;
    }
    return best;
  }

  /**
   * Shuts any point whose ground has gone (engine/sinkhole.js). Everyone
   * called to it goes back to running for themselves, which for the ones
   * standing in the hole is academic.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {void}
   */
  function closePointAt(x, z, radius) {
    for (const point of points) {
      if (!point.open) continue;
      if (Math.hypot(point.x - x, point.z - z) > radius) continue;
      showBanner('POINT LOST', 'The ground went out from under it');
      closePoint(point);
    }
  }

  /** @returns {number} */
  function queuedCount() {
    let n = 0;
    for (const point of points) if (point.open) n += queueAt(point);
    return n;
  }

  /**
   * Calls everyone in range in to a point, and lets go of anyone the point
   * is no longer taking.
   * @param {MusterPoint} point
   * @param {boolean} calling
   * @returns {void}
   */
  function callCrowd(point, calling) {
    if (!ctx.Environment) return;
    for (const person of ctx.Environment.people) {
      const m = person.motion;
      if (!m) continue;
      if (!calling) {
        if (m.pickup === point) m.pickup = null;
        continue;
      }
      if (m.pickup && m.pickup !== point) continue;
      const d = Math.hypot(person.mesh.position.x - point.x, person.mesh.position.z - point.z);
      if (d <= EVAC.draw) m.pickup = point;
      else if (m.pickup === point) m.pickup = null;
    }
  }

  /**
   * @param {MusterPoint} point
   * @returns {void}
   */
  function closePoint(point) {
    point.open = false;
    point.age = 0;
    point.cooldown = EVAC.reopenSeconds;
    point.marker.visible = false;
    point.marker.material.opacity = 0;
    callCrowd(point, false);
    if (point.police) {
      point.police.point = null;
      point.police.state = 'returning';
      ctx.systems.vehicles.setRoute(point.police, point.police.home.x, point.police.home.z);
      point.police = null;
    }
  }

  // ---------------------------------------------------------------------
  // Police: opening and holding a point
  // ---------------------------------------------------------------------

  /**
   * @param {Object} unit
   * @returns {MusterPoint|null}
   */
  function findPoint(unit) {
    let best = null;
    let bestD = Infinity;
    for (const point of points) {
      if (point.open || point.police || point.cooldown > 0) continue;
      if (funnelDistance(point.x, point.z) < EVAC.keepAway) continue;
      const d = Math.hypot(point.x - unit.mesh.position.x, point.z - unit.mesh.position.z);
      if (d >= bestD) continue;
      bestD = d;
      best = point;
    }
    return best;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updatePolice(dt) {
    const { driveVehicle, faceVehicle, updateBeacon, setRoute, checkLost } = ctx.systems.vehicles;
    for (const unit of police) {
      if (unit.state !== 'lost' && checkLost(unit)) {
        unit.state = 'lost';
        if (unit.point) closePoint(unit.point);
        unit.point = null;
      }
      if (unit.state === 'lost') {
        updateBeacon(unit, dt, false);
        continue;
      }
      updateBeacon(unit, dt, unit.state !== 'idle');

      switch (unit.state) {
        case 'idle': {
          if (!Sim.state.running) break;
          const point = findPoint(unit);
          if (!point) break;
          if (!setRoute(unit, point.x + 7, point.z + 7)) {
            // Buried approach (engine/rubble.js). Held off for a while so the
            // unit tries a different point rather than this one again.
            point.cooldown = EVAC.blockedSeconds;
            break;
          }
          point.police = unit;
          unit.point = point;
          unit.state = 'travelling';
          // Pulls up beside the point rather than in the middle of it, so the
          // ring is left clear for the crowd and the bus.
          break;
        }
        case 'travelling': {
          if (driveVehicle(unit, dt)) {
            unit.state = 'holding';
            const point = unit.point;
            point.open = true;
            point.age = 0;
            point.marker.visible = true;
            showBanner('EVACUATION POINT OPEN', 'Get them on the bus');
          }
          break;
        }
        case 'holding': {
          const point = unit.point;
          faceVehicle(unit, dt, point.x, point.z);
          // The funnel is coming: the point is abandoned and everyone at it
          // goes back to running for themselves.
          if (funnelDistance(point.x, point.z) < EVAC.scatter) {
            showBanner('POINT ABANDONED', 'The funnel is on top of it');
            closePoint(point);
            unit.point = null;
          }
          break;
        }
        case 'returning': {
          if (driveVehicle(unit, dt)) unit.state = 'idle';
          break;
        }
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Buses
  // ---------------------------------------------------------------------

  /**
   * @param {Object} bus
   * @returns {MusterPoint|null}
   */
  function findRun(bus) {
    let best = null;
    let bestScore = 0;
    for (const point of points) {
      if (!point.open || point.bus) continue;
      const waiting = queueAt(point);
      // Either enough people to be worth the trip, or a point that has been
      // waiting long enough that it gets one anyway.
      if (waiting < EVAC.busThreshold && point.age < EVAC.busPatience) continue;
      const d = Math.max(1, Math.hypot(point.x - bus.mesh.position.x, point.z - bus.mesh.position.z));
      const score = (waiting + 1) / d;
      if (score <= bestScore) continue;
      bestScore = score;
      best = point;
    }
    return best;
  }

  /**
   * Takes one person off the queue and puts them on the bus. They leave the
   * simulation here but are not counted yet -- see the note at the top of the
   * file. Nothing is banked until the bus is off the map.
   * @param {Object} bus
   * @returns {boolean} whether anyone got on
   */
  function boardOne(bus) {
    if (!ctx.Environment || bus.aboard >= EVAC.capacity) return false;
    const point = bus.point;
    let nearest = null;
    let bestD = EVAC.boardRadius;
    for (const person of ctx.Environment.people) {
      const m = person.motion;
      if (!m || m.pickup !== point || m.mode !== 'muster') continue;
      if (person.captureState !== 'grounded') continue;
      const d = Math.hypot(
        person.mesh.position.x - bus.mesh.position.x,
        person.mesh.position.z - bus.mesh.position.z
      );
      if (d >= bestD) continue;
      bestD = d;
      nearest = person;
    }
    if (!nearest) return false;
    ctx.systems.shelters.removePerson(nearest);
    bus.aboard++;
    return true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateBuses(dt) {
    const { driveVehicle, updateBeacon, setRoute, checkLost } = ctx.systems.vehicles;
    for (const bus of buses) {
      if (bus.state !== 'lost' && checkLost(bus)) {
        bus.state = 'lost';
        if (bus.point) {
          bus.point.bus = null;
          bus.point = null;
        }
        if (bus.aboard > 0) {
          // The worst thing that can happen in this simulation, and the only
          // one the player can arrange deliberately.
          showBanner('BUS LOST', `${bus.aboard} aboard`);
          ctx.systems.gamefeel.event('collapse', bus.mesh.position);
          bus.aboard = 0;
        }
      }
      if (bus.state === 'lost') {
        updateBeacon(bus, dt, false);
        continue;
      }
      updateBeacon(bus, dt, bus.state === 'loading');

      switch (bus.state) {
        case 'idle': {
          if (!Sim.state.running) break;
          const point = findRun(bus);
          if (!point) break;
          if (!setRoute(bus, point.x, point.z)) {
            // There is no way to drive a bus to it. The point stays open --
            // the police are still holding it and people are still walking in
            // -- but nobody is coming to collect them.
            point.cooldown = EVAC.blockedSeconds;
            break;
          }
          point.bus = bus;
          bus.point = point;
          bus.state = 'inbound';
          bus.aboard = 0;
          break;
        }
        case 'inbound': {
          if (!bus.point.open) {
            // The point folded before it got there.
            bus.point.bus = null;
            bus.point = null;
            bus.state = 'leaving';
            setRoute(bus, EVAC.exit.x, EVAC.exit.z);
            break;
          }
          if (driveVehicle(bus, dt)) {
            bus.state = 'loading';
            bus.boardTimer = 0;
            bus.doorTimer = EVAC.doorsSeconds;
            showBanner('BUS AT THE POINT', 'Boarding now');
          }
          break;
        }
        case 'loading': {
          bus.boardTimer -= dt;
          if (bus.boardTimer <= 0) {
            bus.boardTimer = EVAC.boardInterval;
            if (boardOne(bus)) bus.doorTimer = EVAC.doorsSeconds;
            else bus.doorTimer -= EVAC.boardInterval;
          }
          bus.doorTimer -= dt;
          // Doors close when the queue runs dry, when it is full, or when the
          // funnel gets close enough that waiting is no longer sensible.
          const threatened = funnelDistance(bus.mesh.position.x, bus.mesh.position.z) < EVAC.scatter;
          if (bus.doorTimer <= 0 || bus.aboard >= EVAC.capacity || threatened) {
            if (bus.point) {
              bus.point.bus = null;
              bus.point = null;
            }
            bus.state = 'leaving';
            setRoute(bus, EVAC.exit.x, EVAC.exit.z);
          }
          break;
        }
        case 'leaving': {
          if (driveVehicle(bus, dt)) {
            if (bus.aboard > 0) {
              Sim.stats.peopleEvacuated += bus.aboard;
              showBanner('BUS AWAY', `${bus.aboard} evacuated · ${Sim.stats.peopleEvacuated} total`);
            }
            bus.aboard = 0;
            bus.state = 'returning';
            setRoute(bus, bus.home.x, bus.home.z);
          }
          break;
        }
        case 'returning': {
          if (driveVehicle(bus, dt)) bus.state = 'idle';
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateEvacuation(dt) {
    if (!group) return;
    time += dt;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }

    for (const point of points) {
      if (point.cooldown > 0) point.cooldown -= dt;
      if (!point.open) continue;
      point.age += dt;
      // Re-scan for anyone who has wandered into range since it opened, and
      // let go of anyone who has wandered out.
      callCrowd(point, true);
      // The ring breathes while it is taking people, so an open point reads
      // as live rather than as a decal someone left on the road.
      point.marker.material.opacity = 0.34 + 0.16 * Math.sin(time * 3.1);
    }

    updatePolice(dt);
    updateBuses(dt);
  }

  /** @returns {void} */
  function resetEvacuation() {
    for (const point of points) {
      callCrowd(point, false);
      point.open = false;
      point.age = 0;
      point.cooldown = 0;
      point.police = null;
      point.bus = null;
      point.marker.visible = false;
      point.marker.material.opacity = 0;
    }
    for (const vehicle of [...police, ...buses]) {
      const obj = vehicle.obj;
      obj.captureState = 'grounded';
      obj.damageState = 'intact';
      obj.velocity.set(0, 0, 0);
      obj.angularVelocity.set(0, 0, 0);
      obj.vortex = null;
      obj.captureBurstDone = false;
      vehicle.lost = false;
      vehicle.state = 'idle';
      vehicle.point = null;
      vehicle.aboard = 0;
      vehicle.route.length = 0;
      vehicle.speed = 0;
      vehicle.stuck = 0;
      vehicle.heading = 0;
      vehicle.mesh.position.set(vehicle.home.x, 0, vehicle.home.z);
      vehicle.mesh.rotation.set(0, 0, 0);
      vehicle.chassis.rotation.set(0, 0, 0);
      // See the same note in engine/emergency/index.js: resetEnvironment
      // rebuilds Sim.objects and these are not environment objects.
      if (!Sim.objects.includes(obj)) Sim.objects.push(obj);
    }
    if (banner) banner.classList.remove('visible');
    bannerTimer = 0;
  }

  /** @returns {void} */
  function disposeEvacuation() {
    if (!group) return;
    for (const vehicle of [...police, ...buses]) {
      vehicle.mesh.removeFromParent();
      for (const lens of vehicle.lenses) lens.material.dispose();
    }
    police.length = 0;
    buses.length = 0;
    if (points.length) points[0].marker.geometry.dispose();
    for (const mat of materials) mat.dispose();
    materials.length = 0;
    points.length = 0;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    Sim.three.scene.remove(group);
    group = null;
    banner = null;
  }

  return {
    initEvacuation, updateEvacuation, queuedCount, busiestPoint, closePointAt,
    resetEvacuation, disposeEvacuation
  };
}
