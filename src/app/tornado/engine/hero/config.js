// @ts-check
import * as THREE from 'three';
import { PERSON } from '../scale.js';

/**
 * ===========================================================================
 * SECTION HM.0 — Hero Mode's tunables
 * ===========================================================================
 * Every number Hero Mode is tuned by, in one place: Roger's run, the plasma
 * rifle and its mega beam, the machines after him, the cameras and the HUD.
 * The behaviour they drive is described in heroMode.js and GAME_DESIGN.md;
 * numeric contracts are indexed in .claude/rules.md.
 */

/** What one plasma shot takes off an alien ship's hull (aliens.js, mothership.js). */
export const SHIP_DAMAGE = { normal: 1, mega: 5 };

export const HERO = {
  // Sizes and speeds are a life-size man's (engine/scale.js PERSON): he was
  // a 5.5 m figure running at 22 m/s. A hero's sprint, still well ahead of
  // the crowd's 3.4-4.8 m/s and of the Terminators' walk.
  runSpeed: 9,
  backSpeed: 3.5,
  accel: 20,                       // m/s^2
  turnRate: 3.2,                   // radians/sec
  stride: 7.5 / PERSON.height,     // leg-cycle radians per metre covered
  pad: PERSON.height * 0.24,       // clearance kept from a building's footprint
  // How far out he can go: to the edge of the backdrop town
  // (environment/backdrop.js, out to 292 on a 600-wide ground), on request.
  // It was 126 -- an invisible wall a street past the playable town, with
  // the backdrop's buildings in plain view beyond it.
  bound: 288,
  spawnFunnelClearance: 60,
  // Roger always starts beside NUCLEAR PLANT ONE (nuclear.js NUCLEAR.sites[0]),
  // this far out from its middle on the town side (the site is 24 across).
  spawnPlant: { x: -100, z: 100 },
  spawnFromPlant: 34,
  // The camera, over his shoulder at a life-size man's distance.
  followBack: PERSON.height * 3.4,
  followHeight: PERSON.height * 1.8,
  lookAhead: PERSON.height * 1.4,
  lookHeight: PERSON.height * 0.6,
  // Pulled in short of any building behind him: tested at this many points
  // along the way back, kept this far off a wall, never closer than this.
  cameraProbes: 8,
  cameraClearance: 0.6,
  cameraMinBack: PERSON.height * 1.2,
  // The health and energy bars over his head (hero/models.js buildOverhead;
  // he has no name tag any more), and the stars when dazed.
  overheadHeight: PERSON.height * 1.24,
  overheadWidth: 0.78,
  starsHeight: PERSON.height * 1.16,
  starsSize: PERSON.height * 0.5,
  // Where his shots leave from when there is no rifle to measure.
  muzzleHeight: PERSON.height * 0.6,
  // Aim mode: first person, down the rifle.
  eyeHeight: PERSON.height * 0.93, // Roger's eyes
  aimFov: 50,
  lookSensitivity: 0.0021,         // radians per pixel of mouse travel
  pitchMin: -0.9,
  pitchMax: 1.1,
  aimWalkSpeed: 4,
  // The grappling hook's zip (engine/player/grapple.js): how high the hop
  // along the rope goes at its middle.
  zipHop: PERSON.height * 0.5,
  // The plasma beam.
  plasmaCooldown: 0.35,
  beamSeconds: 0.55,
  beamRange: 420,
  blastRadius: 7,                  // round where it lands
  impactEnergy: 9000,              // damage.js's impact scale
  buildingShock: 5,
  igniteChance: 0.6,
  throwForce: 28,
  // The mega beam: Enter (or the left button) held this long (2 s since
  // 2026-10-01, on request; it was 3). The charge bar, the rings, the hum
  // and the HUD all follow it.
  chargeSeconds: 2,
  megaBeamSeconds: 1.1,
  megaWidth: 3.5,                  // of a normal beam
  megaBlastRadius: 18,
  megaImpactEnergy: 40000,
  megaBuildingShock: 10,
  megaThrowForce: 60,
  megaRings: 3,
  megaRingSeconds: 0.7,
  megaTrail: 9,                    // bursts of fire down the beam
  knockdownSeconds: 2.8,           // the Terminator flat on its back
  knockdownFling: 18,
  neutraliseScore: 8000,
  // Being caught by a funnel.
  dazeReach: 1.45,                 // of the funnel radius (capture edge is 1.8)
  dazeSeconds: 3.4,
  dazeImmunity: 3,
  // Untouchable for this long after the run starts (or restarts): nothing
  // kills him -- no alien ray, no ship's laser, no Terminator.
  spawnShieldSeconds: 3,     // was 2; 3 on request
  // Death: the chasm's edge, how deep into it counts (chasm.js gapAt), the
  // stagger before the drop, and the GAME OVER card after the fall.
  chasmMargin: 0.3,
  chasmStagger: 0.55,
  overAfter: 1.6,
  // The pursuers (hero/pursuers.js): this many machines, set off this far
  // behind him on bearings this far apart. None are sent at the start of a
  // run since 2026-10-03 (the panel's Terminator squad does the hunting);
  // the numbers stay for spawnPursuers.
  pursuers: 2,
  pursuerSpread: 0.8,              // radians between their spawn bearings
  pursuerDistance: 55,
  // A third of 80% of Roger's run (it was 19, then 17.6, and still caught
  // him before he could turn and shoot): a relentless walk he can open a
  // gap on, turn round in, aim and fire.
  pursuerSpeed: 9 * 0.8 / 3,
  pursuerScale: 1.15,
  catchRadius: PERSON.height * 0.55,
  staggerSeconds: 1.5,
  staggerSpeed: 4,
  // Shorted out by an EMP-charged funnel (engine/empCharge.js).
  seizeSeconds: 1.3,
  fallSeconds: 0.75,
  burstSeconds: 0.55,
  burstReach: 16,
  empKillScore: 6000,            // a Fujiwhara merge's weight, and then some
  respawnDelay: 6,
  respawns: 1,                   // each machine reboots once after it is killed, then stays down
  // The parked cars: in by the driver's door (Enter), out again with E, Q
  // or Esc. The reach is from Roger's feet to the door, on the ground.
  doorOffset: 1.15,                // of the door from the car's middle
  doorReach: 2,
  doorSpotReach: 16,               // the nearest car's door lights up this near
  exitOffset: 2.2,
  wheelRadius: 0.46,               // cars.js CAR_WHEEL_RADIUS
  // The cut to the Terminators coming in (hero/screen.js placeShowcaseCamera): seconds a shot.
  showcaseShot: 1.6,
  bannerSeconds: 3.4,
  hintSeconds: 7
};

export const UP = new THREE.Vector3(0, 1, 0);
export const Z_AXIS = new THREE.Vector3(0, 0, 1);
// Panel buttons off while Roger is out. Fujiwhara, the Final Boss wedge and
// Doomsday used to be here too; on request (2026-10-05) they work in Hero
// Mode (Roger is never killed by a funnel, R-001), so only the modes that take
// the camera or the funnel away from him stay off.
export const EXCLUSIVE_BUTTONS = ['btn-chase', 'btn-possess', 'btn-cinematic', 'btn-strike'];
export const STREETS_ALONG_X = [-20, -8, 8, 20];
export const STREETS_ALONG_Z = [-30, 30];
