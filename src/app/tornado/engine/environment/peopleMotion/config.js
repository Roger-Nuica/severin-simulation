import * as THREE from 'three';
import { PERSON } from '../../scale.js';

/**
 * ===========================================================================
 * SECTION PM.0 — The crowd's tunables
 * ===========================================================================
 * Every number the crowd's movement is tuned by.
 */

// Pace in metres per second: a real stroll, and a frightened run. Running is kept only moderately faster than the funnel's
// own drift (roughly 2.75 u/s from its wander in vortex.js), so a runner
// visibly gains ground but a person the funnel veers towards can still be
// caught -- running at a realistic sprint would empty every street of
// victims and take the payoff out of the chase.
export const WALK_SPEED_MIN = 1.3;
export const WALK_SPEED_MAX = 1.9;
export const RUN_SPEED_MIN = 3.4;
export const RUN_SPEED_MAX = 4.8;

// Wander targets: a point on the pavement of the nearest street, within
// WANDER_REACH of where the person stands along it. Pavements sit just
// outside the 5-unit-wide road strips built in roadsDecor.js.
export const WANDER_REACH = 14;
export const PAVEMENT_OFFSET_MIN = 3.0;
export const PAVEMENT_OFFSET_MAX = 4.2;
// Beyond this distance from any street, a person just ambles around the
// spot they were placed at instead of trekking to a road.
export const STREET_SNAP_DISTANCE = 26;
// How close to a muster point counts as having joined the queue, and how far
// out someone runs rather than walks to it (engine/evacuation.js).
export const MUSTER_ARRIVE = 7.5;
export const MUSTER_RUN_BEYOND = 26;
export const HOME_WANDER_RADIUS = 10;
export const PAUSE_MIN = 0.8;
export const PAUSE_MAX = 4.5;
export const ARRIVE_DISTANCE = 0.6;
// Keeps everyone on the populated part of the map (people are placed up to
// ~128 from the centre in generateEnvironment).
export const WORLD_BOUND = 128;

// Streets, mirroring the layout in roadsDecor.js's generateRoads(). Kept as
// data here rather than read back from the road meshes, which are plain
// planes with no semantic information attached.
export const STREET_Z_LINES = [-20, -8, 8, 20];
export const STREET_X_LINES = [-30, 30];
export const STREET_HALF_LENGTH = 105;
export const RING_RADIUS = 48.5;

// Flee behaviour. Awareness is measured from the funnel's centre and is a
// multiple of the capture edge (radius * 1.8 in physics.js), so it scales
// with the tornado-size slider: large enough that people are seen to bolt
// well before they are caught, small enough that the whole town does not
// stampede the instant the storm starts.
export const AWARENESS_EDGE_MULTIPLIER = 2.4;
export const AWARENESS_MIN = 45;
// How far past the awareness radius a runner keeps going before calming
// back down to a walk, so the switch does not flicker at the boundary.
export const CALM_MARGIN = 12;
// Panicked runners weave rather than running a perfectly straight line.
export const FLEE_WEAVE_AMPLITUDE = 0.45;
export const FLEE_WEAVE_RATE = 1.3;
// Runners heading for a shelter weave less: they have somewhere to be.
export const SHELTER_WEAVE_AMPLITUDE = 0.15;
// Within this distance of the door they run straight at it, no probing.
export const SHELTER_FINAL_APPROACH = 6;
export const TURN_RATE_WALK = 4;
export const TURN_RATE_RUN = 9;

// Walk cycle. Stride frequency is tied to distance covered (radians of leg
// phase per metre), so the feet keep pace with the ground at any speed
// rather than sliding: shorter legs take more strides per metre.
export const STRIDE_PHASE_PER_UNIT = 6.9 / PERSON.height;
export const LEG_SWING_WALK = 0.45;
export const LEG_SWING_RUN = 0.85;
export const ARM_SWING_WALK = 0.35;
export const ARM_SWING_RUN = 0.95;
// Bob is in local (pre-scale) units, like the limb geometry.
export const BOB_WALK = 0.03;
export const BOB_RUN = 0.07;
export const RUN_LEAN = 0.22;
export const LIMB_EASE_RATE = 6;

// Collision: a figure is about a third of its height wide, so this much
// clearance keeps limbs out of walls too (engine/scale.js PERSON).
export const PERSON_CLEARANCE = PERSON.height * 0.18;
export const COLLISION_CELL = 16;
export const WANDER_TARGET_ATTEMPTS = 6;
export const BLOCKED_REPICK_PAUSE = 0.4;
export const FLEE_PROBE_INTERVAL = 0.25;
export const FLEE_PROBE_DISTANCE = 7;
// Fan of heading offsets (radians) tried in order when running straight
// away is blocked: nearest-to-away first, alternating sides.
export const FLEE_PROBE_OFFSETS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.1, -2.1];
// The watchdog (see unstick): someone trying to move who has covered less
// than STUCK_PROGRESS of the ground they were trying to for STUCK_SECONDS is
// stuck, and walks off on a clear heading for UNSTICK_SECONDS. Long enough
// that turning round on the spot (TURN_RATE_WALK) never counts.
export const STUCK_SECONDS = 1.2;
export const STUCK_PROGRESS = 0.25;
export const UNSTICK_SECONDS = 1.3;
// Probes stop this far inside the edge of the map, so a runner fleeing
// towards it turns along it instead of running on the spot against it.
export const BOUND_MARGIN = 3;

// Social pairing: roughly this share of people are paired up with a
// nearby companion when a town is generated, and walk side by side.
export const PAIR_FRACTION = 0.42;
export const PAIR_MAX_DISTANCE = 30;
// Side-by-side spacing, shoulder to shoulder with a little air.
export const PAIR_OFFSET = PERSON.height * 0.42;
export const PAIR_ARRIVE = 0.4;
// How briskly a follower closes the gap to their slot (1/s), and the cap on
// catch-up speed as a multiple of the leader's pace.
export const PAIR_CATCHUP_GAIN = 2.5;
export const PAIR_CATCHUP_MAX = 1.6;

// Limb animation throttle for distant figures.
export const LIMB_FAR_DISTANCE = 110;
export const LIMB_FAR_STEP = 3;

// --- Disorientation after being dropped by a vortex (see wakeDazed) ---
// How long the daze lasts. Long enough to watch someone stumble a clear
// distance in the wrong direction, short enough that a dropped crowd does not
// spend the rest of the run milling about.
export const DAZED_DURATION = [3.2, 6.5];
// How slowly a dropped person has to be moving before they can pick
// themselves up: roughly the residual jitter of a body resting on the ground
// (see integratePhysics, which keeps applying gravity and bouncing it off
// y = 0), so this fires as soon as they have actually stopped rolling.
export const DAZED_SETTLE_SPEED = 0.6;
// Seconds spent getting back on their feet. The sprawl they landed in rotates
// back to upright over this, and they stay put while it does, so nobody snaps
// from face-down to mid-stride.
export const DAZED_STAND_TIME = 0.9;
// Staggering pace, as a fraction of their normal stroll.
export const DAZED_SPEED_SCALE = 0.55;
// Wandering: the underlying heading turns steadily at DAZED_SPIN (so the path
// curves into loops rather than running straight), and the walked heading
// weaves either side of it.
export const DAZED_SPIN = [0.35, 0.95];
export const DAZED_WEAVE_AMPLITUDE = 1.15;
export const DAZED_WEAVE_RATE = 0.85;
// Body roll, and the arms-out pose. The arms are held well clear of the body
// and swung slightly forward, which is what reads as balancing rather than
// walking; they barely swing with the stride.
export const DAZED_SWAY = 0.18;
export const DAZED_SWAY_RATE = 3.4;
export const DAZED_ARM_SPLAY = 1.15;
export const DAZED_ARM_RAISE = -0.55;
export const DAZED_ARM_SWING = 0.12;
// Heavier lurch per footfall than a normal walk's BOB_WALK.
export const DAZED_BOB = 0.055;

// Shared types (JSDoc), imported by the files that use them.
/**
 * @typedef {Object} PersonMotion
 * @property {boolean} active false once physics has taken this person over
 * @property {boolean} dropped true once physics has had them, until they are
 *   woken back up dazed (see wakeDazed) -- what marks someone as awaiting a
 *   daze rather than never having been caught at all
 * @property {'walk'|'pause'|'flee'|'follow'|'dazed'|'muster'|'defy'} mode
 * @property {number} targetX
 * @property {number} targetZ
 * @property {number} homeX
 * @property {number} homeZ
 * @property {number} pauseTimer
 * @property {number} walkSpeed
 * @property {number} runSpeed
 * @property {number} heading current yaw, radians
 * @property {number} phase walk-cycle phase, radians
 * @property {number} gait 0 = standing, 1 = walking, 2 = running (eased)
 * @property {number} weaveSeed
 * @property {number} limbSlot stagger index for the far-limb throttle
 * @property {{legL:THREE.Object3D, legR:THREE.Object3D, armL:THREE.Object3D, armR:THREE.Object3D}} limbs
 * @property {number} armSplay rest outward angle of the arms (rotation.z magnitude)
 * @property {number} fleeHeading last clear heading found by the flee probe
 * @property {number} fleeProbeTimer seconds until the next flee probe
 * @property {number} dazedTimer seconds of daze left; 0 when not dazed
 * @property {number} standTimer seconds left of getting back on their feet
 * @property {number} dazedHeading the drifting heading they stagger along
 * @property {number} dazedSpin radians/sec that heading turns at (signed)
 * @property {number} landRotX pitch they landed at, rotated out as they stand
 * @property {number} landRotZ roll they landed at, rotated out as they stand
 * @property {import('../shelters.js').ShelterEntrance|null} shelter the door this runner is making for, if any
 * @property {Object|null} hazard the ground hazard they are clearing, if any
 * @property {Object|null} pickup the muster point they have been called to
 * @property {SimObject|null} partner the other half of this person's pair, if any
 * @property {SimObject|null} leader set on the following half of a pair
 * @property {number} pairSide which side of the leader the follower walks on (-1 left, 1 right)
 * @property {number} stuckTime seconds spent trying to move and getting nowhere
 * @property {number} unstickTimer seconds left walking off on unstickHeading
 * @property {number} unstickHeading the clear heading the watchdog picked
 * @property {import('../crowd.js').Trait} [trait] their traits under the
 *   current preset (environment/crowd.js), cached
 */
/**
 * A building footprint as an axis-aligned box on the ground plane, already
 * inflated by PERSON_CLEARANCE. `building` is kept so a collapsed building
 * (walls mostly gone) stops blocking without a grid rebuild.
 * @typedef {{minX:number, maxX:number, minZ:number, maxZ:number, building:SimObject, stamp:number}} BuildingBox
 */
