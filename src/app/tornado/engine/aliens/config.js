// @ts-check
import * as THREE from 'three';
import { PERSON_BUILT_HEIGHT } from '../environment/people.js';
import { CHARACTERS } from '../scale.js';

/**
 * ===========================================================================
 * SECTION AK.0 — The aliens' tunables
 * ===========================================================================
 * Every number the aliens are tuned by, in one place: the landing ship, the
 * crew, the rays, the second wave, the hunters, the mutation. The behaviour
 * they drive is described in aliens.js and GAME_RULES.md; change it here.
 */

// The faint green glow of an ordinary alien's skin (its emissive). The
// instancer (environment/instancer.js) draws an alien as an instance only
// while its skin still glows exactly this, so a burning or mutating one
// draws itself.
export const ALIEN_SKIN_GLOW = 0x12380f;

export const ALIENS = {
  count: 10,
  // The ship.
  // Of the hull's origin above the ground. Raised from 12 with the ramp
  // lowered to 45 degrees, so the ramp is longer (about 27 units) and runs
  // well out from under the hull where it can be seen.
  hoverHeight: 18,
  // The opening camera on the landing spot (frameLanding): this far behind
  // the ship, off to the side the Chase Mode car is parked on, and up.
  frameBack: 48,
  frameSide: 26,
  frameHeight: 34,
  arriveFrom: 170,         // height it comes down from
  arriveSeconds: 3.5,
  rampSeconds: 1.2,        // for the ramp to run out
  rampAngle: Math.PI / 4,  // 45 degrees from the ground
  rampWidth: 6,
  beltStripe: 2,           // world units per stripe on the belt
  hatchRadius: 4,          // of the ramp's top from the ship's axis
  clearance: 20,           // of buildings round the spot it picks
  viaductClearance: 30,    // of the elevated highway's centre line, the hull being 15 wide
  funnelClearance: 70,
  spotBound: 85,
  // The abductions.
  abductSeconds: 120,
  mothershipAfter: 4,      // people taken, for the ship to call the mothership in (was 5)
  abductEvery: 10,
  // Every walking speed of the crew below is 30% up on what it was, on
  // request (drawSpeed 14, fetchSpeed 7, escortSpeed 5, walkSpeed 2.6,
  // huntSpeed 4.6).
  drawSpeed: 18.2,         // world units/sec across the ground to the ramp, alone
  // The escort: two of the crew go out for each person.
  escorts: 2,
  fetchSpeed: 9.1,         // hurrying out to them
  fetchSeconds: 9,         // at most; then they are simply beside them
  escortSpeed: 6.5,        // all three together, to the ramp
  escortSide: 0.75,        // either side of the person
  aboardSeconds: 4,        // inside, before coming back down
  // Riding the belt from the foot to the hatch, at a constant speed -- at
  // least two seconds on the ramp, on request -- then gone.
  climbSeconds: 3.2,
  vanishSeconds: 0.35,
  // The crew.
  // The classic small grey, 1.4 m (engine/scale.js CHARACTERS); it was a
  // 5.2 m figure, and the reaches below shrank with it.
  scale: CHARACTERS.alien.height / PERSON_BUILT_HEIGHT,
  exitEvery: 0.5,          // seconds between two coming down the ramp
  walkSpeed: 3.4,
  patrol: [12, 34],        // distance from the ship's axis they keep to
  turnRate: 3,
  fireReach: 1.3,          // of the Firenado's radius
  burnSeconds: 1.8,
  killScore: 300,
  // The rampage, once the ship is gone.
  raySight: 70,            // how far off a target draws them
  rayRange: 30,            // they stop and shoot from here
  rayEvery: [2.2, 4],      // seconds between two shots from one alien
  rayLife: 0.5,
  aimLead: 0.45,           // seconds the gun arm is up before the shot
  aimHold: 0.5,            // and after it
  rayEnergy: 2600,         // an impact's worth, on damage.js's scale
  rayShock: 2.4,           // on collapseResistance's scale
  rayIgnite: 0.35,         // chance a building hit catches fire
  rayMax: 16,
  retargetSeconds: 0.25,   // between two full target searches (currentTarget)
  // Fighting the Terminators.
  grabReach: 22,           // a Terminator this near an alien is taken
  fireNear: 60,            // of the Firenado, for a Terminator's blow to kill
  burningNear: 25,         // of a burning building, likewise
  knockSpeed: 11,
  knockSeconds: 0.45,
  // The wreck.
  wreckReach: 8,           // added to the funnel's radius
  wreckSeconds: 1.8,
  wreckScore: 4000,
  skin: 0x6fd35a,
  glow: new THREE.Color(0.25, 2.2, 0.45),
  // Roger (engine/heroMode.js).
  rogerSight: 45,          // crew this near him go for him
  huntSpeed: 6,
  meleeReach: 1,           // within this, they have him
  rayHitRadius: 1,         // of where the ray was aimed, for it to hit him
  // The ships' tracking laser.
  laserRange: 100,
  laserSeconds: 3.2,
  laserEvery: [3, 5],
  laserSpeed: 5,           // m/s the foot crawls after him (he runs 9)
  laserStart: 14,          // how far off him the foot comes down
  laserKill: 1.2,
  // Hull points: a normal plasma shot takes 1, a mega beam 5 (heroMode.js
  // SHIP_DAMAGE) -- six shots, or a mega beam and a shot.
  shipHull: 6,
  crashScore: 5000,
  // The hunter ships.
  huntersAt: 90,           // seconds after the first ship arrives (was 150, then 120; sooner again, on request)
  hunterCount: 2,
  hunterScale: 0.6,
  hunterHeight: 26,
  hunterArriveFrom: 220,
  hunterArriveSeconds: 4,
  hunterSpeed: 11,
  hunterHover: 14,         // it stops this far (on the ground) from its target
  hunterShootRange: 60,
  hunterShotEvery: [1.6, 2.8],
  hunterHull: 4,             // hull points, as shipHull: one mega beam, or four shots
  hunterGlow: new THREE.Color(2.4, 0.3, 0.22),
  // The nuclear plants (engine/nuclear.js): every alien ship goes for them
  // while any is standing -- five hits bring one down. The hunters stand
  // off and shoot; the landing ship shoots from where it hangs, starting a
  // while after it has come down.
  plantStandOff: 38,       // how near (on the ground) a hunter comes
  plantShootRange: 75,
  plantShotEvery: [3.5, 5],
  shipPlantFirst: 30,      // seconds hovering before the landing ship's first shot
  shipPlantEvery: 14,
  // The second wave: the transport, what it brings, and the sombreros.
  waveAt: 120,             // seconds after the first ship arrives (two minutes; it was twenty)
  waveCount: 20,
  waveGlow: new THREE.Color(2.6, 1.8, 0.3),
  waveLeaveSeconds: 5,     // lifting away once the last of them is off the ramp
  // People turned by a nuclear plant's green EMP (mutate, engine/nuclear.js).
  mutateSeconds: 2,
  mutateStrike: 0.35,      // of those, the green bolt coming down on them
  mutantMax: 150,          // crew on their feet at once, past which the ray only kills
  mutantColour: new THREE.Color(0.35, 3.2, 0.6),
  sombreroStraw: 0xd9b25e,
  sombreroBand: 0xc0282d,
  bannerSeconds: 3.4,
  goalSeconds: 7           // the opening "STOP THE ALIENS" message
};

// Ray colours: the crew's green, the hunters' red.
export const RAY_COLOURS = {
  green: { core: new THREE.Color(2.5, 6, 3), glow: new THREE.Color(0.3, 2.4, 0.6), flare: new THREE.Color(1.2, 5, 1.6), splash: new THREE.Color(1, 4, 1.4) },
  red: { core: new THREE.Color(6, 2.4, 2), glow: new THREE.Color(2.4, 0.3, 0.25), flare: new THREE.Color(5, 1.4, 1.1), splash: new THREE.Color(4, 1.1, 0.9) }
};

export const UP = new THREE.Vector3(0, 1, 0);

// The aliens' shared types, used across engine/aliens/ (and global
// through types.d.ts at the project root).
/**
 * @typedef {Object} Alien
 * @property {THREE.Group} root
 * @property {{legL: THREE.Object3D, legR: THREE.Object3D, armL: THREE.Object3D, armR: THREE.Object3D}} limbs
 * @property {THREE.MeshStandardMaterial} skin
 * @property {'exiting'|'patrol'|'escort'|'aboard'|'burning'|'dead'} phase
 * @property {number} timer
 * @property {number} heading
 * @property {number} cycle
 * @property {number} tx
 * @property {number} tz
 * @property {number} pause
 * @property {number} rayTimer seconds until it can shoot again
 * @property {number} knockTimer seconds left of being thrown back
 * @property {number} knockX direction it is thrown
 * @property {number} knockZ
 * @property {THREE.Object3D} muzzle the ray gun's emitter, in the right hand
 * @property {number} aim seconds left with the gun arm raised
 * @property {number} side -1 or 1: which side of the person it escorts
 * @property {boolean} [slain] cut down by a samurai (crew.js slashKill): no fire
 * @property {boolean} [wave] one of the second wave (waves.js)
 * @property {THREE.Vector3} [exitTop] the second wave's ramp it walks down (waves.js)
 * @property {THREE.Vector3} [exitFoot]
 * @property {number} [exitHeading]
 * @property {boolean} [dancing] dancing (Smooth Criminal, or nobody left to kill)
 * @property {number} [danceTime] seconds into its dance
 * @property {Object|null} [target] who it is going for (crew.js currentTarget)
 * @property {number} [retarget] seconds until it looks for a nearer target
 * @property {boolean} [locked] its ray is aimed at where Roger stood (crew.js huntRoger)
 * @property {number} [lockX]
 * @property {number} [lockZ]
 * @property {Object[]|null} [instanceParts] its parts, as the instancer found them
 */
/**
 * Someone -- or something -- on the way up the ramp.
 * @typedef {Object} Abductee
 * @property {Object|null} person a person, or null for a Terminator
 * @property {Object|null} machine a Terminator's unit (terminator.js)
 * @property {THREE.Object3D} root what is being moved
 * @property {number} baseScale
 * @property {'fetch'|'drawn'|'waiting'|'climb'|'vanish'} phase
 * @property {number} timer
 * @property {THREE.MeshStandardMaterial[]} materials
 * @property {Alien[]} escorts the crew bringing them in, if any
 */
