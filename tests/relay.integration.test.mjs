import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 18787;
const open = (url) => new Promise((res, rej) => { const w = new WebSocket(url); w.once('open', () => res(w)); w.once('error', rej); });
const next = (w) => new Promise((res) => w.once('message', (d) => res(JSON.parse(d.toString()))));

test('real relay: create, join, input to host, snapshot to peer, role enforcement', async (t) => {
  const srv = spawn(process.execPath, ['relay/server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => srv.kill());
  await new Promise((r) => srv.stdout.once('data', r));
  const host = await open(`ws://localhost:${PORT}`);
  host.send(JSON.stringify({ type: 'create', v: 3 }));
  const created = await next(host);
  assert.equal(created.type, 'created');
  const peer = await open(`ws://localhost:${PORT}`);
  peer.send(JSON.stringify({ type: 'join', v: 3, code: created.code }));
  assert.equal((await next(peer)).type, 'joined');
  assert.equal((await next(host)).type, 'peerJoined');

  const input = { type: 'input', v: 3, seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false, hero: false };
  peer.send(JSON.stringify(input));
  const got = await next(host);
  assert.equal(got.type, 'input');
  assert.equal(got.from, '1');

  peer.send(JSON.stringify({ ...input, damage: 9 }));
  assert.match((await next(peer)).code, /field:damage/);
  peer.send(JSON.stringify({ type: 'snapshot', v: 3 }));
  assert.equal((await next(peer)).code, 'role');

  const snap = { type: 'snapshot', v: 3, room: created.code, tick: 1, t: 1, score: 0, players: [], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [] };
  host.send(JSON.stringify(snap));
  assert.equal((await next(peer)).tick, 1);
  host.close(); peer.close();
});

test('real relay: the snapshot ack is echoed to the peer, a malformed ack is refused, input rules are unchanged', async (t) => {
  const srv = spawn(process.execPath, ['relay/server.mjs'], { env: { ...process.env, PORT: String(PORT + 1) }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => srv.kill());
  await new Promise((r) => srv.stdout.once('data', r));
  const host = await open(`ws://localhost:${PORT + 1}`);
  host.send(JSON.stringify({ type: 'create', v: 3 }));
  const created = await next(host);
  const peer = await open(`ws://localhost:${PORT + 1}`);
  peer.send(JSON.stringify({ type: 'join', v: 3, code: created.code }));
  assert.equal((await next(peer)).type, 'joined');
  assert.equal((await next(host)).type, 'peerJoined');

  const base = { type: 'snapshot', v: 3, room: created.code, tick: 1, t: 1, score: 0, players: [], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [] };
  host.send(JSON.stringify({ ...base, ack: [[1, 42]] }));
  const echoed = await next(peer);
  assert.equal(echoed.tick, 1);
  assert.deepEqual(echoed.ack, [[1, 42]]);

  host.send(JSON.stringify({ ...base, tick: 2, ack: [[1, -1]] }));
  assert.equal((await next(host)).type, 'error');

  host.send(JSON.stringify({ ...base, tick: 3 }));
  const plain = await next(peer);
  assert.equal(plain.tick, 3);
  assert.equal(plain.ack, undefined);

  const input = { type: 'input', v: 3, seq: 5, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false, hero: false };
  peer.send(JSON.stringify(input));
  assert.equal((await next(host)).from, '1');
  peer.send(JSON.stringify({ ...input, damage: 9 }));
  assert.match((await next(peer)).code, /field:damage/);
  host.close(); peer.close();
});
