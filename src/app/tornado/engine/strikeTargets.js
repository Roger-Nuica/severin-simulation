// @ts-check
/**
 * ===========================================================================
 * SECTION L.1 — Lightning strike targets (registry)
 * ===========================================================================
 * The things lightning may deliberately aim at, kept out of lightning.js so
 * that module never needs to know what a person or a chase car is. Each kind
 * of target registers a provider here; lightning.js only asks the registry
 * for candidates and hands the struck one back to its provider.
 *
 * Two priorities:
 *  - 'primary' (people): the scripted opening strikes aim at these, and a
 *    random strike that happens to land close to one hits it too.
 *  - 'rare' (the chase car): only ever aimed at deliberately, after the
 *    scripted phase, and only on a small per-strike chance that the
 *    provider sets itself (typically higher when no primary target is in
 *    range of the storm). Never hit incidentally.
 */

/**
 * @typedef {Object} StrikeProvider
 * @property {string} name for debugging
 * @property {'primary'|'rare'} priority
 * @property {() => SimObject[]} candidates targets that may be struck right now
 * @property {number} strikeHeight world y the bolt ends at on a target
 * @property {(target: SimObject) => void} onStruck applies the hit (explosion, removal, game-over...)
 * @property {(primaryInRange: boolean) => number} [chance] 'rare' only: per-strike probability of being aimed at
 */

/**
 * @returns {{
 *   registerStrikeProvider: (provider: StrikeProvider) => () => void,
 *   providersByPriority: (priority: 'primary'|'rare') => StrikeProvider[]
 * }}
 */
export function createStrikeTargetsSystem() {
  /** @type {StrikeProvider[]} */
  const providers = [];

  /**
   * @param {StrikeProvider} provider
   * @returns {() => void} unregisters the provider
   */
  function registerStrikeProvider(provider) {
    providers.push(provider);
    return () => {
      const i = providers.indexOf(provider);
      if (i !== -1) providers.splice(i, 1);
    };
  }

  /**
   * @param {'primary'|'rare'} priority
   * @returns {StrikeProvider[]}
   */
  function providersByPriority(priority) {
    return providers.filter(p => p.priority === priority);
  }

  return { registerStrikeProvider, providersByPriority };
}
