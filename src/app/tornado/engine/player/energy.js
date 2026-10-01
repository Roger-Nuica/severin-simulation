// @ts-check
/**
 * ===========================================================================
 * SECTION PE — Energy
 * ===========================================================================
 * The hero's energy for the new abilities (engine/player/abilities.js):
 * Time Slow, Teleport, EMP, and the Black Hole Gun's shot. It is a bar of ENERGY.segments
 * segments of 10% each, and an ability costs whole segments. The plasma
 * rifle's own charge, the minigun and the railgun do not use it.
 *
 * It is filled by what the hero goes through -- explosions, a nuclear plant
 * (PR 1b) -- through charge(); nothing refills it by itself. Every charge
 * can name its source, and a source that has already given its share cannot
 * give more (ENERGY.perSourceCap), so an explosion cannot be farmed.
 *
 * Explosions: every real one in town (a tanker, the chemical works' barrels,
 * tanks and blast, a gas main, a fuel station, a car going up after one)
 * emits 'explosion' {x, z, size, source} (engine/events.js), size on 0..1
 * from BLAST_SIZE. Roger standing within ABSORB reach of it takes energy in
 * proportion to its size, less the further out he is:
 *     charge = size x ABSORB.full x (1 - distance / reach),
 *     reach  = ABSORB.reach + ABSORB.reachPerSize x size.
 * Each explosion is its own source, so standing in the same fire does not
 * give twice; his own shots (plasma, railgun) are not explosions of this
 * kind and give nothing, so he cannot feed himself.
 *
 * One bar per player (for co-op later: createEnergy is per player; the
 * system holds the hero's).
 */

export const ENERGY = {
  segments: 10,
  // Where a run starts, as a fraction of the bar (to be calibrated once
  // there are ways to fill it).
  start: 0.5,
  // The most one source (an explosion, a plant) can give, as a fraction:
  // even the tanker, point blank, fills half the bar.
  perSourceCap: 0.5
};

// Taking energy from explosions.
export const ABSORB = {
  full: 0.5,          // fraction of the bar from a size-1 blast, point blank
  reach: 10,          // metres, for the smallest blast...
  reachPerSize: 50,   // ...plus this much per unit of size (tanker: 60 m)
  noticeGap: 0.8,     // seconds between two "+x% ENERGY" lines (a barrel
                      // chain is dozens of charges in a few seconds)
  flashSeconds: 0.6   // the HUD bar glows this long after a charge
};

/**
 * How big each explosion is for the energy, on 0..1: the tanker and the
 * chemical works' blast are the largest there are. Emitters pass one of
 * these as the 'explosion' event's size.
 */
export const BLAST_SIZE = {
  tanker: 1,
  factory: 1,
  factoryTank: 0.45,
  barrel: 0.06,
  station: 0.75,
  car: 0.12,
  gasMain: 0.5,
  manhole: 0.1,
  trex: 0.6,
  yeti: 0.35
};

/**
 * One energy bar.
 * @returns {{
 *   level: () => number,
 *   segments: () => number,
 *   canSpend: (segments: number) => boolean,
 *   spend: (segments: number) => boolean,
 *   charge: (amount: number, source?: any) => number,
 *   set: (level: number) => void
 * }}
 */
export function createEnergy() {
  let value = ENERGY.start;
  /** @type {WeakMap<object, number>} what each source object has given */
  const given = new WeakMap();
  /** @type {Map<string, number>} the same, for sources named by a string */
  const givenByName = new Map();

  /** @returns {number} 0..1 */
  function level() {
    return value;
  }

  /** @returns {number} whole segments filled */
  function segments() {
    return Math.floor(value * ENERGY.segments + 1e-6);
  }

  /**
   * @param {number} n segments
   * @returns {boolean}
   */
  function canSpend(n) {
    return segments() >= n;
  }

  /**
   * @param {number} n segments
   * @returns {boolean} whether it was there to spend (and now is not)
   */
  function spend(n) {
    if (!canSpend(n)) return false;
    value = Math.max(0, value - n / ENERGY.segments);
    return true;
  }

  /**
   * @param {number} amount fraction of the bar
   * @param {any} [source] the thing it came from; each gives at most
   *   ENERGY.perSourceCap in all
   * @returns {number} what was actually added
   */
  function charge(amount, source) {
    let room = 1 - value;
    if (source !== undefined && source !== null) {
      const byObject = typeof source === 'object' || typeof source === 'function';
      const already = byObject ? (given.get(source) || 0) : (givenByName.get(String(source)) || 0);
      room = Math.min(room, ENERGY.perSourceCap - already);
      const add = Math.max(0, Math.min(amount, room));
      if (byObject) given.set(source, already + add);
      else givenByName.set(String(source), already + add);
      value += add;
      return add;
    }
    const add = Math.max(0, Math.min(amount, room));
    value += add;
    return add;
  }

  /**
   * @param {number} level 0..1
   * @returns {void}
   */
  function set(level) {
    value = Math.max(0, Math.min(1, level));
  }

  return { level, segments, canSpend, spend, charge, set };
}

/**
 * @param {Object} ctx
 * @returns {{
 *   hero: ReturnType<typeof createEnergy>,
 *   flashing: () => boolean,
 *   glow: () => void,
 *   absorb: (payload: {x: number, z: number, size: number, source?: any}) => number,
 *   initEnergy: () => void,
 *   resetEnergy: () => void
 * }}
 */
export function createEnergySystem(ctx) {
  let flashUntil = -Infinity;
  let noticeAt = -Infinity;
  let unshown = 0;

  /**
   * An explosion near Roger: his share of it, if he is in reach.
   * @param {{x: number, z: number, size: number, source?: any}} payload
   * @returns {number} what the bar took
   */
  function absorb({ x, z, size, source }) {
    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    if (!roger || !(size > 0)) return 0;
    const reach = ABSORB.reach + ABSORB.reachPerSize * size;
    const d = Math.hypot(roger.x - x, roger.z - z);
    if (d >= reach) return 0;
    const got = system.hero.charge(size * ABSORB.full * (1 - d / reach), source);
    if (got <= 0) return 0;
    const now = ctx.now();
    flashUntil = now + ABSORB.flashSeconds;
    unshown += got;
    if (now - noticeAt >= ABSORB.noticeGap && unshown >= 0.005) {
      ctx.events.emit('notice', { text: `⚡ +${Math.max(1, Math.round(unshown * 100))}% ENERGY` });
      noticeAt = now;
      unshown = 0;
    }
    return got;
  }

  const system = {
    hero: createEnergy(),
    /** @returns {boolean} whether the bar has just taken a charge (the HUD glows) */
    flashing: () => ctx.now() < flashUntil,
    /** @returns {void} the HUD bar glows, as after a charge (a plant's terminal) */
    glow: () => { flashUntil = ctx.now() + ABSORB.flashSeconds; },
    absorb,
    /** @returns {void} listening for explosions */
    initEnergy() {
      ctx.events.on('explosion', (/** @type {any} */ payload) => { absorb(payload); });
    },
    /** @returns {void} a fresh bar (and fresh sources) for a new run */
    resetEnergy() {
      system.hero = createEnergy();
      flashUntil = noticeAt = -Infinity;
      unshown = 0;
    }
  };
  return system;
}
