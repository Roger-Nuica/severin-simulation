import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeroRequests, heroRequestOutcome, mayRequestLock, LOCK_COOLDOWN_MS } from '../src/app/tornado/engine/net/heroRequest.js';
import { validateInput, PROTOCOL_VERSION as V } from '../src/app/tornado/engine/net/protocol.js';

test('hero request acts once per rising edge, per player', () => {
  const r = createHeroRequests();
  assert.equal(r.edge('1', false), false);
  assert.equal(r.edge('1', true), true);
  assert.equal(r.edge('1', true), false, 'held flag does not repeat');
  assert.equal(r.edge('2', true), true, 'another player is independent');
  assert.equal(r.edge('1', false), false);
  assert.equal(r.edge('1', true), true, 'a new press fires again');
  r.forget('1');
  assert.equal(r.edge('1', true), true, 'forgotten player starts fresh');
  r.clear();
  assert.equal(r.edge('2', true), true);
});

test('hero request outcome depends on the host run', () => {
  assert.equal(heroRequestOutcome(true).action, 'join');
  assert.equal(heroRequestOutcome(false).action, 'wait');
});

test('pointer lock is held back for the cooldown after an exit', () => {
  assert.equal(mayRequestLock(10, 0), true);
  assert.equal(mayRequestLock(1000, 900), false);
  assert.equal(mayRequestLock(900 + LOCK_COOLDOWN_MS - 1, 900), false);
  assert.equal(mayRequestLock(900 + LOCK_COOLDOWN_MS, 900), true);
});

test('input carries a required boolean hero flag', () => {
  const base = { type: 'input', v: V, seq: 1, mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, aim: false, weapon: 0, abil: 0, use: false };
  assert.equal(validateInput({ ...base, hero: true }).ok, true);
  assert.equal(validateInput({ ...base, hero: true }).input.hero, true);
  assert.equal(validateInput(base).ok, false);
  assert.equal(validateInput({ ...base, hero: 1 }).ok, false);
  assert.equal(V, 2);
});

test('a new run revives everyone and frees the seats but keeps the room', async () => {
  const { createPlayerRegistry } = await import('../src/app/tornado/engine/net/players.js');
  const reg = createPlayerRegistry();
  reg.add('0'); reg.add('1');
  reg.enterSeat('0', 9000, 0);
  reg.get('1').shield = 0;
  reg.down('1');
  reg.get('0').energy = 3;
  reg.resetRun();
  assert.equal(reg.list().length, 2);
  assert.ok(reg.list().every((p) => p.state === 'up' && p.seat === null && p.energy === 100));
  assert.equal(reg.occupants(9000)[0], null);
  assert.equal(reg.gameOver(), false);
});
