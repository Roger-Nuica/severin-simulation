// @ts-check
/**
 * ===========================================================================
 * SECTION C.2 — The hunt
 * ===========================================================================
 * For the first HUNT_DELAY seconds of a run the storm behaves as it always
 * has: it crosses the town on its own wander path and takes whatever happens
 * to be in the way. After that it stops being weather and starts being a
 * predator -- each active funnel picks a survivor at random and steers for
 * them, picking another the moment that one is gone, until the streets are
 * empty.
 *
 * Deliberately a *steering* layer and nothing else. It writes one field,
 * Vortex.huntTarget, which vortex.js's wander block uses in place of its
 * Lissajous target point; everything downstream -- the capped ground speed,
 * the inertia, the surge, Chase Mode's wanderSpeedMul -- is untouched. So a
 * hunting tornado moves exactly like a wandering one, it just has somewhere
 * it means to go, and it can still be outrun.
 *
 * Targets are chosen at random rather than nearest-first on purpose: nearest
 * would have the funnel mow along a queue in a predictable line, while a
 * random pick sends it lunging across town and gives the people it passes a
 * chance. Each funnel in an Outbreak hunts its own target, and two never take
 * the same one while a choice exists.
 */

// Seconds of running before the hunt begins. Long enough that the opening of
// a run is still the storm arriving on its own terms.
const HUNT_DELAY = 30;
// How close the funnel has to get before that target counts as dealt with and
// it picks another. Comfortably inside the capture radius, so in practice the
// vortex has taken them well before this trips; it exists so a target standing
// somewhere the funnel cannot quite reach is not chased forever.
const REACHED_DISTANCE = 6;
// Seconds before a funnel that has been chasing the same person without
// getting them gives up and picks someone else.
const TARGET_TIMEOUT = 14;

/**
 * @param {Object} ctx
 * @returns {{
 *   Hunt: Object,
 *   updateHunt: (dt: number) => void,
 *   resetHunt: () => void
 * }}
 */
export function createHuntSystem(ctx) {
  const { Sim } = ctx;

  const Hunt = {
    active: false,
    /** @type {Map<Object, {person: Object, timer: number}>} keyed by Vortex */
    targets: new Map()
  };
  ctx.Hunt = Hunt;

  /**
   * Whether a person is still worth chasing: on their feet, in the scene, and
   * not already in the vortex's grip or inside a shelter.
   * @param {Object} person
   * @returns {boolean}
   */
  function huntable(person) {
    return !!person
      && !!person.mesh
      && !!person.mesh.parent
      && person.captureState === 'grounded';
  }

  /**
   * Picks a survivor for one funnel, avoiding anyone another funnel is
   * already after while there is anyone else to take.
   * @param {Object} vortex
   * @returns {Object|null}
   */
  function pickTarget(vortex) {
    const taken = new Set();
    for (const [other, entry] of Hunt.targets) {
      if (other !== vortex && entry.person) taken.add(entry.person);
    }
    const people = ctx.Environment.people;
    const free = people.filter(p => huntable(p) && !taken.has(p));
    // Everyone left is already spoken for: share rather than stop hunting.
    const pool = free.length ? free : people.filter(huntable);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Per frame while the storm is running.
   * @param {number} dt
   * @returns {void}
   */
  function updateHunt(dt) {
    if (!ctx.Environment) return;
    // A player flying the tornado (engine/possess.js) is doing the hunting
    // themselves; Vortex.controlTarget already outranks huntTarget in
    // vortex.js's wander block regardless, but leaving this system running
    // underneath would still overwrite huntTarget on every active funnel for
    // no purpose the player can see.
    if (ctx.Possess && ctx.Possess.active) return;

    if (!Hunt.active) {
      if (Sim.state.elapsed < HUNT_DELAY) return;
      Hunt.active = true;
    }

    for (const tornado of ctx.tornadoes.active) {
      const vortex = tornado.Vortex;
      let entry = Hunt.targets.get(vortex);

      if (entry) {
        entry.timer += dt;
        const person = entry.person;
        const reached = huntable(person)
          && Math.hypot(person.mesh.position.x - vortex.center.x,
            person.mesh.position.z - vortex.center.z) < REACHED_DISTANCE;
        if (!huntable(person) || reached || entry.timer > TARGET_TIMEOUT) entry = null;
      }

      if (!entry) {
        const person = pickTarget(vortex);
        if (!person) {
          // Nobody left: back to wandering over the wreckage.
          vortex.huntTarget = null;
          Hunt.targets.delete(vortex);
          continue;
        }
        entry = { person, timer: 0 };
        Hunt.targets.set(vortex, entry);
      }

      const p = entry.person.mesh.position;
      // Written rather than replaced, so vortex.js reads a stable object and
      // this allocates nothing per frame.
      if (!vortex.huntTarget) vortex.huntTarget = { x: p.x, z: p.z };
      else { vortex.huntTarget.x = p.x; vortex.huntTarget.z = p.z; }
    }
  }

  /** @returns {void} */
  function resetHunt() {
    Hunt.active = false;
    for (const vortex of Hunt.targets.keys()) vortex.huntTarget = null;
    Hunt.targets.clear();
    for (const tornado of ctx.tornadoes.instances) tornado.Vortex.huntTarget = null;
  }

  return { Hunt, updateHunt, resetHunt };
}
