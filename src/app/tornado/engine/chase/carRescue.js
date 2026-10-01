import { carRadiusFor } from './car.js';
import { bannerHost } from '../../utils/banners.js';

/**
 * ===========================================================================
 * SECTION C.3 — Rescuing people in the car
 * ===========================================================================
 * On request, the Chase Mode car can be used to rescue people: whoever is at
 * the wheel -- the player in Chase Mode, or Roger in Hero Mode (either car
 * he is driving) -- slows down beside people and they climb in, one after
 * another, and are out of the storm's reach for good.
 *
 * A person comes aboard when the car is going slower than RESCUE.maxSpeed
 * and they are within RESCUE.reach of its side (the car's own collision
 * radius, so the three-times-size Chase car reaches further), on their feet
 * and not already being taken by the aliens. One boards every
 * RESCUE.boardEvery seconds. Each is taken out of the simulation alive by
 * the same route an ambulance takes a casualty (environment/shelters.js
 * removePerson) and counted with them (Sim.stats.peopleRescued), so they
 * show up as "safe" in the humans readout.
 */

const RESCUE = {
  maxSpeed: 10,          // world units/sec: slower than this and they can get in
  reach: 4,              // beyond the car's collision radius
  boardEvery: 0.3,       // seconds between two climbing in
  bannerSeconds: 2.4
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initCarRescue: () => void,
 *   updateCarRescue: (dt: number) => void,
 *   resetCarRescue: () => void,
 *   disposeCarRescue: () => void
 * }}
 */
export function createCarRescueSystem(ctx) {
  const { Sim } = ctx;
  let boardTimer = 0;
  let rescuedThisRun = 0;
  let bannerTimer = 0;
  /** @type {HTMLDivElement|null} */
  let banner = null;

  /** @returns {void} */
  function initCarRescue() {
    banner = document.createElement('div');
    banner.className = 'rescue-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
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
    bannerTimer = RESCUE.bannerSeconds;
  }

  /**
   * The car being driven right now and how fast, whoever has it.
   * @returns {{mesh: THREE.Object3D, speed: number}|null}
   */
  function drivenCar() {
    const Chase = ctx.Chase;
    if (Chase && Chase.active && Chase.car && !Chase.gameOver && Chase.car.captureState === 'grounded') {
      return { mesh: Chase.car.mesh, speed: Math.abs(Chase.speed) };
    }
    const hero = ctx.systems.heroMode;
    return hero && hero.drivingCar ? hero.drivingCar() : null;
  }

  /**
   * The nearest person who could climb in, if any.
   * @param {THREE.Object3D} mesh the car
   * @returns {Object|null}
   */
  function nextPassenger(mesh) {
    const reach = carRadiusFor(mesh) + RESCUE.reach;
    const c = mesh.position;
    let best = null;
    let bestD = reach;
    for (const person of ctx.Environment.people) {
      if (!person.mesh || !person.mesh.parent || person.abducted || person.electrocuted || person.inChasm) continue;
      if ((person.captureState || 'grounded') !== 'grounded') continue;
      const p = person.mesh.position;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bestD) {
        bestD = d;
        best = person;
      }
    }
    return best;
  }

  /**
   * Per frame, not while paused: whoever is beside a slow car climbs in.
   * @param {number} dt
   * @returns {void}
   */
  function updateCarRescue(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    const car = drivenCar();
    if (!car || car.speed > RESCUE.maxSpeed) {
      boardTimer = 0;
      return;
    }
    boardTimer -= dt;
    if (boardTimer > 0) return;
    const person = nextPassenger(car.mesh);
    if (!person) return;
    boardTimer = RESCUE.boardEvery;
    ctx.systems.shelters.removePerson(person);
    Sim.stats.peopleRescued++;
    rescuedThisRun++;
    const line = `${rescuedThisRun} ${rescuedThisRun === 1 ? 'person' : 'people'} saved by car`;
    // Roger's HUD while Hero Mode is on, the ordinary banner otherwise.
    if (ctx.Hero && ctx.Hero.active) ctx.events.emit('notice', { text: `🚗 RESCUED · ${line}` });
    else showBanner('RESCUED!', line);
  }

  /** @returns {void} */
  function resetCarRescue() {
    boardTimer = 0;
    rescuedThisRun = 0;
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeCarRescue() {
    resetCarRescue();
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return { initCarRescue, updateCarRescue, resetCarRescue, disposeCarRescue };
}
