// @ts-check
/**
 * ===========================================================================
 * SECTION LC — The systems' lifecycle registry
 * ===========================================================================
 * Every system is registered here (register), which also puts it on
 * ctx.systems. The registry finds its lifecycle functions by name:
 *   init    initX / generateX     at bootstrap
 *   reset   resetX / clearX       on Reset (resetSim)
 *   dispose disposeX              on unmount (dispose)
 *
 * The three phases are still run by tornadoEngine.js in the order written
 * there, because order matters for many of them (a building has to exist
 * before its fire, the town before the train that runs through it) and the
 * reasons are documented where the calls are. The registry adds two things
 * on top of that:
 *
 * 1. A new system only has to be registered with `{ auto: true }`. Its
 *    init, reset and dispose then run at the end of each phase
 *    (endPhase), after everything ordered by hand, in registration order.
 *    Two places in all (construct and register, and its update in the
 *    frame) instead of five.
 * 2. The audit. At the end of each phase it names any lifecycle function of
 *    any system that did not run during that phase. That is the classic
 *    Reset bug: a new system whose reset nobody calls leaves the last run's
 *    remains in the next. The audit only warns, in development only, and a
 *    function that must not run in that phase is listed in `skip` when the
 *    system is registered. (It found speechBubbles.clearSpeechBubbles
 *    documented as "on reset" but never called.)
 *
 * The lifecycle functions are wrapped where they sit on the system object,
 * so the engine must take them from the object after register(), which
 * tornadoEngine.js does.
 */

const PHASES = {
  init: /^(init|generate)[A-Z]/,
  reset: /^(reset|clear)[A-Z]/,
  dispose: /^dispose[A-Z]/
};

/**
 * @param {Object} ctx
 * @returns {{
 *   register: (name: string, system: Object, options?: {auto?: boolean, skip?: string[]}) => Object,
 *   beginPhase: (phase: 'init'|'reset'|'dispose') => void,
 *   endPhase: (phase: 'init'|'reset'|'dispose') => void
 * }}
 */
export function createLifecycle(ctx) {
  /**
   * @typedef {Object} Entry
   * @property {string} name
   * @property {Object} system
   * @property {boolean} auto
   * @property {Set<string>} skip
   * @property {{init: string[], reset: string[], dispose: string[]}} fns
   * @property {Set<string>} called this phase
   */
  /** @type {Entry[]} */
  const entries = [];
  const audit = process.env.NODE_ENV === 'development';
  /** @type {Set<string>} warned about already, so each is said once */
  const warned = new Set();

  /**
   * Registers a system: on ctx.systems, and its lifecycle functions wrapped
   * so the registry sees them run.
   * @param {string} name its key on ctx.systems
   * @param {Object} system
   * @param {{auto?: boolean, skip?: string[]}} [options] auto: its lifecycle
   *   is run by the registry (endPhase); skip: lifecycle-named functions
   *   that are not meant to run in their phase (not audited)
   * @returns {Object} the system
   */
  function register(name, system, options = {}) {
    ctx.systems[name] = system;
    /** @type {Entry} */
    const entry = {
      name, system,
      auto: !!options.auto,
      skip: new Set(options.skip || []),
      fns: { init: [], reset: [], dispose: [] },
      called: new Set()
    };
    for (const key of Object.keys(system)) {
      const fn = system[key];
      if (typeof fn !== 'function') continue;
      for (const phase of /** @type {('init'|'reset'|'dispose')[]} */ (Object.keys(PHASES))) {
        if (!PHASES[phase].test(key)) continue;
        entry.fns[phase].push(key);
        system[key] = function lifecycleStep(...args) {
          entry.called.add(key);
          return fn.apply(this, args);
        };
      }
    }
    entries.push(entry);
    return system;
  }

  /**
   * @param {'init'|'reset'|'dispose'} phase
   * @returns {void}
   */
  function beginPhase(phase) {
    for (const entry of entries) for (const key of entry.fns[phase]) entry.called.delete(key);
  }

  /**
   * Runs the auto systems' functions for the phase that have not run, then
   * audits the rest (see the header).
   * @param {'init'|'reset'|'dispose'} phase
   * @returns {void}
   */
  function endPhase(phase) {
    const list = phase === 'dispose' ? entries.slice().reverse() : entries;
    for (const entry of list) {
      if (!entry.auto) continue;
      for (const key of entry.fns[phase]) if (!entry.called.has(key) && !entry.skip.has(key)) entry.system[key]();
    }
    if (!audit) return;
    for (const entry of entries) {
      for (const key of entry.fns[phase]) {
        if (entry.called.has(key) || entry.skip.has(key)) continue;
        const id = `${phase}:${entry.name}.${key}`;
        if (warned.has(id)) continue;
        warned.add(id);
        console.warn(`[lifecycle] ${entry.name}.${key} did not run during ${phase} (engine/lifecycle.js)`);
      }
    }
  }

  return { register, beginPhase, endPhase };
}
