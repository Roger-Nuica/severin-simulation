// Co-op room relay: a standalone WebSocket process, run separately from
// Next.js (`npm run relay`). It only forwards room traffic; the host browser
// owns the simulation. Membership rules live in
// src/app/tornado/engine/net/room.js so they can be tested without sockets.
import { WebSocketServer } from 'ws';
import { randomInt, randomUUID } from 'node:crypto';
import { createRoomRegistry } from '../src/app/tornado/engine/net/room.js';
import { createWindowRing, newStats, formatStats, createReasonCounts } from '../src/app/tornado/engine/net/metrics.js';
import { parseFrame, validateControl, validateInput, validateSnapshot, validateEvent, LIMITS, PROTOCOL_VERSION } from '../src/app/tornado/engine/net/protocol.js';

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Dev diagnostics, off unless RELAY_DEBUG=1. When off, `dbg` is null and every
// hook below is skipped: forwarding, rate limits and the protocol are unchanged.
// Logs hold counts and timings only: never room codes, tokens or message bodies.
const DEBUG = process.env.RELAY_DEBUG === '1';
const dbg = DEBUG ? {
  /** Arrival gaps at the relay, ms (a platform proxy that batches shows as bursts). */
  inGap: { input: createWindowRing(512), snapshot: createWindowRing(256) },
  lastIn: { input: 0, snapshot: 0 },
  /** Time from receipt to the forward call returning, ms. */
  dwell: createWindowRing(1024),
  /** Largest `bufferedAmount` seen on an outgoing socket, bytes. */
  buffered: 0,
  forwarded: 0,
  drops: createReasonCounts(),
  pings: 0,
  tmp: newStats()
} : null;

/** @type {Map<string, import('ws').WebSocket>} */
const sockets = new Map();

const registry = createRoomRegistry({
  send: (conn, msg) => {
    const ws = sockets.get(conn);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
      if (dbg && ws.bufferedAmount > dbg.buffered) dbg.buffered = ws.bufferedAmount;
    }
  },
  random: (n) => randomInt(n)
});

const wss = new WebSocketServer({
  port: PORT,
  maxPayload: LIMITS.maxBytes,
  verifyClient: ({ origin }) => ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
});

/** Simple per-connection token bucket. */
function bucket(perSecond) {
  let tokens = perSecond;
  let last = Date.now();
  return () => {
    const t = Date.now();
    tokens = Math.min(perSecond, tokens + ((t - last) / 1000) * perSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

wss.on('connection', (ws) => {
  const conn = randomUUID();
  sockets.set(conn, ws);
  const control = bucket(5);
  const inputs = bucket(LIMITS.inputRate);
  const hostOut = bucket(LIMITS.snapshotHz * 2 + LIMITS.eventRate);
  const err = (code) => ws.send(JSON.stringify({ type: 'error', v: PROTOCOL_VERSION, code }));

  ws.on('message', (data, isBinary) => {
    if (isBinary) return err('binary');
    const raw = data.toString();
    const t0 = dbg ? performance.now() : 0;
    if (dbg) {
      const m = parseFrame(raw);
      if (m && m.type === 'ping' && Number.isInteger(m.id)) { dbg.pings++; ws.send(JSON.stringify({ type: 'pong', id: m.id })); return; }
    }
    const msg = parseFrame(raw);
    if (!msg) return err('malformed');
    switch (msg.type) {
      case 'input': {
        const info = registry.role(conn);
        if (!info || info.role !== 'peer') return err('role');
        if (raw.length > LIMITS.maxInputBytes) return err('size');
        if (dbg) { if (dbg.lastIn.input) dbg.inGap.input.push(t0, t0 - dbg.lastIn.input); dbg.lastIn.input = t0; }
        if (!inputs()) { if (dbg) dbg.drops.add('inputs'); return; } // over rate: dropped silently
        const v = validateInput(msg);
        if (!v.ok) return err(v.error);
        registry.relay(conn, v.input);
        if (dbg) { dbg.forwarded++; dbg.dwell.push(t0, performance.now() - t0); }
        return;
      }
      case 'snapshot': case 'event': {
        const info = registry.role(conn);
        if (!info || info.role !== 'host') return err('role');
        if (dbg && msg.type === 'snapshot') { if (dbg.lastIn.snapshot) dbg.inGap.snapshot.push(t0, t0 - dbg.lastIn.snapshot); dbg.lastIn.snapshot = t0; }
        if (!hostOut()) { if (dbg) dbg.drops.add('hostOut'); return; }
        const v = msg.type === 'snapshot' ? validateSnapshot(msg) : validateEvent(msg);
        if (!v.ok) return err(v.error);
        registry.relay(conn, msg, typeof msg.to === 'string' ? msg.to : undefined);
        if (dbg) { dbg.forwarded++; dbg.dwell.push(t0, performance.now() - t0); }
        return;
      }
      default: {
        if (!control()) return err('rate');
        const v = validateControl(msg);
        if (!v.ok) return err(v.error);
        if (msg.type === 'create') registry.create(conn);
        else if (msg.type === 'join') registry.join(conn, msg.code);
        else if (msg.type === 'rejoin') registry.rejoin(conn, msg.code, msg.token);
        else if (msg.type === 'leave') registry.drop(conn, true);
      }
    }
  });
  ws.on('close', () => {
    registry.drop(conn, false);
    sockets.delete(conn);
  });
  ws.on('error', () => ws.terminate());
});

setInterval(() => registry.tick(), 1000).unref();
if (dbg) {
  setInterval(() => {
    const now = performance.now();
    const w = 5000;
    console.log(`[relay-debug] forwarded ${dbg.forwarded}; pings ${dbg.pings}; drops ${dbg.drops.entries().map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}; max buffered ${dbg.buffered} B`);
    console.log(`[relay-debug] input arrival gap ms ${formatStats(dbg.inGap.input.stats(now, w, dbg.tmp))}`);
    console.log(`[relay-debug] snapshot arrival gap ms ${formatStats(dbg.inGap.snapshot.stats(now, w, dbg.tmp))}`);
    console.log(`[relay-debug] forward dwell ms ${formatStats(dbg.dwell.stats(now, w, dbg.tmp), 2)}`);
  }, 5000).unref();
  console.log(`[relay-debug] on; perMessageDeflate=${JSON.stringify(wss.options.perMessageDeflate)}; noDelay is the ws default (set on every socket)`);
}
console.log(`[relay] listening on :${PORT}`);
