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

The Katana (`engine/hero/katana/`) is a melee weapon with no energy cost. It stays in the follow camera: right-click draws or holsters it and never enters first-person `aiming`.

- **Quick Slash**: a click or swipe under 0.25 s. A swipe of 28 px or more picks one of six directions; a plain click chains diagonal, horizontal, vertical. Reach about 3 m, auto-lunge up to about 6 m, cooldown 0.35 s (real time).
- **Blade Mode**: hold the button 0.25 s. The world is held at 10 % through the named hold `bladeMode`; it ends on release with no line, on Escape, after three cuts or after 4 s (real time). Roger is not slowed.
- **Targets**: only registry kind `alien` (patrol, escort, exiting) is cut, through `enemies.hit` with a `blade` hit that carries `cut`. Every other registered kind parries and takes no damage; no `accepts` list was changed. The T-Rex accepts `blade` for the samurai, so the Katana never sends `blade` to a non-alien.
- **Cut**: `crew.js` `sliceKill` removes the alien and hands its root to `katana/pieces.js`, which builds two clipped halves with a glowing cap. At most 32 live pieces (oldest recycled), three cuts an alien, about 6 s life with a 1.5 s fade.
- **Feel and score**: `gamefeel.event('slice')` then one `damage.addDamageScore` per landed slash; multi-cut bonus 50 and extra-piece bonus 20 (`KATANA_FEEL`). Hit-stop is 0.065 s of real time on the hold `katanaHitStop`.
- **Blood**: one 600-particle pool (inside the shared 10,000 cap, clamped by `particleRoom()`) and a ring of 48 splatter decals.

## Input and firing

Input is split from gameplay logic:

- `player/input.js` captures key and mouse events into a queue
- `heroMode.js` consumes that queue and decides whether to fire, switch weapons, or trigger an ability

This keeps control flow separate from the simulation and avoids mixing camera or mode logic into the weapon system.

## Adding a new weapon

Before adding one, inspect:
1. `engine/heroMode.js` for selection and aiming state
2. `engine/heroWeapons.js` for the current state machine
3. `engine/enemies.js` for accepted hit types and resistances
4. `engine/damage.js` for score and destruction response
5. the relevant effect and sound systems

The project prefers reusing the existing damage and visual pipelines rather than creating a second combat path.

## Constraints

- keep weapon cycles, cooldowns, and input handling in sync with hero state
- respect enemy registry + damage rules
- route visual-only changes through `gamefeel` and `sound` instead of inventing ad hoc paths
- do not create a parallel weapon system unless the existing file is genuinely overloaded
