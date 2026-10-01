# Tornado simulator — persistent AI context

This repo is a single-page Three.js disaster sandbox running inside Next.js. The engine lives in `src/app/tornado/engine/` and is assembled in `src/app/tornado/tornadoEngine.js` from small lifecycle-driven systems.

## Project overview

- App runtime: browser simulation, not a separate game engine.
- UI entry: `src/app/tornado/TornadoSimulator.js`
- Simulation bootstrap: `createSimulation(container)` in `src/app/tornado/tornadoEngine.js`
- Root state: `Sim` in `src/app/tornado/engine/context.js`
- Registry pattern: subsystems live on `ctx.systems`
- Design preference: per-instance state and lazy lookups, not module-level globals

## Fresh-session workflow

A fresh Claude session should be able to start directly from the repo.

1. Read `CLAUDE.md`.
2. Read the nearest subsystem docs: `docs/architecture.md`, `docs/combat.md`, `docs/weapons.md`, `docs/enemies.md`, `docs/performance.md`.
3. Find the exact file that owns the behavior to change.
4. Reuse the closest analogue in the same subsystem before inventing a new pattern.
5. Confirm the lifecycle and reset/dispose contract.
6. Explain a short task-specific plan, then patch minimally.
7. Validate with the smallest relevant command: `npm run lint`, `npm run build`, or a focused manual check.
8. Summarise what changed and which systems were touched.

Do not ask for missing project history when the repo already contains the answer.

## Task anchors

### Black Hole visuals and sound

- `src/app/tornado/engine/player/blackHole.js`
- `src/app/tornado/engine/player/blackHole/look.js`
- `src/app/tornado/engine/player/blackHole/wind.js`
- `src/app/tornado/engine/player/blackHole/matter.js`
- `src/app/tornado/engine/effects/consumables.js`
- `src/app/tornado/engine/heroWeapons.js`
- `src/app/tornado/engine/sound/`

Keep behavior unchanged: duration, pull radius, no-escape zone, swallow/dissolve flow, and gameplay logic. Treat visuals and sound as rendering/audio-layer changes, not gameplay rewrites.

### Katana / melee work

- `src/app/tornado/engine/heroWeapons.js`
- `src/app/tornado/engine/heroMode.js`
- `src/app/tornado/engine/enemies.js`
- `src/app/tornado/engine/damage.js`
- `src/app/tornado/engine/sound/creatures/recipes.js`
- `src/app/tornado/engine/spaceship/samurai.js`

Reuse the weapon, enemy, and damage contracts instead of building a parallel melee system.

### Enemy and damage tasks

- `src/app/tornado/engine/enemies.js`
- `src/app/tornado/engine/damage.js`
- `src/app/tornado/engine/aliens.js`, `terminator.js`, `trex.js`, `yeti.js`, `patientZero.js`

### Visual and performance tasks

- `src/app/tornado/engine/scene.js`, `post.js`
- `src/app/tornado/engine/particlePool.js`, `lightPool.js`
- `src/app/tornado/engine/perf/`

## Stack

- Next.js 16.3.5
- React 19.2.8
- JavaScript + JSDoc, no TypeScript
- Three.js 0.186.1
- Web Audio API
- ESLint / Next linting

## Repo map

- `src/app/page.js` — app entry
- `src/app/tornado/TornadoSimulator.js` — React wrapper and engine mount
- `src/app/tornado/tornadoEngine.js` — system registration and frame loop
- `src/app/tornado/engine/` — simulation systems
- `src/app/tornado/engine/player/` — hero input, abilities, energy, black hole
- `src/app/tornado/engine/environment/` — world actors and map content
- `src/app/tornado/engine/effects/` — consumables, regions, impact effects
- `src/app/tornado/engine/sound/` — procedural audio and cues
- `public/sounds/` — audio assets
- `docs/` — architecture, combat, weapons, enemies, performance notes
- `GAME_RULES.md`, `FINDINGS.md`, `NOTES.md` — gameplay and design references

## Architecture

Core flow:

`src/app/page.js -> TornadoSimulator.js -> createSimulation(container) -> createSim() -> system registration -> animation loop`

Key rules:

- `createSimulation()` creates a fresh `Sim` and `ctx`
- `createLifecycle(ctx)` enforces the lifecycle contract
- Systems register on `ctx.systems` and expose `init*`, `reset*`, `dispose*`, and `update*`
- Most gameplay logic is reached lazily through `ctx.systems.*`

## Important systems

- `context.js` — shared state and object model
- `lifecycle.js` — registration and init/reset/dispose ordering
- `time.js` — slow motion and world timing
- `events.js` — lightweight event bus
- `scene.js` / `post.js` — rendering and scene graph
- `heroMode.js` / `heroWeapons.js` — hero state and weapon flow
- `enemies.js` / `damage.js` — combat registry and hit resolution
- `physics.js` / `collisions.js` — motion and contact logic
- `environment/` — town, vehicles, people, shelters, buildings, disasters
- `sound/` — procedural audio graph

## Development rules

- Do not rewrite the architecture without reason.
- Reuse `ctx.systems` and lifecycle hooks instead of adding singletons.
- Keep state on `Sim`/`ctx`; avoid module-level mutable state.
- Keep event listeners bound to `ctx.signal` or an `AbortController`.
- Prefer small, targetted edits over broad refactors.
- Preserve lifecycle reset/dispose behavior.
- Reuse existing damage, effect, and sound paths instead of duplicating them.

## Performance rules

- `Sim.objects` is a hot path.
- Reuse pooling for debris, bursts, lights, and other repetitive effects.
- Avoid per-frame allocations in hot loops.
- Keep object traversal and effect churn low.
- Follow the project’s perf caps and benchmark notes in `engine/perf/` and `FINDINGS.md`.

## Validation

Project gate:

- `npm run lint`
- `npm run build`

For gameplay/visual tasks, manual validation is expected when the change is stateful or visual rather than pure logic.

## Standard task summary

```md
# Implementation Summary

## What changed
- ...

## Files changed
- ...

## Systems affected
- ...

## Important architectural decisions
- ...

## Validation
- `npm run lint`
- `npm run build`

## Known issues
- ...

## Follow-up considerations
- ...
```

This file is the short-term working context; the source-of-truth remains the repo itself.
