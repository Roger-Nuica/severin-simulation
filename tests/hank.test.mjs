import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOVES, HANK, rangeOf, moveAt, showLength, isRecord, throwScore, bossChoice } from '../src/app/tornado/engine/hank/moves.js';
import { ENEMY_HEALTH } from '../src/app/tornado/engine/health/damageTable.js';
import { HEALTH } from '../src/app/tornado/engine/health/config.js';

test('the show: two townspeople, one punch each', () => {
  assert.equal(MOVES.length, 2);
});

test('each one is sent a long way', () => {
  MOVES.forEach((m) => {
    const r = rangeOf(m.speed, m.angle);
    assert.ok(r > 90 && r < 180, `range ${r}`);
  });
});

test('they walk up over about two seconds, after he has risen', () => {
  assert.equal(HANK.approach, 2);
  assert.ok(moveAt(0) >= HANK.fall + HANK.rise + HANK.approach);
  assert.ok(Math.abs(moveAt(1) - moveAt(0) - HANK.every) < 1e-9);
  assert.ok(showLength() > 8 && showLength() < 11, `${showLength()}`);
});

test('the record is strictly longer; the score counts the metres', () => {
  assert.equal(isRecord(100, 99.9), true);
  assert.equal(isRecord(100, 100), false);
  assert.equal(throwScore(100), HANK.perVictim + 100 * HANK.perMetre);
});

test('the boss: punch in reach, rocks at Roger up high, walk otherwise', () => {
  const base = { cooldown: 0, rockTimer: 0 };
  assert.equal(bossChoice({ ...base, dist: 2, rogerAlt: 0 }), 'punch');
  assert.equal(bossChoice({ ...base, dist: 2, rogerAlt: 0, cooldown: 1 }), 'wait');
  assert.equal(bossChoice({ ...base, dist: 20, rogerAlt: 0 }), 'walk');
  assert.equal(bossChoice({ ...base, dist: 20, rogerAlt: 10 }), 'rock');
  assert.equal(bossChoice({ ...base, dist: 20, rogerAlt: 10, rockTimer: 1 }), 'walk');
  assert.equal(bossChoice({ ...base, dist: 4, rogerAlt: 10, rockTimer: 1 }), 'wait');
});

test('his health is in the table; his punch kills, his rock hurts', () => {
  assert.equal(ENEMY_HEALTH.hank, HANK.boss.hp);
  assert.equal(HEALTH.damage.hankPunch.instantKill, true);
  assert.ok(HEALTH.damage.hankRock.amount > 0 && HEALTH.damage.hankRock.amount < 100);
});

test('low gravity afterwards is kept (R-040)', () => {
  assert.equal(HANK.lowGravity.scale, 0.3);
  assert.equal(HANK.lowGravity.seconds, 10);
});
