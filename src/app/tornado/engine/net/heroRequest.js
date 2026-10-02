// @ts-check
/**
 * ===========================================================================
 * SECTION NH — Hero requests and the pointer-lock guard (pure rules)
 * ===========================================================================
 * Two small, DOM-free rules kept off the net system so they can be tested.
 *
 *  - Hero request: a guest sends `hero: true` for a short while after pressing
 *    its Hero button. The host acts once, on the rising edge, so a held or
 *    repeated flag never restarts anything.
 *  - Pointer-lock guard: browsers refuse a new lock for a moment after the
 *    player leaves one (Esc), throwing "cannot be acquired immediately after
 *    the user has exited the lock". The guard says when a request is safe.
 */

/** How long, in milliseconds, a new pointer lock is held back after an exit. */
export const LOCK_COOLDOWN_MS = 1500;
/** How long, in seconds, the peer keeps sending `hero: true` after a press. */
export const HERO_FLAG_SECONDS = 0.5;

/**
 * Per-player rising-edge detector for the `hero` request level.
 * @returns {{
 *   edge: (id: string, level: boolean) => boolean,
 *   forget: (id: string) => void,
 *   clear: () => void
 * }}
 */
export function createHeroRequests() {
  /** @type {Map<string, boolean>} */
  const last = new Map();
  return {
    /**
     * @param {string} id Player id.
     * @param {boolean} level The `hero` flag of the latest accepted input.
     * @returns {boolean} True only on the false-to-true transition.
     */
    edge(id, level) {
      const was = last.get(id) === true;
      last.set(id, level);
      return level && !was;
    },
    /** @param {string} id */
    forget(id) { last.delete(id); },
    clear() { last.clear(); }
  };
}

/**
 * What the host does with a guest's Hero request.
 * @param {boolean} hostInHero Whether the host's Hero Mode is running.
 * @returns {{action: 'join'|'wait', text: string}} `join`: the guest is (or
 *   now is) in the run; `wait`: nothing to join yet.
 */
export function heroRequestOutcome(hostInHero) {
  return hostInHero
    ? { action: 'join', text: 'You are in Hero Mode with the host.' }
    : { action: 'wait', text: 'Waiting for the host to start Hero Mode.' };
}

/**
 * Whether a pointer lock may be requested now.
 * @param {number} now Current time, ms.
 * @param {number} exitedAt When the last lock ended, ms (0 when never).
 * @returns {boolean}
 */
export function mayRequestLock(now, exitedAt) {
  return exitedAt <= 0 || now - exitedAt >= LOCK_COOLDOWN_MS;
}
