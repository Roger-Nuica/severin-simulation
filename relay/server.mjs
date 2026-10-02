// Co-op room relay: a standalone WebSocket process, run separately from
// Next.js (`npm run relay`). It only forwards room traffic; the host browser
// owns the simulation. Membership rules live in
// src/app/tornado/engine/net/room.js so they can be tested without sockets.
import { WebSocketServer } from 'ws';
import { randomInt, randomUUID } from 'node:crypto';
import { createRoomRegistry } from '../src/app/tornado/engine/net/room.js';
import { parseFrame, validateControl, validateInput, validateSnapshot, validateEvent, LIMITS, PROTOCOL_VERSION } from '../src/app/tornado/engine/net/protocol.js';

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

/** @type {Map<string, import('ws').WebSocket>} */
const sockets = new Map();

const registry = createRoomRegistry({
  send: (conn, msg) => {
    const ws = sockets.get(conn);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
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
    const msg = parseFrame(raw);
    if (!msg) return err('malformed');
    switch (msg.type) {
      case 'input': {
        const info = registry.role(conn);
        if (!info || info.role !== 'peer') return err('role');
        if (raw.length > LIMITS.maxInputBytes) return err('size');
        if (!inputs()) return; // over rate: dropped silently
        const v = validateInput(msg);
        if (!v.ok) return err(v.error);
        registry.relay(conn, v.input);
        return;
      }
      case 'snapshot': case 'event': {
        const info = registry.role(conn);
        if (!info || info.role !== 'host') return err('role');
        if (!hostOut()) return;
        const v = msg.type === 'snapshot' ? validateSnapshot(msg) : validateEvent(msg);
        if (!v.ok) return err(v.error);
        registry.relay(conn, msg, typeof msg.to === 'string' ? msg.to : undefined);
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
console.log(`[relay] listening on :${PORT}`);
