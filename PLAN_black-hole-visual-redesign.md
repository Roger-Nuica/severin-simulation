# Plan: Black Hole visual redesign and sound pass

## Goal
Rework the Black Hole Gun visual treatment and add audio feedback while preserving the existing gameplay contract: 20 s duration, 100 m pull radius, 40 m no-escape zone, one-at-a-time behavior, and the existing swallow/dissolve logic.

## Clarifications needed
- No blocking clarifications required. The gameplay narrative is documented in `GAME_DESIGN.md`, numeric contracts in `.claude/rules.md`, and the engine code path in `src/app/tornado/engine/player/blackHole.js` and `src/app/tornado/engine/heroWeapons.js`.

## Subtasks
- [ ] Subtask 1: Audit the exact current Black Hole contract and visual hooks
  - Likely files: `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/engine/player/blackHole/look.js`, `src/app/tornado/engine/player/blackHole/wind.js`, `src/app/tornado/engine/player/blackHole/matter.js`, `src/app/tornado/engine/player/blackHole/dissolve.js`, `src/app/tornado/engine/effects/consumables.js`, `src/app/tornado/engine/heroWeapons.js`, `GAME_DESIGN.md`, `.claude/rules.md`
  - Depends on: none
  - Risks / edge cases:
    - changing pull math or duration would alter gameplay balance
    - visual redesign must not break the existing no-escape and dissolve rules
    - sound and visuals must be layered on top of the same state machine rather than reimplementing it

- [ ] Subtask 2: Lock down the render-layer change for the Black Hole appearance
  - Likely files: `src/app/tornado/engine/player/blackHole/look.js`, `src/app/tornado/engine/player/blackHole/matter.js`, `src/app/tornado/engine/player/blackHole/dissolve.js`, `src/app/tornado/engine/scene.js`, `src/app/tornado/engine/post.js`
  - Depends on: Subtask 1
  - Risks / edge cases:
    - visual depth ordering can make the effect disappear in the scene
    - shader/material changes can create performance spikes or pooling issues
    - dissolve behavior must remain synced with the underlying hole life cycle

- [ ] Subtask 3: Add the sound layer without changing combat behavior
  - Likely files: `src/app/tornado/engine/sound/`, `src/app/tornado/engine/heroWeapons.js`, `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/engine/events.js`
  - Depends on: Subtask 1
  - Risks / edge cases:
    - adding sound to every state transition can create repetitive or noisy loops
    - the Black Hole is one-at-a-time and should not trigger overlapping audio events incorrectly
    - must respect the project’s event-driven sound patterns and not introduce ad hoc global audio state

- [ ] Subtask 4: Verify reset/dispose and lifecycle safety
  - Likely files: `src/app/tornado/engine/lifecycle.js`, `src/app/tornado/engine/context.js`, `src/app/tornado/engine/player/blackHole.js`, `src/app/tornado/engine/tornadoEngine.js`
  - Depends on: Subtasks 2 and 3
  - Risks / edge cases:
    - stale particle systems or listeners can leak across remounts
    - reset/dispose must restore the hole state cleanly between runs
    - visual/sound systems must not persist after the hole collapses or is replaced

- [ ] Subtask 5: Validate with repo checks and targeted visual sanity check
  - Likely files: `package.json`, `CLAUDE.md`, relevant engine files above
  - Depends on: Subtasks 2, 3, and 4
  - Risks / edge cases:
    - build regressions from unsupported Three.js API use
    - lint issues from unhandled audio or scene references
    - gameplay contract accidentally changed while tuning visuals

## Implementation notes
- This task is intentionally visual and audio-only. The gameplay contract is fixed and must remain the source of truth.
- The correct pattern is to update the render and sound layers while keeping `blackHole.js` as the authority for the state machine.
- Reuse the existing effect and event infrastructure instead of creating a second parallel black hole system.
