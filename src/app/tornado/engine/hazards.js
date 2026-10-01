// @ts-check
/**
 * ===========================================================================
 * SECTION X — Ground hazards (registry)
 * ===========================================================================
 * Places on the ground that a person should not be standing in, kept out of
 * the crowd AI so peopleMotion.js never needs to know what a viaduct is.
 *
 * The tornado is not one of these: everyone can see a tornado, it is handled
 * by its own distance check in peopleMotion, and it is the thing every other
 * behaviour is measured against. A hazard here is the opposite -- a *local*
 * danger that only makes sense to whatever created it. The first is the
 * shadow under a viaduct span that has started to sag: it is about to be on
 * top of anyone underneath, it is the only warning they get, and once the
 * span has fallen it is not a hazard any more, it is rubble.
 *
 * Deliberately a plain list rather than a spatial index. There are single
 * digits of these at once and they are queried once per person per frame; a
 * grid would cost more to maintain than the scan saves.
 */

/**
 * @typedef {Object} Hazard
 * @property {number} x
 * @property {number} z
 * @property {number} radius how far out people should clear, along x
 * @property {number} [radiusZ] the same along z, for a hazard that is longer
 *   than it is wide -- a viaduct span's shadow is a 37-by-9 rectangle, and
 *   the circle that covers it is four times too wide
 * @property {string} kind for debugging, and so a consumer can tell them apart
 */

/**
 * @returns {{
 *   addHazard: (hazard: Hazard) => Hazard,
 *   removeHazard: (hazard: Hazard) => void,
 *   clearHazards: () => void,
 *   threatAt: (x: number, z: number) => Hazard|null,
 *   hazards: Hazard[]
 * }}
 */
export function createHazardsSystem() {
  /** @type {Hazard[]} */
  const hazards = [];

  /**
   * @param {Hazard} hazard the caller keeps the object and may move it
   * @returns {Hazard} the same object, for the caller to hold on to
   */
  function addHazard(hazard) {
    hazards.push(hazard);
    return hazard;
  }

  /**
   * @param {Hazard} hazard
   * @returns {void}
   */
  function removeHazard(hazard) {
    const i = hazards.indexOf(hazard);
    if (i !== -1) hazards.splice(i, 1);
  }

  /** @returns {void} */
  function clearHazards() {
    hazards.length = 0;
  }

  /**
   * The hazard a point is standing in, nearest first when it is in more than
   * one.
   * @param {number} x
   * @param {number} z
   * @returns {Hazard|null}
   */
  function threatAt(x, z) {
    /** @type {Hazard|null} */
    let best = null;
    // Compared as a fraction of each hazard's own extent, so "nearest" means
    // "deepest inside" rather than "fewest world units from the centre" --
    // which is what you want when they are different shapes.
    let bestD = 1;
    for (const hazard of hazards) {
      const d = Math.hypot(
        (x - hazard.x) / hazard.radius,
        (z - hazard.z) / (hazard.radiusZ || hazard.radius)
      );
      if (d >= bestD) continue;
      bestD = d;
      best = hazard;
    }
    return best;
  }

  return { addHazard, removeHazard, clearHazards, threatAt, hazards };
}
