// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION FA.0 — The chemical works' tunables
 * ===========================================================================
 * Every number the chemical works and its chain of explosions are tuned by.
 */

export const FACTORY = {
  // Clear of the town grid (+-88), the railway (z=33) and the viaduct
  // (z=-52), but well inside the funnel's wander range so the storm can reach
  // it before the fuse does.
  x: 66,
  z: -74,
  // The shed.
  shedWidth: 26,
  shedDepth: 16,
  shedHeight: 9,
  roofRise: 2.4,
  chimneyRadius: 1.6,
  chimneyHeight: 22,
  tankRadius: 3.4,
  tankHeight: 8,
  wallColour: 0x6d7378,
  roofColour: 0x4a5055,
  chimneyColour: 0x8a7f76,
  tankColour: 0xb9bdc0,
  // The yard.
  barrels: 50,
  barrelRadius: 0.6,
  barrelHeight: 1.5,
  barrelColours: [0xc4441f, 0xd8a01c, 0x3c6e3a],
  yardWidth: 22,
  yardDepth: 10,
  // The chain. Seconds between one barrel catching and the next, and how far
  // the fire can jump to find the next one.
  fuse: 40,
  chainInterval: [0.035, 0.09],
  chainReach: 9,
  // Each barrel popping.
  popStrength: 0.85,
  popSpeed: [11, 24],
  popSpin: 9,

  // --- Marking it as a works -------------------------------------------
  // At night the shed was a grey box among grey boxes: nothing said
  // "chemical plant" until it was already on fire. These are what read at a
  // distance -- a gas flare burning off the chimney, a red aviation beacon
  // blinking on top of it, floodlight masts over the yard and hazard strips
  // round the tanks -- and they all go dark the moment the works does.
  flareRadius: 1.15,
  flareHeight: 4.2,
  flareColour: 0xff9a30,
  flareLightColour: 0xff7a1e,
  flareLight: 130,             // peak intensity; flickers between 0.7x and 1.3x
  flareDistance: 85,
  beaconColour: 0xff2f22,
  beaconPeriod: 1.7,           // seconds per blink
  mastCount: 4,
  mastHeight: 13,
  floodColour: 0xdfeaff,
  floodLight: 42,
  floodDistance: 60,
  hazardColour: 0x9dff3c,

  // --- The detonation ---------------------------------------------------
  // This used to be one burst at strength 3.5 -- deliberately half the fuel
  // tanker's 7 -- and for fifty barrels of build-up it landed as a pop. It
  // is now the largest scripted event in the game and runs as a sequence:
  // the two storage tanks go one after the other, and then the works itself
  // does, in a rolling blast whose pressure wave *travels* outward at
  // shockSpeed rather than flattening the whole radius on one frame.
  tankDelay: 0.5,
  tankStagger: 0.45,
  //
  // Then five times all of it, on request: the fireball, the spread of the
  // secondaries, the column, the scar. The pressure wave's reach is capped at
  // the edge of the map (5x its old 95 would be half as far again past it),
  // which is still the whole town and most of the one beyond.
  tankStrength: 12,
  blastDelay: 0.75,
  blastStrength: 40,
  satellites: 30,
  satelliteSpread: 220,
  satelliteInterval: 0.05,
  // The fire column climbing out of the site after the blast.
  mushroomSeconds: 2.4,
  mushroomInterval: 0.1,
  mushroomRise: 180,
  // The pressure wave.
  shockSpeed: 240,             // world units/sec
  blastRadius: 300,
  throwForce: 95,
  fireRadius: 170,
  buildingShock: 7.5,
  scorchRadius: 110,
  score: 6000,
  bannerSeconds: 3.2
};

export const GRAVITY = 17;

// Shared types (JSDoc), imported by the files that use them.
/**
 * @typedef {Object} Barrel
 * @property {THREE.Vector3} pos
 * @property {THREE.Vector3} vel
 * @property {THREE.Euler} rot
 * @property {THREE.Vector3} spin
 * @property {'stacked'|'flying'|'gone'} state
 * @property {number} colour index into FACTORY.barrelColours
 */
