// @ts-check
/**
 * ===========================================================================
 * SECTION U.1 — Minimap: tornado path tracker (data only)
 * ===========================================================================
 * Records where the tornado has been, for minimap.js to draw as a fading
 * trail. Kept apart from the drawing so the history can be read by anything
 * else that wants it, and so the minimap can be hidden without losing it.
 *
 * Why not reuse groundFx.js's PathTrack: that one stores samples without
 * timestamps (the trail fades by age), only records while a sandbox run is
 * going (not while Chase Mode drives the storm before Start), and stops
 * growing at 600 samples (about 3.5 minutes), because it is a geometry
 * buffer. This is a small ring buffer instead: it only needs to hold the
 * last TRAIL_WINDOW seconds and simply overwrites the oldest sample.
 *
 * Time here is "storm time": it only advances while the vortex is actually
 * moving, so pausing freezes the trail's fade along with the tornado.
 *
 * One trail per tornado (engine/tornadoes.js), indexed like the tornadoes,
 * so an Outbreak's storms each leave their own. A tornado only adds to its
 * trail while it is active; a finished Outbreak's trails simply fade.
 */

// Seconds of history kept. The minimap fades segments out over this window.
export const TRAIL_WINDOW = 80;
const SAMPLE_INTERVAL = 0.25;
// Floats per sample: x, z, storm time, funnel radius.
const STRIDE = 4;
// A little more than TRAIL_WINDOW / SAMPLE_INTERVAL, so the oldest sample
// still inside the window is never the one being overwritten.
const CAPACITY = Math.ceil(TRAIL_WINDOW / SAMPLE_INTERVAL) + 16;

/**
 * @typedef {Object} TornadoTrail
 * @property {Float32Array} samples ring buffer, STRIDE floats per sample
 * @property {number} head index of the next slot to write
 * @property {number} count samples currently held (<= CAPACITY)
 * @property {number} capacity
 * @property {number} stride
 * @property {number} time storm time now, in seconds
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   Trail: TornadoTrail,
 *   Trails: TornadoTrail[],
 *   updateMinimapTracker: (dt: number) => void,
 *   resetMinimapTracker: () => void,
 *   isStormMoving: () => boolean
 * }}
 */
export function createMinimapTrackerSystem(ctx) {
  const { Sim } = ctx;

  /**
   * @returns {TornadoTrail}
   */
  function createTrail() {
    return {
      samples: new Float32Array(CAPACITY * STRIDE),
      head: 0,
      count: 0,
      capacity: CAPACITY,
      stride: STRIDE,
      time: 0
    };
  }

  /** @type {TornadoTrail[]} */
  const Trails = ctx.tornadoes.instances.map(createTrail);
  // The primary tornado's trail.
  const Trail = Trails[0];
  let sampleTimer = 0;

  /**
   * Whether the vortex is advancing this frame: during an unpaused run, or,
   * before Start, while Chase Mode or Possess mode is active (the storm is
   * either the opponent or the player's own funnel there, whether or not the
   * sandbox run has been started).
   * @returns {boolean}
   */
  function isStormMoving() {
    if (Sim.state.running) return !Sim.state.paused;
    return !!(ctx.Chase && ctx.Chase.active) || !!(ctx.Possess && ctx.Possess.active);
  }

  /**
   * @param {TornadoTrail} Trail
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function pushSample(Trail, x, z) {
    const o = Trail.head * STRIDE;
    Trail.samples[o] = x;
    Trail.samples[o + 1] = z;
    Trail.samples[o + 2] = Trail.time;
    Trail.samples[o + 3] = Sim.params.radius;
    Trail.head = (Trail.head + 1) % CAPACITY;
    Trail.count = Math.min(Trail.count + 1, CAPACITY);
  }

  /**
   * Per frame: advances storm time and samples every active tornado's
   * ground position at a fixed interval.
   * @param {number} dt
   * @returns {void}
   */
  function updateMinimapTracker(dt) {
    if (!isStormMoving()) return;
    for (const trail of Trails) trail.time += dt;
    sampleTimer -= dt;
    if (sampleTimer > 0) return;
    sampleTimer = SAMPLE_INTERVAL;
    ctx.tornadoes.instances.forEach(({ Vortex }, i) => {
      if (Vortex.active) pushSample(Trails[i], Vortex.center.x, Vortex.center.z);
    });
  }

  /**
   * Empties the history (from resetSim(), alongside the ground scar).
   * @returns {void}
   */
  function resetMinimapTracker() {
    for (const trail of Trails) {
      trail.head = 0;
      trail.count = 0;
      trail.time = 0;
    }
    sampleTimer = 0;
  }

  return { Trail, Trails, updateMinimapTracker, resetMinimapTracker, isStormMoving };
}
