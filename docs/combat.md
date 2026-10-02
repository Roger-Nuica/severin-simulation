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

## Hunter ships

The hunter ships are the registry kind `hunterShip` and accept `plasma`, `bullet`, `bolt` and `fire` (EMP and the Katana chip them through the table, 0.08 a hit; the Katana never reaches them): rifle 1 (MEGA BEAM 5), minigun 0.25 a round, railgun and Lightning-tile bolt 2 (the bolt lands within the 9 m ship disc), Fire Gun 0.5 a tick (3D cone test and the 9 m disc), against a hull of 4. The Katana never hits them; Rocket Strike uses its existing ship path. A downed hunter ignores further hits.

## Weakness model and exclusions

Every weapon hurts every enemy. `accepts` now means "handled by the owner's weakness path" (stun, knockdown, kill, consume) and is unchanged. `enemies.hit` also looks up the weapon x enemy table in `engine/health/damageTable.js` for every hit; a hit the owner does not accept chips the enemy's health (2% of it, no visible effect, no particles), and at 0 health the owner's `defeat` runs its normal kill path. See R-054.

Remaining exclusions:
- The Katana never damages nuclear plants, the mothership or tornadoes (zero cells), and is ignored by hunter ships and samurai.
- Enemies and disasters never damage a samurai; only Roger's weapons do (`PLAYER_WEAPONS_ONLY`).
- The Black Hole Gun is not damage: it consumes registry enemies outright, and it also swallows its caster (and in co-op a guest) inside the 40 m zone.
- Some objects are intentionally excluded from `Sim.objects` because they must not be swept by the main physics system.

## Damage to the player

Every hit on a player goes through `ctx.systems.health.damagePlayer(...)` (R-052, R-053). Never call `killRoger` directly for damage. Sources have per-source values and death messages in `engine/health/config.js`; melee touches share one helper (`health/melee.js`, 2 m reach, 3 s cooldown, Terminator wind-up 0.6 s from 6 m); damage over time ticks every 0.25 s; friendly fire is on. The tornado, debris and ice never damage Roger.

Known gaps: Roger's own minigun, railgun, Fire Gun and Katana against the co-op partner, and the guest's plasma splash and Fire Gun against the host, are not routed; barrels and exploding chain cars deal nothing to Roger; the tanker kill radius (66 m) reuses its set-off radius and is unconfirmed; fissure crack strips do not burn.

## Aftermath

Damage normally triggers existing effect stacks:
- `explosions` spawn bursts and shockwaves
- `gamefeel` handles shake and slow-motion cues
- `debris` registers thrown pieces and impacts
- `buildingFire` and similar systems manage fire propagation

Reuse the existing impact pipeline rather than inventing a second damage path.
