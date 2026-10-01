# Plan: Black Hole visual redesign and sound pass

## Goal
Rework the Black Hole Gun visual treatment and add audio feedback while preserving the existing gameplay contract: 20 s duration, 100 m pull radius, 40 m no-escape zone, one-at-a-time behavior, and the existing swallow/dissolve logic.

## Clarifications needed
- No blocking clarifications required. The gameplay narrative is documented in `GAME_DESIGN.md`, numeric contracts in `.claude/rules.md`, and the engine code path in `src/app/tornado/engine/player/blackHole.js` and `src/app/tornado/engine/heroWeapons.js`.

## Subtasks
- [x] Subtask 1: Audit the exact current Black Hole contract and visual hooks
  - Likely files: `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/engine/player/blackHole/look.js`, `src/app/tornado/engine/player/blackHole/wind.js`, `src/app/tornado/engine/player/blackHole/matter.js`, `src/app/tornado/engine/player/blackHole/dissolve.js`, `src/app/tornado/engine/effects/consumables.js`, `src/app/tornado/engine/heroWeapons.js`, `GAME_DESIGN.md`, `.claude/rules.md`
  - Depends on: none
  - Risks / edge cases:
    - changing pull math or duration would alter gameplay balance
    - visual redesign must not break the existing no-escape and dissolve rules
    - sound and visuals must be layered on top of the same state machine rather than reimplementing it
  - Files changed: none (read-only audit)
  - Result: Numeric contract in `HOLE` (`blackHole.js:46-66`) matches `.claude/rules.md` R-031 exactly (cost 5 = 50% energy, 20 s, escape 40 m, influence 100 m, knockdown 70 m, horizon 3 m; `heroWeapons.js:73` `minRange: 12` matches too) — no contradiction found. State machine confirmed as the single authority (`open/fire/capture/reach/drawIn/close/finish`), one-at-a-time enforced via `pending` in `fire()`. Visual hooks (`look.js` shader vortex, `wind.js` inflow streaks, `matter.js` particle-pool stream, `dissolve.js` clip-plane cut + fragments) are each driven by `blackHole.js` state and own no gameplay logic. `effects/consumables.js` is the sole registry the hole queries. Caps already in place: `HOLE.maxCaught` 60, `DISSOLVE.maxAtOnce` 6 / `maxFragments` 1400, `MATTER.max` 2400.

- [x] Subtask 2: Lock down the render-layer change for the Black Hole appearance
  - Likely files: `src/app/tornado/engine/player/blackHole/look.js`, `src/app/tornado/engine/player/blackHole/matter.js`, `src/app/tornado/engine/player/blackHole/dissolve.js`, `src/app/tornado/engine/scene.js`, `src/app/tornado/engine/post.js`
  - Depends on: Subtask 1
  - Risks / edge cases:
    - visual depth ordering can make the effect disappear in the scene
    - shader/material changes can create performance spikes or pooling issues
    - dissolve behavior must remain synced with the underlying hole life cycle
  - Files changed: none
  - Result: By user decision, the existing render layer (shader-based spiral vortex in `look.js`, the arm-following particle stream in `matter.js`, the clip-plane dissolve in `dissolve.js`) is accepted as the completed redesign — it already replaced an earlier flat "Saturn rings" look per `look.js`'s own header, and `GAME_DESIGN.md` only specifies "draws objects into a vortex" with no further target. No render-layer code changed; subtask treated as satisfied by the current implementation rather than inventing an undirected new look.

- [x] Subtask 3: Add the sound layer without changing combat behavior
  - Likely files: `src/app/tornado/engine/sound/`, `src/app/tornado/engine/heroWeapons.js`, `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/engine/events.js`
  - Depends on: Subtask 1
  - Risks / edge cases:
    - adding sound to every state transition can create repetitive or noisy loops
    - the Black Hole is one-at-a-time and should not trigger overlapping audio events incorrectly
    - must respect the project’s event-driven sound patterns and not introduce ad hoc global audio state
  - Files changed: `src/app/tornado/engine/sound/blackHole.js` (new), `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/tornadoEngine.js`
  - Result: New `createBlackHoleSoundSystem` follows the exact `sound/empHum.js` + `engine/empCharge.js` pattern — a continuous level-driven hum (`updateHum(hole.size)` called every frame, same curve the visuals swell/collapse on) instead of discrete per-event triggers, so it cannot overlap or stutter (only one hole ever exists). `playOpen()`/`playClose()` are one-shots on the state machine's own `open()`/`finish()`, layered alongside the existing shared `shockwaveSound.playShockwave()` rather than replacing it. No per-capture/swallow one-shots were added, deliberately, since up to `HOLE.maxCaught` (60) things can be caught at once — the hum is the only continuous feedback. Registered as `ctx.systems.holeSound` in `tornadoEngine.js`, right before `blackHole` (mirroring `empHum`/`empCharge` registration order), without `{ auto: true }`; its `disposeBlackHoleSound()` is called explicitly from `blackHole.js`'s own `disposeBlackHole()`, so the lifecycle audit sees it as handled via the same indirect-call pattern `empHum` already uses.

- [x] Subtask 4: Verify reset/dispose and lifecycle safety
  - Likely files: `src/app/tornado/engine/lifecycle.js`, `src/app/tornado/engine/context.js`, `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/engine/tornadoEngine.js`
  - Depends on: Subtasks 2 and 3
  - Risks / edge cases:
    - stale particle systems or listeners can leak across remounts
    - reset/dispose must restore the hole state cleanly between runs
    - visual/sound systems must not persist after the hole collapses or is replaced
  - Files changed: none (verification only; the wiring was already lifecycle-correct from Subtask 3)
  - Result: Traced `lifecycle.js`'s `register()`/`endPhase()`: `blackHole` is registered with `{ auto: true }`, so `initBlackHole`/`resetBlackHole`/`disposeBlackHole` are matched by the `init`/`reset`/`dispose` name patterns and auto-run each phase. `holeSound` is registered without `auto`, same as `empHum` — its `disposeBlackHoleSound` is only reached because `blackHole`'s own `disposeBlackHole` calls it explicitly, and since `blackHole` is registered after `holeSound`, the reversed dispose-phase order runs `blackHole`'s dispose first, which marks `holeSound`'s dispose as already-called before the registry would otherwise warn or double-call it — confirmed against the identical `empHum`/`empCharge` registration order already in the file. `SoundSystem`'s `AudioContext` is created once at bootstrap (`initSoundSystem()`, not re-run on Reset), so `holeSound`'s `ensureGraph()` guard (`graph.ctx === ctx`) keeps reusing one graph across resets exactly like `empHum` and `hero.js` already do — oscillators started once, left at zero gain when idle, never recreated or leaked per run. All stop()/disconnect() calls in `disposeBlackHoleSound` are wrapped in try/catch, matching the project's defensive pattern, so dispose ordering relative to the master `SoundSystem` teardown (`tornadoEngine.js` dispose, ~line 1454) cannot throw. `resetBlackHole()` and the no-hole branch of `updateBlackHole()` both now call `updateHum(0)`, so the hum cannot persist past a collapse, a queued re-open, or a Reset. No contradictions or leaks found.

- [x] Subtask 5: Validate with repo checks and targeted visual sanity check
  - Likely files: `package.json`, `CLAUDE.md`, relevant engine files above
  - Depends on: Subtasks 2, 3, and 4
  - Risks / edge cases:
    - build regressions from unsupported Three.js API use
    - lint issues from unhandled audio or scene references
    - gameplay contract accidentally changed while tuning visuals
  - Files changed: none
  - Result: `npm run lint` — clean (project-wide, including the new `sound/blackHole.js` and the edits to `player/blackHole.js` / `tornadoEngine.js`). `npm run build` — fails with the same pre-existing `Module not found: '@luigi-project/client'` in `TornadoSimulator.js:101` already confirmed unrelated to Black Hole work in the prior `PLAN_test-trail-color.md` session (reproduced identically via `git stash` on an unmodified tree). No gameplay-contract files (`heroWeapons.js`'s `HOLE`-reading lines, `HOLE` itself in `blackHole.js`) were touched by Subtask 3 — only sound wiring was added. No manual in-browser visual/audio check was run (no dev server session); recommend firing the Black Hole Gun once in Hero Mode to confirm the hum swells/fades audibly and the open/close one-shots land before calling this fully verified end-to-end.

## Follow-up: pre-existing build blocker — RESOLVED
`./src/app/tornado/TornadoSimulator.js:101` imported `@luigi-project/client`, which was never an installed dependency, so `npm run build` failed before reaching any bundling of the engine. Per explicit user request (the Luigi shell integration is no longer used), the dead `useEffect` that dynamically imported it — along with its now-stale doc comment — was removed from `TornadoSimulator.js`. `npm run build` now completes successfully end-to-end, which also serves as the full-build confirmation Subtask 5 couldn't get before.

## Implementation notes
- This task is intentionally visual and audio-only. The gameplay contract is fixed and must remain the source of truth.
- The correct pattern is to update the render and sound layers while keeping `blackHole.js` as the authority for the state machine.
- Reuse the existing effect and event infrastructure instead of creating a second parallel black hole system.
