# Performance and stability notes

## Hot paths

The main hot path is the simulation loop in `src/app/tornado/tornadoEngine.js` plus the physics and damage passes.

The most sensitive modules are:
- `engine/physics.js`
- `engine/damage.js`
- `engine/debris.js`
- `engine/environment/`
- `engine/explosions/`
- `engine/sound/`

This project is optimized for a single interactive simulation, not a generic engine.

## Pooling and lifecycle

The codebase already reuses pooled objects where appropriate:
- debris is pooled and reused
- explosion bursts share effect systems
- lights come from `lightPool.js`
- `Sim.objects` is the canonical live list of moving objects

Lifecycle resets also matter: stale objects left behind can create CPU and memory drift over time.

## Constraints

- avoid per-frame allocation in hot loops
- do not add or remove lights mid-run unless the current pattern already supports it
- do not create a second destruction pipeline
- keep object traversal targeted and compact
- reuse effect and sound systems instead of duplicating heavy visual logic

## Benchmarking and caps

The repo already contains performance budget helpers in:
- `engine/perf/`
- `engine/perf/caps.js`
- `engine/perf/bench.js`
- `PROJECT_HISTORY.md` (part 1: findings, measurements and traps)

Check those before changing high-impact systems.

## Validation

Use the project gate:

```bash
npm run lint
npm run build
```

If a change is visual or runtime-sensitive, validate with the smallest relevant manual check and keep it scoped.
