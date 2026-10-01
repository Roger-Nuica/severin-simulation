// @ts-check
/**
 * ===========================================================================
 * SECTION PC — Entity caps and the particle budget
 * ===========================================================================
 * The ceilings every new effect and enemy works under, so that no one of
 * them can take the frame rate down (target: 60 fps, FINDINGS.md "Budget").
 *
 * Entities: how many enemies of all kinds may be alive at once
 * (engine/enemies.js counts them), and the kinds with their own ceiling
 * (Patient Zero's clones). A spawner asks canSpawn(kind) first.
 *
 * Particles: one budget shared by every particle pool that is tracked
 * (trackPool: the explosions, fires, weather, sparks...). A new effect asks
 * particleRoom() how many it may emit this frame and emits at most that.
 * What is in use is counted once a frame (a particle is in use while it is
 * drawn: alpha above zero), and shown by the performance overlay
 * (`?perf=1`).
 *
 * Mass effects on people (the nuclear mutation) go in batches of at most
 * CAPS.batch a frame.
 */

export const CAPS = {
  enemies: 160,           // every kind together
  perKind: { patientZeroClone: 50 },
  // Drawn at once, across every tracked pool. The busiest benchmark run
  // (`?bench=1`, heavy) peaks at about 6,800 with every existing effect, so
  // this leaves room for the new ones in the worst moment.
  particles: 10000,
  countEvery: 4,          // frames between two counts of what is in use
  batch: 8                // people changed by one mass effect per frame
};

/**
 * @param {Object} ctx
 * @returns {{
 *   trackPool: (pool: {colours: Float32Array, sizes: Float32Array}) => void,
 *   particlesInUse: () => number,
 *   particleRoom: () => number,
 *   canSpawn: (kind?: string) => boolean,
 *   initCaps: () => void,
 *   updateCaps: () => void
 * }}
 */
export function createCapsSystem(ctx) {
  /** @type {{colours: Float32Array, sizes: Float32Array}[]} */
  const pools = [];
  let inUse = 0;
  let frame = 0;

  /**
   * @param {{colours: Float32Array, sizes: Float32Array}} pool a particle pool (engine/particlePool.js)
   * @returns {void}
   */
  function trackPool(pool) {
    if (!pools.some(p => p.colours === pool.colours)) pools.push(pool);
  }

  /** @returns {number} particles drawn last frame, across the tracked pools */
  function particlesInUse() {
    return inUse;
  }

  /** @returns {number} how many more may be emitted this frame */
  function particleRoom() {
    return Math.max(0, CAPS.particles - inUse);
  }

  /**
   * @param {string} [kind] an enemy kind with its own ceiling
   * @returns {boolean} whether one more enemy (of that kind) may be made
   */
  function canSpawn(kind) {
    const enemies = ctx.systems.enemies;
    if (!enemies) return true;
    if (enemies.count() >= CAPS.enemies) return false;
    const own = kind ? CAPS.perKind[/** @type {keyof typeof CAPS.perKind} */ (kind)] : undefined;
    return own === undefined || enemies.count(kind) < own;
  }

  /**
   * Every particle pool already in the scene tracked: they are all made at
   * start-up, and this runs after every other init (registered with auto,
   * engine/lifecycle.js). A pool made later is tracked by its maker.
   * @returns {void}
   */
  function initCaps() {
    ctx.Sim.three.scene.traverse((/** @type {any} */ o) => {
      const attrs = o.isPoints && o.geometry && o.geometry.attributes;
      if (attrs && attrs.aColour && attrs.aSize) trackPool({ colours: attrs.aColour.array, sizes: attrs.aSize.array });
    });
  }

  /**
   * Once a frame (counting every CAPS.countEvery-th: near enough for a
   * budget): the particles in use counted.
   * @returns {void}
   */
  function updateCaps() {
    if (frame++ % CAPS.countEvery !== 0) return;
    let n = 0;
    for (const pool of pools) {
      const { colours, sizes } = pool;
      for (let i = 0; i < sizes.length; i++) if (colours[i * 4 + 3] > 0.004 && sizes[i] > 0) n++;
    }
    inUse = n;
  }

  return { trackPool, particlesInUse, particleRoom, canSpawn, initCaps, updateCaps };
}
