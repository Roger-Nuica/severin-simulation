import * as THREE from 'three';
import { firstBlockAhead } from './blockers.js';

/**
 * ===========================================================================
 * SECTION D.8 — Environment: the railway and its train
 * ===========================================================================
 * The one piece of moving traffic in town: a freight train running
 * back and forth along a straight line across the north side, between the
 * building rows of the z = 20 street and the ring road. A train rather than
 * cars, because a train is one long object on a fixed path -- no traffic AI
 * at all -- and because derailing is the payoff.
 *
 * On the rails, each wagon is an ordinary 'car' SimObject (so damage.js,
 * physics.js's capture and the swept-up burst all treat it like any other
 * vehicle) held `rooted`, which physics.js skips. This module moves it
 * kinematically instead, and keeps its `velocity` set to the train's, so
 * the moment it is let go it already has that speed.
 *
 * Derail-on-catch: as soon as any wagon comes inside the nearest tornado's
 * capture edge (the radius physics.js starts pulling at), or the wind has
 * already tipped one, the whole train leaves the rails. Every wagon is
 * un-rooted with its forward velocity intact, plus a sideways jolt, a hop
 * and a tumble -- the ones behind the lead plough on into the wreck -- and
 * physics takes over. The tornado's pull then adds to that velocity rather
 * than replacing it, so a caught wagon is yanked off its line rather than
 * stopped and then lifted. There is no coupling physics to maintain: once
 * derailed, each wagon is on its own.
 *
 * The earthquake (engine/earthquake.js, engine/chasm.js) derails it too. While
 * the ground is shaking the wagons rock and hop on the rails; a chasm that
 * opens across the line, or comes within TRAIN.chasmReach of a wagon, tears
 * the rails and the whole train comes off, thrown away from the split, the
 * wagons nearest it smashed (damage.js's 'tipped'); and a hard enough quake
 * (TRAIN.quakeDerail) can shake it off the rails anywhere. Once loose, a wagon
 * over the gap falls in like any other car (chasm.js checkGround). Before,
 * the wagons were held on the rails regardless and a wagon could be dragged
 * along the line across an open chasm.
 *
 * Moving vehicles are rarer and harder for the storm to catch than parked
 * ones, so they pay more: a bonus for the derailment, and a bigger one for
 * each wagon the tornado actually takes up (a parked car pays 15 for being
 * tipped).
 *
 * Something on the rails stops it (environment/blockers.js): a building
 * lying across the line, the rubble a toppled one leaves, a landed ship, a
 * wreck or a thrown car. The locomotive looks TRAIN.lookAhead down the line
 * every frame, brakes to a stop TRAIN.stopGap short of whatever is there,
 * and waits until it is gone. It used to run straight through all of it.
 *
 * A wrecked train is replaced after TRAIN.respawnDelay, up to
 * TRAIN.maxPerRun trains per run, so the line keeps running; the wrecks stay
 * where they fell until the run is reset.
 */

// The line runs along x at this z. Clear of the z = 22 and z = 44 building
// rows at their widest (footprint up to 12, placement jitter 2) and the
// poles at z = 30 (environment/powerLines.js).
export const RAIL_Z = 33;
// Half-width of the strip kept clear of trees, parked cars and people.
const RAIL_CLEARANCE = 4;
const RAIL_EXTENT = 130;           // the line runs from -RAIL_EXTENT to +RAIL_EXTENT
const RAIL_GAUGE = 1.44;
const SLEEPER_SPACING = 1.3;

const TRAIN = {
  wagons: 4,                       // behind the locomotive
  length: 8.6,                     // per vehicle
  gap: 0.9,
  width: 3.0,
  speed: [11, 16],                 // units/s, per train
  // Something on the rails (blockers.js): looked for this far ahead of the
  // locomotive, this finely, with this much room either side of the train's
  // own half-width; it stops this far short and brakes at this rate.
  lookAhead: 24,
  lookStep: 1.5,
  sideRoom: 0.3,
  stopGap: 2.5,
  brake: 9,                        // units/s^2
  accel: 3,                        // units/s^2, pulling away again
  pause: [3, 8],                   // seconds off-screen between runs
  respawnDelay: 20,
  maxPerRun: 3,
  mass: [26, 34],
  liftEligible: 0.3,
  derailJolt: 5,                   // sideways, units/s
  derailHop: [2, 4.5],             // upward, units/s
  derailTumble: 3,                 // rad/s
  derailScore: 120,
  // The earthquake.
  chasmReach: 6,                   // a wagon this near a chasm's edge derails the train
  quakeDerail: 0.7,                // shaking strength over which it may come off anywhere
  quakeDerailRate: 0.6,            // chance per second at full strength
  quakeRock: 0.07,                 // radians of roll on the rails at full strength
  quakeJolt: 9,                    // away from the chasm, units/s
  smashReach: 14,                  // wagons this near the chasm are wrecked outright
  caughtScore: 90,                 // per wagon the tornado takes up
  wheelRadius: 0.42,
  locoColour: 0x9c2f22,
  wagonColours: [0x3f4a52, 0x5b4636, 0x2f4a3c, 0x6b6450],
  trimColour: 0x1b1c1f,
  roofColour: 0x2a2c30,
  windowColour: 0x10141a
};

/**
 * Whether a ground point is on the railway, where the environment should
 * not put trees, parked cars or people.
 * @param {number} x
 * @param {number} z
 * @returns {boolean}
 */
export function onRailway(x, z) {
  return Math.abs(z - RAIL_Z) < RAIL_CLEARANCE && Math.abs(x) < RAIL_EXTENT;
}

/**
 * @typedef {Object} Wagon
 * @property {SimObject} obj
 * @property {THREE.Mesh[]} wheels
 * @property {number} offset distance behind the front of the train
 * @property {boolean} scored whether its capture has been paid for
 */

/**
 * @typedef {Object} Train
 * @property {Wagon[]} wagons locomotive first
 * @property {'running'|'waiting'|'derailed'} state
 * @property {number} head distance of the front along the line, from its start
 * @property {number} dir +1 eastbound, -1 westbound
 * @property {number} speed cruising speed for this pass
 * @property {number} current speed right now: `speed`, or less while it
 *   brakes for something on the rails
 * @property {number} timer seconds left of the pause between runs
 * @property {'chasm'|'quake'} [cause] set when the earthquake is what derails it
 * @property {{x: number, z: number}} [quakeAt] where the chasm met the line
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initTrain: () => void,
 *   updateTrain: (dt: number) => void,
 *   resetTrain: () => void,
 *   disposeTrain: () => void
 * }}
 */
export function createTrainSystem(ctx) {
  const { Sim } = ctx;

  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {THREE.Group|null} the track, built once */
  let track = null;
  /** @type {Train[]} the current train last */
  let trains = [];
  let trainsThisRun = 0;
  let respawnTimer = 0;
  /** @type {{geometries: THREE.BufferGeometry[], materials: THREE.Material[]}|null} */
  let assets = null;
  let wheelGeometry = /** @type {THREE.BufferGeometry|null} */ (null);

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Ballast, two rails and the sleepers (one InstancedMesh): three draw
   * calls for the whole line, static for the life of the page.
   * @returns {THREE.Group}
   */
  function buildTrack() {
    const g = new THREE.Group();
    g.name = 'railway';
    const length = RAIL_EXTENT * 2;
    // Just above the roads (0.01) it crosses, so the level crossings read.
    const ballast = new THREE.Mesh(
      new THREE.PlaneGeometry(length, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 1 })
    );
    ballast.rotation.x = -Math.PI / 2;
    ballast.position.set(0, 0.014, RAIL_Z);
    ballast.receiveShadow = true;
    g.add(ballast);

    const railGeo = new THREE.BoxGeometry(length, 0.14, 0.1);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.4, metalness: 0.7 });
    const rails = new THREE.InstancedMesh(railGeo, railMat, 2);
    const m = new THREE.Matrix4();
    [-1, 1].forEach((side, i) => {
      rails.setMatrixAt(i, m.makeTranslation(0, 0.2, RAIL_Z + side * RAIL_GAUGE / 2));
    });
    g.add(rails);

    const count = Math.floor(length / SLEEPER_SPACING);
    const sleepers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.3, 0.12, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x3b3027, roughness: 1 }),
      count
    );
    for (let i = 0; i < count; i++) {
      sleepers.setMatrixAt(i, m.makeTranslation(-RAIL_EXTENT + (i + 0.5) * SLEEPER_SPACING, 0.08, RAIL_Z));
    }
    sleepers.receiveShadow = true;
    g.add(sleepers);
    return g;
  }

  /**
   * Geometry and materials shared by every train, built once.
   * @returns {void}
   */
  function buildAssets() {
    const body = new THREE.BoxGeometry(TRAIN.length, 2.5, TRAIN.width).translate(0, 1.95, 0);
    const chassis = new THREE.BoxGeometry(TRAIN.length + 0.3, 0.35, TRAIN.width * 0.9).translate(0, 0.62, 0);
    const roof = new THREE.BoxGeometry(TRAIN.length + 0.1, 0.18, TRAIN.width + 0.12).translate(0, 3.28, 0);
    // The locomotive: a lower hood with a raised cab at the back of it.
    const hood = new THREE.BoxGeometry(TRAIN.length * 0.62, 1.9, TRAIN.width * 0.82).translate(TRAIN.length * 0.19, 1.65, 0);
    const cab = new THREE.BoxGeometry(TRAIN.length * 0.36, 2.8, TRAIN.width).translate(-TRAIN.length * 0.3, 2.1, 0);
    const cabGlass = new THREE.BoxGeometry(0.06, 0.8, TRAIN.width * 0.8).translate(-TRAIN.length * 0.12 + 0.02, 2.9, 0);
    wheelGeometry = new THREE.CylinderGeometry(TRAIN.wheelRadius, TRAIN.wheelRadius, 0.18, 12).rotateX(Math.PI / 2);
    assets = {
      geometries: [body, chassis, roof, hood, cab, cabGlass, wheelGeometry],
      materials: [
        new THREE.MeshStandardMaterial({ color: TRAIN.locoColour, roughness: 0.6, metalness: 0.2 }),
        ...TRAIN.wagonColours.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.15 })),
        new THREE.MeshStandardMaterial({ color: TRAIN.trimColour, roughness: 0.7, metalness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: TRAIN.roofColour, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: TRAIN.windowColour, roughness: 0.15, metalness: 0.6 })
      ]
    };
  }

  /**
   * One vehicle: a SimObject whose mesh is built along +x (the direction of
   * travel before the heading is applied).
   * @param {number} index 0 for the locomotive
   * @param {number} trainNumber
   * @returns {Wagon}
   */
  function createWagon(index, trainNumber) {
    const [body, chassis, roof, hood, cab, cabGlass] = assets.geometries;
    const mats = assets.materials;
    const trim = mats[mats.length - 3];
    const roofMat = mats[mats.length - 2];
    const glass = mats[mats.length - 1];
    const root = new THREE.Group();
    root.name = `train${trainNumber}_${index === 0 ? 'locomotive' : `wagon${index}`}`;

    /** @type {[THREE.BufferGeometry, THREE.Material][]} */
    const parts = index === 0
      ? [[chassis, trim], [hood, mats[0]], [cab, mats[0]], [cabGlass, glass]]
      : [[chassis, trim], [body, mats[1 + (index - 1) % TRAIN.wagonColours.length]], [roof, roofMat]];
    for (const [geo, mat] of parts) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }

    const wheels = [];
    for (const x of [-TRAIN.length * 0.34, -TRAIN.length * 0.22, TRAIN.length * 0.22, TRAIN.length * 0.34]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeometry, trim);
        wheel.position.set(x, TRAIN.wheelRadius, side * RAIL_GAUGE / 2);
        root.add(wheel);
        wheels.push(wheel);
      }
    }

    /** @type {SimObject} */
    const obj = {
      id: ctx.nextObjectId.value++,
      type: 'car',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mass: between(TRAIN.mass),
      drag: 0.9,
      // Held on the rails by this module until it derails; physics.js
      // skips rooted, intact objects.
      rooted: true,
      damageState: 'intact',
      breakThreshold: 6 + Math.random() * 2,
      liftEligible: TRAIN.liftEligible,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded',
      moving: true
    };
    root.userData.simObject = obj;
    // Its shape for anything that stops in front of it (blockers.js).
    root.userData.blockBox = { cx: 0, hl: TRAIN.length / 2, hw: TRAIN.width / 2 };
    return { obj, wheels, offset: index * (TRAIN.length + TRAIN.gap), scored: false };
  }

  /**
   * Puts a new train on the line, waiting to enter from a random end.
   * @returns {void}
   */
  function spawnTrain() {
    trainsThisRun++;
    const wagons = Array.from({ length: TRAIN.wagons + 1 }, (_, i) => createWagon(i, trainsThisRun));
    for (const w of wagons) {
      group.add(w.obj.mesh);
      Sim.objects.push(w.obj);
    }
    /** @type {Train} */
    const train = { wagons, state: 'waiting', head: 0, dir: 1, speed: 0, current: 0, timer: between(TRAIN.pause) * 0.5 };
    trains.push(train);
    startRun(train);
    placeTrain(train, 0);
  }

  /**
   * @param {Train} train
   * @returns {number} length of the whole train, front to back
   */
  function trainLength(train) {
    return train.wagons.length * (TRAIN.length + TRAIN.gap);
  }

  /**
   * Readies a train for its next pass: a new direction and speed, with the
   * whole of it off the end of the line it enters from.
   * @param {Train} train
   * @returns {void}
   */
  function startRun(train) {
    train.dir = Math.random() < 0.5 ? 1 : -1;
    train.speed = between(TRAIN.speed);
    train.current = train.speed;
    train.head = 0;
  }

  /**
   * How far ahead of the locomotive's nose the first thing on the rails is.
   * @param {Train} train
   * @returns {number} Infinity when the line is clear
   */
  function blockAhead(train) {
    const start = -RAIL_EXTENT * train.dir;
    const own = new Set(train.wagons.map(w => w.obj));
    return firstBlockAhead(ctx, (along) => ({ x: start + (train.head + along) * train.dir, z: RAIL_Z }),
      0, TRAIN.lookAhead, TRAIN.lookStep, TRAIN.width / 2 + TRAIN.sideRoom, own);
  }

  /**
   * Brakes for whatever is on the rails ahead, or pulls away again once the
   * line is clear.
   * @param {Train} train
   * @param {number} dt
   * @returns {void}
   */
  function updateSpeed(train, dt) {
    const ahead = blockAhead(train);
    let want = train.speed;
    // A solar storm (engine/solarStorm.js): the line has no power.
    if (ctx.systems.solarStorm && ctx.systems.solarStorm.stalled()) want = 0;
    if (ahead !== Infinity) {
      // Just enough to stop by the gap: v^2 = 2 a d.
      want = Math.min(want, Math.sqrt(2 * TRAIN.brake * Math.max(0, ahead - TRAIN.stopGap)));
    }
    train.current = want < train.current
      ? Math.max(want, train.current - TRAIN.brake * 1.5 * dt)
      : Math.min(want, train.current + TRAIN.accel * dt);
    if (ahead <= TRAIN.stopGap) train.current = 0;
  }

  /**
   * Writes each wagon's position, heading and velocity from the train's
   * progress along the line, and turns its wheels.
   * @param {Train} train
   * @param {number} travelled distance moved this frame, for the wheels
   * @returns {void}
   */
  function placeTrain(train, travelled) {
    const moving = train.state === 'running';
    const quake = ctx.systems.earthquake ? ctx.systems.earthquake.earthquakeStrength() : 0;
    // `head` runs from 0 (the front at the entry end) to 2 * RAIL_EXTENT +
    // the train's own length (the back clear of the exit end).
    const start = -RAIL_EXTENT * train.dir;
    for (const w of train.wagons) {
      const along = train.head - w.offset - TRAIN.length / 2;
      w.obj.mesh.position.set(start + along * train.dir, 0, RAIL_Z);
      w.obj.mesh.rotation.set(0, train.dir > 0 ? 0 : Math.PI, 0);
      w.obj.velocity.set(moving ? train.current * train.dir : 0, 0, 0);
      // Rocking and hopping on the rails while the ground shakes.
      if (quake > 0.05 && moving) {
        w.obj.mesh.rotation.z = (Math.random() - 0.5) * 2 * TRAIN.quakeRock * quake;
        w.obj.mesh.position.y = Math.random() * 0.25 * quake;
      }
      w.obj.mesh.visible = moving && along > -TRAIN.length && along < RAIL_EXTENT * 2 + TRAIN.length;
      for (const wheel of w.wheels) wheel.rotation.z -= travelled / TRAIN.wheelRadius;
    }
  }

  /**
   * Whether the train is coming off the rails: a chasm at or beside the
   * line, a quake shaking hard enough, a wagon inside the nearest tornado's
   * capture edge (the radius physics.js starts pulling at), or one the wind
   * has already tipped (damage.js). Sets train.cause for the earthquake's
   * two, so derail() knows to throw it off that way.
   * @param {Train} train
   * @param {number} dt
   * @returns {boolean}
   */
  function caught(train, dt) {
    // The earthquake first: a chasm across or beside the line, or the ground
    // shaking hard enough.
    const chasm = ctx.systems.chasm;
    for (const { obj } of train.wagons) {
      if (!obj.mesh.visible) continue;
      const pos = obj.mesh.position;
      if (chasm && chasm.gapAt(pos.x, pos.z) > -TRAIN.chasmReach) {
        train.cause = 'chasm';
        train.quakeAt = { x: pos.x, z: pos.z };
        return true;
      }
    }
    const quake = ctx.systems.earthquake ? ctx.systems.earthquake.earthquakeStrength() : 0;
    if (quake > TRAIN.quakeDerail && Math.random() < TRAIN.quakeDerailRate * quake * dt) {
      train.cause = 'quake';
      return true;
    }
    const p = Sim.params;
    const flood = ctx.systems.flood;
    const surging = !!(flood && flood.isSurging());
    return train.wagons.some(({ obj }) => {
      if (!obj.mesh.visible) return false;
      if (obj.damageState !== 'intact') return true;
      const pos = obj.mesh.position;
      // The dam's water reaching the line knocks the train off it; derailed,
      // the wagons are loose, and the surge (flood.js sweepObjects) carries
      // them off like anything else it catches.
      if (surging && flood.inWater(pos.x, pos.z)) return true;
      const vortex = ctx.tornadoes.nearest(pos.x, pos.z);
      // Scaled by birth, as in viaduct.js: no funnel before Start, so none
      // to knock the train off the line.
      const edge = p.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor * vortex.sizeMul * vortex.birth;
      return Math.hypot(pos.x - vortex.center.x, pos.z - vortex.center.z) < edge;
    });
  }

  /**
   * Lets every visible wagon go with the speed it had, plus a jolt to one
   * side, a hop and a tumble -- each a little worse the further back it is,
   * as the rest of the train piles into the front. Wagons still hidden off
   * the end of the line are simply removed.
   * @param {Train} train
   * @returns {void}
   */
  function derail(train) {
    train.state = 'derailed';
    const side = Math.random() < 0.5 ? 1 : -1;
    for (const [i, w] of train.wagons.entries()) {
      const { obj } = w;
      if (!obj.mesh.visible) {
        removeWagon(w);
        continue;
      }
      const pile = 1 + i * 0.25;
      obj.rooted = false;
      obj.mesh.userData.parked = false;
      obj.velocity.x = train.current * train.dir;
      obj.velocity.z = side * (i % 2 === 0 ? 1 : -0.6) * TRAIN.derailJolt * pile * Math.random();
      obj.velocity.y = between(TRAIN.derailHop);
      obj.angularVelocity.set(
        (Math.random() - 0.5) * TRAIN.derailTumble * pile, 0, (Math.random() - 0.5) * TRAIN.derailTumble * pile
      );
    }
    // Thrown off by the earthquake: away from the split, harder the nearer,
    // and the wagons at the split smashed.
    if (train.cause === 'chasm' || train.cause === 'quake') {
      const chasm = ctx.systems.chasm;
      for (const w of train.wagons) {
        const { obj } = w;
        if (!obj.mesh.parent) continue;
        const pos = obj.mesh.position;
        const gap = chasm ? chasm.gapAt(pos.x, pos.z) : -Infinity;
        const near = THREE.MathUtils.clamp(1 + gap / TRAIN.smashReach, 0, 1);
        const away = train.quakeAt ? Math.sign(pos.x - train.quakeAt.x) || 1 : side;
        obj.velocity.x += away * TRAIN.quakeJolt * near * 0.6;
        obj.velocity.z += side * TRAIN.quakeJolt * (0.4 + near);
        obj.velocity.y += TRAIN.quakeJolt * 0.5 * (0.3 + near);
        obj.angularVelocity.x += (Math.random() - 0.5) * 4 * (0.5 + near);
        obj.angularVelocity.z += (Math.random() - 0.5) * 4 * (0.5 + near);
        if (near > 0.3) {
          obj.damageState = 'tipped';
          ctx.systems.explosions.spawnImpactBurst(pos, 0.8 + near);
        }
        if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(pos.x, pos.z, 4, 1.5);
      }
    }
    train.wagons = train.wagons.filter(w => w.obj.mesh.parent);
    // Game feel (engine/gamefeel.js). A whole train leaving the rails is a
    // set piece, so it is a 'heavy' event: the biggest shake short of a
    // merge, and one that can tip the frame into slow motion. Before the
    // score, so the derailment is itself paid at the multiplier it just
    // extended.
    ctx.systems.gamefeel.event('derail', train.wagons.length
      ? train.wagons[0].obj.mesh.position
      : undefined);
    ctx.systems.damage.addDamageScore(TRAIN.derailScore);
    respawnTimer = TRAIN.respawnDelay;
  }

  /**
   * @param {Wagon} w
   * @returns {void}
   */
  function removeWagon(w) {
    group.remove(w.obj.mesh);
    const idx = Sim.objects.indexOf(w.obj);
    if (idx !== -1) Sim.objects.splice(idx, 1);
  }

  /**
   * Pays for each derailed wagon the first time the tornado takes it up.
   * @param {Train} train
   * @returns {void}
   */
  function scoreCaptures(train) {
    for (const w of train.wagons) {
      if (w.scored || (w.obj.captureState !== 'rising' && w.obj.captureState !== 'orbiting')) continue;
      w.scored = true;
      // Each wagon the storm lifts counts towards the combo in its own right,
      // and weighs more than a parked car does -- which is the "moving
      // vehicles score higher" rule, applied through the multiplier rather
      // than as a second bonus bolted on beside it.
      ctx.systems.gamefeel.event('train', w.obj.mesh.position);
      ctx.systems.damage.addDamageScore(TRAIN.caughtScore);
    }
  }

  /** @returns {void} */
  function initTrain() {
    group = new THREE.Group();
    group.name = 'train';
    Sim.three.scene.add(group);
    track = buildTrack();
    Sim.three.scene.add(track);
    buildAssets();
    spawnTrain();
  }

  /**
   * Per frame, while the run is going and not paused: before physics, so a
   * train derailed this frame is integrated from this frame on.
   * @param {number} dt
   * @returns {void}
   */
  function updateTrain(dt) {
    if (!group) return;
    for (const train of trains) {
      if (train.state === 'derailed') {
        scoreCaptures(train);
        continue;
      }
      if (train.state === 'waiting') {
        train.timer -= dt;
        if (train.timer <= 0) train.state = 'running';
        continue;
      }
      updateSpeed(train, dt);
      const step = train.current * dt;
      train.head += step;
      placeTrain(train, step);
      if (caught(train, dt)) {
        derail(train);
        continue;
      }
      if (train.head > RAIL_EXTENT * 2 + trainLength(train)) {
        startRun(train);
        train.state = 'waiting';
        train.timer = between(TRAIN.pause);
        placeTrain(train, 0);
      }
    }

    if (respawnTimer > 0) {
      respawnTimer -= dt;
      if (respawnTimer <= 0 && trainsThisRun < TRAIN.maxPerRun
        && !trains.some(t => t.state !== 'derailed')) spawnTrain();
    }
  }

  /**
   * Clears every train and wreck and puts a fresh train on the line. Called
   * from resetSim() after resetEnvironment(), which has emptied Sim.objects.
   * @returns {void}
   */
  function resetTrain() {
    if (!group) return;
    for (const train of trains) for (const w of train.wagons) removeWagon(w);
    group.clear();
    trains = [];
    trainsThisRun = 0;
    respawnTimer = 0;
    spawnTrain();
  }

  /** @returns {void} */
  function disposeTrain() {
    const scene = Sim.three.scene;
    if (group) scene.remove(group);
    if (track) {
      scene.remove(track);
      track.traverse((/** @type {any} */ o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        o.material.dispose();
      });
    }
    if (assets) {
      for (const g of assets.geometries) g.dispose();
      for (const m of assets.materials) m.dispose();
    }
    group = null;
    track = null;
    assets = null;
    wheelGeometry = null;
    trains = [];
  }

  return { initTrain, updateTrain, resetTrain, disposeTrain };
}
