// @ts-check
import { CAPS } from '../perf/caps.js';

/**
 * ===========================================================================
 * SECTION AM.2 — The mass mutation, in batches
 * ===========================================================================
 * The green EMP's ring crosses the whole map, and every person it passes is
 * turned into an alien (aliens.js mutate: the person's materials glowing,
 * a new alien built, a halo, a bolt). Done on the frame the ring reached
 * them, a crowd bunched on a muster point was dozens of those in one frame
 * -- a hitch just as the biggest explosion in the game is on screen.
 *
 * Now the ring only queues them, in the order it reached them, and at most
 * CAPS.batch are turned a frame (engine/perf/caps.js; 8, so a crowd of 160
 * takes a third of a second at 60 fps, far quicker than the ring's own
 * sweep). Someone in the air when it reached them waits until they land,
 * as before, and joins the queue then. The alien ceiling (aliens.js
 * ALIENS.mutantMax: past it the bolt only kills) is unchanged.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   add: (person: SimObject) => void,
 *   update: () => void,
 *   waiting: () => number,
 *   clear: () => void
 * }}
 */
export function createMutationQueue(ctx) {
  /** @type {SimObject[]} reached, to be turned, oldest first */
  let queue = [];
  /** @type {Set<SimObject>} everyone queued or waiting to land */
  const known = new Set();
  /** @type {Set<SimObject>} reached in the air: queued once down */
  const airborne = new Set();

  /**
   * @param {any} person a townsperson (the flags are people's, not every
   *   SimObject's)
   * @returns {boolean} whether they are out of reach now (killed, taken,
   *   electrocuted): nobody left to turn
   */
  function gone(person) {
    return !person.mesh || !person.mesh.parent || person.abducted || person.electrocuted;
  }

  /**
   * The ring reached this person.
   * @param {SimObject} person
   * @returns {void}
   */
  function add(person) {
    if (known.has(person)) return;
    known.add(person);
    if (person.captureState === 'grounded') queue.push(person);
    else airborne.add(person);
  }

  /**
   * Once a frame: those who have landed join the queue, and a batch of the
   * queue is turned.
   * @returns {void}
   */
  function update() {
    for (const person of airborne) {
      if (gone(person)) {
        airborne.delete(person);
        known.delete(person);
      } else if (person.captureState === 'grounded') {
        airborne.delete(person);
        queue.push(person);
      }
    }
    if (!queue.length) return;
    const aliens = ctx.systems.aliens;
    let turned = 0;
    let i = 0;
    for (; i < queue.length && turned < CAPS.batch; i++) {
      const person = queue[i];
      if (gone(person)) {
        known.delete(person);
        continue;
      }
      // Knocked off their feet since: wait for them to land again.
      if (person.captureState !== 'grounded' || !aliens || !aliens.mutate(person)) {
        airborne.add(person);
        continue;
      }
      known.delete(person);
      turned++;
    }
    queue = queue.slice(i);
  }

  /** @returns {number} people reached and not turned yet */
  function waiting() {
    return known.size;
  }

  /** @returns {void} */
  function clear() {
    queue = [];
    known.clear();
    airborne.clear();
  }

  return { add, update, waiting, clear };
}
