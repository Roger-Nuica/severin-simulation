import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayClient } from '../src/app/tornado/engine/net/client.js';

class FakeWS {
  static all = [];
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  recv(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

function make(extra = {}) {
  FakeWS.all = [];
  const ac = new AbortController();
  const msgs = [];
  const states = [];
  const c = createRelayClient({ url: 'ws://x', signal: ac.signal, WebSocketImpl: FakeWS, onMessage: (m) => msgs.push(m), onState: (s) => states.push(s), retryMs: 5, ...extra });
  return { c, ac, msgs, states, ws: () => FakeWS.all.at(-1) };
}

test('host: create, then in-room as host', () => {
  const { c, ws } = make();
  assert.equal(c.host(), true);
  assert.equal(c.host(), false, 'duplicate action ignored');
  ws().open();
  assert.equal(ws().sent[0].type, 'create');
  ws().recv({ type: 'created', code: 'ABCDEF', id: '0' });
  assert.deepEqual(c.state(), { status: 'in-room', role: 'host', code: 'ABCDEF', id: '0', error: null });
  assert.equal(c.send({ type: 'snapshot' }), true);
});

test('peer joins with normalised code, rejoins with token after a drop', async () => {
  const { c, ws } = make();
  c.join(' abcdef ');
  ws().open();
  assert.equal(ws().sent[0].code, 'ABCDEF');
  ws().recv({ type: 'joined', code: 'ABCDEF', id: '1', token: 'TKN' });
  const first = ws();
  first.drop();
  assert.equal(c.state().status, 'reconnecting');
  await new Promise((r) => setTimeout(r, 20));
  assert.notEqual(ws(), first);
  ws().open();
  assert.deepEqual(ws().sent[0], { type: 'rejoin', v: 2, code: 'ABCDEF', token: 'TKN' });
});

test('peer grace expiry closes', async () => {
  const { c, ws } = make({ reconnectGraceMs: 10 });
  c.join('ABCDEF');
  ws().open();
  ws().recv({ type: 'joined', code: 'ABCDEF', id: '1', token: 'T' });
  ws().drop();
  await new Promise((r) => setTimeout(r, 30));
  ws().drop();
  assert.equal(c.state().status, 'closed');
  assert.equal(c.state().error, 'grace-expired');
});

test('host drop is final, hostLeft closes', () => {
  const a = make();
  a.c.host(); a.ws().open(); a.ws().recv({ type: 'created', code: 'ABCDEF', id: '0' });
  a.ws().drop();
  assert.equal(a.c.state().status, 'closed');
  const b = make();
  b.c.join('ABCDEF'); b.ws().open(); b.ws().recv({ type: 'joined', code: 'ABCDEF', id: '1', token: 'T' });
  b.ws().recv({ type: 'hostLeft' });
  assert.equal(b.c.state().status, 'closed');
  assert.equal(b.c.state().error, 'host-left');
});

test('abort closes the socket and silences stale callbacks', () => {
  const { c, ac, ws, msgs, states } = make();
  c.join('ABCDEF');
  const sock = ws();
  sock.open();
  ac.abort();
  const n = states.length;
  sock.onmessage?.({ data: '{"type":"snapshot"}' });
  assert.equal(msgs.length, 0);
  assert.equal(states.length, n);
  assert.equal(sock.readyState, 3);
});

test('failed join returns to closed with the error; leave resets to idle', () => {
  const { c, ws } = make();
  c.join('ABCDEF'); ws().open();
  ws().recv({ type: 'error', code: 'no-room' });
  assert.equal(c.state().status, 'closed');
  assert.equal(c.state().error, 'no-room');
  assert.equal(c.host(), true, 'can try again after close');
  c.leave();
  assert.equal(c.state().status, 'idle');
});
