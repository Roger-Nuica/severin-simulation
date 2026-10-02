// @ts-check
import * as THREE from 'three';
import { CAR_LENS_ON } from '../environment/cars.js';
import { VEHICLES } from '../scale.js';

/**
 * ===========================================================================
 * SECTION C.2 — Chase mode: car & cockpit fixtures
 * ===========================================================================
 */

/**
 * The collision radius of a car of this module's or the town's: the base
 * radius times whatever it is drawn at (mesh.userData.carScale, 1 for the
 * town's).
 * @param {THREE.Object3D} mesh
 * @returns {number}
 */
export function carRadiusFor(mesh) {
  return CHASE_TUNE.carRadius * (mesh.userData.carScale || 1);
}

export const CHASE_TUNE = {
  // World units/sec forward. Was 22 (a town block a second); faster on
  // request, now that the car is drawn three times the size. Roger's run and
  // the Terminators' walk used to be tied to this and are now their own
  // (heroMode.js HERO.runSpeed, pursuerSpeed).
  maxSpeed: 34,
  maxReverseSpeed: 10,
  accel: 24,             // units/sec^2 (was 16, with the top speed)
  brakeDecel: 26,        // units/sec^2 engine-braking toward 0 with no throttle input
  turnRate: 2.4,         // rad/sec at full speed
  // The chase car is drawn this many times the size of the town's parked
  // cars (engine/scale.js VEHICLES.chaseCarScale). It was 3, to stand next
  // to a 5.5 m Roger; with the people life-size it is a car again.
  // Everything that depends on its size reads this: the collision radius
  // (carRadiusFor), both cameras, the wheel dust, the skid marks,
  // lightning's aim, Roger's door.
  carScale: VEHICLES.chaseCarScale,
  carRadius: 1.6,        // collision sphere approximating the 1.8x3.8 body box, at carScale 1
  treeRadius: 1.4,       // flat collision radius for all trees (trunk+canopy fudge; trees store no size metadata)
  spawnDistance: 70,     // units from Vortex.center's current position at chase-on/restart time
  // How much arrow-key input (vs. the vortex's own force, added on top inside
  // updateCaptureState) drives the car's velocity, keyed by captureState.
  // Shrinking this near the tornado is what makes the car "harder to
  // control" as it's buffeted, reusing the existing state machine instead
  // of a new distance check.
  controlFactor: { grounded: 1.0, trembling: 0.45, rising: 0.15, orbiting: 0, falling: 0.25 },
  // Purely cosmetic multiplier for the HUD speedometer readout (not a real
  // unit conversion) -- at maxSpeed:22 this reads as a legible ~88mph top
  // speed instead of an unconvincing "22mph", matching the arcade feel.
  hudSpeedScale: 4,
  // Minimum fraction of maxSpeed while cornering (steering held with only
  // one of left/right down) for skid marks to start laying down.
  skidSpeedFrac: 0.35,
  // Cockpit-view ergonomic margins, all relative to the car's *actual*
  // body/cabin bounding boxes (computed per-car in buildCockpitFixtures
  // via getCarPartBoundingBox -- see its doc comment) rather than
  // hardcoded world-space coordinates. Anchoring to the real geometry
  // means these stay correct even if createCar's box dimensions ever
  // change. All distances in the same local space as those boxes (origin
  // at ground contact, +Z forward, +Y up).
  cockpitEyeHeadroomBelowRoof: 0.18,   // driver eye height sits just under the cabin roof, not above/outside it
  cockpitEyeInsetFromWindshield: 0.45, // camera sits this far back from the cabin's front wall, inside the cabin
  // Everything the driver is meant to *see* is placed by projecting into
  // the camera's own frustum -- each fixture picks a forward distance and
  // is then sized/offset as a fraction of the frustum's half-height (or
  // half-width) at that distance, rather than as a guessed world-space
  // offset. That distinction matters: the previous hardcoded offsets put
  // the dashboard 58 deg below centre and the A-pillars 57 deg off-axis,
  // both well outside a 55 deg (27.5 deg half) vertical / 42.8 deg half
  // horizontal frustum, so they silently rendered nothing at all. Stated
  // as fractions, "0.62 of the half-height" is on-screen *by
  // construction* and stays on-screen if the FOV is ever retuned.
  cockpitRefAspect: 16 / 9,       // reference aspect the horizontal placements below assume
  cockpitWheelDist: 0.40,         // wheel sits this far in front of the eye (arm's reach)
  cockpitWheelCentreFrac: 0.50,   // ...and its centre this far below view centre, in half-heights there
  cockpitWheelRadiusFrac: 0.30,   // wheel outer radius, same half-height units (~32% of view height across)
  cockpitWheelRake: 0.30,         // radians, top of the wheel tilted away from the driver (steering-column rake)
  cockpitDashDist: 0.62,          // dashboard further out than the wheel, so the two never interpenetrate
  cockpitDashTopFrac: 0.62,       // dashboard's top edge, in half-heights below view centre
  cockpitPillarDist: 0.50,
  cockpitPillarSideFrac: 0.92,    // A-pillar centres, in half-widths out from view centre (just inside the edge)
  cockpitPillarLean: 0.14,        // radians, pillar tops leaning inward like a real windscreen surround
  cockpitHeaderBottomFrac: 0.78,  // roof header's lower edge, in half-heights above view centre
  cockpitGlassDist: 0.80,         // glass pane sits beyond the frame, so the frame draws over it
  cockpitWheelMaxAngle: 1.9, // radians, full visual wheel throw at full steering lock

  // Progressive difficulty ramp (see chaseDifficultyProgress in drive.js).
  // Sim.params.intensity/windSpeed/rotationSpeed and the tornado's own
  // ground-wander rate are all driven off one shared 0..1(+) progress value
  // computed from Chase.survivalTime, so every ramped quantity moves in lockstep
  // rather than needing four separately-tuned curves.
  difficulty: {
    baseIntensity: 0.55,     // ~EF3 at t=0 -- "moderate baseline" per spec
    maxIntensity: 0.95,      // ~EF5, reached at rampTime
    baseWindSpeed: 150,
    maxWindSpeed: 300,
    baseRotationSpeed: 2.0,
    maxRotationSpeed: 4.5,
    baseWanderSpeedMul: 1,   // tornado's ground-wander rate at t=0 -- matches sandbox's own pace exactly
    // By rampTime the wander rate is 1.3x on top of what the rising
    // intensity already adds (vortex.js WANDER): median ground speed goes
    // from ~7.8 to ~15.7 units/s over the ramp, never above the 17.7 cap,
    // so a car at full speed (22) can always pull away.
    maxWanderSpeedMul: 1.3,
    // Time (s) for the primary ramp to reach the "max" values above. A plain
    // smoothstep(0, rampTime, t) fed through lerp(baseIntensity, maxIntensity, .)
    // crosses the EF4 threshold (intensity 0.667) at u=0.357 of the curve and
    // EF5 (0.833) at u=0.643 -- solved numerically, not assumed, since
    // smoothstep's S-curve isn't linear in u. At rampTime=100 that lands EF4
    // at ~35.7s (inside the requested 30-45s window) and EF5 at ~64.3s
    // (inside the requested 60-90s window) simultaneously, from the one
    // shared curve.
    rampTime: 100,
    // Beyond rampTime, progress keeps creeping past 1 at this rate (progress
    // units per second) rather than plateauing, so every ramped value keeps
    // climbing slightly for as long as the player survives -- "no hard cap".
    overtimeRate: 0.15 / 60
  }
};

/**
 * @param {Object} ctx
 * @returns {{
 *   createChaseCar: (x: number, z: number) => SimObject,
 *   buildCockpitFixtures: (carMesh: THREE.Group) => void,
 *   disposeCarMesh: (mesh: THREE.Object3D) => void,
 *   getCarPartBoundingBox: (carMesh: THREE.Group, partName: 'body'|'cabin') => THREE.Box3|null
 * }}
 */
export function createChaseCarSystem(ctx) {
  const { Sim } = ctx;
  const { createCar } = ctx.systems.cars;

  /**
   * @param {number} x
   * @param {number} z
   * @returns {SimObject}
   */
  function createChaseCar(x, z) {
    const obj = createCar(x, z, 'chaseCar');
    obj.mesh.userData.parked = false;
    obj.playerControlled = true;
    // createCar()'s liftEligible:0.25 is tuned for parked environment cars,
    // deliberately keeping most of them grounded even at EF5 as background
    // flavour (mass ~14-18 / liftEligible 0.25 gives liftDifficulty ~5.6-7.2,
    // which exceeds tornadoLiftCapacity() -- max ~3.37 -- at every slider
    // setting, so canRise can NEVER become true at that value). The chase
    // car's capturability is the actual win/lose mechanic, so it needs to be
    // reachable: liftEligible:1 (mass-only difficulty, same ceiling as light
    // debris) makes it liftable once intensity/wind/rotation climb toward
    // EF5, while still safely drivable at default/low settings.
    obj.liftEligible = 1;
    // createCar()'s mass (~14-18) was also left untouched, but that alone
    // still gives liftDifficulty ~1.4-1.8 even at liftEligible:1 -- and
    // tornadoLiftCapacity() at EF4 *defaults* (intensity .75/wind 220/
    // radius 20/rotation 3.5) is only ~1.17, so canRise could never pass at
    // default settings either, only once intensity/wind/rotation were
    // dragged most of the way toward EF5 (~3.37 max). That made the car
    // tremble near the funnel but never actually rise/orbit/trigger
    // game-over unless the sliders were pushed hard, which read as "immune
    // to the tornado" during ordinary default-settings play. Lowering mass
    // to roughly roofPiece-debris weight (liftDifficulty ~0.8) clears the
    // EF4-default capacity with a comfortable margin while staying under
    // the low/weak-intensity capacity, so the car is capturable at default
    // settings yet still safely drivable when the tornado is dialled down.
    obj.mass = 7 + Math.random() * 2;
    // Lamps on: the chase car gets its own lens material, driven past the
    // bloom threshold, while the parked cars keep the shared dark one.
    const lenses = obj.mesh.userData.carLenses;
    if (lenses) {
      lenses.material = lenses.material.clone();
      lenses.material.userData.shared = false;
      lenses.material.color.setScalar(CAR_LENS_ON);
    }
    buildCockpitFixtures(obj.mesh);
    // Built life-size, then drawn CHASE_TUNE.carScale times bigger; the
    // cockpit eye, worked out in the car's own units, is scaled to match.
    const s = CHASE_TUNE.carScale;
    obj.mesh.scale.setScalar(s);
    obj.mesh.userData.carScale = s;
    const eye = obj.mesh.userData.cockpitCamOffset;
    obj.mesh.userData.cockpitCamOffset = { x: eye.x * s, y: eye.y * s, z: eye.z * s };
    Sim.three.scene.add(obj.mesh);
    return obj;
  }

  /**
   * Reads back the real local-space bounding box of one of createCar's
   * body-part meshes (tagged via userData.carPart), rather than hardcoding
   * its box dimensions elsewhere. Those children carry only a position
   * offset (no rotation/scale), so translating the geometry's own bounding
   * box by that offset is enough to get an accurate local-space box.
   * @param {THREE.Group} carMesh
   * @param {'body'|'cabin'} partName
   * @returns {THREE.Box3|null}
   */
  function getCarPartBoundingBox(carMesh, partName) {
    // Searched recursively rather than across direct children: the tagged
    // parts now live under the car's chassis group (see createCar), one level
    // below the root. The translate-by-position shortcut below stays valid
    // because that group sits at the root's origin with no transform of its
    // own at build time -- its rotation is only ever driven later, by
    // updateCarVisuals.
    /** @type {THREE.Mesh|null} */
    let child = null;
    carMesh.traverse((o) => {
      if (!child && o.userData.carPart === partName) child = o;
    });
    if (!child) return null;
    child.geometry.computeBoundingBox();
    return child.geometry.boundingBox.clone().translate(child.position);
  }

  /**
   * Builds the cockpit-view fixtures -- a steering wheel, a dashboard block,
   * and a windshield pane -- as children of the car mesh so they inherit
   * its position/rotation/steering every frame for free (same idiom as the
   * car's own body/cabin meshes in createCar), rather than being
   * repositioned manually each frame like updateChaseCamera's third-person
   * rig. The wheel is stored on mesh.userData.cockpitWheel so
   * updateCockpitWheel() can spin it without a child-list search, and all
   * three meshes get disposed for free by disposeCarMesh()'s generic child
   * loop.
   *
   * All placements are derived from the car's *actual* body/cabin bounding
   * boxes (via getCarPartBoundingBox above) plus the small ergonomic
   * margins in CHASE_TUNE, rather than guessed absolute coordinates. The
   * resulting eye offset is cached on mesh.userData.cockpitCamOffset so
   * updateCockpitCamera can read it every frame without recomputing boxes.
   * The wheel/dashboard/windshield all sit above the body/hood box's top
   * face (the "hood clearance") -- see updateCockpitCamera's doc comment
   * for why that matters given the car mesh isn't hollow.
   * @param {THREE.Group} carMesh
   * @returns {void}
   */
  function buildCockpitFixtures(carMesh) {
    const bodyBox = getCarPartBoundingBox(carMesh, 'body');
    const cabinBox = getCarPartBoundingBox(carMesh, 'cabin');
    const hoodTopY = bodyBox.max.y;      // top of the hood -- everything below must clear this to avoid embedding in solid geometry
    const roofY = cabinBox.max.y;        // cabin roof
    const windshieldBaseZ = cabinBox.max.z; // cabin's front wall, i.e. where a windshield would start

    const eyeY = roofY - CHASE_TUNE.cockpitEyeHeadroomBelowRoof;
    const eyeZ = windshieldBaseZ - CHASE_TUNE.cockpitEyeInsetFromWindshield;
    carMesh.userData.cockpitCamOffset = { x: 0, y: eyeY, z: eyeZ };

    // Half-extents of the camera's view frustum at a given forward distance
    // from the eye, in the car's local units. Every fixture below is placed
    // and sized through these rather than with literal offsets, which is what
    // guarantees it actually lands inside the rendered image -- see the
    // cockpit block in CHASE_TUNE for why that matters. Read off the live
    // camera so this tracks initScene's FOV without duplicating the number.
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(Sim.three.camera.fov) / 2);
    /** @type {(d:number) => number} */
    const halfH = (d) => d * tanHalfFov;
    /** @type {(d:number) => number} */
    const halfW = (d) => halfH(d) * CHASE_TUNE.cockpitRefAspect;

    // All fixtures live under one group so they can be hidden wholesale
    // whenever cockpit view isn't the active camera -- they're deliberately
    // sized to fill the driver's field of view, which means several of them
    // stick out well past the car's bodywork and would be glaringly wrong
    // seen from the third-person chase cam. Hidden by default since
    // enterChaseMode always starts in 'chase'.
    const rig = new THREE.Group();
    rig.name = 'cockpitRig';
    rig.visible = false;
    carMesh.add(rig);
    carMesh.userData.cockpitRig = rig;

    // --- Steering wheel: lower-centre, seen from behind as the driver sees it.
    const wheelD = CHASE_TUNE.cockpitWheelDist;
    const wheelOuter = halfH(wheelD) * CHASE_TUNE.cockpitWheelRadiusFrac;
    const wheelTube = wheelOuter * 0.18;
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.75, metalness: 0.1, flatShading: true });
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(wheelOuter - wheelTube, wheelTube, 12, 32), wheelMat);
    wheel.position.set(0, eyeY - halfH(wheelD) * CHASE_TUNE.cockpitWheelCentreFrac, eyeZ + wheelD);
    // Torus lies in its own XY plane with its hole along +Z, i.e. already
    // face-on to a camera looking down +Z; the rake tips the top away from
    // the driver so it reads as a raked steering column rather than a flat
    // ring pasted onto the screen. updateCockpitWheel only ever writes
    // rotation.z, so this survives steering.
    wheel.rotation.x = CHASE_TUNE.cockpitWheelRake;
    wheel.name = 'cockpit_steeringWheel';
    rig.add(wheel);
    carMesh.userData.cockpitWheel = wheel;

    // Spokes + hub, parented to the wheel so they spin with it. A bar across
    // the full diameter plus a stem down to the rim is the cheapest shape
    // that reads unmistakably as a steering wheel rather than a plain ring.
    const spokeBar = new THREE.Mesh(new THREE.BoxGeometry(wheelOuter * 1.85, wheelTube * 0.9, wheelTube * 0.9), wheelMat);
    spokeBar.name = 'cockpit_steeringWheel_spokeBar';
    wheel.add(spokeBar);
    const spokeStem = new THREE.Mesh(new THREE.BoxGeometry(wheelTube * 0.9, wheelOuter * 0.95, wheelTube * 0.9), wheelMat);
    spokeStem.position.y = -wheelOuter * 0.48;
    spokeStem.name = 'cockpit_steeringWheel_spokeStem';
    wheel.add(spokeStem);
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.6, metalness: 0.2, flatShading: true });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelOuter * 0.28, wheelOuter * 0.28, wheelTube * 1.3, 12), hubMat);
    hub.rotation.x = Math.PI / 2; // cylinder's default axis is +Y; lay it along the wheel's hole axis
    hub.name = 'cockpit_steeringWheel_hub';
    wheel.add(hub);

    // --- Dashboard: thin dark strip across the very bottom of the view.
    const dashD = CHASE_TUNE.cockpitDashDist;
    const dashH = 0.28;
    const dashMat = new THREE.MeshStandardMaterial({ color: 0x0f1117, roughness: 0.9, metalness: 0.05, flatShading: true });
    // Wider than the frustum at the reference aspect so it still spans the
    // screen edge-to-edge on wider windows instead of ending mid-view.
    const dash = new THREE.Mesh(new THREE.BoxGeometry(halfW(dashD) * 2.6, dashH, 0.30), dashMat);
    const dashTopY = eyeY - halfH(dashD) * CHASE_TUNE.cockpitDashTopFrac;
    // Clamped so a shallower cabin could never sink the dashboard into the
    // solid hood box, which is opaque from this viewpoint (see
    // updateCockpitCamera's note on back-face culling).
    dash.position.set(0, Math.max(dashTopY - dashH / 2, hoodTopY + dashH / 2 - 0.06), eyeZ + dashD);
    dash.name = 'cockpit_dashboard';
    rig.add(dash);

    // --- Windscreen surround. Boxes, not planes: a PlaneGeometry's normal is
    // +Z and this camera also looks down +Z, so a front-side plane shows the
    // camera its back face and is culled away to nothing. A thin box is solid
    // from every angle and can't fail that way.
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.95, metalness: 0.0, flatShading: true });
    const pillarD = CHASE_TUNE.cockpitPillarDist;
    const pillarX = halfW(pillarD) * CHASE_TUNE.cockpitPillarSideFrac;
    const pillarGeo = new THREE.BoxGeometry(0.085, 1.4, 0.06);

    const leftPillar = new THREE.Mesh(pillarGeo, frameMat);
    leftPillar.position.set(-pillarX, eyeY + 0.12, eyeZ + pillarD);
    // Negative Z-rotation swings this pillar's top toward +X, i.e. inward
    // toward the centre of the view; the right-hand pillar mirrors it.
    leftPillar.rotation.z = -CHASE_TUNE.cockpitPillarLean;
    leftPillar.name = 'cockpit_pillar_left';
    rig.add(leftPillar);

    const rightPillar = new THREE.Mesh(pillarGeo, frameMat);
    rightPillar.position.set(pillarX, eyeY + 0.12, eyeZ + pillarD);
    rightPillar.rotation.z = CHASE_TUNE.cockpitPillarLean;
    rightPillar.name = 'cockpit_pillar_right';
    rig.add(rightPillar);

    // Header/roofline. Deep enough that it runs off the top of the screen
    // rather than leaving a sliver of sky above it.
    const headerH = 0.45;
    const headerBottomY = eyeY + halfH(pillarD) * CHASE_TUNE.cockpitHeaderBottomFrac;
    const header = new THREE.Mesh(new THREE.BoxGeometry(halfW(pillarD) * 2.4, headerH, 0.06), frameMat);
    header.position.set(0, headerBottomY + headerH / 2, eyeZ + pillarD);
    header.name = 'cockpit_header';
    rig.add(header);

    // --- Glass, beyond the surround so the pillars/header draw in front of
    // it. Faintly tinted: enough to read as a pane between the driver and the
    // storm, not enough to mute the tornado behind it. DoubleSide because
    // this one genuinely is a plane, and depthWrite off so it never occludes
    // the transparent debris/funnel passes behind it.
    const glassD = CHASE_TUNE.cockpitGlassDist;
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbcd2e6, transparent: true, opacity: 0.13, roughness: 0.2, metalness: 0.0,
      side: THREE.DoubleSide, depthWrite: false
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(halfW(glassD) * 2.2, halfH(glassD) * 2.2), glassMat);
    glass.position.set(0, eyeY + halfH(glassD) * 0.15, eyeZ + glassD);
    glass.name = 'cockpit_windscreen';
    rig.add(glass);
  }

  /**
   * traverse() rather than a flat children loop: the cockpit rig nests its
   * fixtures a level down (and the steering wheel's spokes/hub another level
   * below that), which a single-level loop would leak.
   * @returns {void}
   */
  function disposeCarMesh(mesh) {
    mesh.traverse((/** @type {any} */ child) => {
      // The wheel and detail geometry/materials are shared by every car (see
      // getCarWheelAssets/getCarDetailAssets), so disposing the chase car must
      // not tear them out from under the parked ones still drawing with them.
      if (child.geometry && !child.geometry.userData.shared) child.geometry.dispose();
      if (child.material && !child.material.userData.shared) child.material.dispose();
    });
  }

  return { createChaseCar, buildCockpitFixtures, disposeCarMesh, getCarPartBoundingBox };
}
