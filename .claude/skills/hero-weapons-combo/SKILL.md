---
name: hero-weapons-combo
description: Use when adding or changing a Hero Mode weapon, weapon-wheel input, damage scoring, or destruction combo behaviour; extend the existing weapon and score paths.
---

# Hero Weapons and Combo Scoring

Extend Hero Mode weapons through its existing wheel, input, trigger and HUD contract, and feed destruction scoring through the shared combo multiplier.

**SAVES:** Preserves the six-weapon selection path and prevents score/combo divergence; the existing combo window is 2.5 s with a +300% bonus ceiling.

**SOURCE:** `src/app/tornado/engine/heroWeapons.js`; `src/app/tornado/engine/hero/input.js`; `src/app/tornado/engine/heroMode.js`; `src/app/tornado/engine/damage.js`; `src/app/tornado/engine/gamefeel.js`; `GAME_DESIGN.md`, “Hero Mode” and “Scoring and feel”; `.claude/rules.md`, weapon and combo contracts.

## How it works

- `WEAPONS` is the ordered wheel source: `rifle`, `minigun`, `railgun`, `fire`, `blackhole`, `katana`. `createHeroWeapons()` owns the selected index and exposes `current()`, `cycle()`, trigger methods, `update()`, view placement, and HUD helpers (`heroWeapons.js:52-53, 109-148`).
- `createHeroInput().consumeInput()` drains the shared player-input queue. Its `wheel` event calls `S.weapons.cycle(e.dir)` and updates the rifle view; mouse and Enter route to trigger handling (`hero/input.js:49-69, 109-114`).
- `cycle()` releases an active trigger, wraps the index, refreshes the view and displays a weapon-specific HUD message (`heroWeapons.js:427-440`). Trigger ownership is dispatched by the selected weapon in `triggerDown()` and its paired release/update paths (`heroWeapons.js:449-480`).
- Combo events are not identical to all impacts: `gamefeel.js` marks which `EVENTS` extend the chain. `damage.addDamageScore()` multiplies score by both the Firenado multiplier and `gamefeel.comboMultiplier()` (`gamefeel.js:43-48, 111-180`; `damage.js:81-97`).
- The combo window is 2.5 real seconds; each counted event adds 0.15 to the multiplier bonus, capped at +3 (a 4x total multiplier) (`gamefeel.js:43-48, 284-295`).

## How to extend it

1. Read the assigned plan, `.claude/rules.md`, the closest existing weapon implementation and the relevant `GAME_DESIGN.md` weapon context.
2. Add the new weapon identifier in the correct wheel position without reordering existing weapons unless the task explicitly approves it; add its display name and colour alongside the current maps.
3. Wire its model/view and state into `createHeroWeapons()` and handle press, hold, release and per-frame updates in the existing dispatch. Reuse existing weapon helpers where appropriate (for example `createBullets()` or `createFireGun()`).
4. Keep wheel input in `hero/input.js`; do not add a second keyboard or mouse listener for weapon selection. Ensure HUD text, aiming view, run start/end and reset state include the new weapon.
5. For score-producing destruction, report the appropriate existing game-feel event before calling the shared score path. Do not make every hit a combo event: follow the event classification in `EVENTS`.
6. Check each target's damage contract before connecting a weapon to it; this skill does not grant new enemy vulnerabilities.

## Pitfalls / common mistakes

- Do not implement another weapon wheel or bypass `S.weapons.cycle()` from input handling.
- Do not update the wheel list without updating its HUD name/colour and trigger/view behavior.
- Do not let an active held trigger continue across a wheel change; `cycle()` calls `triggerUp()` for this reason.
- Do not award score through a second counter or apply the combo/Firenado multiplier twice.
- Do not mark impacts as combo events unless the existing event model classifies them as destruction.