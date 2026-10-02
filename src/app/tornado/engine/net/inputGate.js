// @ts-check
/**
 * ===========================================================================
 * SECTION NG — Host-side input gate
 * ===========================================================================
 * The host receives peer inputs from the relay stamped with the sender's
 * player id (`from`, set by the relay, never by the peer). This gate binds an
 * input to that identity, checks the schema, rejects stale / duplicate
 * sequence numbers and enforces a per-peer rate limit, so only the freshest
 * valid intent per player reaches the simulation.
 */
import { validateInput, LIMITS, parseFrame } from './protocol.js';

/**
 * @param {{now?: () => number, rate?: number}} [opts]
 */
export function createInputGate(opts = {}) {
  const now = opts.now || (() => performance.now());
  const rate = opts.rate ?? LIMITS.inputRate;
  /** @type {Map<string, {seq: number, tokens: number, last: number}>} */
  const peers = new Map();

  return {
    /**
     * @param {Object|string} raw a relayed message (object) or raw frame
     * @param {(id: string) => boolean} known whether the id is a joined player
     * @returns {{ok: true, id: string, input: import('./protocol.js').PlayerInput} | {ok: false, error: string}}
     */
    accept(raw, known) {
      const msg = typeof raw === 'string' ? parseFrame(raw, LIMITS.maxInputBytes + 32) : raw;
      if (!msg || typeof msg !== 'object') return { ok: false, error: 'malformed' };
      const from = /** @type {any} */ (msg).from;
      if (typeof from !== 'string' || !known(from)) return { ok: false, error: 'unknown-peer' };
      // `from` is relay metadata, not part of the peer's schema.
      const { from: _from, ...body } = /** @type {any} */ (msg);
      void _from;
      if (JSON.stringify(body).length > LIMITS.maxInputBytes) return { ok: false, error: 'size' };
      let p = peers.get(from);
      const t = now();
      if (!p) { p = { seq: -1, tokens: rate, last: t }; peers.set(from, p); }
      p.tokens = Math.min(rate, p.tokens + ((t - p.last) / 1000) * rate);
      p.last = t;
      if (p.tokens < 1) return { ok: false, error: 'rate' };
      const v = validateInput(body);
      if (!v.ok) return v;
      p.tokens -= 1;
      if (v.input.seq <= p.seq) return { ok: false, error: 'stale' };
      p.seq = v.input.seq;
      return { ok: true, id: from, input: v.input };
    },
    /** @param {string} id */
    forget(id) { peers.delete(id); },
    clear() { peers.clear(); }
  };
}
