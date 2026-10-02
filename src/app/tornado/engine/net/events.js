// @ts-check
/**
 * ===========================================================================
 * SECTION NE — Major-event sequencing and de-duplication
 * ===========================================================================
 * The host numbers every replicated event; peers apply each id at most once,
 * whatever order or repetition the network delivers. Cosmetic destruction is
 * never replicated, so nothing here carries debris or particles.
 */
import { PROTOCOL_VERSION, LIMITS, validateEvent } from './protocol.js';

/**
 * Host side: stamps ids and caps the event rate.
 * @param {{now?: () => number}} [opts]
 */
export function createEventEmitter(opts = {}) {
  const now = opts.now || (() => performance.now());
  let nextId = 1;
  let tokens = LIMITS.eventRate;
  let last = now();
  return {
    /**
     * @param {string} kind
     * @param {Object} data
     * @returns {import('./protocol.js').NetEvent|null} null when over the rate cap or invalid
     */
    make(kind, data) {
      const t = now();
      tokens = Math.min(LIMITS.eventRate, tokens + ((t - last) / 1000) * LIMITS.eventRate);
      last = t;
      if (tokens < 1) return null;
      const ev = { type: /** @type {'event'} */ ('event'), v: PROTOCOL_VERSION, id: nextId, kind, data };
      if (!validateEvent(ev).ok) return null;
      tokens -= 1;
      nextId++;
      return ev;
    },
    reset() { nextId = 1; tokens = LIMITS.eventRate; last = now(); }
  };
}

/**
 * Peer side: remembers the ids it has applied (a bounded window) and applies
 * each once.
 * @param {number} [window]
 */
export function createEventDeduper(window = 256) {
  /** @type {Set<number>} */
  const seen = new Set();
  /** @type {number[]} */
  const order = [];
  return {
    /**
     * @param {any} ev
     * @returns {boolean} true the first time a valid event id is seen
     */
    first(ev) {
      if (!validateEvent(ev).ok) return false;
      if (seen.has(ev.id)) return false;
      seen.add(ev.id);
      order.push(ev.id);
      if (order.length > window) seen.delete(/** @type {number} */ (order.shift()));
      return true;
    },
    reset() { seen.clear(); order.length = 0; }
  };
}
