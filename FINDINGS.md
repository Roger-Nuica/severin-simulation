# Tornado simulator — key findings

The essentials learnt while building and measuring the game: what was
measured, what it showed, what was done about it, and the traps to avoid.
Kept up to date with every measured change, so nothing has to be found out
twice. The three files each have one job:

- **`GAME_DESIGN.md`**: the narrative gameplay guide and how each event is
  meant to feel to the player.
- **`.claude/rules.md`**: exact implementation contracts and protected
  gameplay values.
- **`PROJECT_HISTORY.md`**: archived decision snapshots, roadmap history, and unapproved future ideas; not a source of current behavior.
- **`FINDINGS.md`** (this file): measurements, lessons and traps, with the
  charts in `docs/perf/`.

All figures come from headless Chromium in the cloud container (no GPU,
swiftshader), unless a line says otherwise. They compare runs with each
other. They are not what a player's machine will see: a laptop's CPU is
faster, and its GPU is untested (see "Not measured yet").

---

## How to measure

- **`?perf=1`**: a live panel in the corner of the game. It shows CPU per
  frame by section (heaviest first), draw calls, triangles, lights (lit /
  wanting), physics objects (and how many are asleep), the quality step
  and the heap. Anything over budget is shown in red.
  (`engine/perf/monitor.js`)
- **`?bench=1`**: a fixed scenario on a fixed step. It ends with one result
  on the page, in the console (`[bench] {...}`) and on
  `window.__tornadoBench`. The page keeps the last result per scenario and
  shows the change next to each figure. (`engine/perf/bench.js`)
  - `&scenario=heavy` (default): the tornado, doomsday at 2 s, the aliens'
    second wave at 8 s and a nuclear meltdown at 20 s.
  - `&scenario=normal`: the tornado only.
  - `&seconds=60`: how long the scenario runs.
  - `&render=0`: CPU only, the only practical way in the headless
    container.
  - `&scenario=hero`: Hero Mode, the tornado and a Terminator.
  - `&scenario=reset`: a busy run, reset half way through, then started
    again. It covers every system's reset.
  - `&seed=N`: a different random seed.
  - `&trace=1` / `&traceFrame=N`: find where two runs diverge.
- **Reproducible.** The same code and seed give the **same fingerprint**
  (objects, damage, collapses, people, aliens, a position checksum). A
  refactor that only moves code must leave the fingerprint unchanged. That
  is the safety net for the refactoring.
  - Verified: two 60 s heavy runs gave `866/1184477/571/78/0/33/-3107.35`
    both times, and three 15 s runs also matched.
  - Run-to-run CPU noise is about ±5%.

## Performance budget

Defined in `engine/perf/budget.js`. It is set just above the current
measurements, so a regression shows up as a FAIL.

| What | Budget | Measured now |
|---|---|---|
| CPU mean, heavy scenario (container) | 12 ms | 11.4 ms |
| CPU mean, normal scenario (container) | 11 ms | 10.1 ms |
| CPU p99, heavy scenario | 25 ms | 22 ms |
| Draw calls per frame (shadows and post included) | 400 | 252 (heavy, after the meltdown) |
| Real point lights | 6 (+1 for lightning) | 6 |
| Heap growth | 2 MB/s | not measurable headless |
| Per-frame allocations in hot paths | none | none (see traps) |

Anything new has to fit in the budget. If it does not, something else has to
be made cheaper first.

## Results

![Performance audit: before and after](docs/perf/audit-overview.svg)

| Metric | Before audit | After |
|---|---|---|
| Draw calls per frame, normal | ~2,430 | 382 |
| Draw calls per frame, heavy (after the meltdown) | 1,430 meshes drawn one by one | 252 |
| Real point lights | 27 | 7 |
| Shadow casters | 1,873 | 694 |
| Funnel churn CPU | 2.56 ms (at 30 Hz) | ~0 (vertex shader) |
| Physics CPU, ~800 objects | 1.1 ms | 0.5 ms |

![Heavy scenario CPU by section](docs/perf/heavy-cpu-sections.svg)

The "heavy" section figures come from `?bench=1&render=0`, as the mean ms per
frame. "Before" is the 30 s run at the start of step 2; "after" is the 60 s
run at the end of it.

| Section | Before | After |
|---|---|---|
| instancer + world matrices | 4.64 | 5.01 |
| funnels | 2.56 | 1.53 |
| physics | 1.18 | 1.16 |
| ui (minimap, stats panel) | 1.13 | 0.38 |
| disasters | 0.92 | 0.94 |
| effects | 0.57 | 0.52 |
| people | 0.47 | 0.29 |
| everything else | 1.55 | 1.58 |
| **total** | **13.03** | **11.41** |

`render=0` does not count the render call's own CPU. What instancing saves
(one draw call instead of hundreds, and far fewer objects for three.js to
sort and cull) therefore does not show in these figures. The instancer's
side of that trade (copying matrices) does show, which is why "instancer"
went up by 0.4 ms while the frame drew about 1,200 fewer objects.

![Heavy scenario: what gets drawn](docs/perf/heavy-draws-by-source.svg)

### Particle budget (engine/perf/caps.js)
- The effects that exist use a lot of particles: about **5,000** drawn at
  12 s into the hero scenario, and a peak of **6,791** in the heavy
  benchmark (`particlesMax` in the `?bench=1` result).
- The shared budget is **10,000**, which leaves at least ~3,200 for the new
  effects in the worst moment.
- Counting what is in use is done every 4th frame, over every tracked pool.
- Enemies are capped at 160 in all, and Patient Zero's clones at 50.
- **With the fuel stations (PR 1a)**, whose three pools (spray 500, flames
  700, smoke 900) ask `particleRoom()` before every emission, the peaks are
  (`particlesMax`): heavy 60 s **7,220**, hero 40 s 7,386, works 40 s 7,538,
  landing 75 s 7,454, storm 40 s 7,753, reset 25 s 7,923. All under the
  10,000 budget.
- The fingerprints changed in every scenario with that step, as they must:
  the stations now leak and go up when a funnel reaches them, and the cars
  round a tanker go up after it. Two heavy runs gave the same fingerprint
  (determinism kept). New references:
  heavy 60 s `855/1280474/572/84/0/54/7637.52`,
  hero 40 s `666/775443/254/88/91/10/6867.55/hero 0 68.18`,
  storm 40 s `627/540718/316/79/3/8/12861.05`,
  landing 75 s `809/582820/346/79/81/8/39985.23/ship down 0.0,0.0`,
  works 40 s `699/712013/288/88/87/6/14780.25`,
  reset 25 s `417/223723/32/67/100/10/5869.47`.

### The comprehensive pass (three r186, matrix walk, swirl)

Measured with `?bench=1&render=0` (mean CPU ms per frame, 60 s heavy and
40 s hero), before and after each step:

| Step | heavy | hero | instancer (heavy) |
|---|---|---|---|
| Start (three 0.160, main after PR 10) | 7.23 | 6.96 | 2.88 |
| Hidden subtrees skipped in the matrix walk, swirl loop tightened | 6.15 | 5.68 | 2.28 |
| three 0.160 → 0.186.1 (Timer, no other change) | 6.08 | 5.80 | 2.04 |
| With the cows (8 cows, 48 meshes and a fence) and the sharks | 6.56 | 5.84 | 2.34 |

- **Hidden subtrees** (engine/matrices.js): about 700 of the scene's ~3,750
  objects sit under something hidden (pools waiting, spare variants, lamps
  off). three draws nothing under a hidden object, so their world matrices
  are no longer rebuilt; the subtree is rebuilt whole the frame it is shown
  again. The fingerprints did not change with it.
- **The swirl loop** (vortex/particles.js): the per-frame constants are
  worked out once rather than per particle, and funnelRadiusAt is inlined
  with the same arithmetic. Fingerprints unchanged.
- **`renderer.debug.checkShaderErrors`** is now off outside `next dev`:
  `getProgramInfoLog` was 9.2% of a heavy run's CPU in the profile (every
  new material compile asks the driver for its log). It does not show in
  the bench (which runs under `next dev`), only in production builds.
- **three 0.186.1**: `THREE.Clock` is deprecated (r183), replaced by
  `THREE.Timer` connected to the Page Visibility API (no huge step when a
  tab comes back). No other API the game uses changed.
  **The fingerprints change with the upgrade** although nothing in the game
  did: three draws every object's `uuid` from `Math.random`, which the
  bench seeds, and r186 makes a different number of internal objects, so
  the seeded stream is shifted. New references (with the cows and sharks):
  heavy 60 s `866/1175337/571/77/0/33/725.65`,
  hero 40 s `662/767737/254/89/74/10/4998.66/hero 0 14.76`.
  Particle peaks: heavy 7,133, hero 7,551 (budget 10,000).
- Still to do: a building's interior is walked every frame though it
  almost never moves. Marking intact buildings static was tried on paper
  and left: too many systems (fire, sinking, shaking, the chasm) move a
  part of an intact building without changing its damage state.

### Life-size scale (docs/SCALE.md)

People went from 5.5 m to 1.8 m. Buildings went to real storeys, and the
funnel's default radius from 20 m to 30 m. CPU per frame
(`?bench=1&render=0`, same container, mean ms):

| Scenario | Before | After |
|---|---|---|
| heavy 60 s | 4.90 | 5.08 |
| hero 40 s | 4.87 | 5.00 |

The fingerprints change with it, as they must: every building, the funnel
and the crowd changed size. New references:

- heavy 60 s: `781/1170844/450/77/0/30/30373.41`
- hero 40 s: `506/615707/51/78/99/8/5062.76/hero 0 40.47`

Particle peaks: heavy 7,327 and hero 7,455, against a budget of 10,000.

### The giants (Yeti, T-Rex, their stalemate), 2026-10-01

The Yeti and the T-Rex are now 15 m and 18 m, with the Yeti's cold gun and
the 15 s stalemate between them (`engine/giants/clash.js`). A new bench
scenario, `&scenario=giants`, calls both in with the storm up: they close
on each other and clash, flame against frost, within the run.

`?bench=1&render=0`, same container, mean ms:

| Scenario | Before (80f3b14) | After |
|---|---|---|
| heavy 60 s | 4.72 | 4.80–5.09 (three runs) |
| hero 40 s | 4.77 | 4.93–5.09 (three runs) |
| normal 50 s | — | 4.94 |
| giants 50 s | — | 5.14, particles 8,486 at the peak |

So both giants and the clash cost about 0.2 ms of CPU over the same town
without them, and stay under the particle budget (10,000). The fur is one
instanced mesh per moving part (four draws for ~1,000 strands).

The fingerprints change: the new systems make their meshes, materials and
pools at start-up, and three.js draws a UUID for each from Math.random,
which the bench has seeded -- everything after is shifted. (The cold gun's
canvas textures use a random generator of their own, so they add nothing.)
New references:

- heavy 60 s: `758/1159147/450/77/0/17/32215.28`
- hero 40 s: `568/693392/92/102/106/4/1428.95/hero 0 29.98`
- giants 50 s: `914/557453/295/68/53/6/-19529.61`

The camera's glide to a new character does not run under the bench
(`ctx.benchmarking`): the hero scenario presses 🤖 Terminator.

### Highway ramps and creature sounds, 2026-10-01

`?bench=1&render=0`, mean ms, after both: giants 50 s 5.23 (5.14 before),
hero 40 s 4.89, heavy 60 s 5.18 -- within run-to-run noise. The creature
sounds cost a distance check per sound asked for; the swarms are held back
by each kind's minimum gap before any audio node is made. New fingerprints
(the highway's new spans and the sounds' random draws shift them):

- heavy 60 s: `776/1118921/436/74/0/21/18873.97`
- hero 40 s: `512/627492/53/83/99/8/-480.95/hero 0 38.21`
- giants 50 s: `793/510118/257/71/57/10/6593.67`

### Black Hole Gun, opaque flood, Bullet Time, Fire Gun, 2026-10-01

Measured on the production build (`next start`), `?bench=1&render=0`,
against the previous commit (fb10348) built and run the same day on the
same machine -- this container ran ~40% slower than the session above, so
the earlier figures are not comparable:

| scenario | before (fb10348) | after | |
|---|---|---|---|
| hero 40 s | 7.22 ms (p99 14.2) | 7.41 (13.6) | noise |
| giants 50 s | 7.41 (13.7) | 8.06 (16.2) | the smaller Yeti closes differently |
| heavy 60 s | 8.81 (18.1) | 8.48 (16.3) | noise; no auto meteors/quake now |
| hole 60 s (new) | — | 4.40 (11.9) | flood + black hole + Yeti at once |

The new `hole` scenario is test 8 of the request: the dam break's surge and
flood with a black hole opened in its path and the Yeti called into it.
Its frame stays well inside 16.7 ms on the CPU. The GPU side (the opaque
water's two meshes, the hole's 1400-fragment and 320-streak instanced
meshes, 300 bullets) is not measured here (no GPU in the container).

New fingerprints (the scheduled meteors and earthquake are gone, the Yeti
is smaller, the minigun has 200 rounds):

- heavy 60 s: `780/758329/436/85/0/47/24974.71`
- hero 40 s: `762/702989/282/100/96/10/-23655.17/hero 0 -26.33`
- giants 50 s: `872/371348/295/69/61/10/-4986.09`
- hole 60 s: `409/230219/91/110/62/8/16629.97`

## Key findings (the essentials)

1. **The funnel's surface noise was the single biggest CPU cost** (half a
   frame at the start). It now runs on the GPU (`engine/funnelChurn.js`),
   and the CPU only sets about 20 numbers per frame. It is also smoother:
   it used to redraw at 30 Hz and now updates every frame.
2. **Draw calls come from things built out of many small meshes**: people
   (6 parts), trees (2), cars (9), aliens (14–17), building walls, and
   explosions (7 objects each). Instancing, one InstancedMesh per kind of
   part, is what took the draw calls from thousands down to hundreds. After
   a nuclear mutation the aliens alone were 915 draws, and are now 12.
3. **Explosion particles now share two pools** (`particlePool.js`, with
   size and alpha per particle) instead of 3 Points per explosion: 102 draws
   became 2.
4. **The real lights are shared** (`lightPool.js`): effects ask for a
   light, and each frame the 6 that matter most near the camera get real
   ones. Adding or removing real lights recompiles every material.
5. **Physics sleep**: about half of a busy town's objects are at rest at
   any moment, and skipping them halved the physics cost.
6. **World matrices**: rebuilding only what moved matches three.js exactly
   (checked on all 4,316 objects). What is left of the cost is the walk
   over ~3,500 objects: about 0.3 µs each, because the objects come in many
   different shapes (megamorphic property access).
7. **Each explosion's sound used to fill fresh noise buffers**: 60,000 to
   125,000 random numbers per explosion, several explosions a second. The
   buffers are now made once and shared (`sound/thunder.js
   createShortNoiseBuffer`).
8. **The minimap redrew every frame** (1.2 ms). It now redraws at 20 Hz. The
   stats panel now writes to the DOM only when a value changes.
9. **The sound had its own effect on the game's randomness.** Sounds that
   play or not depending on the audio clock, or on a sample having loaded,
   used to draw from `Math.random`, so two identical runs diverged. Sound
   now has its own generator (`sound/random.js`).

## Traps (do not do these)

- **`Object3D.lookAt` for a camera pose.** An ordinary object turns its +z
  to the target; a camera looks down its -z. A quaternion taken from a
  plain Object3D aimed the glide's camera exactly backwards
  (`engine/camera.js`). Use `Matrix4.lookAt(eye, target, up)` (the camera
  convention) and `setFromRotationMatrix`.
- **A new system's random numbers at start-up** shift the seeded bench
  (three.js draws every UUID from Math.random), so any new mesh or material
  changes the fingerprint. Expected for a feature; for something meant to
  change nothing (a refactor), build the same objects in the same order.
- **Stepping THREE.Timer on requestAnimationFrame's timestamp.** That
  timestamp is when the frame began; after a long start-up it is earlier
  than the first, direct call to animate, so the first step is negative.
  A negative dt run through the funnel's rope-out *grew* it (birth 3 before
  Start, with the town being wrecked while "standing by"). Step it with
  `update()` (performance.now) and clamp dt at 0 (tornadoEngine.js animate).

- **No `new THREE.Vector3()` (or any allocation) in anything that runs every
  frame or per object.** Use scratch vectors, and pass an `out` vector.
- **No `performance.now()` / `Date.now()` in simulation code.** Use
  `ctx.now()` (the real clock in the game, the fixed clock in the benchmark).
  Otherwise the benchmark stops being reproducible.
- **No `Math.random()` in sound code.** Use `soundRandom()` /
  `soundRandFloat()` from `sound/random.js`. `THREE.MathUtils.randFloat`
  counts as `Math.random` too.
- **Every `addEventListener` passes `{ signal: ctx.signal }`** (the engine's
  lifetime, aborted in `dispose()`). Without it, a remount (React StrictMode
  in dev, or leaving the page in the Luigi shell and coming back) left the
  disposed instance answering the panel's buttons: Reset also reset the dead
  instance and threw (`meteors.js createMeteor`). This was found by the
  benchmark's `reset` scenario.
- **No new real lights.** Use `lightPool.createLight` or `requestLight`.
- **Small parts should not cast shadows** (limbs, wheels, trim, poles,
  hats).
- **A new thing made of many meshes** (a new creature or vehicle) should go
  through the instancer, or be justified with a number from `?bench=1`.
- **Many separate `Points` or `Sprite`s for an effect**: use a shared
  `particlePool`.
- **Redrawing DOM or canvas UI every frame**: throttle it, or write only
  on change.
- **A short benchmark (`seconds` below the 2 s warm-up) used to measure
  nothing and hang its caller.** It now measures the second half and always
  ends with a result or an error on `window.__tornadoBench`.
- **Comparing benchmark numbers across sessions.** The container's speed
  varies by tens of percent from one session to the next. Build the
  previous commit in a `git worktree` and run both the same day.
- **Clipping planes need `renderer.localClippingEnabled`** and a material of
  their own: the black hole's dissolve clones a building's materials (they
  are shared across the town), and puts the originals back when it is done.
- **An effect sized for a giant, fired from the camera**, fills the screen:
  the Fire Gun uses the T-Rex's flames at 0.42 of their size and 0.55 of
  their alpha.
- **Headless checks**: never run a real-time rendered loop in swiftshader
  (a few fps: minutes per check). Run `?bench=1&render=0`, then render
  **one** frame if a picture is needed.

## Refactoring log

- **`aliens.js` and `heroMode.js` were split into folders** (`engine/aliens/`,
  `engine/hero/`), each file now under 720 lines. The code was only moved:
  a scope-analysis tool rewrote the references into `S.x` (shared state) and
  `api.fn` (the other modules' functions), and the `?bench=1` fingerprints
  are identical before and after (heavy, hero).
- **Every file over ~900 lines was then split the same way** (vortex,
  electricStorm, fissure, powerLines, spaceship, meteors, peopleMotion,
  gasMains, flood, factory, viaduct, damage, terminator). Each became a
  folder with its tunables and shared types in `config.js`. The largest file
  left in any of them has 824 lines.
  - Every split was checked against a scenario that runs that code
    (`heavy`, `storm`, `landing`, `works`, `hero`), with identical
    fingerprints before and after.
  - Still over 800: `tornadoEngine.js` (1,543 lines: it builds and
    registers every system, and the frame; the next candidate, to be split
    into construction and the frame), and `chasm.js`, `vortex.js`,
    `nuclear.js`, `ui/minimap.js` at 808–827 lines.
- **Lifecycle registry** (`engine/lifecycle.js`): every system goes through
  `register()`. New systems use `{ auto: true }`. The audit found
  `clearSpeechBubbles` documented as called "on reset" but never called,
  so the old crowd's speech bubbles survived a Reset. The heavy fingerprint
  is unchanged.
- **Event bus** (`engine/events.js`, on `ctx.events`): `announce`,
  `notice`, `empPulse` and `rogerKill` are now emitted instead of 14 direct
  calls into Hero Mode and Smooth Criminal from 11 files (mothership,
  nuclear plants, UFO, hunters, EMP, Electric Tornado, lightning, car
  rescue, minigun, railgun, plasma). The hero fingerprint is unchanged.
- **Type checking** (`// @ts-check`, JSDoc, `jsconfig.json`,
  `types.d.ts`): `npx tsc -p jsconfig.json` checks 108 of the 140 files, and
  a wrong argument in any of them now fails it (tried: an extra argument
  was caught as TS2554).
  - Making them pass meant documenting what had drifted: fields added to
    aliens and to `SimObject` over time and never written into their
    types, and the shared types now visible across files.
  - Still unchecked (156 errors in 32 files, mostly JSDoc unions missing
    states added later, like `'muster'` and `'strain'`, and inference that
    loses tuples). Clean them a file at a time and add `// @ts-check`:
    PwaSupport.js, TornadoSimulator.js, aliens/crew.js, chase/carRescue.js, chase/index.js, chasm.js, clouds.js, context.js, damage.js, downburst.js, earthquake.js, electricStorm.js, emergency/index.js, environment/backdrop.js, environment/blockers.js, environment/buildings.js, environment/fuelStation.js, environment/peopleMotion.js, environment/powerLines.js, environment/tanker.js, environment/train.js, environment/viaduct.js, firenado.js, fissure.js, flood.js, heroMode.js, possess.js, sound/cues.js, terminator.js, ui.js, vortex.js, tornadoEngine.js.
  - three ships no types. `@types/three` would check the three.js calls
    too, but it is a new dependency, so it has not been added.
- **Listener leak** (see Traps): found by the `reset` scenario and fixed
  for all 59 listeners at once.

## Next targets (measured, not done yet)

- **The world-matrix walk (~1.6 ms with nothing moving, ~4–5 ms in the heavy
  scenario).** Idea: skip subtrees that are known to be static, such as
  building interiors and the backdrop, with a version number on the parent.
- **The funnel's swirl particles** (most of the remaining ~1 ms in
  "funnels"; the loop was tightened in the comprehensive pass): the same
  move to the GPU as the surface.
- **Explosion fireball and shock-ring sprites** (4 draws per explosion, for
  under half a second each): a shared instanced billboard.

## Not measured yet

- **A real GPU, and a real phone.** The container has no GPU. Open the game
  with `?perf=1` on the phone (with `next dev -H 0.0.0.0` on the LAN) and
  read the fps and draw figures. Run `?bench=1` for a CPU number that can
  be compared.
- **Heap growth**: `performance.memory` does not update in headless Chrome.
  Measure it in a desktop Chrome with `?perf=1`.
