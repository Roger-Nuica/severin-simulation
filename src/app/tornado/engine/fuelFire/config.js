// @ts-check
/**
 * ===========================================================================
 * SECTION FF.0 — Fuel stations: the tunables
 * ===========================================================================
 * What a fuel station does from the moment a funnel reaches it (see
 * engine/fuelFire.js for the whole story).
 */

export const FUEL = {
  // A funnel counts as a direct hit inside its capture edge
  // (physics.js CAPTURE_TUNE.edgeRadiusFactor x radius x sizeMul) times this.
  hitReach: 1.1,
  // Seconds of leaking (hiss, alarm, spray, the puddle spreading) before it
  // catches, then of burning before the tanks go.
  leakSeconds: 4,
  burnSeconds: 2.5,
  // A station set off by another explosion skips the leak: it is already on
  // fire, and goes up this long after.
  blastFuse: [0.8, 1.6],
  puddleRadius: 9,             // metres, fully spread
  // The blast.
  boomStrength: 11,            // spawnImpactBurst scale: tanker 42, collapse 2.4
  satellites: 5,
  satelliteSpread: 16,
  blastRadius: 34,             // buildings shocked
  buildingShock: 5,            // at the centre, falling off to the edge
  throwRadius: 42,             // loose things thrown
  throwForce: 38,
  killRadius: 11,              // people caught in the fireball
  fireRadius: 30,              // buildings set alight
  setOffRadius: 22,            // tankers, gas mains, lines (explosives.js)
  score: 900,
  // Rings of flame racing out along the ground, and the smoke columns.
  rings: 2,
  ringRadius: 30,
  ringSeconds: 1.1,
  ringGap: 0.28,               // seconds between two rings of one blast
  smokeSeconds: 16,            // the wreck smokes this long after the blast
  smokeRate: 26,               // particles a second per smoking station
  smokeColumns: 3,
  // Secondary explosions: cars near a blast go up after it, one after the
  // other, and each can set off the cars next to it -- a limited chain.
  carRadius: 26,               // from a station or a tanker
  carChainRadius: 11,          // from a car
  carsPerBlast: 5,             // at most, from one blast
  carsPerCar: 2,
  carDelay: [0.25, 0.7],       // seconds after the blast that reached it
  maxDepth: 3,                 // blast -> car -> car -> car, and no further
  maxPending: 14,              // secondaries waiting at once, all chains together
  carStrength: 1.5,
  // Another station within this reach of a blast goes up too, one depth on.
  stationChainRadius: 60,
  // Particle pools.
  sprayMax: 500,
  flameMax: 700,
  smokeMax: 900,
  maxRings: 6
};

