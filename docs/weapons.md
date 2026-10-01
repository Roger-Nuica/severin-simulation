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

The mouse wheel cycles through them; UI text mirrors the same names and colors.

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
