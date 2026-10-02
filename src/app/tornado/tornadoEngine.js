import { createSim } from './engine/context.js';
import { createSceneSystem } from './engine/scene.js';
import { createStrikeTargetsSystem } from './engine/strikeTargets.js';
import { createHazardsSystem } from './engine/hazards.js';
import { createDayNightSystem } from './engine/dayNight.js';
import { createFirenadoSystem } from './engine/firenado.js';
import { createFireSoundSystem } from './engine/sound/fire.js';
import { createEarthquakeSystem } from './engine/earthquake.js';
import { createEarthquakeSoundSystem } from './engine/sound/earthquake.js';
import { createDownburstSystem } from './engine/downburst.js';
import { createStrikeTargetingSystem } from './engine/strikeTargeting.js';
import { createDownburstSoundSystem } from './engine/sound/downburst.js';
import { createFissureSystem } from './engine/fissure.js';
import { createSpaceshipSystem } from './engine/spaceship.js';
import { createKeyPanSystem } from './engine/keyPan.js';
import { createAliensSystem } from './engine/aliens.js';
import { createMothershipSystem } from './engine/mothership.js';
import { createMegaBlastSystem } from './engine/explosions/megaBlast.js';
import { createNuclearSystem } from './engine/nuclear.js';
import { createSmoothCriminalSystem } from './engine/smoothCriminal.js';
import { createHeroModeSystem } from './engine/heroMode.js';
import { createHealthSystem } from './engine/health/system.js';
import { createNetSystem } from './engine/net/system.js';
import { createHeroSoundSystem } from './engine/sound/hero.js';
import { createBlackHoleSoundSystem } from './engine/sound/blackHole.js';
import { createKatanaSoundSystem } from './engine/sound/katana.js';
import { createEmpChargeSystem } from './engine/empCharge.js';
import { createEmpHumSoundSystem } from './engine/sound/empHum.js';
import { createCreatureSoundSystem } from './engine/sound/creatures.js';
import { createGiantClashSystem } from './engine/giants/clash.js';
import { createChasmSystem } from './engine/chasm.js';
import { createTerminatorSystem } from './engine/terminator.js';
import { createSpaceshipSoundSystem } from './engine/sound/spaceship.js';
import { createLightPoolSystem } from './engine/lightPool.js';
import { createPowerArcSoundSystem } from './engine/sound/powerArc.js';
import { createVortexSystem } from './engine/vortex.js';
import { createStormLifeSystem, BRIGHTNESS_BASE } from './engine/stormLife.js';
import { createTornadoRegistry } from './engine/tornadoes.js';
import { createFujiwharaSystem } from './engine/fujiwhara.js';
import { createFujiwharaSoundSystem } from './engine/sound/fujiwhara.js';
import { createForcesSystem } from './engine/forces.js';
import { createCameraSystem } from './engine/camera.js';
import { createGameFeelSystem } from './engine/gamefeel.js';
import { createScreenCrackSystem } from './engine/screenCrack.js';
import { createSoundSystem } from './engine/sound/index.js';
import { createThunderSystem } from './engine/sound/thunder.js';
import { createImpactSoundSystem } from './engine/sound/impact.js';
import { createScreamSoundSystem } from './engine/sound/scream.js';
import { createStingerSoundSystem } from './engine/sound/stinger.js';
import { createShockwaveSoundSystem } from './engine/sound/shockwave.js';
import { createCueSoundSystem } from './engine/sound/cues.js';
import { createLightningSystem } from './engine/lightning.js';
import { createCloudsSystem } from './engine/clouds.js';
import { createWeatherSystem } from './engine/weather.js';
import { createGroundFxSystem } from './engine/groundFx.js';
import { createExplosionsSystem } from './engine/explosions/index.js';
import { createPostSystem } from './engine/post.js';
import { createQualitySystem } from './engine/quality.js';
import { createLifecycle } from './engine/lifecycle.js';
import { createTimeSystem } from './engine/time.js';
import { createEnergySystem } from './engine/player/energy.js';
import { createAbilitySystem } from './engine/player/abilities.js';
import { createPlayerInput } from './engine/player/input.js';
import { createEnemyRegistry } from './engine/enemies.js';
import { createAreaEffects } from './engine/effects/area.js';
import { createConsumables } from './engine/effects/consumables.js';
import { createCapsSystem } from './engine/perf/caps.js';
import { createSettingsSystem } from './engine/settings.js';
import { createEventBus } from './engine/events.js';
import { createPerfMonitorSystem } from './engine/perf/monitor.js';
import { createBenchSystem, seedRandom } from './engine/perf/bench.js';
import { createInstancerSystem } from './engine/environment/instancer.js';
import { createBuildingsSystem } from './engine/environment/buildings.js';
import { createTreesSystem } from './engine/environment/trees.js';
import { createCarsSystem } from './engine/environment/cars.js';
import { createPeopleSystem } from './engine/environment/people.js';
import { createPeopleMotionSystem } from './engine/environment/peopleMotion.js';
import { createSpeechBubbleSystem } from './engine/environment/speechBubbles.js';
import { createDazedStarsSystem } from './engine/environment/dazedStars.js';
import { createCarDustSystem } from './engine/environment/carDust.js';
import { createEnvironmentSystem } from './engine/environment/index.js';
import { createRoadsDecorSystem } from './engine/environment/roadsDecor.js';
import { createParksSystem } from './engine/environment/parks.js';
import { createBackdropSystem } from './engine/environment/backdrop.js';
import { createFuelStationSystem } from './engine/environment/fuelStation.js';
import { createShelterSystem } from './engine/environment/shelters.js';
import { createReinforcementsSystem } from './engine/environment/reinforcements.js';
import { createDebrisSystem, DEBRIS_CAP, DEBRIS_KIND_NAMES } from './engine/debris.js';
import { createDebrisImpactsSystem } from './engine/debrisImpacts.js';
import { createPhysicsSystem } from './engine/physics.js';
import { createDamageSystem } from './engine/damage.js';
import { createBuildingFireSystem } from './engine/buildingFire.js';
import { createPowerLinesSystem } from './engine/environment/powerLines.js';
import { createTrainSystem } from './engine/environment/train.js';
import { createViaductSystem } from './engine/environment/viaduct.js';
import { createTankerSystem } from './engine/environment/tanker.js';
import { createHuntSystem } from './engine/hunt.js';
import { createPossessSystem } from './engine/possess.js';
import { createMeteorSystem } from './engine/meteors.js';
import { createFloodSystem } from './engine/flood.js';
import { createFloodSoundSystem } from './engine/sound/flood.js';
import { createRocketSoundSystem } from './engine/sound/rocket.js';
import { createFactorySystem } from './engine/environment/factory.js';
import { createFuelFireSystem } from './engine/fuelFire.js';
import { createCrowdSystem } from './engine/environment/crowd.js';
import { createTeleportSystem } from './engine/player/teleport.js';
import { createEmpSystem } from './engine/player/emp.js';
import { createTrexSystem } from './engine/trex.js';
import { createFreezeSystem } from './engine/effects/freeze.js';
import { createYetiSystem } from './engine/yeti.js';
import { createBlizzardSystem } from './engine/blizzard.js';
import { createBlackHoleSystem } from './engine/player/blackHole.js';
import { createPatientZeroSystem } from './engine/patientZero.js';
import { createMissionSystem } from './engine/missions.js';
import { createVolcanoSystem } from './engine/volcano.js';
import { createWaterspoutSystem } from './engine/waterspout.js';
import { createActionHeroSystem } from './engine/actionHero.js';
import { createCowSystem } from './engine/cows.js';
import { createCleanerSystem } from './engine/cleaner.js';
import { createElectricStormSystem } from './engine/electricStorm.js';
import { createGasMainsSystem } from './engine/gasMains.js';
import { createLavanadoSystem } from './engine/lavanado.js';
import { createCollisionsSystem } from './engine/collisions.js';
import { createWedgeSystem } from './engine/wedge.js';
import { createDoomsdaySystem } from './engine/doomsday.js';
import { createVehicleSystem } from './engine/emergency/vehicles.js';
import { createEmergencySystem } from './engine/emergency/index.js';
import { createEvacuationSystem } from './engine/evacuation.js';
import { createCarRescueSystem } from './engine/chase/carRescue.js';
import { createKillcamSystem } from './engine/killcam.js';
import { createRubbleSystem } from './engine/rubble.js';
import { createToppleSystem } from './engine/topple.js';
import { createSinkholeSystem } from './engine/sinkhole.js';
import { createChaseSystem } from './engine/chase/index.js';
import { createChaseCarSystem } from './engine/chase/car.js';
import { createSkidMarksSystem } from './engine/chase/skidMarks.js';
import { createChaseCameraSystem } from './engine/chase/cameras.js';
import { createChaseDriveSystem } from './engine/chase/drive.js';
import { createTireFireSystem } from './engine/chase/tireFire.js';
import { createUISystem } from './engine/ui.js';
import { initBannerStack } from './utils/banners.js';
import { createMinimapTrackerSystem } from './engine/ui/minimapTracker.js';
import { createMinimapSystem } from './engine/ui/minimap.js';

/**
 * This is the Three.js tornado simulator (vortex forces, debris pooling,
 * damage tiers, lightning/thunder, etc.), wrapped in `createSimulation(container)`
 * so a React component (see TornadoSimulator.js) controls exactly when the
 * simulation starts and stops. Notable consequences of that wrapping:
 *
 *  - The renderer's canvas is appended to the `container` element passed
 *    in, rather than to `document.body` directly, since this shares a page
 *    with other React-rendered DOM (the UI panel, stats panel, etc., still
 *    rendered as plain HTML by TornadoSimulator.js using the exact same
 *    element IDs the code below queries via `document.getElementById`).
 *  - The window resize listener and the animation-frame loop are
 *    stoppable via the returned `dispose()` function, so React can clean
 *    up correctly when the component unmounts (e.g. if the user navigates
 *    away in the Luigi shell) instead of leaking a running render loop.
 *
 * @param {HTMLElement} container element the renderer's <canvas> is mounted into
 * @returns {{ dispose: () => void }}
 */
export function createSimulation(container) {
  // --- lifecycle handles added for the Next.js port (see file header) ---
  let rafId = null;
  let cancelled = false;

  /**
   * ===========================================================================
   * SECTION A — Configuration & global simulation state
   * ===========================================================================
   * Note on documentation conventions: British English spelling is used
   * throughout comments (colour, behaviour, organise, etc.), and every
   * function below carries a JSDoc type signature. Shared typedefs
   * (SimObject, DamageState, etc.) live in engine/context.js.
   */
  // `?bench=1` (engine/perf/bench.js): the same town and the same storm
  // every run, so Math.random is swapped for a seeded one before anything
  // is built, and put back in dispose().
  const restoreRandom = seedRandom();
  const Sim = createSim();

  /**
   * Growing context object threaded into the per-instance factory modules
   * under engine/ (see ENGINE_REFACTOR_PLAN.md) so they can share state with
   * tornadoEngine.js and with each other without becoming module-level
   * singletons -- state must stay per-`createSimulation()` call, not
   * module-scoped, since React StrictMode remounts the component in dev.
   */
  // Shared mutable counter for SimObject ids, wrapped in an object so every
  // module that creates objects (buildings, trees, cars, debris) can share
  // and increment the same sequence via ctx.nextObjectId.value++.
  // Every listener the engine adds (buttons, keys, the window) is tied to
  // this instance's lifetime and goes with it in dispose(): a remount (React
  // StrictMode in dev, or leaving the page in the Luigi shell and coming
  // back) used to leave the old instance answering the panel's buttons too,
  // and a Reset then also ran the disposed instance's reset, which threw.
  const lifetime = new AbortController();
  const ctx = {
    container, Sim,
    signal: lifetime.signal,
    // News between systems (engine/events.js).
    events: createEventBus(),
    nextObjectId: { value: 1 },
    systems: {},
    // Seconds, for anything that animates by the clock rather than by the
    // frame's dt (a sway, a flicker, a noise phase): the real clock, except
    // in a benchmark (engine/perf/bench.js), where it is the frames' own
    // fixed steps added up, so a run is the same every time.
    now: () => performance.now() * 0.001
  };
  let benchClock = 0;

  // Every system goes through register() (engine/lifecycle.js): onto
  // ctx.systems, and its init/reset/dispose watched. A new system registered
  // with { auto: true } has them run for it at the end of each phase below.
  const lifecycle = createLifecycle(ctx);
  const { register } = lifecycle;

  const sceneSystem = createSceneSystem(ctx);
  register('scene', sceneSystem);
  const { initScene, updateAtmosphere, disposeScene } = sceneSystem;

  // Before lightning and before everything that registers strike targets
  // into it (people.js, chase/index.js), which they do at construction time.
  register('strikeTargets', createStrikeTargetsSystem());
  // Local ground dangers the crowd AI steers away from (engine/hazards.js):
  // at present the shadow under a sagging viaduct span.
  // Each owner (viaduct, chasms, gas mains) removes its own hazards on reset.
  register('hazards', createHazardsSystem(), { skip: ['clearHazards'] });

  // Constructed before sound/lightning/clouds/groundFx/explosions/post below:
  // lightning.js and groundFx.js already read ctx.Vortex eagerly at their own
  // construction time, so it has to exist as a real object by then, not just
  // by the time initVortex() actually populates its geometry at bootstrap.
  const vortexSystem = createVortexSystem(ctx);
  register('vortex', vortexSystem);
  // The Outbreak preset's extra tornadoes (engine/tornadoes.js): built now,
  // hidden and inactive until an Outbreak switches them on. OUTBREAK_DETAIL
  // scales their particle counts and sub-vortex pools against the primary's.
  const OUTBREAK_MAX = 3;
  const OUTBREAK_DETAIL = 1;
  const tornadoRegistry = createTornadoRegistry(ctx);
  const vortexSystems = [vortexSystem];
  for (let i = 1; i < OUTBREAK_MAX; i++) {
    vortexSystems.push(createVortexSystem(ctx, { index: i, detail: OUTBREAK_DETAIL }));
  }

  // computeVortexForce/windForceMagnitudeAt are published onto ctx by the
  // factory itself (see forces.js) for physics.js/damage.js to read; nothing
  // in tornadoEngine.js calls them directly.
  const forcesSystem = createForcesSystem(ctx);
  register('forces', forcesSystem);

  // Cinematic/setCinematicView are published onto ctx by the factory itself
  // (see camera.js), the same way Chase/Environment publish themselves --
  // chase/index.js's enterChaseMode/exitChaseMode need to hand off between
  // the two camera modes and is constructed further down.
  const cameraSystem = createCameraSystem(ctx);
  register('camera', cameraSystem);
  const { Cinematic, setCinematicView, updateCinematicCamera } = cameraSystem;

  // Before damage/fire/power lines, all of which report events to it, and
  // before the animation loop, which reads its timescale to derive the
  // simulation's delta time from the real one.
  const gamefeelSystem = createGameFeelSystem(ctx);
  register('gamefeel', gamefeelSystem);
  const { GameFeel, updateGameFeel, applyGameFeelShake, resetGameFeel } = gamefeelSystem;

  // Looked up lazily by gamefeel.js's event() rather than depended on here,
  // so construction order between the two doesn't matter.
  const screenCrackSystem = createScreenCrackSystem(ctx);
  register('screenCrack', screenCrackSystem);
  const { initScreenCrack, resetScreenCrack, disposeScreenCrack } = screenCrackSystem;

  const soundSystem = createSoundSystem(ctx);
  register('sound', soundSystem);
  const {
    SoundSystem, initSoundSystem, resumeSoundSystem, updateSoundSystem,
    detachAudioGestureListeners
  } = soundSystem;

  const thunderSystem = createThunderSystem(ctx);
  register('thunder', thunderSystem);

  const impactSystem = createImpactSoundSystem(ctx);
  register('impact', impactSystem);

  const screamSystem = createScreamSoundSystem(ctx);
  register('scream', screamSystem);

  const stingerSystem = createStingerSoundSystem(ctx);
  register('stinger', stingerSystem);

  const shockwaveSystem = createShockwaveSoundSystem(ctx);
  register('shockwaveSound', shockwaveSystem);

  const cueSystem = createCueSoundSystem(ctx);
  register('cues', cueSystem);

  const lightningSystem = createLightningSystem(ctx);
  // disposeBolt is per bolt, called from dispose() for each one live.
  register('lightning', lightningSystem, { skip: ['disposeBolt'] });
  const { Lightning, initLightning, updateLightning, disposeBolt, resetLightningStrikes } = lightningSystem;

  const cloudsSystem = createCloudsSystem(ctx);
  register('clouds', cloudsSystem);
  const { initClouds, updateClouds, disposeClouds } = cloudsSystem;

  const weatherSystem = createWeatherSystem(ctx);
  register('weather', weatherSystem);
  const { initWeather, updateWeather, disposeWeather } = weatherSystem;

  const groundFxSystem = createGroundFxSystem(ctx);
  register('groundFx', groundFxSystem);
  // One groundFx per tornado; the primary's is the one above.
  vortexSystems.forEach((system, i) => {
    tornadoRegistry.register({
      ...system,
      groundFx: i === 0 ? groundFxSystem : createGroundFxSystem(ctx, system.Vortex)
    });
  });

  const explosionsSystem = createExplosionsSystem(ctx);
  register('explosions', explosionsSystem);
  const {
    ImpactBursts, initImpactBursts, spawnImpactBurst,
    updateImpactBursts, resetImpactBursts, disposeImpactBursts
  } = explosionsSystem;

  // Steps the picture down on machines that cannot hold the frame rate
  // (engine/quality.js).
  const qualitySystem = createQualitySystem(ctx);
  register('quality', qualitySystem);
  const { initQuality, updateQuality, resetQuality, disposeQuality } = qualitySystem;
  // `?perf=1`'s overlay and `?bench=1`'s benchmark (engine/perf/).
  const perfMonitor = createPerfMonitorSystem(ctx);
  register('perfMonitor', perfMonitor);
  // The foundation for the hero's abilities and the new enemies (plan PR 0):
  // time groups, energy, abilities, the player's input kept apart from the
  // game, the shared register of enemies, effects in an area, and the
  // entity caps and particle budget. Their init, reset and dispose are run
  // by the lifecycle registry (auto).
  register('time', createTimeSystem(ctx), { auto: true });
  register('energy', createEnergySystem(ctx), { auto: true });
  register('abilities', createAbilitySystem(ctx), { auto: true });
  register('teleport', createTeleportSystem(ctx), { auto: true });
  register('emp', createEmpSystem(ctx), { auto: true });
  register('playerInput', createPlayerInput(ctx), { auto: true });
  register('enemies', createEnemyRegistry(ctx), { auto: true });
  register('area', createAreaEffects(ctx), { auto: true });
  // What the Black Hole Gun can swallow: everything but Roger.
  register('consumables', createConsumables(ctx), { auto: true });
  register('caps', createCapsSystem(ctx), { auto: true });
  // The panel's Sounds switches, kept between sessions (engine/settings.js).
  register('settings', createSettingsSystem(ctx), { auto: true });
  // How the crowd behaves: traits and presets (engine/environment/crowd.js),
  // read by the people's movement.
  register('crowd', createCrowdSystem(ctx), { auto: true });
  const bench = createBenchSystem(ctx, {
    frame, startSim,
    isCancelled: () => cancelled,
    // The sound graph built and every sample loaded before the first frame:
    // both draw random numbers, and when they happen mid-run depends on the
    // network, not on the game (engine/perf/bench.js).
    prepare: () => {
      ctx.systems.sound.ensureAudioReady();
      return SoundSystem.samplesReady || Promise.resolve();
    }
  });
  if (bench.enabled) ctx.now = () => benchClock;
  // Read by what the benchmark must not run (camera.js's glide).
  ctx.benchmarking = bench.enabled;
  // The crowd and the trees drawn as instances (engine/environment/instancer.js).
  const instancerSystem = createInstancerSystem(ctx);
  register('instancer', instancerSystem);
  const { initInstancer, updateInstancer, restoreInstancer, resetInstancer, disposeInstancer } = instancerSystem;
  const postSystem = createPostSystem(ctx);
  register('post', postSystem);
  const { initPostProcessing, renderFrame, disposePostProcessing } = postSystem;

  // Constructed before the environment/debris/physics/damage systems below
  // (rather than alongside the rest of chase/* further down) because those
  // Phase 5 modules -- cars.js and carDust.js -- already read Chase state
  // (ctx.Chase) eagerly at their own construction time; ctx.Chase has to
  // exist as a real object by then, not just by the time chase mode is
  // actually toggled on. chase/index.js's own functions look up the other
  // chase/* systems (chaseCar, chaseDrive, skidMarks, cars) lazily via
  // ctx.systems.* inside their bodies instead of destructuring them here,
  // so none of those need to exist yet at this point.
  const chaseSystem = createChaseSystem(ctx);
  register('chase', chaseSystem);
  const { Chase, exitChaseMode, updateChaseHud, initChaseUI, parkChaseCar } = chaseSystem;

  const buildingsSystem = createBuildingsSystem(ctx);
  register('buildings', buildingsSystem);

  const treesSystem = createTreesSystem(ctx);
  register('trees', treesSystem);

  const carDustSystem = createCarDustSystem(ctx);
  // The Chase Mode car's dust, fire and body state are reset on entering,
  // restarting and leaving a chase (chase/index.js), not by Reset.
  register('carDust', carDustSystem, { skip: ['resetCarDust'] });
  const { initCarDust, updateCarDust } = carDustSystem;

  const carsSystem = createCarsSystem(ctx);
  register('cars', carsSystem, { skip: ['resetCarVisuals'] });
  const { createCar, updateCarVisuals, resetCarVisuals } = carsSystem;

  const peopleSystem = createPeopleSystem(ctx);
  register('people', peopleSystem);

  // Reads ctx.Environment lazily inside its update, so only needs to exist
  // before the loop starts, not before the environment is generated.
  const speechBubbleSystem = createSpeechBubbleSystem(ctx);
  register('speechBubbles', speechBubbleSystem);
  const { initSpeechBubbles, updateSpeechBubbles, clearSpeechBubbles, disposeSpeechBubbles } = speechBubbleSystem;

  const peopleMotionSystem = createPeopleMotionSystem(ctx);
  register('peopleMotion', peopleMotionSystem);
  const { updatePeopleMotion } = peopleMotionSystem;

  // Reads the dazed state peopleMotion.js writes, so it only needs to exist
  // before the loop starts -- same as the speech bubbles above.
  const dazedStarsSystem = createDazedStarsSystem(ctx);
  register('dazedStars', dazedStarsSystem);
  const { initDazedStars, updateDazedStars, disposeDazedStars } = dazedStarsSystem;

  // Before the environment system: generateEnvironment() plants the park
  // trees through it (populateParks).
  const parksSystem = createParksSystem(ctx);
  register('parks', parksSystem);
  const { generateParkGrounds } = parksSystem;

  const fuelStationSystem = createFuelStationSystem(ctx);
  register('fuelStation', fuelStationSystem);
  register('shelters', createShelterSystem(ctx));
  // Looks up ctx.systems.people/peopleMotion lazily inside its own functions
  // rather than destructuring them here, so construction order relative to
  // either does not matter (same pattern chase/index.js uses further down).
  const reinforcementsSystem = createReinforcementsSystem(ctx);
  register('reinforcements', reinforcementsSystem);
  const { updateReinforcements, resetReinforcements, disposeReinforcements } = reinforcementsSystem;

  const environmentSystem = createEnvironmentSystem(ctx);
  register('environment', environmentSystem);
  const { generateEnvironment, resetEnvironment } = environmentSystem;

  const roadsDecorSystem = createRoadsDecorSystem(ctx);
  register('roadsDecor', roadsDecorSystem);
  const { generateRoads, generateDecor } = roadsDecorSystem;

  const backdropSystem = createBackdropSystem(ctx);
  register('backdrop', backdropSystem);
  const { generateBackdrop, updateBackdrop, resetBackdrop } = backdropSystem;

  const debrisSystem = createDebrisSystem(ctx);
  register('debris', debrisSystem);
  const { DebrisPool, initDebrisPool, spawnDebris, releaseDebris, syncDebrisInstances, spawnAmbientDebris } = debrisSystem;

  const physicsSystem = createPhysicsSystem(ctx);
  register('physics', physicsSystem);
  const { integratePhysics, updateCaptureState } = physicsSystem;

  // Before the damage system: collapseBuilding() reaches for both of these by
  // name the moment a building goes down (a fuel station lighting the street,
  // a collapse pulling a power line over), so they have to be on ctx.systems
  // before the first collapse rather than merely before the loop starts.
  const buildingFireSystem = createBuildingFireSystem(ctx);
  register('buildingFire', buildingFireSystem);
  const {
    initBuildingFire, updateBuildingFire, resetBuildingFire, disposeBuildingFire
  } = buildingFireSystem;

  // The effect-light budget the power-line arcs and the lava vents share.
  const lightPoolSystem = createLightPoolSystem(ctx);
  register('lightPool', lightPoolSystem);
  const { initLightPool, flushLightPool, resetLightPool, disposeLightPool } = lightPoolSystem;

  register('powerArcSound', createPowerArcSoundSystem(ctx));

  // The railway's train (engine/environment/train.js), the town's one
  // piece of moving traffic.
  const trainSystem = createTrainSystem(ctx);
  register('train', trainSystem);
  const { initTrain, updateTrain, resetTrain, disposeTrain } = trainSystem;

  // The elevated highway. Constructed alongside the train for the same
  // reasons -- it owns car objects and pushes them into Sim.objects -- and
  // before the damage system, which routes debris hits on its structure
  // straight back to it (damageFromImpact).
  const viaductSystem = createViaductSystem(ctx);
  register('viaduct', viaductSystem);
  const { initViaduct, updateViaduct, resetViaduct, disposeViaduct } = viaductSystem;

  const tankerSystem = createTankerSystem(ctx);
  register('tanker', tankerSystem);
  const { initTanker, updateTanker, resetTanker, disposeTanker } = tankerSystem;

  // Steers the funnels once the run is old enough; reads the people list
  // and writes only Vortex.huntTarget.
  const huntSystem = createHuntSystem(ctx);
  register('hunt', huntSystem);
  const { updateHunt, resetHunt } = huntSystem;

  // Hands the primary funnel's steering to the player (engine/possess.js).
  // Looks up ctx.systems.wedge/doomsday/ui lazily inside its own functions
  // rather than destructuring them here, so construction order relative to
  // any of them does not matter (same pattern chase/index.js uses).
  const possessSystem = createPossessSystem(ctx);
  register('possess', possessSystem);
  const { Possess, updatePossess, resetPossess } = possessSystem;

  // Independent of the storm: the barrage lands on the run clock wherever
  // the funnel happens to be.
  const meteorSystem = createMeteorSystem(ctx);
  register('meteors', meteorSystem);
  const { initMeteors, updateMeteors, resetMeteors, disposeMeteors } = meteorSystem;

  // Its own disaster on its own button, with no tie to the storm at all.
  register('floodSound', createFloodSoundSystem(ctx));
  const floodSystem = createFloodSystem(ctx);
  register('flood', floodSystem);
  const { initFlood, updateFlood, resetFlood, disposeFlood } = floodSystem;

  const factorySystem = createFactorySystem(ctx);
  register('factory', factorySystem);
  const { initFactory, updateFactory, resetFactory, disposeFactory } = factorySystem;
  // The fuel stations going up: leak, fire, blast, the cars after it
  // (engine/fuelFire.js). After the town, whose stations it takes over.
  register('fuelFire', createFuelFireSystem(ctx), { auto: true });
  // The cyber T-Rex (engine/trex.js), from the panel.
  register('trex', createTrexSystem(ctx), { auto: true });
  // Frozen: ice blocks and statues (engine/effects/freeze.js); the cyber
  // Yeti and the Blizzard that use it (plan PR 4).
  register('freeze', createFreezeSystem(ctx), { auto: true });
  register('yeti', createYetiSystem(ctx), { auto: true });
  // The creatures' sounds (engine/sound/creatures.js), positional.
  register('creatureSounds', createCreatureSoundSystem(ctx), { auto: true });
  // The two giants' stalemate (engine/giants/clash.js).
  register('giantClash', createGiantClashSystem(ctx), { auto: true });
  register('blizzard', createBlizzardSystem(ctx), { auto: true });
  // The Black Hole Gun's own voice (sound/blackHole.js), driven by the hole's
  // size each frame rather than its own lifecycle -- see sound/empHum.js for
  // the same level-driven pattern.
  register('holeSound', createBlackHoleSoundSystem(ctx));
  // The Black Hole Gun's hole (a weapon, heroWeapons.js) and Patient Zero.
  register('blackHole', createBlackHoleSystem(ctx), { auto: true });
  register('patientZero', createPatientZeroSystem(ctx), { auto: true });
  // Timed missions over the game's own statistics (plan PR 7).
  register('missions', createMissionSystem(ctx), { auto: true });
  // The volcano in the earthquake's fissure (plan PR 8).
  register('volcano', createVolcanoSystem(ctx), { auto: true });
  // A tornado over the dam's lake (plan PR 9).
  register('waterspout', createWaterspoutSystem(ctx), { auto: true });
  // Hank Granite's scene and Captain Spotless (plan PR 10): from their
  // buttons only.
  register('actionHero', createActionHeroSystem(ctx), { auto: true });
  // The pasture and its herd (engine/cows.js): physics objects the funnel
  // lifts like anything else, mooing.
  register('cows', createCowSystem(ctx), { auto: true });
  register('cleaner', createCleanerSystem(ctx), { auto: true });

  const electricStormSystem = createElectricStormSystem(ctx);
  register('electricStorm', electricStormSystem);
  const {
    initElectricStorm, updateElectricStorm, resetElectricStorm, disposeElectricStorm
  } = electricStormSystem;
  // Funnels charged by bringing a power line down (engine/empCharge.js).
  register('empHum', createEmpHumSoundSystem(ctx));
  const empChargeSystem = createEmpChargeSystem(ctx);
  register('empCharge', empChargeSystem);
  const { initEmpCharge, updateEmpCharge, resetEmpCharge, disposeEmpCharge } = empChargeSystem;

  // The buried gas network. Registered before the systems that can open one
  // (the fissures, a meteor, the lavanado) look for it.
  const gasMainsSystem = createGasMainsSystem(ctx);
  register('gasMains', gasMainsSystem);
  const { initGasMains, updateGasMains, resetGasMains, disposeGasMains } = gasMainsSystem;

  // The tornado carrying a load of molten rock: fed by the earthquake's lava,
  // so it needs the fissures, and it rains onto the town, so it needs the
  // mains above.
  const lavanadoSystem = createLavanadoSystem(ctx);
  register('lavanado', lavanadoSystem);
  const { initLavanado, updateLavanado, resetLavanado, disposeLavanado } = lavanadoSystem;

  // What happens where two of the above meet. Knows about several disasters
  // at once, which is exactly why none of them has to know about each other.
  // What a building leaves in the road, and what makes it fall over rather
  // than down. damage.js reaches for the toppling system the moment anything
  // collapses, and toppling drops rubble as it lands.
  const rubbleSystem = createRubbleSystem(ctx);
  register('rubble', rubbleSystem);
  const { initRubble, resetRubble, disposeRubble } = rubbleSystem;

  const toppleSystem = createToppleSystem(ctx);
  register('topple', toppleSystem);
  const { updateTopple, resetTopple } = toppleSystem;

  // The ground going away. It reaches for the evacuation through ctx at the
  // moment it opens rather than at construction, so the order here is free.
  const sinkholeSystem = createSinkholeSystem(ctx);
  register('sinkhole', sinkholeSystem);
  const {
    initSinkholes, updateSinkholes, resetSinkholes, disposeSinkholes
  } = sinkholeSystem;

  // The town's own side. The vehicle system is the shared chassis and
  // driving; the two above it are what the vehicles are *for*, and both need
  // it registered before they build their fleets.
  // The fleets are made once and kept across runs; their traffic list is
  // only emptied when the whole instance goes (dispose).
  register('vehicles', createVehicleSystem(ctx), { skip: ['resetVehicleTraffic'] });

  const emergencySystem = createEmergencySystem(ctx);
  register('emergency', emergencySystem);
  const {
    initEmergency, updateEmergency, resetEmergency, disposeEmergency
  } = emergencySystem;

  // Picking people up in the car (chase/carRescue.js): Chase Mode's, or
  // whichever car Roger is driving.
  const carRescueSystem = createCarRescueSystem(ctx);
  register('carRescue', carRescueSystem);
  const { initCarRescue, updateCarRescue, resetCarRescue, disposeCarRescue } = carRescueSystem;
  const evacuationSystem = createEvacuationSystem(ctx);
  register('evacuation', evacuationSystem);
  const {
    initEvacuation, updateEvacuation, resetEvacuation, disposeEvacuation
  } = evacuationSystem;

  // Registered before gamefeel fires its first heavy event, since that is
  // what arms a replay.
  const killcamSystem = createKillcamSystem(ctx);
  register('killcam', killcamSystem);
  const { initKillcam, updateKillcam, resetKillcam, disposeKillcam } = killcamSystem;

  const collisionsSystem = createCollisionsSystem(ctx);
  register('collisions', collisionsSystem);
  const {
    initCollisions, updateCollisions, resetCollisions, disposeCollisions
  } = collisionsSystem;

  // The storm at the scale where the town has no outside, and the one button
  // that fires every disaster above in an order that was chosen rather than
  // clicked. Both reach for everything they drive through ctx.systems at the
  // moment they are pressed rather than at construction, so neither needs to
  // come after the twenty-odd systems it touches.
  const wedgeSystem = createWedgeSystem(ctx);
  register('wedge', wedgeSystem);
  const { initWedge, updateWedge, resetWedge, disposeWedge } = wedgeSystem;

  const doomsdaySystem = createDoomsdaySystem(ctx, { startSim });
  register('doomsday', doomsdaySystem);
  const {
    initDoomsday, updateDoomsday, resetDoomsday, disposeDoomsday
  } = doomsdaySystem;

  const powerLinesSystem = createPowerLinesSystem(ctx);
  register('powerLines', powerLinesSystem);
  const {
    initPowerLines, updatePowerLines, resetPowerLines, disposePowerLines
  } = powerLinesSystem;

  const damageSystem = createDamageSystem(ctx);
  register('damage', damageSystem);
  const { updateDamage, updatePendingShocks, resetDamage } = damageSystem;

  // After damage (it calls damageFromImpact) and after debris/environment,
  // both of which it walks every frame.
  const debrisImpactsSystem = createDebrisImpactsSystem(ctx);
  register('debrisImpacts', debrisImpactsSystem);
  const { updateDebrisImpacts } = debrisImpactsSystem;

  const chaseCarSystem = createChaseCarSystem(ctx);
  // disposeCarMesh is per car, called when a chase car is replaced.
  register('chaseCar', chaseCarSystem, { skip: ['disposeCarMesh'] });

  const skidMarksSystem = createSkidMarksSystem(ctx);
  register('skidMarks', skidMarksSystem);
  const { SkidMarks, initSkidMarks, clearSkidMarks } = skidMarksSystem;

  const chaseCameraSystem = createChaseCameraSystem(ctx);
  register('chaseCamera', chaseCameraSystem);
  const { updateChaseCamera, updateCockpitCamera, updateCockpitWheel, syncCockpitRigVisibility } = chaseCameraSystem;

  const tireFireSystem = createTireFireSystem(ctx);
  register('tireFire', tireFireSystem, { skip: ['resetTireFire'] });
  const { initTireFire, updateTireFire, disposeTireFire } = tireFireSystem;

  const chaseDriveSystem = createChaseDriveSystem(ctx);
  register('chaseDrive', chaseDriveSystem);
  const { updateChaseCar, detachChaseInputListeners } = chaseDriveSystem;

  // startSim/togglePause/resetSim (SECTION J, below) are passed in directly
  // rather than looked up lazily via ctx.systems: they stay owned by
  // tornadoEngine.js as orchestration glue rather than becoming their own
  // factory module, but initUI()'s button wiring still needs to reach them.
  // Safe to reference here ahead of their textual declaration since they're
  // hoisted function declarations.
  const uiSystem = createUISystem(ctx, { startSim, togglePause, resetSim });
  register('ui', uiSystem);
  const { initUI, updateStatsPanel } = uiSystem;

  const minimapTrackerSystem = createMinimapTrackerSystem(ctx);
  register('minimapTracker', minimapTrackerSystem);
  const { updateMinimapTracker, resetMinimapTracker } = minimapTrackerSystem;

  register('fireSound', createFireSoundSystem(ctx));

  const firenadoSystem = createFirenadoSystem(ctx);
  register('firenado', firenadoSystem);
  const { initFirenado, updateFirenado, resetFirenado, disposeFirenado } = firenadoSystem;

  const dayNightSystem = createDayNightSystem(ctx);
  register('dayNight', dayNightSystem);
  const { initDayNight, updateDayNight, resetDayNight } = dayNightSystem;

  register('earthquakeSound', createEarthquakeSoundSystem(ctx));

  // Before the earthquake itself, which arms an eruption when triggered.
  const fissureSystem = createFissureSystem(ctx);
  register('fissures', fissureSystem);
  const { initFissures, updateFissures, resetFissures, disposeFissures } = fissureSystem;

  register('fujiwharaSound', createFujiwharaSoundSystem(ctx));

  // Outbreak tornadoes merging (engine/fujiwhara.js).
  const fujiwharaSystem = createFujiwharaSystem(ctx);
  register('fujiwhara', fujiwharaSystem);
  const { initFujiwhara, updateFujiwhara, resetFujiwhara, disposeFujiwhara } = fujiwharaSystem;

  const earthquakeSystem = createEarthquakeSystem(ctx);
  register('earthquake', earthquakeSystem);
  const { initEarthquake, updateEarthquake, resetEarthquake, disposeEarthquake } = earthquakeSystem;

  // Straight-line winds out of a collapsing storm cell (engine/downburst.js),
  // its own button and nothing to do with the funnel.
  register('downburstSound', createDownburstSoundSystem(ctx));
  const downburstSystem = createDownburstSystem(ctx);
  register('downburst', downburstSystem);
  const { initDownburst, updateDownburst, resetDownburst, disposeDownburst } = downburstSystem;

  // Lightning called down by the player (engine/strikeTargeting.js).
  const strikeTargetingSystem = createStrikeTargetingSystem(ctx);
  register('strikeTargeting', strikeTargetingSystem);
  const {
    initStrikeTargeting, updateStrikeTargeting, resetStrikeTargeting, disposeStrikeTargeting
  } = strikeTargetingSystem;

  // The ground splitting open (engine/chasm.js), opened by the earthquake.
  const chasmSystem = createChasmSystem(ctx);
  register('chasm', chasmSystem);
  const { initChasms, updateChasms, resetChasms, disposeChasms } = chasmSystem;

  // The one thing only the Electric Tornado's EMP can kill (engine/terminator.js).
  const terminatorSystem = createTerminatorSystem(ctx);
  register('terminator', terminatorSystem);
  const { initTerminator, updateTerminator, resetTerminator, disposeTerminator } = terminatorSystem;

  // Landing Support (engine/spaceship.js): T, the samurai and the rocket.
  // After the earthquake, whose dust pool it kicks up, and after
  // gamefeel/damage, which it feeds -- though it reaches all of them
  // through ctx.systems when called.
  register('spaceshipSound', createSpaceshipSoundSystem(ctx));
  register('rocketSound', createRocketSoundSystem(ctx), { auto: true });
  const spaceshipSystem = createSpaceshipSystem(ctx);
  register('spaceship', spaceshipSystem);
  const { initSpaceship, updateSpaceship, resetSpaceship, disposeSpaceship } = spaceshipSystem;

  // The alien ship and its crew, at the start of every run (engine/aliens.js).
  const aliensSystem = createAliensSystem(ctx);
  register('aliens', aliensSystem);
  const { initAliens, updateAliens, resetAliens, disposeAliens } = aliensSystem;
  // Called in by the alien ship if it is left alone (engine/mothership.js).
  const mothershipSystem = createMothershipSystem(ctx);
  register('mothership', mothershipSystem);
  const { initMothership, updateMothership, resetMothership, disposeMothership } = mothershipSystem;
  // The two explosions bigger than everything else (the mothership crash,
  // a nuclear plant) and the plants themselves.
  const megaBlastSystem = createMegaBlastSystem(ctx);
  register('megaBlast', megaBlastSystem);
  const { initMegaBlasts, updateMegaBlasts, resetMegaBlasts, disposeMegaBlasts } = megaBlastSystem;
  const nuclearSystem = createNuclearSystem(ctx);
  register('nuclear', nuclearSystem);
  const { initNuclear, updateNuclear, resetNuclear, disposeNuclear } = nuclearSystem;
  // Smooth Criminal (engine/smoothCriminal.js): the stage, the song, the dance.
  const smoothCriminalSystem = createSmoothCriminalSystem(ctx);
  register('smoothCriminal', smoothCriminalSystem);
  const { initSmoothCriminal, updateSmoothCriminal, resetSmoothCriminal, disposeSmoothCriminal } = smoothCriminalSystem;
  // Hero Mode: Roger, the bunker and the machine after him (engine/heroMode.js).
  register('heroSound', createHeroSoundSystem(ctx));
  // The Katana's own voice (sound/katana.js): its own bus, no creature voices (R-046).
  register('katanaSound', createKatanaSoundSystem(ctx));
  const heroSystem = createHeroModeSystem(ctx);
  register('heroMode', heroSystem);
  const { initHero, updateHero, resetHero, disposeHero } = heroSystem;
  // Roger's rechargeable health and the one player-damage API (engine/health/).
  register('health', createHealthSystem(ctx), { auto: true });

  // Co-op (engine/net/): the room, the guest's avatar and the host's
  // snapshots. Looks the hero up lazily; its init/reset/dispose run through
  // the registry.
  register('net', createNetSystem(ctx), { auto: true });
  // Co-op rebuilds the town from the room's seed through a Reset.
  ctx.resetSim = resetSim;

  // W A S D slide the free camera over the town (engine/keyPan.js).
  const keyPanSystem = createKeyPanSystem(ctx);
  register('keyPan', keyPanSystem);
  const { initKeyPan, updateKeyPan, resetKeyPan, disposeKeyPan } = keyPanSystem;

  const minimapSystem = createMinimapSystem(ctx);
  register('minimap', minimapSystem);
  const { initMinimap, updateMinimap, disposeMinimap } = minimapSystem;

  /**
   * ===========================================================================
   * SECTION I — Animation loop
   * ===========================================================================
   */
  
  // How long the storm atmosphere (Sim.state.stormRamp, see context.js) takes
  // to build from calm to full once a run starts, and to settle back once it
  // stops. In rather than out: a storm should feel like it is rolling in, not
  // switching on, but there is no reason to linger once it is over.
  const STORM_RAMP_IN = 4;
  const STORM_RAMP_OUT = 1.5;

  let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;

  // The storm's life between the systems (engine/stormLife.js): the scene
  // brightness, the funnels' touchdown and rope-out, and the dam.
  const stormLife = createStormLifeSystem(ctx);
  const { updateBrightness, updateBirth, keepFunnelsOffTheDam } = stormLife;

  /** @returns {void} */
  function animate() {
    if (cancelled) return;
    rafId = requestAnimationFrame(animate);
    // THREE.Timer (Clock is deprecated since r183), connected to the page's
    // visibility so coming back to a hidden tab is not one huge step.
    // Stepped on performance.now(), not on requestAnimationFrame's
    // timestamp: that is when the frame began, which after a long start-up
    // is earlier than the first (direct) call -- a negative step, which
    // grew a funnel that was roping out (measured: birth 3 before Start).
    Sim.three.clock.update();
    frame(Math.max(0, Math.min(Sim.three.clock.getDelta(), 0.05)));
  }

  /**
   * One frame of the game: every system's update, then the render. Called by
   * animate() with the real time since the last frame, and by the benchmark
   * (engine/perf/bench.js) with a fixed step instead.
   * @param {number} rawDt seconds, already clamped
   * @param {boolean} [render] false to skip the render itself (the benchmark
   *   measuring the CPU alone)
   * @returns {void}
   */
  function frame(rawDt, render = true) {
    // The overlay's section timing (engine/perf/monitor.js): each lap() closes
    // the section before it. Off unless `?perf` or `?bench` is in the address.
    const lap = perfMonitor.lap;
    perfMonitor.beginFrame();
    benchClock += rawDt;
    lap('camera');
    // Two clocks from here on. `rawDt` is real elapsed time and drives
    // anything that must keep running at wall-clock speed during a
    // slow-motion: the game-feel layer's own timers, the camera shake, the
    // sound system and the fps counter. `dt` is `rawDt` scaled by
    // GameFeel.timeScale and is what the *simulation* runs on -- physics,
    // damage, particles, animation, weather. Scaling here rather than
    // throttling requestAnimationFrame is the difference between the world
    // slowing down and the frame rate dropping.
    // Whatever holds the world's time down (Time Slow, engine/time.js) caps
    // GameFeel's scale before the frame's dt is made from it.
    ctx.systems.time.updateTime();
    updateGameFeel(rawDt);
    const dt = rawDt * GameFeel.timeScale;

    // A glide to a new character (engine/camera.js) puts the driving mode's
    // own camera back first, so the mode carries on from where it was.
    cameraSystem.restoreGlide();
    // Before OrbitControls, so the target it damps towards is the moved one.
    updateKeyPan(rawDt);
    Sim.three.controls.update();
    if (Chase.active) {
      updateChaseCar(dt);
      updateCarVisuals(dt);
      updateCockpitWheel(dt);
      syncCockpitRigVisibility();
      if (Chase.viewMode === 'cockpit') updateCockpitCamera(); else updateChaseCamera(dt);
      updateChaseHud();
    } else {
      updateCinematicCamera(dt);
    }

    // Unconditional, like updateChaseCar above: steering works immediately on
    // toggle-on, whether or not Start has been pressed. Before the funnels
    // update below, so this frame's key state reaches Vortex.controlTarget in
    // time to be read by it.
    lap('funnels');
    updatePossess();
    // Before the funnels update, so the size it has grown to this frame is
    // the one that gets drawn and felt.
    if (!Sim.state.paused) updateBirth(dt);

    // Before the funnels update, so the size it ramps to this frame is the one
    // that gets drawn and felt -- and deliberately before updateFujiwhara,
    // which owns Vortex.sizeMul outright while a merge is actually in flight
    // and writes it after this. Outside the running block because growing into
    // a wedge is a thing to watch happen with the storm still standing by.
    if (!Sim.state.paused) updateWedge(dt);

    if (Sim.state.running && !Sim.state.paused) {
      Sim.state.elapsed += dt;
      // Before everything else in the frame: a beat of the script fires the
      // same triggers the panel buttons do, and whatever it sets off should
      // start on the frame it was due rather than the one after.
      updateDoomsday(dt);
      // Before the funnels update: a merge pins and places them, and the
      // hunt picks where they are steering for this frame.
      updateFujiwhara(dt);
      updateHunt(dt);
      for (const tornado of tornadoRegistry.active) tornado.updateVortexVisuals(dt, Sim.state.elapsed);
      // After the funnels have moved this frame, before anything reads where
      // they are.
      keepFunnelsOffTheDam();
      for (const tornado of tornadoRegistry.instances) tornado.groundFx.updatePathTrack(dt);
    } else if (!Sim.state.running) {
      for (const tornado of tornadoRegistry.active) tornado.updateVortexVisuals(dt, ctx.now());
      keepFunnelsOffTheDam();
    }

    // The town's physics and damage run whether or not the storm has been
    // started: before the Tornado button there is simply no funnel (birth 0
    // pulls and captures nothing), but an earthquake, a meteor, the dam, a
    // gas main or a landing ship set off first must still throw, hurt and
    // kill people and wreck things. (All of this used to sit inside the
    // running block above, so anything set off before the storm froze its
    // victims in place, unharmed.)
    if (!Sim.state.paused) {
      lap('vehicles');
      // Before physics: a train derailed this frame is integrated from now.
      updateTrain(dt);
      // Alongside the train and for the same reason: a span that drops this
      // frame, and any car that drops with it, is integrated from here on.
      updateViaduct(dt);
      updateTanker(dt);
      lap('physics');
      integratePhysics(dt);
      // Straight after the physics that moved the debris, so each piece is
      // tested against the path it has just covered this frame.
      updateDebrisImpacts(dt);
      lap('damage');
      updateDamage(dt);
    }

    // Outside the running/unpaused block above, but gated on paused: a burst
    // can be triggered from updateChaseCar()'s capture check, which runs
    // whenever chase mode is active regardless of whether the storm is
    // running, and a burst spawned there would otherwise hang frozen in
    // mid-air with nothing ever advancing or retiring it.
    // After integratePhysics(), so the wander/flee position it writes is the
    // one that reaches the renderer; before Start as well, so the town is
    // already alive while the user is setting up the storm.
    // Both of these write their vehicles' own positions, so they run after
    // integratePhysics for exactly the reason updatePeopleMotion does -- and
    // before it, so a person deciding where to walk this frame sees the bus
    // where it has actually stopped rather than a frame behind.
    // Before the fleets: a hole that opened this frame closes the evacuation
    // point standing over it before a bus is sent to collect from it.
    lap('rescue');
    if (!Sim.state.paused) updateSinkholes(dt);
    if (!Sim.state.paused) updateEmergency(dt);
    if (!Sim.state.paused) updateEvacuation(dt);
    if (!Sim.state.paused) updateCarRescue(dt);
    // After both, so it sees where every vehicle actually ended up this frame.
    if (!Sim.state.paused) ctx.systems.vehicles.checkTankerContact();
    lap('people');
    if (!Sim.state.paused) updatePeopleMotion(dt);
    // Gated on Sim.state.running/elapsed internally rather than here: the
    // new arrivals come in waves of twenty every thirty seconds of the run.
    if (!Sim.state.paused) updateReinforcements(dt);
    // After updatePeopleMotion, so a dazed person's ring of stars is placed
    // over where they have just staggered to rather than a frame behind them.
    if (!Sim.state.paused) updateDazedStars(dt);
    // Frozen enemies thawing (engine/enemies.js), on the world's time.
    if (!Sim.state.paused) ctx.systems.enemies.updateEnemies(dt);
    if (!Sim.state.paused) updateSpeechBubbles(dt);
    lap('effects');
    if (!Sim.state.paused) updateImpactBursts(dt);
    if (!Sim.state.paused) updateCarDust(dt);
    if (!Sim.state.paused) updateTireFire(dt);
    if (!Sim.state.paused) updateFirenado(dt);
    // Immediately after the Firenado and never before it: both tint the
    // funnel through Vortex.fire, and the Lavanado deliberately takes the
    // brighter of the two rather than overwriting it (see updateLavanado).
    if (!Sim.state.paused) updateLavanado(dt);
    // Structure fires and line faults outlive the tornado passing, so both
    // run whenever the scene is live rather than only while it is over them.
    // Queued collapse shocks drain here rather than inside updateDamage, so
    // the flood and the meteors can bring buildings down with no storm
    // running (see updatePendingShocks).
    lap('collapse');
    if (!Sim.state.paused) updatePendingShocks(dt);
    // Out here with the queued shocks and for the same reason: a meteor, the
    // flood or a gas main can bring a building down with no storm running at
    // all, and a building that started falling inside the running block would
    // otherwise hang at half past vertical for the rest of the session.
    if (!Sim.state.paused) updateTopple(dt);
    lap('disasters');
    if (!Sim.state.paused) updateFlood(dt);
    // Out here with the flood rather than inside the running block: the
    // barrage is a disaster of its own and the panel can now call it down
    // with no storm at all, which needs it ticking whenever the scene is.
    if (!Sim.state.paused) updateMeteors(dt);
    if (!Sim.state.paused) updateFactory(dt);
    // Every frame, paused too: its sound goes quiet when the game stops.
    ctx.systems.fuelFire.updateFuelFire(Sim.state.paused ? 0 : dt, rawDt);
    ctx.systems.trex.updateTrex(Sim.state.paused ? 0 : dt);
    ctx.systems.yeti.updateYeti(Sim.state.paused ? 0 : dt);
    // After both giants, which report where their beams leave from.
    ctx.systems.giantClash.updateGiantClash(Sim.state.paused ? 0 : dt);
    ctx.systems.blizzard.updateBlizzard(Sim.state.paused ? 0 : dt);
    ctx.systems.patientZero.updatePatientZero(Sim.state.paused ? 0 : dt);
    // After everything that moves things: what it holds, it places.
    ctx.systems.blackHole.updateBlackHole(Sim.state.paused ? 0 : dt);
    ctx.systems.freeze.updateFreeze(Sim.state.paused ? 0 : dt);
    ctx.systems.missions.updateMissions(Sim.state.paused ? 0 : dt);
    ctx.systems.volcano.updateVolcano(Sim.state.paused ? 0 : dt);
    ctx.systems.waterspout.updateWaterspout(Sim.state.paused ? 0 : dt, rawDt);
    ctx.systems.actionHero.updateActionHero(Sim.state.paused ? 0 : dt, Sim.state.paused ? 0 : rawDt);
    if (!Sim.state.paused) ctx.systems.cows.updateCows(dt);
    ctx.systems.cleaner.updateCleaner(Sim.state.paused ? 0 : dt);
    if (!Sim.state.paused) updateElectricStorm(dt);
    // After the Electric Tornado, whose funnel tint it tops up.
    if (!Sim.state.paused) updateEmpCharge(dt);
    lap('fires');
    if (!Sim.state.paused) updateBuildingFire(dt);
    if (!Sim.state.paused) updatePowerLines(dt);
    lap('disasters');
    if (!Sim.state.paused) updateEarthquake(dt);
    if (!Sim.state.paused) updateDownburst(dt);
    if (!Sim.state.paused) updateStrikeTargeting(dt);
    if (!Sim.state.paused) updateChasms(dt);
    if (!Sim.state.paused) updateTerminator(dt);
    lap('aliens');
    if (!Sim.state.paused) updateAliens(dt);
    // Landing Support's samurai and their ship, on the world's time.
    if (!Sim.state.paused) spaceshipSystem.updateSupportWorld(dt);
    if (!Sim.state.paused) updateMothership(dt);
    lap('nuclear');
    if (!Sim.state.paused) updateNuclear(dt);
    if (!Sim.state.paused) updateSmoothCriminal(dt);
    updateMegaBlasts(Sim.state.paused ? 0 : dt);
    lap('disasters');
    // The far town beyond the playable one comes down under a funnel too.
    if (!Sim.state.paused) updateBackdrop(dt);
    if (!Sim.state.paused) updateFissures(dt, earthquakeSystem.earthquakeStrength());
    // After the fissures, whose vents are what it burns, and after the flood,
    // whose front is what puts them out: both are read this frame rather than
    // a frame behind.
    if (!Sim.state.paused) updateGasMains(dt);
    if (!Sim.state.paused) updateCollisions(dt);
    lap('lights');
    // After every effect that asks for a light this frame (power lines, fissures,
    // burning gas mains).
    if (!Sim.state.paused) flushLightPool();
    lap('effects');
    for (const tornado of tornadoRegistry.instances) tornado.groundFx.updateGroundSpray(dt);
    lap('sky');

    // Chase Mode and Possess mode can both be under way before Start (see
    // minimapTracker.js's isStormMoving() for the same distinction), so the
    // target follows any of the three rather than Sim.state.running alone --
    // neither a chase nor flying the tornado yourself should play out under a
    // calm, drizzle-free sky.
    const stormTarget = (Sim.state.running || Chase.active || Possess.active) ? 1 : 0;
    const stormRampSeconds = stormTarget > Sim.state.stormRamp ? STORM_RAMP_IN : STORM_RAMP_OUT;
    const stormRampStep = rawDt / stormRampSeconds;
    Sim.state.stormRamp = stormTarget > Sim.state.stormRamp
      ? Math.min(stormTarget, Sim.state.stormRamp + stormRampStep)
      : Math.max(stormTarget, Sim.state.stormRamp - stormRampStep);

    updateDayNight(dt);
    updateAtmosphere();
    updateBrightness(rawDt);
    updateClouds(dt);
    updateWeather(dt);
    // Real time deliberately: slowing the audio graph's own parameter ramps
    // in step with the world is the "underwater" cliché. The sound system
    // reads GameFeel.timeScale itself and drops the storm's pitch a little
    // instead (see updateSoundSystem).
    lap('sound');
    updateSoundSystem(rawDt);
    // The city background before Start and the Chase Mode music
    // (sound/cues.js), started and faded as the run and the modes change.
    cueSystem.updateCues();
    ctx.systems.creatureSounds.updateCreatureSounds();
    lap('sky');
    updateLightning(dt);
    lap('hero');
    // Landing Support's targeting, the rocket's fall and the cooldowns, on
    // real time, held while paused (see updateSpaceship). Its camera is
    // placed further down (placeCamera), after Hero Mode's.
    updateSpaceship(rawDt);
    // Hero Mode's follow, aim and death cameras, likewise before the shake.
    // Real time: aiming slows the world, never Roger's pursuer.
    updateHero(rawDt);
    ctx.systems.health.updateHealth(rawDt);
    // Co-op: the guest's avatar and snapshots (host), or the host's world (peer).
    ctx.systems.net.updateNet(rawDt);
    // Hank Granite's scene holds the camera on him (engine/actionHero.js),
    // after Hero Mode's camera and before the shake.
    ctx.systems.actionHero.placeCamera(rawDt);
    // The Rocket Strike's nose camera (engine/spaceship/rocket.js), over
    // Hero Mode's while it falls.
    spaceshipSystem.placeCamera();
    // A glide to a character just called in (engine/camera.js), over
    // whatever the camera writers above asked for.
    cameraSystem.placeGlide(rawDt);
    // Last of the camera writers, after updateLightning's own shake and after
    // whichever camera system placed the camera this frame, so the offset is
    // what reaches the renderer. Real time: a punch stretched to three times
    // its length in slow motion stops reading as a punch.
    lap('camera');
    applyGameFeelShake(rawDt);
    // Last of all the camera writers and deliberately outside every paused
    // gate: a replay *is* the simulation being paused, and it still has to
    // advance, place the camera and eventually hand it back.
    updateKillcam(rawDt);
    lap('ui');
    updateStatsPanel();
    updateMinimapTracker(dt);
    updateMinimap();

    // Real time, so the readout stays a frame-rate counter rather than
    // reporting a third of it during a slow-motion.
    fpsAccum += rawDt; fpsFrames++;
    fpsTimer += rawDt;
    if (fpsTimer > 0.5) {
      document.getElementById('fps').textContent = `${Math.round(fpsFrames / fpsAccum)} fps`;
      fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
    }
  
    // The particle budget (engine/perf/caps.js): what is drawn now, for the
    // effects that ask how much room is left.
    ctx.systems.caps.updateCaps();
    // The teleport's distortions, on real time.
    ctx.systems.teleport.updateTeleport(rawDt);
    ctx.systems.emp.updateEmp(rawDt);
    // Last thing before the render: every system has moved its people and
    // trees for this frame.
    lap('instancer');
    updateInstancer();
    lap('render');
    // updateInstancer has just brought every world matrix up to date: the
    // render need not walk the whole scene again to do the same.
    Sim.three.scene.matrixWorldAutoUpdate = false;
    if (render) renderFrame();
    Sim.three.scene.matrixWorldAutoUpdate = true;
    lap('instancer');
    // Everything the instancer hid for the render is shown again, so every
    // system sees the scene as it really is while it updates.
    restoreInstancer();
    updateQuality();
    perfMonitor.endFrame();
  }
  
  /**
   * ===========================================================================
   * SECTION J — Start / Pause / Reset controllers
   * ===========================================================================
   */
  
  /** @returns {void} */
  function startSim() {
    if (Sim.state.running) {
      // Mid-run, only to bring a funnel back that Roger's mega beam put out
      // (engine/heroMode.js neutralise): a new one comes down, somewhere
      // else along its wander path.
      for (const tornado of tornadoRegistry.active) {
        const v = tornado.Vortex;
        if (!v.neutralized) continue;
        v.neutralized = false;
        v.wanderPlaced = false;
      }
      return;
    }
    resumeSoundSystem();
    // Right after resumeSoundSystem(), so the audio graph it just (re)built
    // is guaranteed ready for this same click -- the moment the storm
    // actually begins is worth its own cue (engine/sound/stinger.js).
    stingerSystem.playStinger();
    Sim.state.running = true;
    Sim.state.paused = false;
    Sim.state.elapsed = 0;
  
    const target = Math.min(Sim.params.debrisCount, DEBRIS_CAP);
    for (let i = 0; i < target; i++) spawnAmbientDebris();

    document.getElementById('btn-start').disabled = true;
    document.getElementById('btn-pause').disabled = false;
    document.getElementById('btn-pause').textContent = '⏸ Pause';
  }
  
  /** @returns {void} */
  function togglePause() {
    if (!Sim.state.running) return;
    Sim.state.paused = !Sim.state.paused;
    document.getElementById('btn-pause').textContent = Sim.state.paused ? '▶ Resume' : '⏸ Pause';
  }
  
  /** @returns {void} */
  function resetSim() {
    lifecycle.beginPhase('reset');
    cameraSystem.resetCamera();
    resetQuality();
    resetInstancer();
    if (Chase.active) exitChaseMode();
    Sim.state.running = false;
    Sim.state.paused = false;
    Sim.state.elapsed = 0;
    // A hard cut back to calm rather than the usual settle-out ramp: Reset is
    // the clean-slate action, and STORM_RAMP_OUT's second and a half would
    // otherwise still be dying away over the fresh, empty town.
    Sim.state.stormRamp = 0;
    // Likewise the funnel: gone, not withering, so the next Start brings a
    // fresh one down out of the cloud (see updateBirth).
    for (const tornado of tornadoRegistry.instances) {
      tornado.groundFx.resetPathTrack();
      tornado.Vortex.birth = 0;
    }
    // Clears any merge and monster first, the primary's included (setCount
    // below only ever touches the extra tornadoes).
    resetFujiwhara();
    // Re-place the Outbreak's extra tornadoes (if any) for the fresh run.
    const tornadoCount = tornadoRegistry.count();
    tornadoRegistry.setCount(1);
    tornadoRegistry.setCount(tornadoCount);
    resetMinimapTracker();
    resetFirenado();
    // After resetFujiwhara above, which is the other writer of the funnel's
    // size: the wedge hands back an ordinary funnel on a wander of its own
    // speed again, and the script stops wherever it had got to.
    resetWedge();
    resetDoomsday();
    resetEarthquake();
    resetDownburst();
    resetStrikeTargeting();
    resetDayNight();
    resetChasms();
    resetTerminator();
    resetBackdrop();
    resetSpaceship();
    resetKeyPan();
    resetAliens();
    resetMothership();
    resetMegaBlasts();
    resetNuclear();
    resetSmoothCriminal();
    resetHero();
    resetFissures();
    resetLightPool();
    clearSkidMarks();
    resetImpactBursts();
    resetLightningStrikes();
    resetPowerLines();
    resetGameFeel();
    // Both before resetEnvironment() below replaces the buildings a queued
    // chain-collapse shock, or a burning building, still points at.
    resetDamage();
    resetBuildingFire();

    Sim.stats.objectsAffected = 0;
    Sim.stats.damageScore = 0;
    Sim.stats.debrisDisplaced = 0;
    Sim.stats.vehiclesOverturned = 0;
    Sim.stats.treesUprooted = 0;
    Sim.stats.buildingPiecesLost = 0;
    Sim.stats.buildingsCollapsed = 0;
    Sim.stats.chainCollapses = 0;
    Sim.stats.buildingsBurned = 0;
    Sim.stats.debrisImpacts = 0;
    Sim.stats.peopleSheltered = 0;
    Sim.stats.peopleDazed = 0;
    Sim.stats.peopleRescued = 0;
    Sim.stats.peopleEvacuated = 0;
    Sim.stats.firesDoused = 0;
    Sim.stats.aliensBurned = 0;
    Sim.stats.cowsFlown = 0;
  
    for (const kind of DEBRIS_KIND_NAMES) {
      for (const slot of DebrisPool.slots[kind]) {
        if (slot) releaseDebris(slot);
      }
    }
    syncDebrisInstances();

    resetEnvironment(ctx.townSeed);
    // The bubbles and queued replies of the crowd just replaced (documented
    // as called on reset, and never was: found by the lifecycle audit).
    clearSpeechBubbles();
    // A fresh Chase Mode car waiting in the fresh town (chase/index.js),
    // beside where the aliens are about to land, and the camera on them both.
    parkChaseCar();
    ctx.systems.aliens.frameLanding();
    // After: the fresh Sim.objects is the one the new train goes into.
    resetTrain();
    resetViaduct();
    resetTanker();
    resetMeteors();
    resetFlood();
    resetFactory();
    resetElectricStorm();
    resetEmpCharge();
    resetGasMains();
    resetLavanado();
    resetCollisions();
    // After resetEnvironment, which rebuilds Sim.objects: both of these put
    // their own vehicles back into it.
    resetRubble();
    resetTopple();
    resetSinkholes();
    resetEmergency();
    resetEvacuation();
    resetCarRescue();
    resetKillcam();
    resetScreenCrack();
    resetHunt();
    resetPossess();
    resetReinforcements();
    lifecycle.endPhase('reset');

    document.getElementById('btn-start').disabled = false;
    stormLife.resetStormLife();
    document.getElementById('btn-pause').disabled = true;
    document.getElementById('btn-pause').textContent = '⏸ Pause';
  }

  /**
   * ===========================================================================
   * Bootstrap (runs once, when createSimulation is called)
   * ===========================================================================
   */
  // Before the systems that append their banners to it, so the very first one
  // raised is already inside the cap (utils/banners.js).
  lifecycle.beginPhase('init');
  initBannerStack();
  initScene();
  initClouds();
  initWeather();
  for (const tornado of tornadoRegistry.instances) {
    tornado.initVortex();
    tornado.groundFx.initGroundSpray();
    tornado.groundFx.initPathTrack();
  }
  initImpactBursts();
  initPostProcessing();
  initQuality();
  perfMonitor.initPerfMonitor();
  initInstancer();
  postSystem.Post.brightness = BRIGHTNESS_BASE;
  initSkidMarks();
  initCarDust();
  initTireFire();
  initSpeechBubbles();
  initDazedStars();
  initBuildingFire();
  initMinimap();
  initFirenado();
  initEarthquake();
  initDownburst();
  initStrikeTargeting();
  initChasms();
  initTerminator();
  initSpaceship();
  initKeyPan();
  initAliens();
  initMothership();
  initMegaBlasts();
  initNuclear();
  initSmoothCriminal();
  initHero();
  initFujiwhara();
  initLightPool();
  initFissures();
  initSoundSystem();
  initLightning();
  initDebrisPool();
  generateEnvironment(ctx.townSeed);
  // The Chase Mode car, parked in town from the start beside where the
  // aliens land (chase/index.js), and the opening shot on them both
  // (aliens.js frameLanding).
  parkChaseCar();
  ctx.systems.aliens.frameLanding();
  initTrain();
  initViaduct();
  initTanker();
  initMeteors();
  initFlood();
  initFactory();
  initElectricStorm();
  initEmpCharge();
  initGasMains();
  initLavanado();
  initCollisions();
  initWedge();
  initDoomsday();
  // After generateEnvironment, so the fleets' own objects go into a Sim.objects
  // the town is already in, and before the roads purely for tidiness.
  initRubble();
  initSinkholes();
  initEmergency();
  initEvacuation();
  initCarRescue();
  initKillcam();
  initScreenCrack();
  generateRoads();
  // After the roads it lines: the poles are laid out along the same street
  // centre lines generateRoads() draws.
  initPowerLines();
  generateParkGrounds();
  generateDecor();
  generateBackdrop();
  initDayNight();
  initUI();
  lifecycle.endPhase('init');
  // A benchmark drives the frames itself, on a fixed step (engine/perf/bench.js).
  if (bench.enabled) bench.startBench();
  else animate();

  // Development-only handle on the *live* instance for console/devtools
  // inspection. The Three.js devtools bridge binds to the first scene it
  // sees, which under React StrictMode's dev double-mount is the instance
  // that has already been disposed; this names the one actually running.
  const debugHandle = { Sim, ctx };
  if (process.env.NODE_ENV === 'development') window.__tornadoDebug = debugHandle;

  /**
   * Tears the simulation down: stops the animation loop, removes the
   * window resize listener, disposes the WebGL context, and detaches the
   * canvas from `container`. Called from TornadoSimulator.js's `useEffect`
   * cleanup function on unmount.
   * @returns {void}
   */
  function dispose() {
    cancelled = true;
    lifetime.abort();
    lifecycle.beginPhase('dispose');
    if (window.__tornadoDebug === debugHandle) delete window.__tornadoDebug;
    if (rafId !== null) cancelAnimationFrame(rafId);
    bench.disposeBench();
    perfMonitor.disposePerfMonitor();
    restoreRandom();
    disposeScene();
    detachChaseInputListeners();
    // THREE.AudioListener uses a single AudioContext shared (module-level
    // singleton) across every listener instance on the page, so closing it
    // here would permanently kill audio for any future createSimulation()
    // call that reuses it — notably React StrictMode's dev-mode
    // mount→cleanup→mount, which would otherwise leave the *live* instance
    // silently stuck with a closed context (createGain() etc. on a closed
    // context are inert/no-ops rather than throwing, so nothing else
    // breaks — just sound). Stop/disconnect only this instance's own nodes
    // instead of touching the shared context's lifecycle.
    if (SoundSystem.noiseSource) SoundSystem.noiseSource.stop();
    if (SoundSystem.rumbleOsc) SoundSystem.rumbleOsc.stop();
    if (SoundSystem.ambientWindSource) SoundSystem.ambientWindSource.stop();
    if (SoundSystem.masterGain) SoundSystem.masterGain.disconnect();
    detachAudioGestureListeners();
    if (SoundSystem.visibilityHandler) {
      document.removeEventListener('visibilitychange', SoundSystem.visibilityHandler);
      SoundSystem.visibilityHandler = null;
    }
    for (const node of SoundSystem.activeAmbientNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    for (const node of Lightning.activeAudioNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    for (const node of SoundSystem.activeImpactNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    // These two were missing next to the ambient/impact loops above, which
    // left a scream or a stinger still sounding into a freshly (re)mounted
    // instance's mix after a React StrictMode dev remount.
    for (const node of SoundSystem.activeScreamNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    for (const node of SoundSystem.activeStingerNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    for (const node of SoundSystem.activeShockwaveNodes) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    // Including the two looped tracks, which would otherwise play on forever.
    cueSystem.stopAllCues();
    if (Lightning.overlay && Lightning.overlay.parentNode) {
      Lightning.overlay.parentNode.removeChild(Lightning.overlay);
    }
    for (const bolt of Lightning.bolts) {
      disposeBolt(bolt.mesh);
    }
    disposeClouds();
    disposeWeather();
    disposeTireFire();
    disposeSpeechBubbles();
    disposeDazedStars();
    disposeBuildingFire();
    disposePowerLines();
    disposeMinimap();
    disposeFirenado();
    disposeFissures();
    disposeTrain();
    disposeViaduct();
    disposeTanker();
    disposeMeteors();
    disposeFlood();
    disposeFactory();
    disposeElectricStorm();
    disposeEmpCharge();
    disposeGasMains();
    disposeLavanado();
    disposeCollisions();
    disposeWedge();
    disposeDoomsday();
    disposeRubble();
    disposeSinkholes();
    disposeEmergency();
    disposeEvacuation();
    disposeCarRescue();
    disposeKillcam();
    disposeScreenCrack();
    ctx.systems.vehicles.resetVehicleTraffic();
    ctx.systems.vehicles.disposeVehicleAssets();
    disposeLightPool();
    disposeFujiwhara();
    disposeEarthquake();
    disposeDownburst();
    disposeStrikeTargeting();
    disposeChasms();
    disposeTerminator();
    disposeSpaceship();
    disposeKeyPan();
    disposeAliens();
    disposeMothership();
    disposeNuclear();
    disposeSmoothCriminal();
    disposeMegaBlasts();
    disposeReinforcements();
    disposeHero();
    ctx.systems.heroSound.disposeHeroSound();
    ctx.systems.katanaSound.disposeKatanaSound();
    for (const { groundFx: { GroundSpray, PathTrack } } of tornadoRegistry.instances) {
      if (GroundSpray.points) {
        Sim.three.scene.remove(GroundSpray.points);
        GroundSpray.points.material.map.dispose();
        GroundSpray.points.geometry.dispose();
        GroundSpray.points.material.dispose();
      }
      if (PathTrack.mesh) {
        Sim.three.scene.remove(PathTrack.mesh);
        PathTrack.mesh.geometry.dispose();
        // The scar decal is a CanvasTexture built per instance (see
        // createGroundScarTexture), so it has to go with the material.
        if (PathTrack.mesh.material.map) PathTrack.mesh.material.map.dispose();
        PathTrack.mesh.material.dispose();
      }
    }
    if (SkidMarks.mesh) {
      Sim.three.scene.remove(SkidMarks.mesh);
      SkidMarks.mesh.geometry.dispose();
      SkidMarks.mesh.material.dispose();
    }
    disposeImpactBursts();
    disposePostProcessing();
    disposeQuality();
    disposeInstancer();
    lifecycle.endPhase('dispose');
    Sim.three.clock.dispose();
    Sim.three.renderer.dispose();
    const canvas = Sim.three.renderer.domElement;
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  return { dispose };
}
