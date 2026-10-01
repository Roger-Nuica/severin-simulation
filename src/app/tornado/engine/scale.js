// @ts-check

/**
 * ===========================================================================
 * SECTION SC — The scale of everything
 * ===========================================================================
 * One world unit is one metre, and this file is the one place every size in
 * the game is decided. Until now each system picked its own: the people
 * were drawn at 3.04x (5.5 m tall, for visibility), so everything built at
 * life size beside them -- bicycles, houses, Hank Granite -- looked like
 * toys, and everything built to match them (the chase car at 3x, Roger's
 * 22 m/s run) was out of proportion with the town. See docs/SCALE.md for
 * the whole table: each element, what it measured, its real size, and the
 * size chosen here with the reason.
 *
 * The rule, so the next size is predictable rather than argued again:
 *   1. Start from the real thing, in metres (a person 1.8 m, a storey 3.2 m,
 *      a car 4.5 m).
 *   2. Only depart from it for a stated game reason (readability from the
 *      default camera, a character meant to tower), and then by a factor
 *      written next to it here, not by a number buried in a system.
 *   3. Anything sized "against a person" (a speech bubble's height, a
 *      collision width, a camera distance) is derived from PERSON.height,
 *      never typed in.
 *
 * Systems read these numbers; they do not keep copies. A change here moves
 * the thing everywhere it is drawn, collided with or aimed at.
 */

/** A person, the yardstick for everything else. */
export const PERSON = {
  // A real adult is 1.6-1.9 m; 1.8 m reads clearly from the street camera
  // without the bystanders looking like giants next to the houses.
  height: 1.8,
  width: 0.5,             // shoulders
  walk: 1.4,              // m/s, real walking pace
  run: 5.5                // m/s, a frightened sprint
};

/** One storey of a building, floor to floor. */
export const STOREY = 3.2;

/**
 * The town's buildings. Footprints are limited by the street grid (spots
 * 22 m apart, environment/index.js); height is in storeys plus a roof.
 */
export const BUILDINGS = {
  // A detached house: 8-11 m wide, one or two storeys plus a gabled roof.
  house: { width: [8, 10.5], depth: [7.5, 9.5], storeys: [1, 2] },
  // A townhouse: three to four storeys under a hipped roof.
  townhouse: { width: [8, 11], depth: [8, 10.5], storeys: [3, 4] },
  // A block of flats: six to nine storeys (19-29 m).
  apartment: { width: [9.5, 11.5], depth: [9, 10.5], storeys: [6, 9] },
  // A shop: one tall storey, a wide frontage.
  shop: { width: [11, 13], depth: [8, 10], storeys: [1, 1], storeyHeight: 4.5 },
  // A low parapet over the top storey.
  parapet: 0.5,
  // Windows: a real pane, one row per storey, a bay every so many metres.
  window: { width: 1.1, height: 1.4, bay: 2.6, sill: 0.9 }
};

/** Vehicles, at their real sizes. */
export const VEHICLES = {
  car: { length: 4.5, width: 1.8, height: 1.45 },
  // The chase car is a car; it used to be drawn 3x to stand next to a
  // 5.5 m Roger.
  chaseCarScale: 1,
  bicycle: { length: 1.75, wheel: 0.68 },
  tanker: { length: 16, width: 2.5, height: 3.8 },
  bus: { length: 12, width: 2.55, height: 3.2 }
};

/** Characters, by their own stated sizes. */
export const CHARACTERS = {
  roger: { height: 1.85 },                 // a person, a little taller
  hank: { height: 2.2 },                   // larger than life, but a man
  terminator: { height: 2.1 },             // a head over the crowd
  alien: { height: 1.4 },                  // the classic small grey
  smoothDancer: { height: 1.9 },
  patientZero: { height: 2.3 },            // "a head taller than anyone"
  cow: { length: 2.4, height: 1.5 },
  shark: { length: 4.5 },
  // The two giants, on request: "towering over houses, comparable to
  // mid-size buildings" -- a house is 6-10 m to the ridge, a townhouse
  // 10-13 m, a block 19-29 m. Both in the same class, at least 3x what
  // they were (3.5 m and 6 m). Everything that goes with their size --
  // hitbox, reach, speed, the flame and the ice cone, the footfall shake --
  // is derived from these heights (GIANT below).
  // 30% smaller than the 15 m it was, on request (2026-10-01): 10.5 m,
  // still 3x the 3.5 m Yeti. The T-Rex stays as it is.
  yeti: { height: 10.5 },                  // 3x the 3.5 m Yeti
  trex: { height: 18, length: 39 },        // 3x a real T. rex
  spotless: { height: 30 }                 // a giant of light: over the tallest block
};

/**
 * How a giant's numbers follow its height. Reach, ranges and hitboxes grow
 * with the height itself; walking speed with its square root (a big animal's
 * stride is longer, not quicker: the Froude rule), so a 3x giant walks
 * about 1.7x as fast and does not feel slow, yet Roger (9 m/s) can still run.
 */
export const GIANT = {
  /**
   * @param {number} height now
   * @param {number} was the height a number was tuned at
   * @returns {{size: number, pace: number}} size: the height ratio; pace: its square root
   */
  ratio(height, was) {
    const size = height / was;
    return { size, pace: Math.sqrt(size) };
  }
};

/** The storm and the disasters, against a town of 6-30 m buildings. */
export const STORM = {
  // Funnel radius (the "Tornado Radius" slider's default and range): a
  // strong tornado is 50-500 m across; 60 m is wide enough to take a block
  // at a time in a town ~180 m across, the slider reaching a 100 m wedge.
  radius: { default: 30, min: 10, max: 50 },
  // Meteors: 20-28 m rocks leaving 30-44 m craters -- already town-scale.
  meteorRadius: [9.6, 13.8],
  // A cone that stands well over the 29 m blocks: 50 m high, 90 m across.
  volcano: { height: 50, baseRadius: 45 },
  dam: { height: 34 }
};
