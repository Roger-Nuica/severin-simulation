import { STORM } from './scale.js';
/**
 * ===========================================================================
 * Shared typedefs & simulation state
 * ===========================================================================
 * Note on documentation conventions: British English spelling is used
 * throughout comments (colour, behaviour, organise, etc.), and every
 * function below carries a JSDoc type signature.
 */

/** @typedef {'debris'|'car'|'tree'|'building'|'person'|'cow'|'viaduct'|'viaductDebris'} ObjectType */
/** @typedef {'intact'|'swaying'|'tipped'|'uprooted'|'airborne'|'roofLost'|'wallLost'|'collapsed'|'settled'|'flattened'} DamageState */
/** @typedef {'branch'|'box'|'roofPiece'|'rock'|'treeTrunk'|'ice'} DebrisKind */
/**
 * Per-object capture progression driven by updateCaptureState(): grounded
 * (outside the field, or resting/at rest) -> trembling (outer radius,
 * sliding/pulled along the ground) -> rising (inner radius, lifting off) ->
 * orbiting (airborne, spiralling around the funnel axis while climbing) ->
 * falling (released/flung or field too weak to sustain it, ballistic back
 * down to grounded). Only meaningful for non-rooted-and-intact objects,
 * i.e. whatever integratePhysics() actually iterates over.
 * @typedef {'grounded'|'trembling'|'rising'|'orbiting'|'falling'} CaptureState
 */

/**
 * @typedef {Object} SimObject
 * @property {number} id
 * @property {ObjectType} type
 * @property {THREE.Object3D} mesh
 * @property {THREE.Vector3} velocity
 * @property {THREE.Vector3} angularVelocity
 * @property {number} mass
 * @property {number} drag
 * @property {boolean} rooted
 * @property {DamageState} damageState
 * @property {number} breakThreshold
 * @property {number} liftEligible  // 0..1 multiplier on upward force
 * @property {boolean} pooled       // true if drawn from the debris pool
 * @property {DebrisKind} [kind]    // pooled debris only: which per-kind pool this belongs to
 * @property {number} poolIndex     // index into instanced pool, -1 if none
 * @property {number} lifeTimer     // seconds since becoming free/settled, for recycling
 * @property {CaptureState} captureState        // progressive capture state machine (see updateCaptureState)
 * @property {boolean} [moving]                // the freight train only: whether it is under way
 * @property {number} [orbitAngle]              // radians; current position around the funnel while orbiting
 * @property {number} [orbitRadiusFactor]        // 0..1-ish; this object's personal fraction of the funnel radius while orbiting, for visual variety
 * @property {number} [orbitMaxHeight]           // world-space y above which an orbiting object is flung outward and released
 * @property {number} [orbitLane]                // world-space y this orbiting object is currently settling towards; creeps upward at orbitLaneDrift
 * @property {number} [orbitLaneDrift]           // m/s the lane creeps upward, i.e. how long this object stays in the column before release
 * @property {number} [orbitClimbRate]           // how briskly the object eases towards its lane (higher = snappier)
 * @property {number} [orbitR]                   // smooth orbit radius, tracked separately from the wobbled position (see the orbiting branch)
 * @property {number} [orbitY]                   // smooth orbit height, tracked separately from the wobbled position
 * @property {number} [noisePhase]               // per-object simplex-noise offset, so no two objects wobble in step
 * @property {number} [noiseFreq]                // per-object simplex-noise rate multiplier
 * @property {boolean} [playerControlled]        // true only for the Chase Mode car; excluded from Sim.objects/integratePhysics
 * @property {Object} [motion]                  // people only: wander/flee/walk-cycle state owned by peopleMotion.js (PersonMotion)
 * @property {boolean} [captureBurstDone]        // true once this object has fired its one-off "swept into the vortex" impact burst (see updateCaptureState)
 * @property {boolean} [shelter]                 // buildings only: a storm shelter (environment/shelters.js), exempt from damage
 * @property {Object[]} [shelterEntrances]       // shelters only: ShelterEntrance points people run to
 * @property {Object|null} [powerNode]           // buildings only: its connection to the power lines (environment/powerLines.js PowerNode), null if not on the network
 * @property {Object|null} [vortex]              // the tornado (a Vortex) this object is caught by, or nearest to while grounded (physics.js)
 * @property {number} [groundFloor]              // height its lowest point rests at, set by the physics each frame (physics.js asleep)
 * @property {boolean} [burnedOut]               // buildings only: burnt to a shell, will not catch again (buildingFire.js)
 * @property {THREE.Vector3} [position]          // pooled debris only: where it is (it has no mesh of its own; debris.js)
 * @property {THREE.Euler} [rotation]            // pooled debris only
 * @property {THREE.Vector3} [scale]             // pooled debris only
 * @property {number} [lastX]                    // last position checked for a hit (debrisImpacts.js)
 * @property {number} [lastY]
 * @property {number} [lastZ]
 * @property {number} [impactCooldown]           // seconds before it can hit something again (debrisImpacts.js)
 */

/**
 * Builds a fresh `Sim` state object. Called once per `createSimulation()`
 * call (never module-scoped) so React StrictMode's dev-mode remount gets its
 * own independent instance rather than sharing state with a previous one.
 * @returns {{
 *   params: {intensity:number, windSpeed:number, radius:number, rotationSpeed:number,
 *            debrisCount:number, debrisSize:number},
 *   state: {running:boolean, paused:boolean, elapsed:number, stormRamp:number},
 *   objects: SimObject[],
 *   stats: {objectsAffected:number, damageScore:number, debrisDisplaced:number,
 *           vehiclesOverturned:number, treesUprooted:number, buildingPiecesLost:number,
 *           buildingsCollapsed:number, chainCollapses:number, buildingsBurned:number,
 *           debrisImpacts:number, peopleSheltered:number, peopleDazed:number,
 *           peopleRescued:number, peopleEvacuated:number, firesDoused:number,
 *           aliensBurned:number, cowsFlown:number},
 *   three: {scene:THREE.Scene, camera:THREE.PerspectiveCamera, renderer:THREE.WebGLRenderer,
 *           controls:THREE.OrbitControls, clock:THREE.Timer}
 * }}
 */
export function createSim() {
  return {
    params: {
      intensity: 0.75,
      windSpeed: 220,
      radius: STORM.radius.default,
      rotationSpeed: 3.5,
      debrisCount: 40,
      debrisSize: 1.0
    },
    // stormRamp: 0 at rest, 1 once a run (or Chase Mode, which can run before
    // Start) is properly under way -- read by scene.js/clouds.js/weather.js
    // to hold the sky, cloud deck and rain calm while standing by, rather than
    // the params sliders' storm already being fully in effect the moment the
    // page loads (see tornadoEngine.js's animate() for where it is advanced).
    state: { running: false, paused: false, elapsed: 0, stormRamp: 0 },
    objects: [],
    stats: {
      objectsAffected: 0,
      damageScore: 0,
      debrisDisplaced: 0,
      vehiclesOverturned: 0,
      treesUprooted: 0,
      buildingPiecesLost: 0,
      buildingsCollapsed: 0,
      // Of buildingsCollapsed, how many were brought down by a neighbour's
      // collapse rather than by the wind itself (see damage.js).
      chainCollapses: 0,
      // ...and how many the fire finished off (engine/buildingFire.js).
      buildingsBurned: 0,
      // Flying debris that actually connected with something
      // (engine/debrisImpacts.js).
      debrisImpacts: 0,
      peopleSheltered: 0,
      // Taken out alive by the town rather than by a shelter door: collected
      // by an ambulance, and driven out on an evacuation bus
      // (engine/emergency/index.js, engine/evacuation.js).
      peopleRescued: 0,
      peopleEvacuated: 0,
      // Buildings the fire brigade put back out.
      firesDoused: 0,
      // Aliens the Firenado set alight (aliens/crew.js): the Fire crew
      // mission counts them (engine/missions.js).
      aliensBurned: 0,
      // Cows the funnel has taken up (engine/cows.js).
      cowsFlown: 0,
      // Running total of people who have been dropped by a vortex and walked
      // off their daze (see environment/peopleMotion.js), counted once each
      // time they enter the dazed state.
      peopleDazed: 0
    },
    // Filled by scene.js, which is the only writer.
    three: /** @type {any} */ ({})
  };
}
