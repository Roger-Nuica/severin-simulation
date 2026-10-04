import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueHeadline } from '../src/app/tornado/engine/ui/headlines.js';

const h = (text, breaking = false) => ({ text, breaking });

test('breaking news jumps the ordinary lines, in order', () => {
  const q = [h('a'), h('b')];
  enqueueHeadline(q, h('B1', true), 4);
  enqueueHeadline(q, h('B2', true), 4);
  assert.deepEqual(q.map((x) => x.text), ['B1', 'B2', 'a', 'b']);
});

test('a full queue loses ordinary lines, never breaking ones', () => {
  const q = [];
  for (const t of ['a', 'b', 'c']) enqueueHeadline(q, h(t), 3);
  enqueueHeadline(q, h('B', true), 3);
  assert.deepEqual(q.map((x) => x.text), ['B', 'a', 'b']);
  enqueueHeadline(q, h('d'), 3);
  assert.deepEqual(q.map((x) => x.text), ['B', 'a', 'b'], 'the newest ordinary line goes');
  const all = [h('X', true), h('Y', true)];
  enqueueHeadline(all, h('Z', true), 2);
  assert.deepEqual(all.map((x) => x.text), ['Y', 'Z'], 'all breaking: the oldest goes');
});
