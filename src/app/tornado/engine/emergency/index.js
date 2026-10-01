import * as THREE from 'three';
import { createSoftDotTexture } from '../../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { bannerHost } from '../../utils/banners.js';
import { VEHICLE_KINDS } from './vehicles.js';

/**
 * ===========================================================================
 * SECTION AD — Emergency response
 * ===========================================================================
 * The town fighting back.
 *
 * Everything else in this simulation points one way: the player presses a
 * button and the town gets worse. This is the first thing in it that makes
 * the town get *better*, and the only thing the player has to work against.
 *
 *  - **Fire engines** answer burning buildings, park at the kerb and play a
 *    jet onto them until they are out (engine/buildingFire.js douse). They
 *    cannot touch a burning gas main -- the gas is still coming up out of the
 *    ground -- which is what makes engine/gasMains.js the fire that has to
 *    burn itself out.
 *  - **Ambulances** answer casualties: anyone the storm has dropped, or left
 *    staggering. A person an ambulance reaches leaves the simulation alive.
 *
 * Both refuse to drive into the funnel, and both abandon a job and run if it
 * comes for them while they are working -- which is the behaviour that makes
 * them read as people rather than as score-correcting machinery.
 *
 * The fleet does not respawn. Every unit the storm catches is one that will
 * not answer the next call, so a long run is a slow collapse of the town's
 * ability to look after itself: the fires it could have put out stay lit and
 * the casualties it would have collected are still lying in the street. That
 * is the real feedback loop here, and it is why the vehicles are ordinary
 * SimObjects rather than something the storm has been taught to leave alone.
 */

const EMERGENCY = {
  // The depot: on the x = 30 street at the southern edge of the town grid, so
  // units leave and return along a road rather than across gardens.
  //
  // Thirty-eight units from the chemical works (environment/factory.js at
  // 66, -74), which is well inside its ninety-five-unit blast radius and
  // deliberately so. Putting the fire station within reach of the worst
  // explosion in town means one press can take the whole fleet off the board
  // before the fires start -- and the player who works that out gets to burn
  // a town that has nobody left to defend it.
  station: { x: 30, z: -86 },
  bay: 6.5,                    // spacing of the vehicles parked on the apron
  engines: 3,
  ambulances: 2,
  // A call is not answered the instant it comes in.
  responseDelay: [1.1, 3.4],
  // How close a unit parks to what it is dealing with.
  fireStandoff: 10,
  casualtyStandoff: 3.2,
  // How long it takes to put a building out, and to load a casualty.
  douseSeconds: [3.6, 6.2],
  loadSeconds: 2.4,
  // Nobody drives towards a tornado. A job inside this radius of a funnel is
  // not taken, and a unit already working inside `abandon` of one drops what
  // it is doing and leaves. `abandon` is the smaller of the two so a unit
  // that has committed does not turn round the moment the funnel drifts.
  keepAway: 78,
  abandon: 52,
  // Beyond this a call is somebody else's problem -- it stops units driving
  // the length of the map to a fire on the far edge of the backdrop.
  reach: 190,
  // How often a call written off as unreachable is offered to the fleet
  // again. Rubble never moves, but the units do, and a fire that could not be
  // reached from the depot may be reachable from where one is standing now.
  retrySeconds: 9,
  // The jet. Droplets under gravity rather than a cone: an arc of water
  // landing on a roof reads as a hose and a cone reads as a spray can.
  jetMax: 620,
  jetRate: 120,
  jetLife: [0.55, 1.2],
  jetSpeed: [17, 23],
  jetSize: 2.1,
  jetColour: new THREE.Color(0.62, 0.82, 0.95),
  steamColour: new THREE.Color(0.86, 0.9, 0.92),
  steamRate: 16,
  steamLife: [0.9, 1.9],
  steamSize: 6.5,
  bannerSeconds: 3
};

/**
 * @typedef {import('./vehicles.js').Vehicle} Vehicle
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initEmergency: () => void,
 *   updateEmergency: (dt: number) => void,
 *   fleetStatus: () => {live: number, total: number},
 *   resetEmergency: () => void,
 *   disposeEmergency: () => void
 * }}
 */
export function createEmergencySystem(ctx) {
  const { Sim } = ctx;

  /** @type {Vehicle[]} */
  const fleet = [];
  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let jet = null;
  /** @type {THREE.Mesh|null} */
  let apron = null;
  /** @type {THREE.Material[]} */
  const materials = [];
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  let lostCount = 0;
  // Calls nobody can get to, because the roads to them are buried. Cleared
  // every few seconds: rubble does not move, but a unit's own position does,
  // and what is unreachable from the depot may not be from where a unit is
  // standing now.
  /** @type {Set<Object>} */
  let unreachable = new Set();
  let unreachableTimer = 0;
  let noAccessShown = false;
  let jetAlive = 0;
  const scratch = new THREE.Color();
  const scratchVec = new THREE.Vector3();

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

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
    bannerTimer = EMERGENCY.bannerSeconds;
  }

  /** @returns {void} */
  function initEmergency() {
    group = new THREE.Group();
    group.name = 'emergency';
    Sim.three.scene.add(group);

    // The apron: a slab of tarmac the units park on, so the depot is a place
    // rather than four vehicles standing in a field. Flat and low, above the
    // roads but below the funnel's path scars.
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 1 });
    materials.push(apronMat);
    apron = new THREE.Mesh(new THREE.BoxGeometry(EMERGENCY.bay * 5.4, 0.06, 13), apronMat);
    apron.position.set(EMERGENCY.station.x, 0.03, EMERGENCY.station.z);
    apron.receiveShadow = true;
    apron.name = 'emergency_apron';
    group.add(apron);

    jet = createParticlePool(
      Sim.three.scene, EMERGENCY.jetMax, createSoftDotTexture(), THREE.NormalBlending, 'emergency_jet'
    );

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'rescue-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }

    buildFleet();
  }

  /** @returns {void} */
  function buildFleet() {
    const { createVehicle } = ctx.systems.vehicles;
    const kinds = [
      ...Array(EMERGENCY.engines).fill('engine'),
      ...Array(EMERGENCY.ambulances).fill('ambulance')
    ];
    const first = -(kinds.length - 1) / 2;
    for (let i = 0; i < kinds.length; i++) {
      const x = EMERGENCY.station.x + (first + i) * EMERGENCY.bay;
      const vehicle = createVehicle(kinds[i], x, EMERGENCY.station.z, `emergency_${kinds[i]}_${i}`);
      // Nose out towards the street, so the first thing a unit does on a call
      // is drive forward rather than turn on the spot.
      vehicle.heading = Math.PI;
      vehicle.mesh.rotation.y = vehicle.heading;
      vehicle.home = { x, z: EMERGENCY.station.z };
      vehicle.state = 'idle';
      vehicle.timer = 0;
      vehicle.target = null;
      fleet.push(vehicle);
      Sim.objects.push(vehicle.obj);
    }
  }

  // ---------------------------------------------------------------------
  // Finding work
  // ---------------------------------------------------------------------

  /**
   * How near the nearest funnel a point is. Every decision in this module is
   * really this number against a threshold.
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
   * @param {Object} target
   * @returns {boolean} whether another unit is already on it
   */
  function claimed(target) {
    return fleet.some(v => v.target === target && !v.lost);
  }

  /**
   * The nearest building on fire that nobody is dealing with, is not standing
   * in a tornado, and is close enough to be this town's problem.
   * @param {Vehicle} vehicle
   * @returns {SimObject|null}
   */
  function findFire(vehicle) {
    const burning = ctx.systems.buildingFire.burning();
    if (!burning.length) return null;
    const p = vehicle.mesh.position;
    let best = null;
    let bestD = EMERGENCY.reach;
    for (const building of burning) {
      if (claimed(building) || unreachable.has(building)) continue;
      const b = building.mesh.position;
      if (funnelDistance(b.x, b.z) < EMERGENCY.keepAway) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d >= bestD) continue;
      bestD = d;
      best = building;
    }
    return best;
  }

  /**
   * The nearest casualty nobody has been sent to. A casualty is someone the
   * storm has put on the ground (`dropped`, still being thrown about by
   * physics) or someone it has already put down and who is now staggering
   * (`dazed`) -- see environment/peopleMotion.js.
   * @param {Vehicle} vehicle
   * @returns {SimObject|null}
   */
  function findCasualty(vehicle) {
    const people = ctx.Environment ? ctx.Environment.people : null;
    if (!people || !people.length) return null;
    const p = vehicle.mesh.position;
    let best = null;
    let bestD = EMERGENCY.reach;
    for (const person of people) {
      const m = person.motion;
      if (!m || (!m.dropped && m.mode !== 'dazed')) continue;
      // Still in the air, or still being dragged: there is nothing an
      // ambulance can do for someone the funnel has not finished with.
      if (person.captureState !== 'grounded') continue;
      if (claimed(person) || unreachable.has(person)) continue;
      const q = person.mesh.position;
      if (funnelDistance(q.x, q.z) < EMERGENCY.keepAway) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= bestD) continue;
      bestD = d;
      best = person;
    }
    return best;
  }

  /**
   * Whether a target is still worth being driven to. Checked every frame on
   * the way there, because a building can burn down and a casualty can be
   * picked up by the funnel while a unit is en route.
   * @param {Vehicle} vehicle
   * @returns {boolean}
   */
  function targetStillValid(vehicle) {
    const target = vehicle.target;
    if (!target || !target.mesh || !target.mesh.parent) return false;
    const p = target.mesh.position;
    if (funnelDistance(p.x, p.z) < EMERGENCY.abandon) return false;
    if (vehicle.kind === 'engine') return ctx.systems.buildingFire.isBurning(target);
    const m = target.motion;
    return Boolean(m) && (m.dropped || m.mode === 'dazed') && target.captureState === 'grounded';
  }

  /**
   * Sends a unit to a target, parking it short of whatever it is.
   * @param {Vehicle} vehicle
   * @param {SimObject} target
   * @returns {void}
   */
  function dispatch(vehicle, target) {
    const { setRoute } = ctx.systems.vehicles;
    const standoff = vehicle.kind === 'engine' ? EMERGENCY.fireStandoff : EMERGENCY.casualtyStandoff;
    const t = target.mesh.position;
    const p = vehicle.mesh.position;
    // Park on the side the unit is arriving from, so it does not drive round
    // the building to reach an arbitrary point.
    scratchVec.set(t.x - p.x, 0, t.z - p.z);
    if (scratchVec.lengthSq() < 1e-6) scratchVec.set(0, 0, 1);
    scratchVec.normalize().multiplyScalar(-standoff);
    vehicle.target = target;
    if (!setRoute(vehicle, t.x + scratchVec.x, t.z + scratchVec.z)) {
      // Every street to it is under a building. Remembered rather than simply
      // skipped, so the unit does not spend the rest of the run picking the
      // same unreachable call off the top of the list every frame.
      unreachable.add(target);
      vehicle.target = null;
      vehicle.state = 'idle';
      vehicle.timer = between(EMERGENCY.responseDelay);
      if (!noAccessShown) {
        noAccessShown = true;
        showBanner('NO ACCESS', 'The street is blocked');
      }
      return;
    }
    vehicle.state = 'responding';
  }

  /**
   * @param {Vehicle} vehicle
   * @returns {void}
   */
  function sendHome(vehicle) {
    vehicle.target = null;
    vehicle.state = 'returning';
    ctx.systems.vehicles.setRoute(vehicle, vehicle.home.x, vehicle.home.z);
  }

  // ---------------------------------------------------------------------
  // Working
  // ---------------------------------------------------------------------

  /**
   * One droplet from a hose, thrown from the top of the engine towards the
   * fire on a ballistic arc.
   * @param {Vehicle} vehicle
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function spawnJet(vehicle, at) {
    const p = jet;
    const i = p.next;
    p.next = (p.next + 1) % EMERGENCY.jetMax;
    const from = vehicle.mesh.position;
    const nozzleY = 3.2;
    p.positions[i * 3] = from.x + (Math.random() - 0.5) * 0.7;
    p.positions[i * 3 + 1] = nozzleY;
    p.positions[i * 3 + 2] = from.z + (Math.random() - 0.5) * 0.7;
    // Aimed at the upper half of what it is hitting, with enough loft that
    // gravity gives the stream a visible arc on the way.
    const dx = at.x - from.x;
    const dz = at.z - from.z;
    const flat = Math.max(1, Math.hypot(dx, dz));
    const speed = between(EMERGENCY.jetSpeed);
    p.velocities[i * 3] = (dx / flat) * speed + (Math.random() - 0.5) * 2.4;
    p.velocities[i * 3 + 1] = 7 + Math.random() * 4;
    p.velocities[i * 3 + 2] = (dz / flat) * speed + (Math.random() - 0.5) * 2.4;
    p.life[i] = p.maxLife[i] = between(EMERGENCY.jetLife);
    // Band 0 is water, band 1 is the steam coming off what it lands on.
    p.seed[i] = Math.random() * 0.999;
  }

  /**
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function spawnSteam(at) {
    const p = jet;
    const i = p.next;
    p.next = (p.next + 1) % EMERGENCY.jetMax;
    p.positions[i * 3] = at.x + (Math.random() - 0.5) * 6;
    p.positions[i * 3 + 1] = 3 + Math.random() * 5;
    p.positions[i * 3 + 2] = at.z + (Math.random() - 0.5) * 6;
    p.velocities[i * 3] = (Math.random() - 0.5) * 3;
    p.velocities[i * 3 + 1] = 5 + Math.random() * 5;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 3;
    p.life[i] = p.maxLife[i] = between(EMERGENCY.steamLife);
    p.seed[i] = 1 + Math.random() * 0.999;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateJet(dt) {
    const p = jet;
    let alive = 0;
    for (let i = 0; i < EMERGENCY.jetMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      const steam = p.seed[i] >= 1;
      // Water falls; steam rises and slows.
      if (steam) {
        p.velocities[i * 3 + 1] += 2 * dt;
        p.velocities[i * 3] *= Math.max(0, 1 - 0.9 * dt);
        p.velocities[i * 3 + 2] *= Math.max(0, 1 - 0.9 * dt);
      } else {
        p.velocities[i * 3 + 1] -= 21 * dt;
      }
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      const c = steam ? EMERGENCY.steamColour : EMERGENCY.jetColour;
      scratch.copy(c);
      p.colours[i * 4] = scratch.r;
      p.colours[i * 4 + 1] = scratch.g;
      p.colours[i * 4 + 2] = scratch.b;
      p.colours[i * 4 + 3] = steam ? Math.sin(Math.PI * u) * 0.34 : (1 - u) * 0.62;
      p.sizes[i] = steam
        ? EMERGENCY.steamSize * (0.5 + (p.seed[i] - 1)) * (0.5 + u * 1.7)
        : EMERGENCY.jetSize * (0.6 + p.seed[i] * 0.8);
    }
    jetAlive = alive;
  }

  /**
   * An engine at the kerb, playing a jet onto a fire.
   * @param {Vehicle} vehicle
   * @param {number} dt
   * @returns {void}
   */
  function workFire(vehicle, dt) {
    const at = vehicle.target.mesh.position;
    ctx.systems.vehicles.faceVehicle(vehicle, dt, at.x, at.z);
    jet.accumulator += EMERGENCY.jetRate * dt;
    while (jet.accumulator >= 1) {
      jet.accumulator -= 1;
      spawnJet(vehicle, at);
    }
    vehicle.steamAccumulator = (vehicle.steamAccumulator || 0) + EMERGENCY.steamRate * dt;
    while (vehicle.steamAccumulator >= 1) {
      vehicle.steamAccumulator -= 1;
      spawnSteam(at);
    }

    vehicle.timer -= dt;
    if (vehicle.timer > 0) return;
    // Out. The radius is small on purpose: an engine puts out the building it
    // is parked at, not the street -- if the fire has spread while it worked,
    // that is another call.
    const put = ctx.systems.buildingFire.douse(at.x, at.z, 5);
    if (put > 0) {
      Sim.stats.firesDoused += put;
      if (Sim.stats.firesDoused === 1) {
        showBanner('FIRE UNDER CONTROL', 'The brigade is answering calls');
      }
    }
    vehicle.target = null;
    lookForWork(vehicle);
  }

  /**
   * An ambulance loading a casualty.
   * @param {Vehicle} vehicle
   * @param {number} dt
   * @returns {void}
   */
  function workCasualty(vehicle, dt) {
    const person = vehicle.target;
    const at = person.mesh.position;
    ctx.systems.vehicles.faceVehicle(vehicle, dt, at.x, at.z);
    vehicle.timer -= dt;
    if (vehicle.timer > 0) return;
    // Out of the simulation alive, by the same route a person reaching a
    // shelter door leaves it (environment/shelters.js removePerson).
    ctx.systems.shelters.removePerson(person);
    Sim.stats.peopleRescued++;
    if (Sim.stats.peopleRescued === 1) {
      showBanner('CASUALTY RECOVERED', 'The ambulances are running');
    }
    vehicle.target = null;
    lookForWork(vehicle);
  }

  /**
   * @param {Vehicle} vehicle
   * @returns {void}
   */
  function lookForWork(vehicle) {
    const target = vehicle.kind === 'engine' ? findFire(vehicle) : findCasualty(vehicle);
    if (target) dispatch(vehicle, target);
    else sendHome(vehicle);
  }

  // ---------------------------------------------------------------------

  /**
   * @param {Vehicle} vehicle
   * @returns {void}
   */
  function onLost(vehicle) {
    lostCount++;
    vehicle.state = 'lost';
    vehicle.target = null;
    const name = VEHICLE_KINDS[vehicle.kind].label;
    const { live, total } = fleetStatus();
    showBanner('UNIT DOWN', `${name} lost · ${live} of ${total} still running`);
    ctx.systems.gamefeel.event('car', vehicle.mesh.position);
  }

  /** @returns {{live: number, total: number}} */
  function fleetStatus() {
    return { live: fleet.length - lostCount, total: fleet.length };
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateEmergency(dt) {
    if (!group) return;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    unreachableTimer -= dt;
    if (unreachableTimer <= 0) {
      unreachableTimer = EMERGENCY.retrySeconds;
      if (unreachable.size) unreachable = new Set();
    }

    const { driveVehicle, updateBeacon, checkLost } = ctx.systems.vehicles;

    for (const vehicle of fleet) {
      if (vehicle.state !== 'lost' && checkLost(vehicle)) onLost(vehicle);
      if (vehicle.state === 'lost') {
        // The wreck is physics's now, and its beacon has stopped.
        updateBeacon(vehicle, dt, false);
        continue;
      }

      // Blue lights on whenever it is out of the yard.
      updateBeacon(vehicle, dt, vehicle.state !== 'idle');

      switch (vehicle.state) {
        case 'idle': {
          vehicle.timer -= dt;
          if (vehicle.timer > 0) break;
          const target = vehicle.kind === 'engine' ? findFire(vehicle) : findCasualty(vehicle);
          if (target) dispatch(vehicle, target);
          else vehicle.timer = between(EMERGENCY.responseDelay);
          break;
        }
        case 'responding': {
          if (!targetStillValid(vehicle)) {
            // Whatever it was going to has gone out, been rescued by someone
            // else, or is now inside a tornado.
            vehicle.target = null;
            lookForWork(vehicle);
            break;
          }
          if (driveVehicle(vehicle, dt)) {
            vehicle.state = 'working';
            vehicle.timer = vehicle.kind === 'engine'
              ? between(EMERGENCY.douseSeconds)
              : EMERGENCY.loadSeconds;
          }
          break;
        }
        case 'working': {
          if (!targetStillValid(vehicle)) {
            vehicle.target = null;
            lookForWork(vehicle);
            break;
          }
          if (vehicle.kind === 'engine') workFire(vehicle, dt);
          else workCasualty(vehicle, dt);
          break;
        }
        case 'returning': {
          // A call on the way back is still a call.
          const target = vehicle.kind === 'engine' ? findFire(vehicle) : findCasualty(vehicle);
          if (target) {
            dispatch(vehicle, target);
            break;
          }
          if (driveVehicle(vehicle, dt)) {
            vehicle.state = 'idle';
            vehicle.timer = between(EMERGENCY.responseDelay);
          }
          break;
        }
        default:
          break;
      }
    }

    if (jetAlive > 0 || jet.accumulator > 0) {
      updateJet(dt);
      markPoolDirty(jet);
      jet.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
  }

  /**
   * Puts the fleet back in the yard, undamaged, for a fresh run.
   * @returns {void}
   */
  function resetEmergency() {
    lostCount = 0;
    unreachable = new Set();
    unreachableTimer = 0;
    noAccessShown = false;
    for (const vehicle of fleet) {
      const obj = vehicle.obj;
      obj.captureState = 'grounded';
      obj.damageState = 'intact';
      obj.velocity.set(0, 0, 0);
      obj.angularVelocity.set(0, 0, 0);
      obj.vortex = null;
      obj.captureBurstDone = false;
      vehicle.lost = false;
      vehicle.state = 'idle';
      vehicle.target = null;
      vehicle.route.length = 0;
      vehicle.speed = 0;
      vehicle.stuck = 0;
      vehicle.timer = 0;
      vehicle.heading = Math.PI;
      vehicle.mesh.position.set(vehicle.home.x, 0, vehicle.home.z);
      vehicle.mesh.rotation.set(0, Math.PI, 0);
      vehicle.chassis.rotation.set(0, 0, 0);
      // resetEnvironment rebuilds Sim.objects, so the fleet has to put itself
      // back in: these are not environment objects and nothing else knows
      // they should be there.
      if (!Sim.objects.includes(obj)) Sim.objects.push(obj);
    }
    if (jet) {
      jet.life.fill(0);
      jet.colours.fill(0);
      jet.sizes.fill(0);
      markPoolDirty(jet);
    }
    jetAlive = 0;
    if (banner) banner.classList.remove('visible');
    bannerTimer = 0;
  }

  /** @returns {void} */
  function disposeEmergency() {
    if (!group) return;
    for (const vehicle of fleet) {
      vehicle.mesh.removeFromParent();
      for (const lens of vehicle.lenses) lens.material.dispose();
    }
    fleet.length = 0;
    if (apron) apron.geometry.dispose();
    for (const mat of materials) mat.dispose();
    materials.length = 0;
    if (jet) disposeParticlePool(Sim.three.scene, jet);
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    Sim.three.scene.remove(group);
    group = null;
    apron = null;
    jet = null;
    banner = null;
  }

  return { initEmergency, updateEmergency, fleetStatus, resetEmergency, disposeEmergency };
}
