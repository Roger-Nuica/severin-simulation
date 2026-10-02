import * as THREE from 'three';
import { CHASE_TUNE } from './car.js';
import { onRailway } from '../environment/train.js';
import { VIADUCT_Z } from '../environment/viaduct.js';
import { roadBlockAt } from '../environment/blockers.js';

/**
 * ===========================================================================
 * SECTION C.2 — Chase mode
 * ===========================================================================
 * An alternative interaction mode layered on top of the sandbox: spawns a
 * player-driven car and a third-person camera. Deliberately kept outside
 * Sim.objects/Environment.cars so it is never touched by integratePhysics,
 * updateDamage, or resetSim()'s full-town teardown, and so driving works
 * immediately on toggle-on without requiring Sim.state.running -- its own
 * updateChaseCar()/updateChaseCamera() are called unconditionally from
 * animate(), the same way updateCinematicCamera() already is. It still
 * calls the shared updateCaptureState() directly for the car, so the exact
 * same vortex buffeting/capture physics debris already uses applies to the
 * car for free, including the same 'orbiting' transition used here as the
 * "fully captured" game-over trigger.
 *
 * The car is in town from the start of every game (parkChaseCar, called at
 * start-up and on Reset): parked beside the aliens' landing spot (the
 * opening camera looks at them both), or failing that on a clear spot, headlamps on, and on the
 * minimap as a ringed cyan car, so it can be found before Chase Mode is
 * switched on. Chase Mode takes that car where it stands (Chase.parked
 * becomes Chase.car); leaving Chase Mode parks it wherever it was left, or,
 * if the run ended with it wrecked, parks a fresh one. It used to be made on
 * the spot at a fixed distance from the funnel when Chase Mode began.
 *
 * @param {Object} ctx
 * @returns {{
 *   Chase: Object,
 *   enterChaseMode: () => boolean,
 *   exitChaseMode: () => void,
 *   restartChaseRun: () => void,
 *   triggerChaseGameOver: (cause?: ChaseDeathCause) => void,
 *   updateChaseHud: () => void,
 *   initChaseUI: () => void,
 *   parkChaseCar: () => void
 * }}
 */
// Lightning's chance of aiming at the chase car, per strike, once the
// scripted opening strikes are spent (see strikeTargets.js). People stay the
// overwhelming favourite: at Chase Mode's 0.7-1.8 strikes/s this is roughly
// one car strike every 1.5-4 minutes while anyone is within the storm's
// reach, and every 10-30 s once nobody is.
const CAR_STRIKE_CHANCE_PEOPLE_NEARBY = 0.006;
const CAR_STRIKE_CHANCE_NOBODY_NEARBY = 0.05;
// Beyond this ground distance from the funnel the car is out of the storm's
// reach: outrunning the tornado shouldn't be punished by a bolt from nowhere.
const CAR_STRIKE_REACH = 90;
// The ring road (roadsDecor.js), which the parked car is kept off.
const RING_ROAD_RADIUS = 48.5;
// How far from the aliens' ship the car is parked at the start: clear of the
// hull (radius 15) and the crew walking round it.
const PARK_BY_ALIENS = [22, 32];
const GAME_OVER_TITLES = {
  tornado: 'Caught by the tornado!',
  lightning: 'Struck by lightning!',
  chasm: 'Swallowed by the earthquake!'
};

/** @typedef {'tornado'|'lightning'|'chasm'} ChaseDeathCause */

export function createChaseSystem(ctx) {
  const { Sim, Vortex, Cinematic, setCinematicView } = ctx;

  const Chase = {
    active: false,
    car: /** @type {SimObject|null} */ (null),
    // The car waiting in town while Chase Mode is off (see the header); null
    // while it is being driven.
    parked: /** @type {SimObject|null} */ (null),
    heading: 0,           // radians, car's current facing (yaw)
    speed: 0,             // current forward speed, world units/sec, signed (+forward/-reverse)
    viewMode: 'chase',    // 'chase' | 'cockpit' -- which camera is currently driving Sim.three.camera
    wheelAngle: 0,        // radians, cockpit steering wheel's current visual spin (eased toward input, see updateCockpitWheel)
    wheelSpin: 0,         // radians, road wheels' rolling angle (integrated from speed, see updateCarVisuals)
    prevSpeed: 0,         // last frame's Chase.speed, differenced into the acceleration the body pitches against
    bodyPitch: 0,         // radians, chassis pitch (nose up/down) under acceleration, braking and wind
    bodyRoll: 0,          // radians, chassis roll (lean) under cornering and wind
    keys: { forward: false, back: false, left: false, right: false },
    keydownHandler: /** @type {((e: KeyboardEvent) => void)|null} */ (null),
    keyupHandler: /** @type {((e: KeyboardEvent) => void)|null} */ (null),
    colliders: { buildings: /** @type {{minX:number,maxX:number,minZ:number,maxZ:number}[]} */ ([]), trees: /** @type {{x:number,z:number,r:number}[]} */ ([]) },
    gameOver: false,
    survivalTime: 0,
    minDistanceToCore: Infinity,
    savedCamera: /** @type {{pos: THREE.Vector3, target: THREE.Vector3}|null} */ (null),
    // Sandbox intensity/windSpeed/rotationSpeed at the moment Chase Mode was
    // entered, restored on exit -- see enterChaseMode/exitChaseMode. Chase
    // Mode never moves the sandbox's own sliders (only Sim.params underneath
    // them), so they keep showing whatever the sandbox is set to the whole
    // time; restoring Sim.params from here on exit is what re-synchronises
    // reality with what the panel displays, with no DOM update needed here.
    // The player may still drag a slider mid-chase, and setParam() (ui.js)
    // writes those three into this snapshot rather than into Sim.params for
    // exactly that reason -- the ramp owns the live value, this owns the
    // value the sandbox goes back to.
    savedParams: /** @type {{intensity: number, windSpeed: number, rotationSpeed: number}|null} */ (null),
    // Tornadoes running before Chase Mode (an Outbreak's), restored after.
    savedTornadoCount: 0
  };

  ctx.Chase = Chase;

  /**
   * Picks a spawn point a fixed distance from the tornado's current (and
   * continuously wandering, see updateVortexVisuals) position, clamped to
   * roughly the town's built-up bounds.
   * @returns {{x:number, z:number, heading:number}}
   */
  function pickChaseSpawnPosition() {
    const angle = Math.random() * Math.PI * 2;
    const BOUND = 90; // buildingSpots span roughly x,z in [-88, 88] (generateEnvironment)
    const x = THREE.MathUtils.clamp(Vortex.center.x + Math.cos(angle) * CHASE_TUNE.spawnDistance, -BOUND, BOUND);
    const z = THREE.MathUtils.clamp(Vortex.center.z + Math.sin(angle) * CHASE_TUNE.spawnDistance, -BOUND, BOUND);
    // Heading derived directly from the spawn->tornado vector (rather than
    // `angle + PI`) so it's correct even after the BOUND clamp above shifts
    // the spawn point off the pure radial line, and so it actually matches
    // the car's forward-vector convention used everywhere else
    // (forward = (sin(heading), cos(heading)), i.e. heading = atan2(dx, dz)).
    const dx = Vortex.center.x - x;
    const dz = Vortex.center.z - z;
    const heading = Math.atan2(dx, dz);
    return { x, z, heading };
  }

  /**
   * Whether the car can be left at (x, z): in the built-up town, not in or
   * against a building, a tree, another car or a wreck
   * (environment/blockers.js), off the railway and the ring road, out from
   * under the viaduct, and not on top of the funnel.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function parkable(x, z) {
    const trees = ctx.Environment ? ctx.Environment.trees : [];
    if (onRailway(x, z) || Math.abs(z - VIADUCT_Z) < 9) return false;
    // Off the ring road the fuel tanker drives (environment/tanker.js),
    // which does not know about this car.
    if (Math.abs(Math.hypot(x, z) - RING_ROAD_RADIUS) < 5) return false;
    if (Math.hypot(x - Vortex.center.x, z - Vortex.center.z) < CHASE_TUNE.spawnDistance * 0.6) return false;
    // Room for the car at the size it is drawn (chase/car.js carScale).
    const room = CHASE_TUNE.carRadius * CHASE_TUNE.carScale + 1.5;
    if (roadBlockAt(ctx, x, z, room, new Set())) return false;
    return !trees.some(t => t.mesh && Math.hypot(t.mesh.position.x - x, t.mesh.position.z - z) < room);
  }

  /**
   * Where to leave the car: beside the aliens' landing spot, on request
   * (aliens.js plannedSpot) -- off to the side of the ship, clear of its
   * hull and of the ramp it runs out towards town, facing along the ramp
   * -- or, if there is no room there, anywhere clear in town, facing the
   * centre.
   * @returns {{x: number, z: number, heading: number}}
   */
  function pickParkingSpot() {
    const aliens = ctx.systems.aliens;
    if (aliens && aliens.plannedSpot) {
      const spot = aliens.plannedSpot();
      const across = Math.atan2(spot.dirX, -spot.dirZ);
      for (let attempt = 0; attempt < 60; attempt++) {
        const a = across + (Math.random() - 0.5) * 1.8;
        const r = PARK_BY_ALIENS[0] + Math.random() * (PARK_BY_ALIENS[1] - PARK_BY_ALIENS[0]);
        const x = spot.x + Math.cos(a) * r;
        const z = spot.z + Math.sin(a) * r;
        if (parkable(x, z)) return { x, z, heading: Math.atan2(spot.dirX, spot.dirZ) };
      }
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 24 + Math.random() * 60;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (parkable(x, z)) return { x, z, heading: Math.atan2(-x, -z) };
    }
    return pickChaseSpawnPosition();
  }

  /**
   * @param {SimObject} car
   * @returns {void}
   */
  function removeCar(car) {
    Sim.three.scene.remove(car.mesh);
    ctx.systems.chaseCar.disposeCarMesh(car.mesh);
  }

  /**
   * Sits a car still as a parked one: no lean left on the body from the
   * driving, and the cockpit fixtures (only ever seen from inside) hidden.
   * @param {SimObject} car
   * @returns {void}
   */
  function settleParked(car) {
    car.velocity.set(0, 0, 0);
    car.angularVelocity.set(0, 0, 0);
    car.mesh.position.y = 0;
    const { carChassis, cockpitRig } = car.mesh.userData;
    if (carChassis) carChassis.rotation.set(0, 0, 0);
    if (cockpitRig) cockpitRig.visible = false;
  }

  /**
   * Leaves a fresh car parked in town for Chase Mode to pick up, in place of
   * any that was there. Called once the town exists (start-up) and after a
   * Reset rebuilds it.
   * @returns {void}
   */
  function parkChaseCar() {
    if (Chase.active) return;
    if (Chase.parked) removeCar(Chase.parked);
    const spot = pickParkingSpot();
    Chase.parked = ctx.systems.chaseCar.createChaseCar(spot.x, spot.z);
    Chase.parked.mesh.rotation.set(0, spot.heading, 0);
    settleParked(Chase.parked);
  }

  /**
   * Refreshes the chase HUD's live speed/distance-to-core/danger readout.
   * Speed goes through CHASE_TUNE.hudSpeedScale, a purely cosmetic
   * multiplier (not a real unit conversion) so the arcade top speed reads
   * as a legible dashboard-style mph figure instead of the raw small
   * world-units number. The danger readout reuses the exact EF-rating
   * formatting ui.js already uses for the sandbox's own intensity stat
   * (`EF${Math.min(5, Math.floor(intensity * 6))}`), so the same number
   * means the same thing in both places -- it reads directly off
   * Sim.params.intensity, which applyChaseDifficulty() (drive.js) is what's
   * actually climbing while Chase Mode runs.
   * @returns {void}
   */
  function updateChaseHud() {
    if (!Chase.car) return;
    const pos = Chase.car.mesh.position;
    const speedEl = document.getElementById('chase-hud-speed');
    const distEl = document.getElementById('chase-hud-distance');
    const intensityEl = document.getElementById('chase-hud-intensity');
    if (speedEl) speedEl.textContent = `${Math.round(Math.abs(Chase.speed) * CHASE_TUNE.hudSpeedScale)} mph`;
    if (distEl) {
      const dist = Math.hypot(pos.x - Vortex.center.x, pos.z - Vortex.center.z);
      distEl.textContent = `${Math.round(dist)} m`;
    }
    if (intensityEl) intensityEl.textContent = `EF${Math.min(5, Math.floor(Sim.params.intensity * 6))}`;
  }

  /** @returns {void} */
  function showChaseHud() {
    const hud = document.getElementById('chase-hud');
    if (hud) hud.classList.add('visible');
  }

  /** @returns {void} */
  function hideChaseHud() {
    const hud = document.getElementById('chase-hud');
    if (hud) hud.classList.remove('visible');
  }

  /**
   * Ends the run. Only the first cause counts: a car already finished off
   * by lightning that the tornado then sweeps up (or the reverse) keeps its
   * original game-over message.
   * @param {ChaseDeathCause} [cause]
   * @returns {void}
   */
  function triggerChaseGameOver(cause = 'tornado') {
    if (Chase.gameOver) return;
    Chase.gameOver = true;
    Chase.keys = { forward: false, back: false, left: false, right: false };
    showGameOverOverlay(cause);
  }

  /**
   * @param {ChaseDeathCause} cause
   * @returns {void}
   */
  function showGameOverOverlay(cause) {
    const overlay = document.getElementById('chase-gameover');
    if (!overlay) return;
    const title = document.getElementById('chase-gameover-title');
    if (title) title.textContent = GAME_OVER_TITLES[cause];
    document.getElementById('chase-gameover-time').textContent = `${Chase.survivalTime.toFixed(1)} s`;
    document.getElementById('chase-gameover-distance').textContent = `${Chase.minDistanceToCore.toFixed(0)} m`;
    overlay.classList.add('visible');
  }

  /** @returns {void} */
  function hideGameOverOverlay() {
    const overlay = document.getElementById('chase-gameover');
    if (overlay) overlay.classList.remove('visible');
  }

  /**
   * Respawns just the chase car at a fresh position and resumes control,
   * without resetting the underlying tornado run (Sim.state/Sim.stats/
   * Environment are untouched).
   * @returns {void}
   */
  function restartChaseRun() {
    if (!Chase.car) return;
    hideGameOverOverlay();
    const spot = pickChaseSpawnPosition();
    Chase.car.mesh.position.set(spot.x, 0, spot.z);
    Chase.car.velocity.set(0, 0, 0);
    Chase.car.angularVelocity.set(0, 0, 0);
    Chase.car.captureState = 'grounded';
    Chase.car.damageState = 'intact';
    Chase.heading = spot.heading;
    Chase.car.mesh.rotation.set(0, Chase.heading, 0);
    Chase.speed = 0;
    Chase.survivalTime = 0;
    Chase.minDistanceToCore = Infinity;
    Chase.gameOver = false;
    Chase.wheelAngle = 0;

    // Progressive difficulty resets to baseline immediately, rather than
    // waiting for the next frame's ramp to catch up with the now-zeroed
    // survivalTime -- a restarted run should read as "back to easy" the
    // instant it restarts, not one frame later.
    const d = CHASE_TUNE.difficulty;
    Sim.params.intensity = d.baseIntensity;
    Sim.params.windSpeed = d.baseWindSpeed;
    Sim.params.rotationSpeed = d.baseRotationSpeed;
    Vortex.wanderSpeedMul = d.baseWanderSpeedMul;

    ctx.systems.cars.resetCarVisuals();
    ctx.systems.chaseDrive.buildChaseColliders(); // cheap; also self-heals if the town was regenerated while chase mode was active
  }

  /**
   * @returns {boolean} whether Chase Mode is now active; false only when
   *   starting it was refused (Possess mode -- engine/possess.js -- is
   *   already driving the funnel).
   */
  function enterChaseMode() {
    if (Chase.active) return true;
    if (ctx.Possess && ctx.Possess.active) return false;
    if (ctx.Hero && ctx.Hero.active) return false;
    if (Cinematic.active) { setCinematicView(false); Cinematic.blend = 0; }
    const cinematicBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-cinematic'));
    if (cinematicBtn) cinematicBtn.disabled = true;

    // The car parked in town (parkChaseCar), where it stands; one made on
    // the spot only if there is none.
    if (Chase.parked) {
      Chase.car = Chase.parked;
      Chase.parked = null;
      Chase.heading = Chase.car.mesh.rotation.y;
    } else {
      const spot = pickChaseSpawnPosition();
      Chase.car = ctx.systems.chaseCar.createChaseCar(spot.x, spot.z);
      Chase.heading = spot.heading;
    }
    Chase.car.mesh.rotation.set(0, Chase.heading, 0);
    Chase.car.velocity.set(0, 0, 0);
    Chase.car.angularVelocity.set(0, 0, 0);
    Chase.speed = 0;
    ctx.systems.chaseDrive.buildChaseColliders();
    ctx.systems.skidMarks.clearSkidMarks();

    Chase.savedCamera = { pos: Sim.three.camera.position.clone(), target: Sim.three.controls.target.clone() };
    Chase.survivalTime = 0;
    Chase.minDistanceToCore = Infinity;
    Chase.gameOver = false;
    Chase.viewMode = 'chase';
    Chase.wheelAngle = 0;

    // Progressive difficulty (see applyChaseDifficulty in drive.js): save
    // whatever the sandbox sliders currently hold, so exitChaseMode() can
    // hand them back untouched, then snap straight to the ramp's baseline --
    // Chase Mode always starts a run at the same moderate difficulty
    // regardless of whatever the sandbox sliders happened to be set to.
    // One tornado in Chase Mode: an Outbreak's others go away for the
    // chase and come back (re-placed) after it.
    Chase.savedTornadoCount = ctx.tornadoes.count();
    ctx.tornadoes.setCount(1);
    // The two sandbox-only modes go away for the chase, for the same reason the
    // Outbreak does: an EF5 wedge has no outside for a car to drive in, and the
    // Doomsday script ends in one (engine/wedge.js, engine/doomsday.js).
    ctx.systems.wedge.setWedge(false);
    ctx.systems.doomsday.setDoomsday(false);
    for (const id of ['preset-fujiwhara', 'btn-wedge', 'btn-doomsday']) {
      const modeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (modeBtn) modeBtn.disabled = true;
    }
    ctx.systems.ui.highlightMatchingPreset();
    Chase.savedParams = {
      intensity: Sim.params.intensity,
      windSpeed: Sim.params.windSpeed,
      rotationSpeed: Sim.params.rotationSpeed
    };
    const d = CHASE_TUNE.difficulty;
    Sim.params.intensity = d.baseIntensity;
    Sim.params.windSpeed = d.baseWindSpeed;
    Sim.params.rotationSpeed = d.baseRotationSpeed;
    Vortex.wanderSpeedMul = d.baseWanderSpeedMul;
    ctx.systems.cars.resetCarVisuals();
    ctx.systems.chaseDrive.attachChaseInputListeners();
    Chase.active = true;
    showChaseHud();
    updateChaseHud();

    const cockpitBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-cockpit'));
    if (cockpitBtn) cockpitBtn.disabled = false;
    return true;
  }

  /** @returns {void} */
  function exitChaseMode() {
    if (!Chase.active) return;
    ctx.systems.chaseDrive.detachChaseInputListeners();
    // Left parked where it stopped -- unless the run ended with it wrecked,
    // lifted or fallen, when a fresh one is parked somewhere clear instead.
    const car = Chase.car;
    Chase.car = null;
    const intact = car && !Chase.gameOver && car.captureState === 'grounded' && car.mesh.position.y > -1;
    Chase.active = false;
    if (intact) {
      car.mesh.rotation.set(0, Chase.heading, 0);
      settleParked(car);
      Chase.parked = car;
    } else {
      if (car) removeCar(car);
      parkChaseCar();
    }
    Chase.gameOver = false;
    Chase.viewMode = 'chase';
    ctx.systems.cars.resetCarVisuals();

    // Hand the sandbox's own parameters back exactly as they were before
    // Chase Mode overwrote them (see enterChaseMode).
    if (Chase.savedParams) {
      Sim.params.intensity = Chase.savedParams.intensity;
      Sim.params.windSpeed = Chase.savedParams.windSpeed;
      Sim.params.rotationSpeed = Chase.savedParams.rotationSpeed;
      Chase.savedParams = null;
    }
    Vortex.wanderSpeedMul = 1;
    if (Chase.savedTornadoCount) {
      ctx.tornadoes.setCount(Chase.savedTornadoCount);
      Chase.savedTornadoCount = 0;
    }
    for (const id of ['preset-fujiwhara', 'btn-wedge', 'btn-doomsday']) {
      const modeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (modeBtn) modeBtn.disabled = false;
    }
    ctx.systems.ui.highlightMatchingPreset();
    const cinematicBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-cinematic'));
    if (cinematicBtn) cinematicBtn.disabled = false;
    const cockpitBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-cockpit'));
    if (cockpitBtn) {
      cockpitBtn.disabled = true;
      cockpitBtn.textContent = 'Cockpit View';
      cockpitBtn.setAttribute('aria-pressed', 'false');
      cockpitBtn.classList.remove('active');
    }
    Sim.three.controls.enabled = true;
    if (Chase.savedCamera) {
      Sim.three.camera.position.copy(Chase.savedCamera.pos);
      Sim.three.controls.target.copy(Chase.savedCamera.target);
      Chase.savedCamera = null;
    }
    hideGameOverOverlay();
    hideChaseHud();
  }

  /** @returns {void} */
  function initChaseUI() {
    const chaseBtn = document.getElementById('btn-chase');
    chaseBtn.addEventListener('click', () => {
      const turningOn = !Chase.active;
      // enterChaseMode() can refuse (Possess mode is driving); exitChaseMode()
      // never does. Read Chase.active back afterwards rather than trusting
      // turningOn, so a refusal leaves the button exactly as it was.
      if (turningOn) enterChaseMode(); else exitChaseMode();
      chaseBtn.textContent = Chase.active ? 'Exit Chase Mode' : 'Chase Mode';
      chaseBtn.setAttribute('aria-pressed', String(Chase.active));
      chaseBtn.classList.toggle('active', Chase.active);
    }, { signal: ctx.signal });

    document.getElementById('btn-chase-restart').addEventListener('click', restartChaseRun, { signal: ctx.signal });

    const cockpitBtn = document.getElementById('btn-cockpit');
    cockpitBtn.addEventListener('click', () => {
      if (!Chase.active) return;
      const enabled = Chase.viewMode !== 'cockpit';
      Chase.viewMode = enabled ? 'cockpit' : 'chase';
      cockpitBtn.textContent = enabled ? 'Exit Cockpit View' : 'Cockpit View';
      cockpitBtn.setAttribute('aria-pressed', String(enabled));
      cockpitBtn.classList.toggle('active', enabled);
    }, { signal: ctx.signal });
  }

  /**
   * Whether lightning may aim at the car right now: in a live run, within
   * the storm's reach, and not already being lifted by the tornado --
   * a car that is rising or orbiting is about to end the run through the
   * capture path, which takes priority. A car merely trembling against the
   * wind is fair game.
   * @returns {SimObject[]}
   */
  function strikeableCar() {
    const car = Chase.car;
    if (!Chase.active || !car || Chase.gameOver) return [];
    if (car.captureState !== 'grounded' && car.captureState !== 'trembling') return [];
    const dx = car.mesh.position.x - Vortex.center.x;
    const dz = car.mesh.position.z - Vortex.center.z;
    return dx * dx + dz * dz < CAR_STRIKE_REACH * CAR_STRIKE_REACH ? [car] : [];
  }

  /**
   * Lightning hit the car: the same explosion lightning-struck people get
   * (fireball, particles, sound), a touch larger, a hop off the ground from
   * the blast, and game over.
   * @param {SimObject} car
   * @returns {void}
   */
  function onCarStruck(car) {
    const pos = car.mesh.position.clone();
    pos.y += 1.2;
    ctx.systems.explosions.spawnImpactBurst(pos, 1.6);
    // Ballistic 'falling' lets the shared capture physics carry the hop and
    // land the car again (see updateCaptureState).
    car.velocity.y = 7;
    car.captureState = 'falling';
    Chase.speed = 0;
    triggerChaseGameOver('lightning');
  }

  // The car is a rare lightning target (strikeTargets.js); people remain the
  // primary ones.
  ctx.systems.strikeTargets.registerStrikeProvider({
    name: 'chaseCar',
    priority: 'rare',
    candidates: strikeableCar,
    strikeHeight: 2.0 * CHASE_TUNE.carScale, // roof height, so the bolt visibly hits the car
    onStruck: onCarStruck,
    chance: (primaryInRange) => (primaryInRange ? CAR_STRIKE_CHANCE_PEOPLE_NEARBY : CAR_STRIKE_CHANCE_NOBODY_NEARBY)
  });

  return { Chase, enterChaseMode, exitChaseMode, restartChaseRun, triggerChaseGameOver, updateChaseHud, initChaseUI, parkChaseCar };
}
