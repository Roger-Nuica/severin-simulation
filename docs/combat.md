# Combat and damage

## Flow

1. A weapon or impact resolves a hit.
2. `engine/enemies.js` decides whether the target accepts that hit type.
3. `engine/damage.js` applies damage, score, collapse, and fire states.
4. downstream systems such as `gamefeel`, `explosions`, and `debris` react.

Key functions:
- `createEnemyRegistry(ctx)` in `engine/enemies.js`
- `createDamageSystem(ctx)` in `engine/damage.js`
- `createPhysicsSystem(ctx)` in `engine/physics.js`

## Enemy registry

The registry is the universal adapter layer for hostile entities.

Each enemy kind exposes:
- `kind`
- `list()` for active entities
- `position(e)`
- `accepts` damage types
- `damage(e, hit)`
- optional `hitbox`, `consume`, `object`, and `size` hooks

A new enemy should register itself through `ctx.systems.enemies.registerKind(...)`, not by creating a separate combat system.

## Damage families

The current registry recognizes these hit families:

- `plasma`
- `bullet`
- `bolt`
- `emp`
- `fire`
- `freeze`
- `gravity`
- `cleanse`
- `blade`

Damage is accepted by enemy kind, not globally.

## Destruction and score

The damage system is split by responsibility:
- `engine/damage/config.js` — tunables
- `engine/damage/trees.js` — sway, flatten, uproot
- `engine/damage/buildings.js` — collapse and structural shock
- `engine/damage/impact.js` — collision and impact resolution

Scoring is centralized in `engine/damage.js`; `gamefeel.js` owns combo and visual impact timing.

A Katana cut calls `gamefeel.event('slice', at)` (a combo event with a small shake) immediately before one `damage.addDamageScore`, so the chain extends and the score is multiplied once. Multi-cut (50) and extra-piece (20) bonuses go through the same path. The hit-stop is a 0.065 s real-time world hold with its own id, `katanaHitStop`, so it never releases Time Slow or Bullet Time.

## Immunity and exclusions

Some entities are intentionally resistant or excluded:
- Terminators are only meaningfully stopped by EMP-like effects.
- Some enemy types are more sensitive to fire or other hit categories.
- some objects are intentionally excluded from `Sim.objects` because they must not be swept by the main physics system.

If a target is meant to be immune, it is usually filtered at the hit-resolution layer or kept out of the active object list.

## Aftermath

Damage normally triggers existing effect stacks:
- `explosions` spawn bursts and shockwaves
- `gamefeel` handles shake and slow-motion cues
- `debris` registers thrown pieces and impacts
- `buildingFire` and similar systems manage fire propagation

Reuse the existing impact pipeline rather than inventing a second damage path.
