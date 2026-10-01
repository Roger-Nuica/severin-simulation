# Plan: test-trail-color

## Goal
Change the plasma rifle's shot trail colour from its current blue to a slightly darker blue, without altering any gameplay values (damage, cooldown, cell cost, beam length/width, hit resolution).

## Clarifications needed
- "Trail" is read here as the plasma beam's visible streak drawn in `buildBeam()` (`src/app/tornado/engine/hero/plasma.js:366-381`) — specifically the layer commented `// blue sheath` (line 379, `THREE.Color(0.6, 1.8, 5)`). Confirm this is the element meant, since the file has several other blue-tinted elements that are visually related but distinct:
  - the `// white-hot core` layer (line 378) and `// halo` layer (line 380) of the same beam
  - the view-rifle charging energy strip colour (`updateCharge()`, line 76) — brightens while the trigger is held, separate from the fired shot
  - the MEGA BEAM ring colour (line 463) and beam splash colour (line 386, 463) — only triggered on a charged/mega shot
  - the screen flash colour `'#bfe6ff'` passed to `lightning.flashScreen()` on a mega shot (line 444)
  If the intent is only the normal-shot trail, scope stays to line 379. If it should look consistent across the whole plasma effect (mega beam included), say so and the halo/ring/splash colours should be darkened proportionally too.
- No specific target hex/RGB value was given ("un pic mai închis" / "slightly darker") — confirm a rough target (e.g. reduce each RGB component by ~20–30%) is acceptable, or provide an exact colour.

## Subtasks
- [x] Subtask 1: Darken the plasma beam's blue sheath colour
  - Likely files: `src/app/tornado/engine/hero/plasma.js` (`buildBeam()`, line 379; optionally lines 378/380 if the core/halo should shift together for visual consistency)
  - Depends on: none
  - Risks / edge cases:
    - These RGB values are HDR-style (components run above 1.0) feeding an `AdditiveBlending` `MeshBasicMaterial` — "darker" here means reducing magnitude while keeping the blue-dominant ratio, not clamping to a standard 0–1 hex colour; a naive hex-based "darker blue" could look wrong under additive blending/bloom.
    - This is a pure rendering-layer change (colour constant only); per `CLAUDE.md` "Development rules" and R-047, do not touch beam geometry, opacity/blend mode, timers, or any value governed by R-033/R-034 (cell cost, cooldown, charge/hold timing, beam width/length, damage table).
    - `buildBeam()` constructs the mesh once per run and is reused; no lifecycle/reset/dispose changes are needed for a colour-only edit.
    - Verify visually in both normal and charged (partial-width) shots, since `S.state.beamWidth` scales the same mesh/material.
  - Validation: `npm run lint`, `npm run build`, manual check — fire the plasma rifle in Hero Mode and confirm the trail reads as a darker blue without affecting hit detection, cooldown, or energy cost.
  - Files changed: `src/app/tornado/engine/hero/plasma.js`
  - Result: Reduced the `// blue sheath` layer colour (line 379) from `THREE.Color(0.6, 1.8, 5)` to `THREE.Color(0.45, 1.35, 3.75)` — a uniform 25% magnitude reduction, keeping the exact RGB ratio (and hue) under additive blending. Clarifications were left unanswered, so scope was kept to the narrow default stated in the plan: only line 379 touched; core (378) and halo (380) layers, the charging energy strip, and MEGA BEAM rings/splash/flash colours were left untouched.
