import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, HANK, rangeOf, airTime, moveAt, showLength, isRecord, throwScore } from '../src/app/tornado/engine/hank/moves.js';

test('five moves, one townsperson each', () => {
  assert.equal(MOVES.length, 5);
  assert.deepEqual(MOVES.map((m) => m.name), ['JAB', 'HAYMAKER', 'UPPERCUT', 'HAMMER THROW', 'GROUND POUND']);
});

test('every throw is a long one, and the hammer throw the longest', () => {
  const ranges = MOVES.map((m) => rangeOf(m.speed, m.angle));
  ranges.forEach((r) => assert.ok(r > 50 && r < 180, `range ${r}`));
  assert.equal(Math.max(...ranges), ranges[3]);
});

test('the uppercut goes up more than out', () => {
  const up = MOVES[2];
  const height = (up.speed * Math.sin(up.angle)) ** 2 / (2 * HANK.gravity);
  assert.ok(height > rangeOf(up.speed, up.angle));
  assert.ok(airTime(up.speed, up.angle) > 7);
});

test('the show stays about a quarter of a minute', () => {
  assert.ok(showLength() > 12 && showLength() < 16, `${showLength()}`);
  assert.ok(moveAt(0) >= HANK.fall + HANK.rise);
  assert.equal(moveAt(1) - moveAt(0), HANK.every);
});

test('the record is strictly longer; the score counts the metres', () => {
  assert.equal(isRecord(100, 99.9), true);
  assert.equal(isRecord(100, 100), false);
  assert.equal(throwScore(100), HANK.perVictim + 100 * HANK.perMetre);
});

test('low gravity afterwards is kept (R-040)', () => {
  assert.equal(HANK.lowGravity.scale, 0.3);
  assert.equal(HANK.lowGravity.seconds, 10);
});
