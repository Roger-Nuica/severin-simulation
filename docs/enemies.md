# Enemies and hostile actors

## Shared registry pattern

The project uses one enemy registry in `src/app/tornado/engine/enemies.js`.

The registry exposes:
- `registerKind(kind)`
- `kinds()`
- `each(visit)`
- `count(kind)`
- `hit(e, kind, hit)`
- `setState(e, state, seconds)`
- `getState(e, state)`
- `updateEnemies(dt)`

This keeps enemy logic modular while keeping one shared combat contract.

## Current hostile actors

- `engine/aliens.js` — alien attack logic and the `hunterShip` registry kind
- `engine/terminator.js` — EMP-resistant hostile units
- `engine/trex.js` — cyber T-Rex logic
- `engine/yeti.js` — hostile snow/beast variant
- `engine/patientZero.js` — special hostile threat, the Replicator: `patientZero/model.js` (the body, one glow material, six instanced parts for the clones), `patientZero/swarm.js` (the nanite blocks that build and break clones), `patientZero/encircle.js` (15 clones surround Roger at 100 m and close in, throwing shards); the original's second evolution after 75 s and the hit feedback (via the registry's optional `wounded` hook) are in `patientZero.js`; sound in `sound/replicator.js`
- `engine/heroMode.js` / `heroWeapons.js` — Roger’s direct combat interactions

Not every hostile actor is a separate class; some are registry-backed kinds using the same contract.

## Katana interaction

The Katana (`engine/hero/katana/`) cuts registry kind `alien` in the phases patrol, escort and exiting (and people, see `docs/weapons.md`), through a `blade` hit carrying `cut`; `aliens.js` routes it to `crew.js` `sliceKill`, which scores `ALIENS.killScore` once and hands the root to the pieces system. Every other registry kind in reach (Terminator, pursuer, T-Rex, Yeti, Patient Zero and clones) takes a plain `blade` hit (no cut) that deals its table chip (R-054) with a parry spark; no `accepts` list changed. The T-Rex accepts `blade` for the samurai only, so the Katana never gives its handler a cut. Nuclear plants, the mothership and tornadoes are never reached (zero cells), and samurai and hunter ships are ignored.

## Hunter ships

Hunter ships are the registry kind `hunterShip` (`engine/aliens.js`; it has no `hitbox`, so the rifle still finds one once through `shipTargets`). It accepts `plasma`, `bullet`, `bolt` and `fire`; EMP and the Katana chip it through the table (0.08), and it never takes `freeze`. All damage reaches `waves.js` `hitHunter` against a hull of 4, which ignores downed ships:

| Weapon | Hull per hit |
| --- | --- |
| Plasma rifle | 1 (MEGA BEAM 5) |
| Minigun | 0.25 a round |
| Railgun and Lightning-tile bolt | 2 |
| Fire Gun | 0.5 a tick (about 8 ticks) |
| Katana | none in practice (ignored; table cell 0.08) |
| EMP | 0.08 chip |

Rocket Strike still damages hunters only through its existing ship path. The Black Hole Gun pulls hunters like any registry enemy within 100 m and consumes them. Hits below 1 point (minigun, fire) give a light spark and a quiet cue; the full burst is for plasma or the downing hit.

## GHOST flight (air support)

`engine/airSupport.js` (R-056) is an ally, not an enemy: three stealth fighters that arrive 30 s into a run and hunt the alien ground crew. They read the crew through `aliens.targets()` (patrol and escort only) and kill through the owner's `plasmaKill`, the same direct call the rifle makes, so the burn, the death cry and the score are the aliens' own. They do not go through `enemies.hit` (no table cell, no other kind is touched), they never hit hunter ships, the UFO or the mothership, and their blasts are visual (`explosions.spawnImpactBurst` only, no `explosion` event). The kill rate is capped for the whole flight at one alien per 5 s (`airSupport/plan.js`, `mayStartStrike` / `mayKill`, tested in `tests/air-support.test.mjs`). They never pick an alien within 10 m of Roger while another is available.

## Shared enemy states

The registry supports these states:
- `frozen`
- `disintegrated`
- `absorbed`

These states are used for cross-type effects without hard-coding logic into each enemy owner.

## Health and the weapon table

Every enemy has health in `engine/health/damageTable.js` (alien 1, Terminator and pursuer 30, T-Rex 40, Yeti 30, Patient Zero 12, clone 1, hunter ship 4, UFO 6, samurai 3, nuclear plant 5, mothership 15, tornado 20). `enemies.hit` applies the table to every hit and calls the owner's optional `defeat(e, hit)` at 0 health; per-instance health lives in a WeakMap in the registry. Samurai, the UFO, the nuclear plant, the mothership and the tornado are not registry kinds and are routed through their own call sites (`hitSamurai`, `hitShip`, `chipTarget`). Enemies and disasters never hurt a samurai. See R-054 for every value.

## Damage contract

A registered enemy kind accepts a set of hit types and implements `damage(e, hit)`. That is the project’s core rule for enemy-specific weaknesses and reactions: accepted types reach the handler; any other hit chips health through the table instead of being ignored.

Examples of hit families:
- `plasma`
- `bullet`
- `bolt`
- `emp`
- `fire`
- `freeze`
- `gravity`
- `cleanse`
- `blade`

A hostile entity has its own reaction (stun, knockdown, kill) only to the damage types it explicitly accepts; other types chip its health.

## How to add a new enemy

1. register the kind with `ctx.systems.enemies.registerKind(...)`
2. implement `list()` for active instances
3. define `position(e)` and `hitbox(e)` where relevant
4. set `accepts` and `damage(e, hit)`
5. reuse registry state helpers for freeze, dissolve, or absorption
6. keep destruction effects running through the generic damage/effect pipeline

Do not create a second enemy registry or a side-channel combat system.
