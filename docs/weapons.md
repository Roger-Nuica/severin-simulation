# Weapons and hero combat

## Current architecture

The hero weapon flow is split across a few files:

- `src/app/tornado/engine/player/input.js` captures raw input
- `src/app/tornado/engine/heroMode.js` owns hero state, aiming, and movement
- `src/app/tornado/engine/heroWeapons.js` defines the firing logic and close-up models

There is no standalone weapon registry. The active weapon is selected by hero state, and the weapons module handles firing behavior.

## Existing weapons

In `heroWeapons.js` the active modes are:
- `rifle`
- `minigun`
- `railgun`
- `fire`
- `blackhole`
- `katana`

The mouse wheel cycles through them; UI text mirrors the same names and colours. `katana` is the sixth and last entry: the first five keep their original order.

## Katana

The Katana (`engine/hero/katana/`) is a melee weapon with no energy cost. Selecting it draws it automatically from the sheath on the back. Right-click enters first person (it reuses the `aiming` phase) and lowers it again; wheeling onto the Katana lowers to the follow camera. In first person the crosshair is at the centre, a first-person blade is shown and Roger's heading follows the view: with the left button up the mouse looks, with it held the look is frozen and the mouse movement draws the cut line from the crosshair (`bladeUi.js`, shown while dragged); releasing cuts along the line's exact angle (a drag under 28 px is a plain click and runs the chain). The first-person blade stays at the ready while walking. Q is Time Slow, as with every other weapon, and the Katana cuts in it (its timers run on real time).

- **Quick Slash**: a click or swipe outside Blade Mode, however long the button is held (there is no hold-to-enter). A swipe of 28 px or more picks one of six directions; a plain click chains diagonal, horizontal, vertical. Reach about 3 m, auto-lunge up to about 6 m, cooldown 0.35 s (real time).
- **Blade Mode** (not reachable since 2026-10-02: Q was given back to Time Slow; `katanaBladeToggle` remains, unbound): formerly Q with the Katana drawn, Q again to end it. The world is held at 10 % through the named hold `bladeMode`; it ends on Q, Escape, leaving first person (right-click out), changing weapon, a daze, a freeze or death, after the third cut or after 4 s (real time). Roger is not slowed and the look stays in real time. While it is on, hold the left button and drag to draw the line (from the crosshair in first person) and release to cut; a drag shorter than 24 px on release does nothing and the mode stays on. The hint 'Q: Blade Mode' is in the weapon message when the Katana is selected.
- **Targets**: registry kind `alien` (patrol, escort, exiting) is cut, through `enemies.hit` with a `blade` hit that carries `cut`. People are cut too, through the people owner's `eachCuttable`/`slicePerson` (never sent `blade`, no parry): the person-kill score 8 once per person with no multi-cut bonus, and the person falls in two through the pieces core. Hunter ships and samurai are ignored. Every other registered kind in reach (Terminator, pursuer, T-Rex, Yeti, Patient Zero, clones) takes a plain `blade` hit that deals its chip value from the central table (R-054) with a parry spark and no cut; nuclear plants, the mothership and tornadoes are never reached and take nothing. The co-op guest's Katana also cuts people (a burst, credited 8) and hurts the host (10); no `accepts` list was changed. The T-Rex accepts `blade` for the samurai only.
- **Cut**: `crew.js` `sliceKill` removes the alien and hands its root to `katana/pieces.js`, which builds two clipped halves with a glowing cap. At most 32 live pieces (oldest recycled), three cuts an alien, about 6 s life with a 1.5 s fade.
- **Feel and score**: `gamefeel.event('slice')` then one `damage.addDamageScore` per landed slash; multi-cut bonus 50 and extra-piece bonus 20 (`KATANA_FEEL`). Hit-stop is 0.065 s of real time on the hold `katanaHitStop`.
- **Blood**: one 600-particle pool (inside the shared 10,000 cap, clamped by `particleRoom()`) and a ring of 48 splatter decals.

## Hunter ships

Every weapon except the Katana can hurt a hunter ship (registry kind `hunterShip`, hull 4): rifle 1 (MEGA BEAM 5), minigun 0.25 a round, railgun and Lightning-tile bolt 2, EMP 0.08, Fire Gun 0.5 a tick (about 8 ticks; a 3D cone test and the 9 m ship disc). The Black Hole Gun pulls and consumes them. See `docs/enemies.md`.

## Every weapon hurts every enemy

The weapon x enemy table (`engine/health/damageTable.js`, R-054) gives each weapon (plasma, MEGA BEAM, minigun, railgun, Fire Gun, Katana, rocket, lightning, EMP) a value against every enemy; a weapon with no special effect chips 2% of the enemy's health. Zero cells are only the Katana against nuclear plants, the mothership and tornadoes. The UFO takes 0.12 from the minigun, Fire Gun tick, railgun and lightning bolt; the samurai take the Fire Gun as 0.06 a tick of 3 (50 ticks). The Rocket Strike blast reaches samurai through the rocket column; against registry kinds it keeps sending the MEGA BEAM, EMP and fire hits.

## Weapons against players

Friendly fire is on (R-053). Roger's own plasma or MEGA BEAM blast hurts him with linear falloff (15 / 40 at the centre, 1.5 m muzzle guard, none when there is no partner); minigun 3, railgun bolt 20, Fire Gun tick 2 and Katana 10 are the values against a co-op partner, but only rays, the Katana, the plasma splash, explosions and the black hole are routed. Not routed: Roger's minigun, railgun, Fire Gun and Katana against the guest, and the guest's plasma splash and Fire Gun against Roger.

## Input and firing

Input is split from gameplay logic:

- `player/input.js` captures key and mouse events into a queue
- `heroMode.js` consumes that queue and decides whether to fire, switch weapons, or trigger an ability

This keeps control flow separate from the simulation and avoids mixing camera or mode logic into the weapon system.

## Adding a new weapon

Before adding one, inspect:
1. `engine/heroMode.js` for selection and aiming state
2. `engine/heroWeapons.js` for the current state machine
3. `engine/enemies.js` for accepted hit types, and `engine/health/damageTable.js` for the weapon x enemy values
4. `engine/damage.js` for score and destruction response
5. the relevant effect and sound systems

The project prefers reusing the existing damage and visual pipelines rather than creating a second combat path.

## Constraints

- keep weapon cycles, cooldowns, and input handling in sync with hero state
- respect enemy registry + damage rules
- route visual-only changes through `gamefeel` and `sound` instead of inventing ad hoc paths
- do not create a parallel weapon system unless the existing file is genuinely overloaded
