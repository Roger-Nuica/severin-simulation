import test from 'node:test';
import assert from 'node:assert/strict';
import { newHoleClock, stepHoleClock, holeAt, HOLE_CLOSE_SECONDS, HOLE_OPEN_SECONDS } from '../src/app/tornado/engine/net/fxQueue.js';
import { holeSize, HOLE } from '../src/app/tornado/engine/player/blackHole.js';

const row = (x, z, age, closing) => [x, z, age, closing];

test('no row, no hole', () => {
  const c = newHoleClock();
  assert.equal(stepHoleClock(c, null, false, 0.016), false);
  assert.equal(stepHoleClock(c, undefined, true, 0.016), false);
});

test('the first row starts it at the host age; age counts on between rows', () => {
  const c = newHoleClock();
  assert.equal(stepHoleClock(c, row(10, 20, 3, 0), true, 0.016), true);
  assert.equal(c.age, 3);
  assert.equal(c.closing, -1);
  stepHoleClock(c, row(10, 20, 3, 0), false, 0.5);
  assert.ok(Math.abs(c.age - 3.5) < 1e-9);
});

test('a small drift is kept, a big one snaps to the host', () => {
  const c = newHoleClock();
  stepHoleClock(c, row(0, 0, 5, 0), true, 0);
  stepHoleClock(c, row(0, 0, 5.1, 0), true, 0);
  assert.equal(c.age, 5);
  stepHoleClock(c, row(0, 0, 6, 0), true, 0);
  assert.equal(c.age, 6);
});

test('the collapse is timed from the flag flipping 0 to 1', () => {
  const c = newHoleClock();
  stepHoleClock(c, row(1, 2, 19.9, 0), true, 0);
  stepHoleClock(c, row(1, 2, 20, 0), false, 0.1);
  assert.equal(c.closing, -1);
  stepHoleClock(c, row(1, 2, 20.1, 1), true, 0.1);
  assert.equal(c.closing, 0);
  stepHoleClock(c, row(1, 2, 20.5, 1), false, 0.5);
  assert.ok(Math.abs(c.closing - 0.5) < 1e-9);
  // later rows with the flag still set do not restart it
  stepHoleClock(c, row(1, 2, 21, 1), true, 0.1);
  assert.ok(Math.abs(c.closing - 0.6) < 1e-9);
});

test('a first row already collapsing starts the collapse at zero', () => {
  const c = newHoleClock();
  stepHoleClock(c, row(1, 2, 20.2, 1), true, 0);
  assert.equal(c.closing, 0);
});

test('done after the close time, and a lingering host row does not reopen it', () => {
  const c = newHoleClock();
  stepHoleClock(c, row(1, 2, 20, 1), true, 0);
  assert.equal(stepHoleClock(c, row(1, 2, 20, 1), false, HOLE_CLOSE_SECONDS + 0.01), false);
  assert.equal(c.done, true);
  assert.equal(stepHoleClock(c, row(1, 2, 22, 1), true, 0.016), false);
  // the row going clears it; a new hole then starts
  assert.equal(stepHoleClock(c, null, true, 0.016), false);
  assert.equal(c.done, false);
  assert.equal(stepHoleClock(c, row(5, 5, 0.1, 0), true, 0.016), true);
  assert.equal(c.closing, -1);
});

test('a queued shot: the flag back to 0 with a new age is a new hole at once', () => {
  const c = newHoleClock();
  stepHoleClock(c, row(1, 2, 8, 0), true, 0);
  stepHoleClock(c, row(1, 2, 8.1, 1), true, 0.1);
  assert.ok(c.closing >= 0);
  stepHoleClock(c, row(30, 40, 0.1, 0), true, 0.05);
  assert.equal(c.on, true);
  assert.equal(c.closing, -1);
  assert.equal(c.age, 0.1);
  assert.equal(c.x, 30);
});

test('the mirror curve matches the host curve and the copied durations match HOLE', () => {
  assert.equal(HOLE_OPEN_SECONDS, HOLE.openSeconds);
  assert.equal(HOLE_CLOSE_SECONDS, HOLE.closeSeconds);
  for (const age of [0, 0.3, 0.75, 1.5, 6, 20]) {
    for (const closing of [-1, 0, 0.2, 0.45, 0.9, 1.5, 1.79, 1.8, 2]) {
      assert.equal(holeSize(age, closing), holeAt(age, closing), `${age}/${closing}`);
    }
  }
  assert.equal(holeSize(0, -1), 0);
  assert.equal(holeSize(5, -1), 1);
});
