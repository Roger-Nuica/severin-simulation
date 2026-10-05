# TODO

Open work in one place: the sound files the owner will send, checks only a
person can make, and the feature backlog.

## Sounds the owner will provide

Drop each file into `public/sounds/` under exactly this name. The code is
already wired for it; until the file is there the game plays the fallback
listed (and the browser console shows one harmless 404 for the missing file).

| File | What it is for | Where it is played | Until it is added |
| --- | --- | --- | --- |
| `jetpack.mp3` | Roger's jetpack burn. It loops for as long as he flies (Space), so a seamless loop of 1–4 s works best. | `src/app/tornado/engine/sound/grappleJet.js` (`JET_URL`) | Silent (on request, 2026-10-05) |
| `patient-zero.mp3` | Patient Zero making a clone. Only its first 2 s are played, once per clone. | `src/app/tornado/engine/sound/replicator.js` (`CLONE_URL`) | The old synthesised cue |

Wanted but not wired to a file name yet (they use a synthesised stand-in;
send a file and it will be hooked up):

| Sound | Where it would go | Today |
| --- | --- | --- |
| Plasma rifle shot | `sound/hero.js` (`PLASMA_SAMPLE_URL`, now `null`) | Synthesised zap |
| "Get over here!" shout of the grappling hook | `sound/grappleJet.js` (`SHOUT_SAMPLE_URL`, now `null`) | Synthesised growl and the browser's speech voice |

## Checks only a person can make

- Look, sound and frame rate on a real phone and a real desktop: every
  change of 2026-10-05 was checked headless in Chromium (software
  rendering), which is not a visual or audio check.

## Feature backlog

Ideas the owner liked (2026-10-02) and wants kept. Each one is a candidate,
not a contract: when one is picked, it gets a plan and its numbers go into
`.claude/rules.md`. Tick an idea off here once it ships.

### Disasters

- [ ] **Giant hail** — ball-sized ice falls over a chosen area: breaks windows,
  dents cars, dazes people. Builds on the shared particle pool.
- [ ] **Sandstorm (haboob)** — a brown wall of dust crosses town; visibility
  drops to a few metres, and aliens and Terminators lose sight of Roger.
- [x] **Solar storm / blackout** — auroras overhead, the power fails, lights go
  out, cars stall, Terminators and ships glitch for a few seconds. Ties in
  with the EMP and the power lines (shipped 2026-10-02 as the Solar Storm
  tile, `engine/solarStorm.js`; Roger's EMP runs down the lines during it).
- [x] **Gravity rift** — inside a zone everything floats up, then drops all at
  once (shipped 2026-10-02 as the Gravitron weapon, `engine/gravityRift.js`;
  since 2026-10-05 it lifts everything, including trees, clutter, every
  enemy and the ships, and only people and enemies explode).
- [ ] **Lake tsunami** — a giant wave rises from the lake and hits town from
  the side (separate from the dam break).

### Abilities for Roger

- [x] **Grappling hook** — G: pulls an alien to Roger, or zips Roger to a wall
  or a heavy enemy (shipped 2026-10-02, `engine/player/grapple.js`).
- [ ] **Rewind** — back 3 seconds in time (position and health). Pairs with
  Time Slow.
- [ ] **Force push** — a shockwave that throws cars, people and enemies 15 m
  ahead.
- [ ] **Decoy clone** — a holographic Roger the enemies attack for a few
  seconds.
- [x] **Telekinesis** — lift a car with the mouse and throw it (shipped
  2026-10-02 on C, `engine/player/telekinesis.js`).
- [x] **Jetpack / double jump** — a flight over buildings with flame and
  sound (shipped 2026-10-04 on Space, `engine/hero/jetpack.js`; since
  2026-10-05 one press flies, with no time limit; roofs and rubble are
  ground; silent until `jetpack.mp3` arrives).

### Performance and app

- [ ] **A higher frame rate, a smaller game** (owner's note) — make the game
  lighter to load and run, and revisit the PWA (the install button is
  switched off for now, `src/app/tornado/PwaSupport.js` `OFFER_INSTALL`).
  Start from "Next targets" in the findings (`PROJECT_HISTORY.md`, part 1).
