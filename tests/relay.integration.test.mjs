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
  host.send(JSON.stringify({ type: 'create', v: 2 }));
  const created = await next(host);
  assert.equal(created.type, 'created');
  const peer = await open(`ws://localhost:${PORT}`);
  peer.send(JSON.stringify({ type: 'join', v: 2, code: created.code }));
  assert.equal((await next(peer)).type, 'joined');
  assert.equal((await next(host)).type, 'peerJoined');

  const input = { type: 'input', v: 2, seq: 1, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false, hero: false };
  peer.send(JSON.stringify(input));
  const got = await next(host);
  assert.equal(got.type, 'input');
  assert.equal(got.from, '1');

  peer.send(JSON.stringify({ ...input, damage: 9 }));
  assert.match((await next(peer)).code, /field:damage/);
  peer.send(JSON.stringify({ type: 'snapshot', v: 2 }));
  assert.equal((await next(peer)).code, 'role');

  const snap = { type: 'snapshot', v: 2, room: created.code, tick: 1, t: 1, score: 0, players: [], tornadoes: [], terminators: [], aliens: [], ships: [], vehicles: [] };
  host.send(JSON.stringify(snap));
  assert.equal((await next(peer)).tick, 1);
  host.close(); peer.close();
});
