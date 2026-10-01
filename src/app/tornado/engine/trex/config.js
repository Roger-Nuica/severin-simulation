// @ts-check
import * as THREE from 'three';
import { CHARACTERS, GIANT } from '../scale.js';

// Tuned for a 6 m T-Rex; now a giant (engine/scale.js CHARACTERS, GIANT).
const { size, pace } = GIANT.ratio(CHARACTERS.trex.height, 6);

/**
 * ===========================================================================
 * SECTION TX.0 — The cyber T-Rex: tunables
 * ===========================================================================
 */

export const TREX = {
  // A giant (engine/scale.js CHARACTERS): 18 m, 39 m long. The model is
  // built 15 m tall (trex/model.js scales it).
  height: CHARACTERS.trex.height,
  walkSpeed: 4.2 * pace,     // metres a second (7.3)
  turnRate: 0.75,            // radians a second
  spawnRing: 160,            // where it comes in from, out from the centre
  // What it takes: hit points, and each hit's share of them.
  hp: 40,
  damage: { plasma: 3, mega: 40, bullet: 0.3, bolt: 8, emp: 6 },
  empStun: 5,                // seconds its implants are down after an EMP
  // The flame breath.
  // A 30 m flame at 6 m, grown by the height but less than in proportion
  // (90 m would reach across half the town): 60 m.
  flameRange: 60,            // metres
  flameHalfAngle: 0.3,       // radians either side of straight ahead
  flameSeconds: 2.6,
  flameEvery: [5, 8],        // seconds between two breaths
  flameAim: 52,              // it breathes once its target is within this
  igniteEvery: 0.25,         // seconds between two checks of what the cone reaches
  flameRate: 320,            // particles a second while breathing
  flameMax: 1100,            // the pool
  flameSpeed: 60,            // metres a second, out of the mouth
  flameSize: 1.4,            // particle size, against the 6 m T-Rex's (2 whited the screen out)
  // Walking through town.
  crushRadius: 2.5 * size,   // people and cars under its feet (7.5 m)
  buildingShock: 6 * pace,   // to a building it walks into
  stepShake: 0.25 * pace,
  stepHeard: 160,            // metres: how far a footfall is felt and heard
  hitboxRadius: 0.3,         // of its height: the cylinder the guns aim at
  score: 5000,
  // Death.
  fallSeconds: 1.6,
  goneAfter: 8,              // seconds after it falls, it is taken away
  // The look.
  skin: 0x3d4a3a,
  belly: 0x6d7563,
  metal: 0x8a9199,
  eye: new THREE.Color(4, 0.25, 0.1),
  vent: new THREE.Color(3, 1.1, 0.2)
};
