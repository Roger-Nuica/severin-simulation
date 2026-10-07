import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNetDebug, newStats, createWindowRing, createSendLog, createCounters, createReasonCounts, formatStats, createNetMetrics,
  createRateTable, createLineRing, formatRates, fixed1, COMBAT_LINES
} from '../src/app/tornado/engine/net/metrics.js';

test('the page flag is opt-in and understands off values', () => {
  assert.equal(isNetDebug(''), false);
  assert.equal(isNetDebug('?x=1'), false);
  assert.equal(isNetDebug('?netdebug'), true);
  assert.equal(isNetDebug('?netdebug=1'), true);
  assert.equal(isNetDebug('?a=1&netdebug'), true);
  assert.equal(isNetDebug('?netdebug=0'), false);
  assert.equal(isNetDebug('?netdebug=false'), false);
  assert.equal(isNetDebug('?netdebugger'), false);
  assert.equal(isNetDebug(undefined), false);
});

test('a window ring reports min, median and max over the window only', () => {
  const r = createWindowRing(8);
  const out = newStats();
  assert.equal(r.stats(0, 5000, out).n, 0);
  [[0, 50], [1000, 10], [2000, 30], [3000, 20]].forEach(([t, v]) => r.push(t, v));
  const s = r.stats(3000, 5000, out);
  assert.deepEqual({ n: s.n, min: s.min, median: s.median, max: s.max }, { n: 4, min: 10, median: 30, max: 50 });
  const late = r.stats(6500, 5000, out);
  assert.deepEqual({ n: late.n, min: late.min, max: late.max }, { n: 2, min: 20, max: 30 });
  r.clear();
  assert.equal(r.stats(6500, 5000, out).n, 0);
});

test('a full ring overwrites its oldest samples', () => {
  const r = createWindowRing(3);
  for (let i = 1; i <= 5; i++) r.push(i, i * 10);
  const s = r.stats(5, 100, newStats());
  assert.equal(s.n, 3);
  assert.equal(s.min, 30);
  assert.equal(s.max, 50);
});

test('the send log matches an ack to its seq once and ignores older or unknown acks', () => {
  const log = createSendLog(16);
  log.sent(1, 100); log.sent(2, 133); log.sent(3, 166);
  assert.equal(log.acked(2, 300), 167);
  assert.equal(log.acked(2, 310), -1, 'repeat');
  assert.equal(log.acked(1, 320), -1, 'older than the last matched');
  assert.equal(log.acked(9, 330), -1, 'never sent');
  assert.equal(log.acked(3, 340), 174);
  log.sent(19, 400); // wraps onto slot 3: seq 3 is gone
  assert.equal(log.acked(3, 500), -1);
  assert.equal(log.acked(19, 500), 100);
  log.clear();
  assert.equal(log.acked(20, 600), -1);
});

test('counters and reason counts count and clear', () => {
  const c = createCounters(3);
  c.add(1); c.add(1); c.add(9); c.add(-1);
  assert.equal(c.get(1), 2);
  assert.equal(c.get(9), 0);
  c.clear();
  assert.equal(c.get(1), 0);
  const r = createReasonCounts();
  r.add('stale'); r.add('yaw'); r.add('stale');
  assert.deepEqual(r.entries(), [['stale', 2], ['yaw', 1]]);
  assert.equal(r.last(), 'stale');
  r.clear();
  assert.deepEqual(r.entries(), []);
});

test('stats format with and without samples', () => {
  assert.equal(formatStats(newStats()), 'no samples');
  assert.equal(formatStats({ n: 2, min: 1, median: 2, max: 3 }), 'min 1 / med 2 / max 3 (n=2)');
});

test('net metrics: ack delay, relay ping, cadence, rejects and fire counters', () => {
  const m = createNetMetrics({ weapons: 6 });
  m.inputSent(1, 1000);
  m.snapshotArrived(1100, -1);
  m.snapshotArrived(1180, 1);
  m.hostFrameAt(1000); m.hostFrameAt(1016); m.hostFrameAt(1048);
  m.snapshotSent(1000); m.snapshotSent(1067);
  m.inputAccepted(1000); m.inputAccepted(1033);
  m.peerFrame(1190);
  const id = m.nextPing(1200);
  assert.equal(id, 1);
  m.pong(99, 1210);
  m.pong(1, 1250);
  m.reject('yaw'); m.reject('stale'); m.reject('stale');
  m.fire(0, 0); m.fire(0, 2); m.fire(0, 3); m.fire(5, 0); m.fire(5, 1); m.unfired(0); m.unfired(2);
  const text = m.report(1300).join('\n');
  assert.match(text, /ack delay[^\n]*min 180 \/ med 180 \/ max 180 \(n=1\)/);
  assert.match(text, /relay ping RTT ms: min 50/);
  assert.match(text, /snapshot interarrival ms: min 80/);
  assert.match(text, /host frame ms: min 16 \/ med 32 \/ max 32/);
  assert.match(text, /snapshot send interval ms: min 67/);
  assert.match(text, /gate rejects: yaw=1 stale=2 \(last: stale\)/);
  assert.match(text, /\[w0: call 1 cd 0 ray 1 hit 1\]/);
  assert.match(text, /\[w5: call 1 cd 1 ray 0 hit 0\]/);
  assert.match(text, /no-hero 1/);
  assert.match(text, /not raised 1/);
  m.reset();
  assert.match(m.report(2000).join('\n'), /ack delay[^\n]*no samples/);
});

test('the peer stops pinging when the relay never answers', () => {
  const m = createNetMetrics({ weapons: 6 });
  assert.equal(m.nextPing(0), 1);
  assert.equal(m.nextPing(1000), 2);
  assert.equal(m.nextPing(2000), 3);
  assert.equal(m.nextPing(3000), 0);
  assert.match(m.report(3000).join('\n'), /relay not answering/);
  const ok = createNetMetrics({ weapons: 6 });
  for (let i = 1; i <= 10; i++) { assert.equal(ok.nextPing(i * 1000), i); ok.pong(i, i * 1000 + 40); }
});

test('a rate table turns totals into per-second rates over each roll', () => {
  const t = createRateTable(['bytes', 'rows']);
  t.add('bytes', 500); t.add('bytes', 500); t.add('rows', 30); t.add('nope', 9);
  assert.equal(t.rate('bytes'), 0, 'no window closed yet');
  t.roll(1000);
  t.add('bytes', 3000); t.add('rows', 45);
  t.roll(3000);
  assert.equal(t.rate('bytes'), 1500);
  assert.equal(t.rate('rows'), 22.5);
  assert.equal(t.rate('nope'), 0);
  assert.equal(formatRates('x', ['bytes', 'rows'], t.rate, 0), 'x: bytes 1500 | rows 23');
  t.clear();
  assert.equal(t.rate('bytes'), 0);
});

test('a line ring keeps the newest lines, oldest first, and folds repeats', () => {
  const r = createLineRing(3);
  assert.deepEqual(r.lines(), []);
  r.push('a'); r.push('b'); r.push('b again', 'b'); r.push('b once more', 'b');
  assert.deepEqual(r.lines(), ['a', 'b once more x3']);
  r.push('c'); r.push('d');
  assert.deepEqual(r.lines(), ['b once more x3', 'c', 'd']);
  r.push('e');
  assert.deepEqual(r.lines(), ['c', 'd', 'e']);
  r.clear();
  assert.deepEqual(r.lines(), []);
  assert.equal(COMBAT_LINES, 20);
});

test('fixed1 prints one decimal and a dash for a non-finite number', () => {
  assert.equal(fixed1(3.14159), '3.1');
  assert.equal(fixed1(NaN), '-');
  assert.equal(fixed1(Infinity), '-');
});

test('net metrics: snapshot kinds, bytes, ignored events, host counts and the combat ring', () => {
  const m = createNetMetrics({ weapons: 6, kinds: ['players', 'tornadoes'] });
  m.roll(0);
  m.snapshotBytes(1000); m.snapshotBytes(1000);
  m.snapshotRows('players', 2); m.snapshotRows('players', 2); m.snapshotRows('tornadoes', 1); m.snapshotRows('unknown', 7);
  m.eventBytes(120);
  m.eventIn('explosion'); m.eventIgnored('explosion'); m.eventIn('notice'); m.eventIn('notice'); m.eventIgnored('notice(dup/invalid)');
  m.eventDropped('mission');
  m.host(0); m.host(0); m.host(1); m.host(2); m.host(9);
  m.combat('shot 1 rifle', 'k'); m.combat('shot 1 rifle', 'k');
  m.roll(2000);
  const text = m.report(2000).join('\n');
  assert.match(text, /snapshots 1\.0 \| snap bytes 1000\.0 \| events 0\.5 \| event bytes 60\.0 \| players 2\.0 \| tornadoes 0\.5/);
  assert.match(text, /events received: explosion=1 notice=2/);
  assert.match(text, /IGNORED[^\n]*: explosion=1 notice\(dup\/invalid\)=1/);
  assert.match(text, /dropped by the host's emitter: mission=1/);
  assert.match(text, /own weapon calls[^\n]* 2, hole opens 1, tornado births 1/);
  assert.deepEqual(m.combatLines(), ['shot 1 rifle x2']);
  m.reset();
  const after = m.report(3000).join('\n');
  assert.match(after, /events received: none/);
  assert.match(after, /own weapon calls[^\n]* 0, hole opens 0, tornado births 0/);
  assert.deepEqual(m.combatLines(), []);
});

test('net metrics without kinds still reports and ignores row counts', () => {
  const m = createNetMetrics({ weapons: 6 });
  m.snapshotRows('players', 3);
  m.roll(0); m.roll(1000);
  assert.match(m.report(1000).join('\n'), /per second: snapshots 0\.0 \| snap bytes 0\.0 \| events 0\.0 \| event bytes 0\.0/);
});
