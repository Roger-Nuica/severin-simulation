// @ts-check
/**
 * ===========================================================================
 * SECTION NC — Relay client
 * ===========================================================================
 * One WebSocket to the relay, owned by one simulation. It speaks the control
 * protocol (create / join / rejoin / leave), exposes the room state, and
 * hands every other message to `onMessage`. Everything is bound to the
 * AbortSignal it is given, so a React unmount / StrictMode remount / reset
 * closes the socket and drops its callbacks: nothing outlives the sim.
 *
 * The WebSocket constructor is injected (tests pass a fake).
 */
import { PROTOCOL_VERSION, parseFrame, LIMITS } from './protocol.js';

/**
 * @typedef {'idle'|'connecting'|'in-room'|'reconnecting'|'closed'} NetStatus
 * @typedef {{status: NetStatus, role: 'host'|'peer'|null, code: string|null, id: string|null, error: string|null}} NetState
 */

/**
 * @param {{url: string, signal: AbortSignal,
 *   WebSocketImpl?: typeof WebSocket,
 *   onMessage: (msg: Object) => void,
 *   onState: (state: NetState) => void,
 *   reconnectGraceMs?: number,
 *   retryMs?: number}} opts
 */
export function createRelayClient(opts) {
  const { url, signal, onMessage, onState } = opts;
  const WS = opts.WebSocketImpl || globalThis.WebSocket;
  const graceMs = opts.reconnectGraceMs ?? 30000;
  const retryMs = opts.retryMs ?? 1500;

  /** @type {NetState} */
  const state = { status: 'idle', role: null, code: null, id: null, error: null };
  /** @type {WebSocket|null} */
  let ws = null;
  /** @type {string|null} */
  let token = null;
  /** @type {object|null} what to send on open */
  let hello = null;
  let generation = 0;
  let retryTimer = 0;
  let dropAt = 0;

  /** @param {Partial<NetState>} patch */
  const set = (patch) => {
    if (signal.aborted) return;
    Object.assign(state, patch);
    onState({ ...state });
  };

  function connect() {
    const gen = ++generation;
    const sock = new WS(url);
    ws = sock;
    sock.onopen = () => {
      if (gen !== generation || signal.aborted) return;
      if (hello) sock.send(JSON.stringify(hello));
    };
    sock.onmessage = (e) => {
      // A stale socket (an earlier attempt, or after leave) must not act.
      if (gen !== generation || signal.aborted) return;
      const msg = parseFrame(typeof e.data === 'string' ? e.data : '', LIMITS.maxBytes);
      if (!msg) return;
      switch (msg.type) {
        case 'created':
          set({ status: 'in-room', role: 'host', code: String(msg.code), id: String(msg.id), error: null });
          return;
        case 'joined':
          token = typeof msg.token === 'string' ? msg.token : token;
          // After this a drop is a rejoin, not a fresh join.
          hello = { type: 'rejoin', v: PROTOCOL_VERSION, code: String(msg.code), token };
          set({ status: 'in-room', role: 'peer', code: String(msg.code), id: String(msg.id), error: null });
          onMessage(msg);
          return;
        case 'error':
          set({ error: String(msg.code) });
          if (state.status === 'connecting') { teardown(); set({ status: 'closed' }); }
          return;
        case 'hostLeft':
          teardown();
          set({ status: 'closed', error: 'host-left' });
          onMessage(msg);
          return;
        default:
          onMessage(msg);
      }
    };
    sock.onclose = () => {
      if (gen !== generation || signal.aborted) return;
      ws = null;
      // A peer with a token tries to get back in until the grace is spent;
      // the host's loss ends the room (no host migration).
      if (state.role === 'peer' && token && state.status !== 'closed') {
        if (state.status !== 'reconnecting') dropAt = Date.now() + graceMs;
        if (Date.now() >= dropAt) { teardown(); set({ status: 'closed', error: 'grace-expired' }); return; }
        set({ status: 'reconnecting' });
        retryTimer = setTimeout(() => { if (!signal.aborted) connect(); }, retryMs);
        return;
      }
      if (state.status !== 'closed') set({ status: 'closed', error: state.error || 'disconnected' });
    };
    sock.onerror = () => {};
  }

  function teardown() {
    generation++;
    clearTimeout(retryTimer);
    token = null;
    hello = null;
    const sock = ws;
    ws = null;
    if (sock) {
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      try { sock.close(); } catch { /* already closed */ }
    }
  }

  /** @param {Object} first @param {'host'|'peer'} role */
  function open(first, role) {
    if (signal.aborted || state.status !== 'idle' && state.status !== 'closed') return false;
    hello = first;
    token = null;
    set({ status: 'connecting', role, code: null, id: null, error: null });
    connect();
    return true;
  }

  const api = {
    state: () => ({ ...state }),
    /** @returns {boolean} false when already connecting/in a room */
    host: () => open({ type: 'create', v: PROTOCOL_VERSION }, 'host'),
    /** @param {string} code */
    join: (code) => open({ type: 'join', v: PROTOCOL_VERSION, code: String(code).trim().toUpperCase() }, 'peer'),
    /** @param {Object} msg @returns {boolean} whether it was sent */
    send(msg) {
      if (!ws || ws.readyState !== 1 || state.status !== 'in-room') return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    leave() {
      if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ type: 'leave', v: PROTOCOL_VERSION })); } catch { /* closing */ } }
      teardown();
      if (state.status !== 'idle') set({ status: 'idle', role: null, code: null, id: null, error: null });
    },
    dispose() { teardown(); }
  };
  signal.addEventListener('abort', () => teardown(), { once: true });
  return api;
}
