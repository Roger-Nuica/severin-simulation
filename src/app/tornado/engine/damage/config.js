import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION DM.0 — Damage tunables
 * ===========================================================================
 * Every number the damage model is tuned by: thresholds, collapse, score.
 */

export const WINDOW_DARK_COLOUR = new THREE.Color(0x14110c);

/**
 * ---------------------------------------------------------------------------
 * Chain-reaction collapse
 * ---------------------------------------------------------------------------
 * A building coming down does not come down quietly: it throws its own mass
 * sideways into whatever is standing next to it. Every collapse therefore
 * queues a *shock* against each neighbour within reach, which either topples
 * it outright (a domino) or tears a piece or two off it, leaving it that much
 * weaker for the next one.
 *
 * Three things keep a cascade bounded and legible rather than levelling the
 * town from one unlucky collapse:
 *  - shocks are queued with a short delay instead of resolving in the same
 *    frame, so a run of dominoes falls one after another and reads as cause
 *    and effect;
 *  - shock strength falls off linearly with distance and is compared against
 *    the target's own resistance, so only close and/or already-damaged
 *    neighbours actually go;
 *  - each collapse carries a chain depth, capped at CHAIN_MAX_DEPTH, so no
 *    single first collapse can propagate indefinitely however dense the town.
 * A building can only ever collapse once, which is the backstop under all
 * three: a cascade cannot revisit anything.
 */

// Shock delivered to a neighbour right at the collapsing building's own
// footprint, before distance falloff.
export const CHAIN_SHOCK_BASE = 0.85;
// ...plus this much per world unit of the collapsing building's wall height:
// a 22-unit apartment block coming down hits far harder than a 3.4-unit house.
export const CHAIN_SHOCK_PER_HEIGHT = 0.055;
// How far the shock reaches, as a base plus the collapsing building's own
// largest footprint dimension. Measured against the real town: building spots
// sit 22 units apart along a row (generateEnvironment), each jittered by up to
// 2, so a next-door neighbour is 18-26 units away centre to centre, while the
// nearest building across the street is 32+. These values give a reach of
// 25.6 (smallest house) to 29 (widest shop), which covers next door and stops
// short of the far side of the road.
//
// Worth stating because it was tuned the wrong way round first: a reach of
// 13 + 0.9x footprint came to 21 units, which sounds ample next to a 22-unit
// grid and in fact meant the nearest neighbour was *always* out of range, so
// no shock was ever queued and the whole mechanic silently did nothing.
export const CHAIN_REACH_BASE = 20;
export const CHAIN_REACH_PER_SIZE = 0.75;
// Seconds before a queued shock resolves, so dominoes fall in sequence.
export const CHAIN_DELAY = [0.25, 0.7];
// Collapses removed from the original wind-driven one. 3 allows a visible run
// of dominoes down a street without a single collapse being able to sweep the
// whole town.
export const CHAIN_MAX_DEPTH = 3;
// Maps a building's wind breakThreshold (5.5..9.5) onto the shock scale, and
// how much easier each already-lost piece makes it to topple. An intact small
// house resists ~0.7-1.0, an intact apartment block ~1.2, and either drops
// well below that once the tornado has opened it up.
//
// Read these against the shock a next-door collapse actually delivers (0.66
// for a 22-unit-away apartment block coming down) and the intended rule falls
// out: a glancing blow on an intact building, a topple on one the storm has
// already opened up, and a borderline coin-flip on an intact small house. A
// glancing blow costs the target pieces, which lowers its own resistance --
// so a street the tornado has chewed along really does go over in sequence,
// while an untouched block of flats next to one unlucky collapse does not.
export const CHAIN_RESISTANCE_PER_THRESHOLD = 0.13;
export const CHAIN_RESISTANCE_PER_WALL_LOST = 0.22;
export const CHAIN_RESISTANCE_PER_ROOF_LOST = 0.1;
// Pieces a shock that fails to topple a building knocks loose.
export const CHAIN_GLANCING_PIECES = 2;
// Extra score for a collapse the player did not have to drive the tornado
// into: the domino is the reward.
export const CHAIN_COLLAPSE_BONUS = 60;
// How far a detonating fuel station throws burning fuel. Wider than the
// collapse shock's reach, so the forecourt fire starts with a few buildings
// alight at once and has somewhere to spread from.
// 14 rather than 22: at 22 a single station lit most of the block around it
// outright, and with the pool fix letting all three stations go inside a few
// seconds that alone had most of the town alight before the spread mechanic
// had done anything at all. 14 is a forecourt fire that then spreads, which
// is the mechanic doing the work rather than the initial condition.
export const FUEL_FIRE_RADIUS = 20;
// A building that collapses while the Firenado is burning is coming apart in
// a column of fire; this is the chance it comes down alight. Not a certainty,
// so a Firenado run still has unburned buildings left to knock over.
export const FIRENADO_IGNITE_CHANCE = 0.6;
// ...and how close to the funnel it has to be for that to apply, as a
// multiple of the tornado's radius. Tuned down from 3 after measuring it: the
// radius slider tops out at 28, so a factor of 3 reached 84 units, which is
// most of the town rather than "inside the fire column" -- one Firenado had
// 32 of 36 buildings alight within six seconds.
export const FIRENADO_IGNITE_RADIUS_FACTOR = 1.6;
// How far a collapsing building reaches to pull a power line down with it.
// Poles stand 4.6 units off the street centre and buildings are 5-12 across,
// so this catches the pole outside a building that fronts the street without
// reaching the one outside its neighbour.
export const COLLAPSE_POLE_RADIUS = 14;

/**
 * ---------------------------------------------------------------------------
 * Debris impacts
 * ---------------------------------------------------------------------------
 * What happens when flying debris actually hits something (the finding of the
 * hit itself lives in engine/debrisImpacts.js, which owns the broad phase).
 * Impact energy is 0.5*m*v^2 in the simulation's own units, so a branch
 * brushing a wall is nothing and a tumbling tree trunk at full orbit speed is
 * a battering ram.
 */
// Thresholds are in the simulation's own energy units, and were set against
// what the debris pool actually produces rather than guessed. A piece ejected
// from the column leaves at up to `6 + windSpeed*0.05` plus a 4-8 outward kick
// (see the 'orbiting' -> 'falling' branch in physics.js), so ~30 units/sec at
// EF5, and kind masses run 0.15 (branch) to 7 (tree trunk). That puts a
// tumbling branch around 60, a thrown rock around 600, and a tree trunk at
// full pelt over 3000 -- so the ladder below reads as "a branch bounces off a
// wall, a rock holes it, a trunk takes half the building with it".
//
// Energy below which an impact is ignored outright, so nothing is spent on
// debris trickling along the ground.
export const IMPACT_MIN_ENERGY = 60;
// Energy that tears a piece off a building. Below it, a hit scuffs the facade
// (a burst, no structural loss); above it, a wall or roof panel goes, and a
// big enough hit takes two.
export const IMPACT_PIECE_ENERGY = 400;
export const IMPACT_DOUBLE_PIECE_ENERGY = 1500;
// Cars tip at much less than a building loses a wall -- they are not anchored.
export const IMPACT_CAR_ENERGY = 150;
// A standing tree resists roughly what a wall does.
export const IMPACT_TREE_ENERGY = 600;
// A person is killed by anything with real weight behind it, which is most of
// what the vortex throws.
export const IMPACT_PERSON_ENERGY = 90;
export const IMPACT_SCORE = 8;
