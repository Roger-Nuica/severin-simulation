# Architecture

## High-level flow

```text
src/app/page.js
  -> TornadoSimulator.js
  -> createSimulation(container)
  -> createSim()
  -> register systems in tornadoEngine.js
  -> animation loop updates each system
```

`src/app/tornado/tornadoEngine.js` is the bootstrap point. It creates the context, registers systems on `ctx.systems`, and drives update order.

## Core state

- `createSim()` in `src/app/tornado/engine/context.js` creates the root state object.
- `Sim.objects` is the live list of physical objects the storm can affect.
- `Sim.stats` tracks destruction totals and score data.
- `ctx.systems` is the registry of engine subsystems.
- `ctx.events` is the shared cross-system event bus.

## Lifecycle

The lifecycle contract is enforced by `src/app/tornado/engine/lifecycle.js`.

- register with `register(name, system)`
- auto systems run `init*`, `reset*`, and `dispose*`
- non-auto systems must be invoked at the right phase
- dev mode warns when lifecycle hooks are missing or out of order

This matters because environment setup, damage, debris, and UI all depend on correct ordering.

## Subsystem groups

### Rendering and scene
- `scene.js` builds the renderer, camera, and scene
- `post.js` handles render passes
- `weather.js`, `clouds.js`, `dayNight.js`, `lightning.js` define atmosphere and FX

### Player and hero
- `engine/player/input.js` captures keyboard and mouse state
- `engine/player/abilities.js` handles slow-motion, teleport, EMP-style powers; `engine/player/grapple.js` is the grappling hook (G)
- `engine/player/energy.js` stores energy and spend/restore logic
- `engine/heroMode.js` owns Roger’s state and movement
- `engine/heroWeapons.js` holds the weapon wheel and close-up models

### Combat and damage
- `engine/health/` is Roger's health: `system.js` registers `ctx.systems.health` (auto lifecycle: `initHealth`, `resetHealth`, `disposeHealth`, plus `updateHealth(rawDt)` called by `tornadoEngine.js` after `updateHero`, on real time). It exposes the one player-damage API `damagePlayer`, `health`, `state`, `glow` and `revivePlayer`. Pure helpers sit beside it: `state.js` (regeneration), `melee.js` (touch, wind-up), `dot.js` and `fire.js` (damage over time), `hazards.js` (lava, flood), `friendlyFire.js`, `enemyDamage.js` and `damageTable.js` (weapon x enemy), with every number in `config.js`. Co-op health rides the net snapshot (`hp` rows) and a `playerDamage` event
- `engine/enemies.js` is the shared registry for enemy kinds and hit acceptance
- `engine/damage.js` owns damage resolution, collapse logic, and score updates
- `engine/physics.js` applies force and object motion
- `engine/collisions.js`, `debris.js`, `debrisImpacts.js` handle contact and impact effects

### World actors
- `engine/environment/` contains the town, buildings, vehicles, roads, shelters, parks, and trains
- `engine/aliens.js`, `terminator.js`, `trex.js`, `yeti.js`, `patientZero.js` register hostile actors
- disaster systems include `earthquake.js`, `flood.js`, `meteors.js`, `chasm.js`, `sinkhole.js`, `firenado.js`, `volcano.js`, and similar modules

### UI and feedback
- `engine/ui.js` owns HUD and control-panel logic
- `engine/gamefeel.js` drives combos, shake, and slow-motion feel
- `engine/sound/` holds the procedural audio graph
- `engine/explosions/` and `groundFx.js` handle aftermath visuals

## Rules to follow

- per-instance state, not module-level mutable state
- most calls go through `ctx.systems.*` or `ctx.events`
- lifecycle-managed systems respect `init` / `reset` / `dispose`
- keep the architecture local and system-oriented, not class-heavy

## Where to start

Start with the nearest subsystem analogue, then follow the correct lifecycle, damage, and effect chain.

Examples:
- new disaster -> inspect nearby disaster system in `engine/`
- new enemy behavior -> inspect `engine/enemies.js` and the owning enemy file
- new weapon -> inspect `engine/heroWeapons.js`, `engine/heroMode.js`, and the damage registry
- new destruction feedback -> inspect `engine/damage.js`, `explosions/`, and `gamefeel.js`
