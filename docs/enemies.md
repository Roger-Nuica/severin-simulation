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

- `engine/aliens.js` — alien attack logic
- `engine/terminator.js` — EMP-resistant hostile units
- `engine/trex.js` — cyber T-Rex logic
- `engine/yeti.js` — hostile snow/beast variant
- `engine/patientZero.js` — special hostile threat
- `engine/heroMode.js` / `heroWeapons.js` — Roger’s direct combat interactions

Not every hostile actor is a separate class; some are registry-backed kinds using the same contract.

## Shared enemy states

The registry supports these states:
- `frozen`
- `disintegrated`
- `absorbed`

These states are used for cross-type effects without hard-coding logic into each enemy owner.

## Damage contract

A registered enemy kind accepts a set of hit types and implements `damage(e, hit)`. That is the project’s core rule for enemy-specific immunity and reactions.

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

A hostile entity reacts only to damage types it explicitly accepts.

## How to add a new enemy

1. register the kind with `ctx.systems.enemies.registerKind(...)`
2. implement `list()` for active instances
3. define `position(e)` and `hitbox(e)` where relevant
4. set `accepts` and `damage(e, hit)`
5. reuse registry state helpers for freeze, dissolve, or absorption
6. keep destruction effects running through the generic damage/effect pipeline

Do not create a second enemy registry or a side-channel combat system.
