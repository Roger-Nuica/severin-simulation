---
name: disaster-system-change
description: Use when adding, modifying, disabling, or removing a disaster system; trace UI, engine registration, frame updates, cross-system consumers, lifecycle, rules, and performance.
---

# Skill: Disaster System Changes

Add, modify, disable, or remove a disaster by following the existing disaster-system wiring and preserving its gameplay, cross-system, lifecycle, and performance contracts.

**SAVES:** Prevents incomplete disaster changes such as a removed panel button with a still-running update, missing Reset cleanup, stale Doomsday references, or effects that exceed shared caps.

**WHEN TO USE:** Whenever a task creates a new disaster, changes an existing disaster's behavior, makes one unavailable, or removes one from the game.

**SOURCE:** `src/app/tornado/TornadoSimulator.js`; `src/app/tornado/tornadoEngine.js`; `src/app/tornado/engine/lifecycle.js`; example systems `src/app/tornado/engine/electricStorm.js`, `src/app/tornado/engine/earthquake.js`, and `src/app/tornado/engine/downburst.js`; `src/app/tornado/engine/doomsday.js`; `src/app/tornado/engine/perf/caps.js`; `.claude/rules.md`; `GAME_DESIGN.md`.

## How it works in this repository

- Disaster buttons are declared in the `Disasters` section of `TornadoSimulator.js`, using IDs such as `btn-electric`, `btn-earthquake`, and `btn-downburst`. System init methods bind handlers to `ctx.signal`; stateful controls also synchronize button state such as `aria-pressed`, `active`, and `disabled`.
- Disaster factories are imported and registered in `tornadoEngine.js`. Registration order matters because systems access each other through `ctx.systems`.
- `lifecycle.js` discovers `init*`, `reset*`, and `dispose*` functions. `{ auto: true }` can run lifecycle methods at phase boundaries, but does not add a system to the frame loop. The owning update method still needs the correct explicit call in `tornadoEngine.js`, along with explicit reset/dispose wiring when the system is not auto-managed.
- Existing systems expose their own trigger/state APIs. For example, Doomsday calls `ctx.systems.earthquake.triggerEarthquake()` and `ctx.systems.electricStorm.setElectric(true)`; minimap, collision, environment, and other systems may also read a disaster's API.
- Disasters that emit particles use shared pools and `ctx.systems.caps`; a local pool capacity does not replace the shared `particleRoom()` / `trackPool()` contract.

## How to extend it

### Add a disaster

1. Read the approved plan, `.claude/rules.md`, the relevant sections in `GAME_DESIGN.md`, and the closest existing disaster system. Verify exact tunables in runtime code; do not copy old values from prose or memory.
2. Identify the owning factory and state. Keep mutable state per simulation instance in the factory closure or `Sim`/`ctx`; expose the smallest necessary API on the system returned to `ctx.systems`.
3. Add the panel control in `TornadoSimulator.js` with an ID and state semantics matching the disaster. Bind listeners using `ctx.signal` in the owning system.
4. Import and register the factory in `tornadoEngine.js` in dependency order. Add its explicit per-frame update call and ensure init, reset, and dispose run exactly once using either `{ auto: true }` for lifecycle phases or the established explicit calls.
5. Search for related consumers before wiring interactions: `doomsday.js` scripts disasters; `collisions.js`, `ui/minimap.js`, environment systems, sound systems, and missions may consume or expose disaster state. Update only the integrations required by the approved task.
6. Add sound through the existing sound systems and registration paths when requested; do not introduce module-global audio state or unmanaged listeners.
7. If the disaster creates particles, lights, enemies, or transient entities, use the existing pools/caps and ask permission before any cap increase.
8. Damage to the player: if the disaster can hurt Roger or a co-op player, route it through `ctx.systems.health.damagePlayer({source, ...})` with a source entry (value and death message) in `engine/health/config.js` (R-053); never call `killRoger` directly. Use damage over time ticks of 0.25 s (`health/dot.js`) or once-per-event latches (`health/hazards.js`) rather than per-frame damage, and keep the tornado, debris and ice at daze or freeze only (R-001).
9. Update `GAME_DESIGN.md` for player-facing behavior and `.claude/rules.md` for protected numeric contracts. If runtime code conflicts with existing rules, stop and report it before changing the affected gameplay.

### Modify a disaster

1. Locate its owning factory and trace every public method and consumer before editing.
2. Preserve existing behavior not explicitly changed by the task, especially mode exclusions, enemy immunities, scoring, cross-disaster interactions, button state, and reset/dispose behavior.
3. Update related descriptions, rule values, dependent consumers, benchmark coverage, and documentation in the same approved scope. Do not leave stale button hints or scheduled-script references.

### Remove or disable a disaster

1. Confirm the approved task explicitly requests removal or disabling; do not infer removal from a redesign request.
2. Search the repository for its button ID, factory/import, `ctx.systems` key, update/reset/dispose functions, sound system, CSS/banner identifiers, config/constants, and every direct consumer or scripted trigger.
3. Remove or disable only the owned integration points. Preserve shared systems and APIs still used by other disasters. For a temporary disable, prefer the existing feature flag or availability pattern if one exists; do not delete the implementation unless removal is approved.
4. Remove stale documentation and test/benchmark references, and verify no dangling imports, button IDs, event listeners, or consumer calls remain.

## Safety guards

Apply `.claude/rules.md` and the fixed safety gates in `.claude/skills/full-autonomous-run/SKILL.md` to every disaster change. Stop and report instead of proceeding if:

- the change would alter another system's immunity, accepted damage, weapon behavior, or protected gameplay contract;
- implementation requires increasing shared particle, entity, or performance caps;
- runtime values conflict with `.claude/rules.md` for a system in scope;
- required dependencies or acceptance criteria are unclear;
- an explicit performance target is not credible for the current architecture;
- an existing system lacks a safe reset/dispose path and adding the requested behavior would leak listeners, scene objects, materials, textures, pools, or audio.

For a new rendering, physics, or algorithmic technique without a close project analogue, identify it as the highest-risk plan subtask. After that subtask is implemented, stop and request the user's visual/manual confirmation before building dependent work on top of it.

## Validare

- Run the narrowest relevant check after each subtask.
- For a completed disaster change, run `npm run lint` and `npm run build` when available, and manually test activation, deactivation, Reset, and remount/dispose behavior.
- Use `?perf=1` or `?bench=1` when the change affects repeated effects, entities, particles, or frame cost.
- Report what was checked, what remains unverified, and any safety stop or approval needed.
