import * as THREE from 'three';
import { PERSON_BUILT_HEIGHT } from '../environment/people.js';
import { CHARACTERS } from '../scale.js';

/**
 * ===========================================================================
 * SECTION TM.0 — The Terminators' tunables
 * ===========================================================================
 * Every number the Terminators are tuned by.
 */

export const T800 = {
  // 2.1 m: a head over the crowd (engine/scale.js CHARACTERS). It was an
  // 8 m machine beside 5.5 m people; the distances below shrank with it.
  scale: CHARACTERS.terminator.height / PERSON_BUILT_HEIGHT,
  speed: 3,                    // m/s: a relentless walk, slower than a runner
  turnRate: 2.4,               // radians/sec
  stride: 7.5,                 // walk-cycle radians per world unit
  reach: 0.9,                  // how close it must get to a person, metres
  retarget: 0.6,               // seconds between choosing a target
  bound: 127,                  // stays inside the playable town (people go to 128)
  spawnRadius: 118,
  squad: 5,                    // sent in together by the button
  probe: [1.2, 2.6],           // distances ahead tested for a clear way
  detourSeconds: 0.8,          // keeps to one side of an obstacle this long
  watchdogSeconds: 2,          // how often progress is checked
  watchdogProgress: 0.3,       // fraction of the possible distance that counts as moving
  breakoutSeconds: 1.8,        // how long a stuck machine strikes out on a clear heading
  ignoreSeconds: 8,            // how long it leaves alone a person it could not reach
  alienSight: 30,              // how far off it will go for an alien instead of a person
  strikeReach: 1.2,
  strikeCooldown: 1.4,         // seconds between two blows
  killScore: 40,
  destroyScore: 6000,
  dyingSeconds: 2.2,           // seizing up before it goes over
  fallSeconds: 0.7,
  bannerSeconds: 3.4,
  chrome: 0xc2cad4,
  joint: 0x2a2e33,
  eye: new THREE.Color(6, 0.25, 0.12)
};

// Half its width, for the push-out and the way-ahead probe.
export const PAD = 0.6 * T800.scale * 0.3;

// Shared types (JSDoc), imported by the files that use them.
/**
 * @typedef {Object} Unit
 * @property {THREE.Group} root
 * @property {{hipL: THREE.Object3D, hipR: THREE.Object3D, kneeL: THREE.Object3D, kneeR: THREE.Object3D,
 *   shoulderL: THREE.Object3D, shoulderR: THREE.Object3D, head: THREE.Object3D, body: THREE.Object3D}} joints
 * @property {THREE.MeshBasicMaterial} eyeMat
 * @property {'walking'|'dying'|'taken'|'dead'} phase
 * @property {Object|null} foe the alien it is going for, if any
 * @property {number} strikeTimer seconds until it can strike again
 * @property {import('../health/melee.js').TouchState} touch its melee cooldown against Roger (health/melee.js)
 * @property {number} touchClock world seconds it has been walking, the clock of `touch`
 * @property {number} heading
 * @property {number} cycle
 * @property {number} timer
 * @property {number} retarget
 * @property {Object|null} target
 * @property {THREE.Material[]} materials
 * @property {THREE.BufferGeometry[]} geometries
 * @property {number} detourHeading
 * @property {number} detourTimer
 * @property {number} detourSide which way it last turned off, +1 or -1
 * @property {number} watchTimer
 * @property {number} watchX where it was at the last progress check
 * @property {number} watchZ
 * @property {Object|null} ignore a person it gave up on
 * @property {number} ignoreTimer
 * @property {number} [bulletHits] shots taken so far (terminator/hits.js)
 */
