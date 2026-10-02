import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnemyRegistry } from '../src/app/tornado/engine/enemies.js';
import { weaponColumn, tableDamage, fullHealth, healthAfter } from '../src/app/tornado/engine/health/enemyDamage.js';
import { WEAPON_VS_ENEMY, WEAPONS, KATANA_EXCLUSIONS } from '../src/app/tornado/engine/health/damageTable.js';

/**
 * A fake owner: counts its handler calls and its defeats (its "score").
 * @param {string} name The registry kind (a table row).
 * @param {string[]} accepts The kinds of damage its handler answers to.
 * @returns {{kind: any, calls: any[], defeats: {n: number}, e: object}}
 */
const owner = (name, accepts) => {
  const calls = [];
  const defeats = { n: 0 };
  const e = { alive: true };
  const kind = {
    kind: name,
    list: () => (e.alive ? [e] : []),
    position: () => ({ x: 0, z: 0 }),
    accepts,
    damage: (_e, hit) => {
      calls.push(hit.type);
      return false;
    },
    defeat: () => {
      if (!e.alive) return true;
      e.alive = false;
      defeats.n++;
      return true;
    }
  };
  return { kind, calls, defeats, e };
};

const registry = () => createEnemyRegistry({});

test('weapon columns: mega is plasma with mega, the rest are their own', () => {
  assert.equal(weaponColumn({ type: 'plasma' }), 'plasma');
  assert.equal(weaponColumn({ type: 'plasma', mega: true }), 'mega');
  for (const t of ['bullet', 'bolt', 'fire', 'blade', 'emp']) assert.equal(weaponColumn({ type: t }), t);
  for (const t of ['freeze', 'gravity', 'cleanse']) assert.equal(weaponColumn({ type: t }), null);
});

test('healthAfter keeps the table precision: fifty chips of 0.6 empty 30 exactly', () => {
  let h = fullHealth('terminator');
  for (let i = 0; i < 50; i++) h = healthAfter(h, tableDamage('terminator', { type: 'fire' }));
  assert.equal(h, 0);
});

test('chips accumulate and the enemy is defeated on the hit that empties it, once', () => {
  const reg = registry();
  const o = owner('terminator', ['plasma', 'bullet', 'bolt', 'emp']);
  reg.registerKind(o.kind);
  for (let i = 0; i < 49; i++) assert.equal(reg.hit(o.e, o.kind, { type: 'fire' }), false);
  assert.equal(o.defeats.n, 0);
  assert.equal(reg.hit(o.e, o.kind, { type: 'fire' }), true);
  assert.equal(o.defeats.n, 1);
  // A late hit adds no second defeat (it is no longer listed, and defeat is a no-op).
  reg.hit(o.e, o.kind, { type: 'fire' });
  assert.equal(o.defeats.n, 1);
});

test('a chip of a kind the owner does not accept never reaches its handler', () => {
  const reg = registry();
  const o = owner('terminator', ['plasma', 'bullet', 'bolt', 'emp']);
  reg.registerKind(o.kind);
  reg.hit(o.e, o.kind, { type: 'blade' });
  reg.hit(o.e, o.kind, { type: 'fire' });
  assert.deepEqual(o.calls, []);
});

test('weakness hits reach the owner unchanged and also count toward health', () => {
  const reg = registry();
  const o = owner('terminator', ['plasma', 'bullet', 'bolt', 'emp']);
  reg.registerKind(o.kind);
  for (let i = 0; i < 29; i++) reg.hit(o.e, o.kind, { type: 'bullet' });
  assert.equal(o.calls.length, 29);
  assert.equal(o.defeats.n, 0);
  // The owner's own rule stops it on the 30th; the register does not defeat it twice.
  o.kind.damage = (_e, hit) => { o.calls.push(hit.type); o.e.alive = false; return true; };
  assert.equal(reg.hit(o.e, o.kind, { type: 'bullet' }), true);
  assert.equal(o.defeats.n, 0);
});

test('mixed weapons add up: 10 knockdowns of plasma (6) and 24 bullets (24) empty a Terminator', () => {
  const reg = registry();
  const o = owner('terminator', ['plasma', 'bullet', 'bolt', 'emp']);
  reg.registerKind(o.kind);
  for (let i = 0; i < 10; i++) reg.hit(o.e, o.kind, { type: 'plasma' });
  for (let i = 0; i < 23; i++) reg.hit(o.e, o.kind, { type: 'bullet' });
  assert.equal(o.defeats.n, 0);
  assert.equal(reg.hit(o.e, o.kind, { type: 'bullet' }), true);
  assert.equal(o.defeats.n, 1);
});

test('a strong hit (30 of 30) defeats at once; a chip on the T-Rex does not', () => {
  const reg = registry();
  const o = owner('terminator', ['plasma', 'bullet', 'bolt', 'emp']);
  reg.registerKind(o.kind);
  assert.equal(reg.hit(o.e, o.kind, { type: 'plasma', mega: true }), true);
  assert.equal(o.defeats.n, 1);
  const p = owner('trex', ['plasma', 'bullet', 'bolt', 'emp', 'blade']);
  reg.registerKind(p.kind);
  assert.equal(reg.hit(p.e, p.kind, { type: 'fire' }), false);
  assert.equal(p.defeats.n, 0);
});

test('an alien (1 health) takes 50 minigun chips; its kills score once', () => {
  const reg = registry();
  const o = owner('alien', ['plasma', 'bolt', 'fire', 'blade']);
  reg.registerKind(o.kind);
  for (let i = 0; i < 49; i++) reg.hit(o.e, o.kind, { type: 'bullet' });
  assert.equal(o.defeats.n, 0);
  assert.equal(reg.hit(o.e, o.kind, { type: 'bullet' }), true);
  assert.equal(o.defeats.n, 1);
});

test('kinds without a weapon column, or without a defeat, are untouched', () => {
  const reg = registry();
  const o = owner('terminator', ['plasma']);
  reg.registerKind(o.kind);
  for (const type of ['freeze', 'gravity', 'cleanse']) assert.equal(reg.hit(o.e, o.kind, { type }), false);
  const bare = owner('terminator', ['plasma']);
  delete bare.kind.defeat;
  for (let i = 0; i < 100; i++) reg.hit(bare.e, bare.kind, { type: 'fire' });
  assert.equal(bare.defeats.n, 0);
});

test('resetEnemies forgets health', () => {
  const reg = registry();
  const o = owner('alien', []);
  reg.registerKind(o.kind);
  for (let i = 0; i < 49; i++) reg.hit(o.e, o.kind, { type: 'bullet' });
  reg.resetEnemies();
  for (let i = 0; i < 49; i++) reg.hit(o.e, o.kind, { type: 'bullet' });
  assert.equal(o.defeats.n, 0);
});

test('every weapon damages every registry kind: no zero cell outside the katana exclusions', () => {
  for (const [kind, row] of Object.entries(WEAPON_VS_ENEMY)) {
    for (const w of WEAPONS) {
      const zero = row[w] === 0;
      assert.equal(zero, w === 'blade' && KATANA_EXCLUSIONS.includes(kind), `${kind}/${w}`);
    }
  }
  for (const kind of ['alien', 'terminator', 'pursuer', 'trex', 'yeti', 'patientZero', 'patientZeroClone', 'hunterShip']) {
    for (const hit of [{ type: 'plasma' }, { type: 'plasma', mega: true }, { type: 'bullet' }, { type: 'bolt' }, { type: 'fire' }, { type: 'emp' }]) {
      assert.ok(tableDamage(kind, hit) > 0, `${kind}/${hit.type}`);
    }
  }
  assert.ok(tableDamage('trex', { type: 'blade' }) > 0);
});

test('weakness numbers are the runtime ones', () => {
  assert.equal(tableDamage('yeti', { type: 'fire' }), 1.2);
  assert.equal(tableDamage('trex', { type: 'plasma' }), 3);
  assert.equal(tableDamage('terminator', { type: 'bullet' }), 1);
  assert.equal(fullHealth('terminator'), 30);
});

test('the rocket column is wired through the samurai blast: one hit of 3, as before', () => {
  assert.equal(weaponColumn({ type: 'blast' }), 'rocket');
  assert.equal(tableDamage('samurai', { type: 'blast' }), fullHealth('samurai'));
});

test('samurai: 3 minigun rounds, one rifle shot, 50 fire ticks (the table, D1)', () => {
  const hp = (type) => healthAfter(fullHealth('samurai'), tableDamage('samurai', { type }));
  assert.equal(hp('plasma'), 0);
  assert.equal(hp('bolt'), 0);
  let h = fullHealth('samurai');
  for (let i = 0; i < 3; i++) h = healthAfter(h, tableDamage('samurai', { type: 'bullet' }));
  assert.equal(h, 0);
  h = fullHealth('samurai');
  for (let i = 0; i < 50; i++) h = healthAfter(h, tableDamage('samurai', { type: 'fire' }));
  assert.equal(h, 0);
});

test('UFO (6 hull): rifle 1, MEGA 5, every other weapon that reaches it a chip', () => {
  assert.equal(tableDamage('ufo', { type: 'plasma' }), 1);
  assert.equal(tableDamage('ufo', { type: 'plasma', mega: true }), 5);
  for (const type of ['bullet', 'bolt', 'fire']) {
    const d = tableDamage('ufo', { type });
    assert.ok(d > 0 && d < 1, type);
  }
});

// ---- Subtask 18: the non-creature targets (plant, mothership, tornado) ----
import { chipTarget, shipKindOf, mergedHealth } from '../src/app/tornado/engine/health/enemyDamage.js';

test('plant chips accumulate: 50 normal shots empty its 5, a MEGA BEAM spends it at once', () => {
  let h = fullHealth('nuclearPlant');
  let shots = 0;
  while (h > 0) { h = chipTarget('nuclearPlant', h, { type: 'plasma' }).health; shots++; }
  assert.equal(shots, 50);
  assert.equal(chipTarget('nuclearPlant', 5, { type: 'plasma', mega: true }).spent, true);
  // The alien ships' five whole hits still empty it, and add to any chip.
  assert.equal(chipTarget('nuclearPlant', 1, { type: 'bullet' }).spent, false);
});

test('the mothership keeps its strong hits and chips the rest', () => {
  assert.equal(shipKindOf('MOTHERSHIP'), 'mothership');
  assert.equal(shipKindOf('UFO'), 'ufo');
  assert.equal(shipKindOf('HUNTER'), null);
  assert.equal(tableDamage('mothership', { type: 'plasma' }), 1);
  assert.equal(tableDamage('mothership', { type: 'plasma', mega: true }), 5);
  assert.equal(tableDamage('mothership', { type: 'blast' }), 8);
  assert.equal(chipTarget('mothership', 15, { type: 'bullet' }).health, 14.7);
});

test('a tornado is chipped by every weapon but is neutralised outright only by the MEGA BEAM', () => {
  let h = fullHealth('tornado');
  let hits = 0;
  while (h > 0) { h = chipTarget('tornado', h, { type: 'bullet' }).health; hits++; }
  assert.equal(hits, 50);
  assert.equal(chipTarget('tornado', 20, { type: 'plasma', mega: true }).spent, true);
  assert.equal(chipTarget('tornado', 20, { type: 'plasma' }).health, 19.6);
});

test('the katana does nothing to the plant, the mothership or a tornado', () => {
  for (const kind of ['nuclearPlant', 'mothership', 'tornado']) {
    const full = fullHealth(kind);
    for (let i = 0; i < 1000; i++) assert.deepEqual(chipTarget(kind, full, { type: 'blade' }), { health: full, spent: false });
  }
});

test('a Fujiwhara merge keeps one health value, the lower, and never heals', () => {
  assert.equal(mergedHealth(20, 12), 12);
  assert.equal(mergedHealth(8, 20), 8);
  assert.equal(mergedHealth(20, 20), 20);
});

test('the black hole stays an outright kill: it has no table column for the three targets', () => {
  for (const kind of ['nuclearPlant', 'mothership', 'tornado']) {
    assert.equal(weaponColumn({ type: 'blackHole' }), null);
    assert.equal(tableDamage(kind, { type: 'blackHole' }), 0);
  }
});

test('telekinesis: a thrown car (throw) kills an alien, takes a third of a Terminator, a fifth of the T-Rex', () => {
  assert.equal(weaponColumn({ type: 'throw' }), 'throw');
  assert.equal(tableDamage('alien', { type: 'throw' }), fullHealth('alien'));
  assert.equal(tableDamage('terminator', { type: 'throw' }), 10);
  assert.equal(tableDamage('trex', { type: 'throw' }), 8);
  assert.equal(tableDamage('yeti', { type: 'throw' }), 6);
});
