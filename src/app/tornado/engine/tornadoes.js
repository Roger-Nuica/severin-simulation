// @ts-check
/**
 * ===========================================================================
 * SECTION C.0 — Tornado registry (Outbreak mode)
 * ===========================================================================
 * The simulator can run more than one tornado at once (the Outbreak
 * preset). Each tornado is a full, independent instance of the vortex
 * system (engine/vortex.js createVortexSystem) with its own funnel,
 * particles, sub-vortices, wander path and ground effects (groundFx.js).
 * They are all built at start-up; the extra ones simply sit hidden and
 * inactive until an Outbreak switches them on, so starting or ending one
 * allocates nothing and never changes the scene's light or material set.
 *
 * Instance 0 is the primary tornado: it is ctx.Vortex, and it is always
 * active. Systems that only ever make sense for one storm (the cinematic
 * camera, Chase Mode, the Firenado, the rain's funnel cut-out) keep using
 * ctx.Vortex. Systems that deal with "the tornado near this point" -- the
 * force field, capture physics, damage, fleeing people -- ask the registry
 * for the nearest active one.
 *
 * Two active tornadoes that drift close enough can merge (Fujiwhara,
 * engine/fujiwhara.js). The one absorbed is retired through retire(), the
 * same switch-off path setCount uses, so a merged Outbreak can have a gap in
 * the active set (e.g. instances 0 and 2); the next setCount (a preset
 * change, or resetSim) puts it back to "the first n".
 */

/**
 * @typedef {Object} TornadoInstance
 * @property {Object} Vortex the instance's state (see vortex.js)
 * @property {(dt: number, t: number) => void} updateVortexVisuals
 * @property {(pos: import('three').Vector3, velocity: import('three').Vector3, dt: number) => void} applySubVortexForce
 * @property {(end: import('three').Vector3, power: number) => void} onLightningStrike
 * @property {(on: boolean, others: Object[]) => void} setActive
 * @property {() => void} clearMergeState
 * @property {Object} groundFx the instance's groundFx system
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   instances: TornadoInstance[],
 *   active: TornadoInstance[],
 *   activeVortices: Object[],
 *   register: (instance: TornadoInstance) => void,
 *   nearest: (x: number, z: number) => Object,
 *   setCount: (n: number) => void,
 *   retire: (instance: TornadoInstance) => void,
 *   spawnExtra: () => boolean,
 *   count: () => number
 * }}
 */
export function createTornadoRegistry(ctx) {
  /** @type {TornadoInstance[]} */
  const instances = [];
  // Rebuilt in place whenever the active set changes, so the per-object,
  // per-frame lookups (nearest) never allocate.
  /** @type {TornadoInstance[]} */
  const active = [];
  /** @type {Object[]} */
  const activeVortices = [];

  /** @returns {void} */
  function rebuildActive() {
    active.length = 0;
    activeVortices.length = 0;
    for (const inst of instances) {
      if (!inst.Vortex.active) continue;
      active.push(inst);
      activeVortices.push(inst.Vortex);
    }
  }

  /**
   * @param {TornadoInstance} instance
   * @returns {void}
   */
  function register(instance) {
    instances.push(instance);
    rebuildActive();
  }

  /**
   * The active tornado whose ground position is nearest (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {Object} its Vortex state
   */
  function nearest(x, z) {
    let best = activeVortices[0];
    if (activeVortices.length === 1) return best;
    let bestD = Infinity;
    for (const v of activeVortices) {
      const dx = x - v.center.x;
      const dz = z - v.center.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  /**
   * Switches tornadoes on or off so that the first n are active. The
   * primary (index 0) always stays on.
   * @param {number} n
   * @returns {void}
   */
  function setCount(n) {
    const want = Math.max(1, Math.min(n, instances.length));
    for (let i = 1; i < instances.length; i++) {
      const on = i < want;
      if (instances[i].Vortex.active === on) continue;
      // Placed apart from the ones already running.
      instances[i].setActive(on, activeVortices);
      if (on) instances[i].groundFx.resetPathTrack();
      rebuildActive();
    }
  }

  /**
   * Switches one tornado off, whichever it is, for a Fujiwhara merge. The
   * primary is never retired: it is always the survivor of any merge it is
   * part of.
   * @param {TornadoInstance} instance
   * @returns {void}
   */
  function retire(instance) {
    if (instance.Vortex.index === 0 || !instance.Vortex.active) return;
    instance.setActive(false, activeVortices);
    rebuildActive();
  }

  /**
   * Switches on one more tornado, the first one not already running --
   * whichever that is, since a merge can leave a gap in the active set.
   * Placed apart from the ones in play, and grown from the cloud like any
   * funnel added mid-run.
   * @returns {boolean} false if every tornado is already in play
   */
  function spawnExtra() {
    for (let i = 1; i < instances.length; i++) {
      if (instances[i].Vortex.active) continue;
      instances[i].setActive(true, activeVortices);
      instances[i].groundFx.resetPathTrack();
      rebuildActive();
      return true;
    }
    return false;
  }

  /** @returns {number} */
  function count() {
    return active.length;
  }

  const registry = { instances, active, activeVortices, register, nearest, setCount, retire, spawnExtra, count };
  ctx.tornadoes = registry;
  return registry;
}
