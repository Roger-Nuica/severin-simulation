import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION VD.0 — The viaduct's tunables
 * ===========================================================================
 * Where the viaduct runs (VIADUCT_Z, used by the aliens and the minimap too)
 * and every number its structure and traffic are tuned by.
 */

// Layout. The line runs along X at this Z, clear of the ring road (radius
// 46-51) and on the opposite side of town from the railway at z = 33.
export const VIADUCT_Z = -52;
export const DECK_Y = 10;
// The elevated deck runs +-DECK_HALF; a ramp at each end comes down from it
// to the ground at +-HALF_LENGTH. It used to be one level deck +-130 that
// ran into the dam's wall at the west end and stopped in mid-air at the
// east, with the cars driving off both.
export const DECK_HALF = 80;
export const HALF_LENGTH = 128;

/**
 * The ramps: two spans each, the upper one from the deck's end pillar down
 * to a half-height pillar, the lower one from there to an abutment on the
 * ground. Part of the structure like any span: they sag and fall the same
 * way when a pillar under them goes, and drain under a funnel.
 */
export const RAMP = {
  midHeight: 5,           // the half-way pillar (the deck is DECK_Y)
  // The slab's centre at the foot, so its top meets the ground just above
  // the roads (0.01).
  footY: -0.3
};

/**
 * The traffic's road, beyond the ramps: from the foot of each ramp along
 * the ground, round a bend and north along x = +-connectorX to the street
 * at z = junctionZ (roadsDecor.js's z = -20 road), where the town's grid
 * takes over. Cars start at one junction and are taken away at the other,
 * and come back in at the start.
 */
export const ROUTE = {
  connectorX: 136,
  junctionZ: -20,
  cornerRadius: 8,
  roadWidth: 9,
  roadY: 0.012
};

export const DECK = {
  segments: 7,
  width: 9,
  thickness: 0.7,
  // Guard rails along both edges, parented to their segment so they fall
  // with it rather than hanging in the air over the gap.
  railHeight: 0.8,
  railThickness: 0.25,
  // Seconds a segment takes to sag onto its remaining hinge before it lets
  // go entirely.
  sagSeconds: 0.8,
  // Radians it rotates through while sagging.
  sagAngle: 0.5,
  // The shudder a surviving neighbour gives when a span next to it goes.
  shudderSeconds: 0.9,
  shudderAmplitude: 0.16,
  shudderRate: 26
};

export const PILLAR = {
  radiusTop: 0.9,
  radiusBase: 1.5,
  // Where the break happens, as a fraction of the pillar's height.
  snapAt: [0.45, 0.75],
  colour: 0x8d8a85
};

// Integrity, in arbitrary units: both pillars and deck segments start at 1.
export const STRUCTURE = {
  // Drained per second while a tornado's capture radius covers the piece,
  // scaled by intensity. At EF4 a pillar under the funnel fails in a few
  // seconds rather than instantly -- long enough to watch it happen.
  tornadoDrain: 0.5,
  // Taken off by one direct debris hit, scaled by the hit's energy against
  // this reference. A thrown car takes a pillar most of the way down.
  impactReference: 1200,
  impactMax: 0.7,
  // A pillar reaching zero costs its neighbouring deck segments this much
  // outright, on top of losing their support.
  pillarLossToDeck: 0.35
};

export const TRAFFIC = {
  cars: 10,
  speed: 13,
  // Two lanes, offset either side of the centreline, travelling opposite ways.
  laneOffset: 2.1,
  // Wheels sit on the deck surface.
  rideHeight: 0
};

/**
 * Drivers reacting to the road ahead. The traffic used to drive at a constant
 * speed until the span under a car stopped being intact, at which point that
 * car dropped -- so every car reached the gap at full speed and went over it
 * without ever appearing to have noticed, one after another, evenly spaced.
 *
 * The check is deliberately dumb: look `lookahead` units down your own lane,
 * and if the road there is gone, brake. What makes it read as driving rather
 * than as a rule is the two things that fall out of it -- a driver who sees
 * the gap too late cannot stop in time and goes over anyway (the braking
 * curve decides, not a flag), and a driver braking hard is an obstacle to
 * whoever is behind them, which is what turns four cars into a pile-up at the
 * edge instead of four separate departures.
 */
export const BRAKE = {
  lookahead: 38,
  decel: 24,                 // units/s^2 under braking
  accel: 7,                  // getting back up to speed afterwards
  edgeMargin: 3,             // aim to stop this far short of the broken edge
  // A car that has run out of road goes over only if it is still carrying
  // real speed. Without this, a driver who stopped cleanly at the margin was
  // pushed off the moment their remaining room reached zero -- which is how
  // every car ended up in the gap, one after another, exactly the blind
  // behaviour this was meant to replace. Above the shunt speed on purpose, so
  // being rear-ended at the brink does not by itself put you over it.
  edgeGiveUpSpeed: 3,
  // How much of the theoretical stopping curve a driver actually uses.
  safety: 0.7,
  // How long a driver keeps going after the road ahead opens up before they
  // do anything about it. Without this nobody is ever caught out -- a
  // 38-unit lookahead against a 3.5-unit stopping distance means perfect
  // information and instant reflexes, every car stops, and nothing ever goes
  // into the gap. Reaction time is what decides who was too close when the
  // span went, and it is different for every driver.
  reaction: [0.35, 1.2],
  // Following distance at which a driver starts braking for the car in front,
  // and the distance at which they have failed to.
  gap: 11,
  crashGap: 3.4,
  // The veer. Braking hard pulls a car toward the outside of its lane, with a
  // slew angle to match, so a queue at the edge is a scattered mess rather
  // than a neat line.
  swerve: 1.5,
  swerveRate: 3.2,
  swerveYaw: 0.45,
  // A shunt: the jolt it gives both cars, and the speed it leaves them at.
  shuntSpeed: 2,
  shuntYaw: 0.35
};

/**
 * A span that has begun to sag but has not let go yet. It hangs over the
 * ground for DECK.sagSeconds, which is long enough to be a warning -- and the
 * people underneath take it, which is what tells the player that a sagging
 * deck is somewhere not to be.
 */
export const SHADOW = {
  // How far either side of the span's footprint counts as underneath it. The
  // slab is 9 wide; this is generous on purpose, because it is a readability
  // signal first and a physics volume second.
  margin: 7,
  // Kept for a moment after the span lands, so the crowd keeps clear of the
  // rubble rather than turning round into it.
  lingerSeconds: 2.5
};

export const SCORE = {
  pillar: 150,
  deck: 300,
  car: 110,
  shunt: 70
};

// Shared types (JSDoc), imported by the files that use them.
/**
 * @typedef {Object} Pillar
 * @property {THREE.Mesh|null} mesh null for a ramp's abutment on the ground
 * @property {number} x
 * @property {number} height metres, ground to the slab's centre
 * @property {number} integrity 1 down to 0
 * @property {boolean} down
 */
/**
 * @typedef {Object} Segment
 * @property {THREE.Group} group deck slab plus its rails
 * @property {number} index
 * @property {number} centreX
 * @property {number} span horizontal length
 * @property {number} tilt radians: 0 on the deck, the slope on a ramp
 * @property {number} baseY the slab centre's height when standing
 * @property {number} length the slab's length along its slope
 * @property {Pillar} left
 * @property {Pillar} right
 * @property {number} integrity
 * @property {'intact'|'sagging'|'fallen'} state
 * @property {number} sagTimer
 * @property {number} shudder
 * @property {number} hinge -1 hinged on its left pillar, 1 on its right
 * @property {SimObject|null} body once it has let go
 * @property {Object|null} hazard the shadow zone it casts while sagging
 * @property {boolean} landed whether its fall has already been resolved
 * @property {number} fallTimer seconds since it let go
 */
