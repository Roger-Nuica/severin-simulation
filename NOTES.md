# Tornado simulator — agreed behaviour and ideas for later

A running record kept with Roger, so each working session starts from the
same understanding. **Agreed behaviour** is what the game is meant to do
now: read it before changing anything it touches, and update it when a
request changes it. **Ideas for later** are not built yet. The gameplay
narrative is in `GAME_DESIGN.md` and implementation contracts are in
`.claude/rules.md`; this file is the why and the what-next.

## Agreed behaviour

### Controls, Bullet Time, the Fire Gun (2026-10-01, on request)
- **W A S D everywhere**, the arrow keys removed (no fallback): Hero Mode,
  the car, Chase Mode, Control Tornado, the Landing ship, the free camera.
  Q Time Slow, E Teleport, R EMP. In a car E/Q/Esc get out (abilities are
  off while driving).
- **Time Slow lasts 7 s**; Q again ends it early. **With the minigun in hand
  it is Bullet Time** (Roger's proposal, built as he described it): the
  world at 3%, the minigun's bullets (real ones now, hero/bullets.js:
  brass, glowing tip, tracer, casings, sparks, instanced, 300 at most)
  hanging in the air -- those fired during it fly 5 m first -- then all
  going on together when it ends; the picture drained and vignetted, the
  camera drifting round Roger, the sound muffled with a time-warp in and a
  whoosh out.
- **Fire Gun** on the wheel: the T-Rex's fire (same particles at a man's
  scale, same sound, same burning), no energy. The **only** weapon that
  hurts the Cyber Yeti (fire only; an EMP stuns it); it burns aliens too.
- **Mega beam: 2 s** of charge (was 3). **Railgun: yellow.**
- **The minigun keeps its rules** (people and Terminators, 30 rounds a
  Terminator; the register enemies that take bullets), 200 rounds.

### Scripted events and the black hole (2026-10-01, on request)
- **Nothing chains by itself.** Starting the tornado sets off no other
  disaster: the scheduled meteor barrage (25 s), the rock aimed at the dam
  and the automatic earthquake (90 s) are gone, and the waterspout no
  longer breaks the dam. Meteors start only from their button, at random
  spots; the Dam Break only from its button. Doomsday's script still calls
  them itself. (The tanker's and the chemical works' fuses are set pieces of
  their own, not disasters, and stay.)
- **The flame "tornado" after shooting a tanker** was the Firenado's flames
  drawn on a funnel that was not there (the tanker and the fuel station
  called firenado.ignite with no storm up). Explosions no longer light it;
  it burns only on Ignite or when a funnel passes through a big fire, and
  never with no funnel on the ground.
- **The Black Hole Gun** replaces the R ability and the Disasters tile: a
  weapon on the wheel, aimed like the railgun, 50% energy a shot (as
  asked), 20 s open, one at a time (a second shot collapses the first and
  opens behind it). Pull out to 100 m as a swirling inward wind (the
  Downburst's turned round), no escape inside 40 m. It swallows
  **everything but Roger** through one hook, `engine/effects/consumables.js`:
  people, Sim.objects, buildings and every registered enemy kind by
  default (owners may give a quiet `consume`), anything else registers a
  provider (UFOs, hunter ships, mothership, nuclear plants, landed ships,
  tornadoes). Buildings and other big things dissolve in place (a clipping
  plane sweeping from the hole's side, instanced fragments streaming in);
  small things spiral in, stretched. Swallowed things are gone quietly.
- **The flood is opaque, murky and destructive**: a building-high wave
  (24 m at the breach) over a deep flood; buildings take damage ∝ depth ×
  speed² until they collapse, cars and trees are thrown and carried, people
  swept; foam, spray, mud; rushing water and wave crashes (sound/flood.js).

### Music (`engine/sound/cues.js`)
- The music is a playlist: `guta.mp3` played to its end, then `drobeta.mp3`
  to its end, then round again, for as long as the page is open.
- Nothing in the game stops, restarts or replaces it: Roger living or dying,
  a run starting or ending, Chase Mode, the Terminators, the ships.
- `terminator.wav` plays for a few seconds (6 s) **on top of** the playlist
  when a Terminator first comes within 50 m of Roger. It can play again once
  they have all been further than 75 m.
- `space-ship-music.wav` is treated the same way: a few seconds on top when
  the mothership arrives.
- Under those overlays the playlist dips a little and the storm (wind and
  rain hiss, thunder, effects) is turned down so they are heard. The storm is
  also turned down while the hunter ships are in the sky.
- Chase Mode's `car-music.wav` is switched off (`MUSIC.chaseTrack`), since it
  would play on top of the playlist.
- A track choice beside the Music switch (2026-10-01, on request): the
  playlist (default) or the old `city-sound.wav` (it never left
  `public/sounds/`; added in commit a7d0373), looped and levelled to the
  playlist's RMS. ~1 s crossfade; remembered (settings.js CHOICES). The
  12 MB WAV is fetched only once chosen.

### Creature sounds (`engine/sound/creatures.js`) — 2026-10-01
- On request: every character that was silent has spawn, movement, attack,
  hurt and death sounds where they make sense (design guide in GAME_DESIGN.md),
  positional (PannerNode, inverse distance), bigger = lower and heard
  farther. Pooled voices (18), quietest cut first, a minimum gap per kind
  so swarms share voices, nothing played out of hearing. One graph per
  held loop. A "Creature sounds" switch. Michael untouched.
- The giants' old sounds (sound/giants.js: steps and the clash) moved into
  it, now placed where they are.

### The elevated highway (`engine/environment/viaduct.js`) — 2026-10-01
- Ramps at both ends down to the ground and a ground road to the street at
  z = -20 (it used to stop in the air at the east and run into the dam at
  the west). The ramps are spans like the rest and fall the same way. The
  traffic drives the whole route and re-enters at the start.

### Hero Mode
- Roger's look: muscled, black leather jacket over a white T-shirt, Elvis
  pompadour with sideburns, dark glasses; a swagger walk. The panel button
  is a small "🦸 Hero".
- Minigun: 200 rounds (600 for a while; back to 200 on request, 2026-10-01).
- Roger is untouchable for the first 3 s of a run (was 2) (spawn shield).
- Two Terminators hunt him at once; each reboots once.
- Weapons, Q to switch on foot: plasma rifle, minigun (200 rounds, people and
  Terminators only, 30 rounds per Terminator), railgun (one lightning bolt per
  click, not within 9 m of Roger; the bolt kills aliens too).
- W, with any weapon: 3 s of slow motion at 30% for the world, not for Roger
  or his aim, so a shot can be lined up.
- After Roger's mega beam puts a tornado out, the Tornado button (or a
  preset) brings a new one down.
- He can walk out to the edge of the backdrop town (±288), stopping against
  its blocks and the dam wall. The old invisible wall at ±126 is gone.
- Meteors kill him; an EMP wave kills him on foot but not in a car.

### The Chase Mode car (`engine/chase/`)
- Parked beside the aliens' landing spot from the start of every game and
  after Reset; the opening camera looks at the aliens and the car.
- Drawn three times life-size (`CHASE_TUNE.carScale`), about Roger's height.
  Everything size-dependent reads that constant.
- In Hero Mode, touching its left (driver's) door puts Roger in and driving
  it straight away, with Chase Mode's handling and camera. After he gets
  out, he has to walk away before the door takes him in again. This does not
  end Hero Mode.

- Drives faster: top speed 34 (was 22), for the town's cars Roger drives too.
  Roger's run and the Terminators' walk keep their old speeds.
- Rescues people: whoever drives it (Chase Mode, or Roger in any car) slows
  below 10 beside people and they climb in, one every 0.3 s, and count as
  saved (`engine/chase/carRescue.js`).

### Explosions
- Anything violent enough sets off the town's explosives, storm or no storm
  (`engine/explosives.js`): the mothership's beam and crash, a crashing
  alien ship, meteors, lightning (the tile and the railgun), Roger's plasma,
  and the tanker and chemical works setting each other off. What goes off:
  the fuel tankers, the chemical works, the gas mains, the power lines.
- Five fuel tankers: the one on the ring road (20 s fuse) and four parked
  ones out towards the north, south, east and west edges of town (118 from
  the centre, on the long streets), with no fuse: a funnel, Roger's shot or
  anything violent beside them sets them off (`environment/tanker.js`).
- Order of size: tanker < chemical works < mothership crash < nuclear plant.
  The mothership crash and the nuclear blast share `explosions/megaBlast.js`
  (white-out, fireball dome, visible pressure wave over the whole map,
  secondaries, a mushroom cloud mesh).

### Smooth Criminal (`engine/smoothCriminal.js`)
- Disaster tile. A stage rises in the middle of town with the dancer (white
  pinstripe suit, fedora) on it; `public/sounds/smooth-criminal.mp3` plays,
  looped, with the playlist silent under it. After 2 s everyone (people and
  aliens) dances and nobody fights (`peace()`).
- Roger killing anyone during it ends it: the dancer rises to 90 m and
  explodes like a nuclear plant, in violet (no mutation); the song fades.
- Pressing the button again ends it quietly.
- Nothing plays over its song: terminator.wav and space-ship-music.wav
  wait, and one already playing is cut.
- The stage's light is 20% down (SMOOTH.stageLight 0.8; on request, the
  stage only): the floor read washed out.
- His ascent is filmed (2026-10-01, on request; the only change to him):
  the camera glides out to a medium distance, him in the middle of the
  frame, then pulls back to 260 m for the blast, in every camera mode, and
  gives the camera back (`ascentShot`).
- Mushroom clouds (all mega blasts): the stem fades 5 s after it has
  climbed; the cap lingers 15-25 s. The standing stem read as a leftover
  violet structure after the dancer's explosion.

### People
- New arrivals every 30 s on the game's own clock (not the storm's); from
  minute 2 they are armed and shoot aliens.
- Aliens dance when there are no humans left.

### Panel
- Aquamarine on dark teal (the override block at the end of `tornado.css`;
  it was blue, then amber). Smooth Criminal is a pill beside Hero. "STOP THE ALIENS" message when the game opens.

### Nuclear power plants (`engine/nuclear.js`)
- Two, at opposite corners of town. Destroyed only by: the mothership (its
  beam aims at them; its crash too), the alien ships (5 hits; the UFO and
  the hunters target them while any stands), Roger's mega beam, or the
  Electric Tornado running into one.
- Destroyed: 1.8 s critical, then the biggest explosion in the game, then a
  green EMP ring over the whole map that turns every person it passes into
  a sombrero alien over 2 s (`aliens.js mutate`). Roger is not mutated.
  It also kills Terminators and faults power lines.

### Aliens
- Hunter ships come 90 s after the first ship (was 150, then 120).
- The mothership comes after 4 abductions (was 5).
- All aliens move 30% faster (every crew speed in `ALIENS`).
- Second wave: 2 minutes after the first ship (was 20), a gold transport lands
  elsewhere and 20 more aliens in sombreros walk down its ramp, then it
  leaves. They go through town after people and Roger straight away.

### The giants (`engine/yeti.js`, `engine/trex.js`, `engine/giants/clash.js`) — agreed 2026-10-01
- The cyber Yeti (10.5 m since 2026-10-01: 30% smaller than the 15 m it
  was, on request) and the cyber T-Rex (18 m) are giants, at least 3x
  what they were, in the same class: over the houses, as tall as a
  townhouse or a small block. Hitboxes, reach, speed (by the square root of
  the size), flame and cone ranges, the footfall shake and thud all follow
  the height (`scale.js` GIANT).
- The Yeti is half yeti (fur with the hair showing), half cyborg (metal arm,
  leg and half the face, cyan lights), and carries a Mr. Freeze cold gun: a
  continuous cone that turns people to statues and freezes aliens (Roger by
  the storm's rule). Its ice storm is unchanged.
- The T-Rex's flames kill aliens too.
- Yeti meets T-Rex: always a stalemate, beams cancelling in the middle with
  steam, sparks, bursts and a hiss; exactly 15 s, then both hunt Roger, and
  that pair never fights again.
- A character called in from the panel: the camera glides to it in 1 s,
  then the camera mode carries on (`camera.js` glideTo). Not under the
  benchmark.

### Scale (`engine/scale.js`, `docs/SCALE.md`) — agreed 2026-10-01
- One unit is one metre; every size starts from the real thing and departs
  from it only by a factor written in `scale.js`, with the reason.
  Anything sized against a person derives from `PERSON.height` (1.8 m).
- Buildings bigger (real storeys), the tornado bigger, people to life size
  (they were 5.5 m), characters to the table in docs/SCALE.md (variant A,
  chosen by Roger: people shrink to real, the world keeps its map). Done:
  all five steps.
- The dam's lake is a closed basin (walls and banks), and the dam line is
  the west edge of the world for everything.

### The storm
- The second tornado comes 30 s after Start (was 90 s).
- The earthquake is back on (`EARTHQUAKE.enabled`), with its automatic
  one at 90 s.

### Performance (weak laptops, integrated graphics)
- Renderer: pixel ratio at most 1.5, no canvas antialias (post.js's target
  is multisampled, 2x), `powerPreference: 'high-performance'`.
- Sun shadow map 1024 with plain PCF (was 4096 PCFSoft). Small things cast
  no shadow: people's limbs and heads (the torso does), tree trunks, car
  wheels and trim, rooftop plant, awnings, street decor, rubble, dam chunks,
  aliens' limbs and hats.
- GTAO 8 samples (was 16).
- Point lights: 7 real ones in all (was 27). Effects get lights from
  `lightPool.js` (createLight / requestLight); the brightest near the camera
  win each frame. The lightning flash keeps its own.
- Adaptive quality (`engine/quality.js`): under 40 fps for 3 s, step down --
  pixel ratio 1, no AO, no MSAA, shadow map 512. Only down, never back up.
  `?quality=low` starts at the bottom, `?quality=high` switches it off.
- No per-frame allocation in the hot paths: the vortex force
  (`forces.js computeVortexForce` takes an `out` vector), the capture
  physics, the per-object damage checks, the ships' tracking lasers, the
  cameras, the wheel zoom, the composite pass and the blast waves use scratch
  vectors. Keep it that way: no `new THREE.Vector3()` in anything that runs
  every frame or per object.
- The crowd, the trees and the parked/viaduct cars are drawn as instances
  (`environment/instancer.js`): ~1,500 draws down to ~20. People, trees and
  cars keep their own meshes and materials, hidden and copied into the
  instances each frame; anything unusual (Roger, a gun or hair on a part,
  a glow, a swapped material, abducted/electrocuted/mutating, a car Roger or
  Chase Mode drives) draws itself instead. Code can keep changing their
  meshes as before.
- Also instanced: every plain box and cylinder of the buildings, the
  viaduct, the filling stations and the nuclear plants (untextured, opaque,
  unglowing standard material, geometry built at its centre). A wall torn
  off leaves the scene and so leaves the instances; a burning or fading
  building draws itself. Parts are hidden only for the render and shown
  again right after it (restoreInstancer), so the game always sees the real
  visibility. The instancer updates the scene's world matrices once and the
  render is told not to repeat it.
- CPU, measured (headless, per frame, normal run): about 10.9 ms before,
  6.5 ms after. The funnel's surface churn (noise on every vertex + normals)
  was half of it: now redrawn at 30 Hz (20 Hz once quality has stepped
  down), movement and particles still every frame. Aliens re-search their
  target every 0.25 s (currentTarget) instead of every frame. Speech bubbles:
  the random roll before the pool scan, the screen size read twice a second.
- Draw calls per scene render (shadow pass included): about 2,430 -> 380.
- World matrices (`engine/matrices.js`): one pass a frame that rebuilds a
  local matrix only when position/rotation/scale changed and a world matrix
  only when it or its parent changed (or it changed parent). Checked equal
  to three's forced full pass on every object (4,316) after a heavy run.
  Nothing needs marking static by hand.
- Physics sleep (`physics.js asleep`): a grounded object at rest on its floor,
  not turning and out of every funnel's reach skips the frame (a settled
  debris piece still ages for recycling). Spin is snapped to zero once too
  small to see, and rotation is only written while turning.
- CPU per frame (headless harness): heavy run (nuclear blast, 100+ aliens,
  800 objects) about 13.0 ms -> 5.5 ms; normal run 6.5 -> 5.7 ms.
- Measuring: `?perf=1` (live panel, CPU by section, draws, lights, physics)
  and `?bench=1` (reproducible benchmark, pass/fail against the budget in
  `engine/perf/budget.js`). Measurements, charts, lessons and traps live in
  `FINDINGS.md`; keep it updated with every measured change.
- The funnel's surface churn runs on the GPU (`engine/funnelChurn.js`),
  every frame. Aliens are instanced like people (one who burns, mutates or
  flashes draws itself). Explosion particles share two particle pools. The
  minimap redraws at 20 Hz. Sound draws from its own random generator and
  shares its noise buffers.

### Switched off, not deleted
- The small satellite funnels round the tornado (`SUB.enabled` in
  `engine/vortex.js`), which read as a stray mini fire tornado.

### Known bugs, not fixed yet
- In `npm run dev`, pressing Reset throws in `meteors.js` (createMeteor).
  It happens on `main` too. Probably React StrictMode's double mount leaving
  the discarded instance's Reset listener attached.

## Roadmap: energy, abilities, enemies, new content (agreed 2026-09-30)

One PR per step, each tried on the Vercel preview before the next.

### Decisions
- The new **energy** is separate from the plasma rifle's charge. It pays only
  for the new abilities (Time Slow, Teleport, EMP, black hole). Plasma,
  minigun and railgun never use it.
- Bar of **10 segments** of 10%. Each ability costs whole segments. The
  starting costs are below; they get calibrated in play.
- The **laser hand** is dropped from the plan.
- **Weapons** switch on the **mouse wheel**; Q no longer does. The
  **abilities** are on their own keys. Movement is on **W A S D** (the
  arrows until 2026-10-01; now they do nothing anywhere), right-click
  raises the weapon and Enter fires.
- The minigun's old slow motion (W) became the general **Time Slow**
  ability.
- The **EMP** and the **black hole** affect the rest of the world, never the
  player.
- **Mr. Proper** and **Chuck Norris** are random events, at the end.
- **Co-op** online (two heroes) comes later. What we keep from it now:
  player input is separate from simulation state.

### Keys
| Key | Ability | Starting cost |
|---|---|---|
| W A S D | Move / steer, in every mode | — |
| Q | Time Slow, 7 s (Bullet Time with the minigun) | 20% |
| E | Tactical teleport (was W) | 10% |
| R | EMP beam / shock wave (was E) | 30% |
| Wheel | Switch weapon (plasma / minigun / railgun / Fire Gun / Black Hole Gun) | free; the Black Hole Gun's shot costs 50% |

(R was the portable black hole until 2026-10-01; it is the Black Hole Gun on
the wheel now, see "Scripted events and the black hole" below.)

### Rules for every step
- Target **60 fps**. Entity caps and a shared particle budget apply to every
  new effect (`engine/perf/caps.js`).
- Every feature gets a **test button** in the Disasters panel.
- `GAME_DESIGN.md` and `.claude/rules.md` are updated when gameplay experience or implementation contracts change.
- Player input (keys, mouse) stays separate from simulation state
  (`engine/player/input.js`).

### Steps
- **PR 0 — Foundation. Done.**
  - Energy module (`engine/player/energy.js`).
  - Ability framework: slot, key, cost, cooldown, state
    (`engine/player/abilities.js`). The slow motion lives there now as
    Time Slow on Q (W too, until Teleport).
  - Time groups, so the world can be slowed and the player not
    (`engine/time.js`).
  - Shared enemy register: damage kinds, and frozen / disintegrated /
    absorbed states (`engine/enemies.js`). The aliens, Terminators and
    Roger's pursuers are registered.
  - Effect in a radius or over the whole map, player excluded
    (`engine/effects/area.js`).
  - Weapons on the wheel.
  - Entity caps and a particle budget: 10,000 particles; the heavy benchmark
    peaks at ~6,800.
  - The player's input read into a queue and consumed by the frame.
  - Test button: 🧪 Abilities.
- **PR 0b — Sound settings. Done.**
  - 🔊 Sounds section (`engine/settings.js`), holding Mute and the volume
    too. 🎥 Camera & sound is now 🎥 Camera.
  - Three switches: Rain, Rain sound (the storm's wind-and-rain hiss: there
    is no separate rain recording) and Music (the background playlist).
  - Saved in localStorage and read every frame, so a Reset or a reload
    keeps them.
- **PR 1a — Energy and filling stations. Done.**
  - `engine/fuelFire.js` (+ `engine/fuelFire/`: config, the car chain,
    effects, the leak's sound). Explosions emit `explosion` {x, z, size,
    source} (`engine/events.js`); `engine/player/energy.js` absorbs it
    (ABSORB, BLAST_SIZE). Per-source cap 50%. Test button: ⛽ Fuel Station.
  - The fuel trucks were already there (the five tankers); they now charge
    the bar and set off the cars round them.
  - Energy bar in the HUD.
  - Explosions give energy in proportion to their size, with an anti-farm
    rule.
  - Filling stations and fuel trucks hit by the tornado: leak, fire,
    explosion, secondary explosions, pump alarm, hiss, rings of flame and
    columns of smoke. The chain of explosions has a depth limit.
- **PR 1b — Nuclear plants. Done.** A charging terminal per plant
  (`engine/nuclear/charger.js`): 100% in 3 s, 60 s cooldown after use. The
  mass mutation is queued and turned CAPS.batch (8) a frame
  (`engine/nuclear/mutation.js`). Test buttons 🔌 Plug In and ☢️ Meltdown
  (`engine/nuclear/panel.js`). `heroMode.placeRoger(x, z)` added (Teleport
  will use it).
- **PR 6 — NPC behaviour you can tune. Done** (moved here, after PR 1b, at
  Roger's request). `engine/environment/crowd.js`, read by
  `peopleMotion.js`; the 👥 Crowd section of the panel, and 👥 Crowd in
  Disasters (next preset, storm on). Normal is the old crowd unchanged.
  Measured: 1–3.5 µs per person-call, no fps cost at ~165 people.
  - Traits: panic, herd, shelter awareness.
  - Presets: aggressive (stands up to the tornado), coward (runs in random
    directions), leader (one NPC takes the others to safety).
  - Presets mix behaviours for different styles of play.
  - Done when the presets make visibly different crowds, with no fps drop
    at ~165 NPCs.
- **PR 2 — Time Slow (20%, duration, cooldown) and Teleport (W). Done.**
  Time Slow: 20%, 3 s, 6 s cooldown, Q only. Teleport
  (`engine/player/teleport.js`): 10%, 18 m, 1.5 s cooldown; an ability's
  `canStart` refuses before anything is spent.
  - Teleport: a short jump the way he looks, with distortion at both ends.
  - Never into a crater or a building.
- **PR 3 — EMP beam (E) and the cyber T-Rex. Done.** `engine/player/emp.js`
  (through the enemies register, never the 'empPulse' event, which kills
  Roger); `engine/trex.js` + `engine/trex/` (config, model, flames). The
  register now has hitboxes: the rifle and the minigun aim at any enemy
  kind that gives one. EMP-Terminator confirmed: the pulse kills it.
  - The EMP kills the Terminator.
  - The T-Rex's long-range flames reuse the fire system.
- **PR 4 — Cyber Yeti and Blizzard. Done.** `engine/effects/freeze.js`
  (ice blocks, statues, 'ice' debris kind), `engine/yeti.js`,
  `engine/blizzard.js`; flood.setFrozen, chasm.setFrozen, firenado.quench,
  Vortex.ice glow. Enemy owners skip their update while 'frozen'.
  - A "frozen" state for the player and enemies.
  - The Blizzard freezes the dam water and the fissure lava.
  - Ice statues shatter.
- **PR 5 — Black hole (R) and Patient Zero. Done.** `engine/player/blackHole.js`
  (40 m point of no return, 70 m pull, caps 60 things / 10 buildings,
  particle stream on the budget); `engine/patientZero.js` (clones in two
  InstancedMeshes, capped at 50 by CAPS.perKind).
  - The black hole: a 40 m point of no return, disintegration, a capped
    number of objects affected.
  - Redesigned 2026-10-01 (on request): a swirling purple vortex instead
    of the black ball in yellow rings (`player/blackHole/look.js`, one shader
    mesh; `player/blackHole/matter.js`, matter streaming in along the arms),
    open 10 s, 10% energy, wandering slowly with its pull, things spiral in
    stretched; 40 drawn in on show at once, the rest go without it.
  - Patient Zero: up to 50 instanced clones; the original can be told
    apart; the clones go when it dies.
- **PR 7 — Timed missions. Done.** `engine/missions.js` over Sim.stats
  (new stat aliensBurned, counted in aliens/crew.js); the tracker is let
  through utils/banners.js (the pop-up banners stay suppressed, so it shows
  the result itself). They read the existing stats and give a score
  reward. They depend on the NPC behaviour (rescues) and on the
  Firenado–aliens interaction.
- **PR 8 — Volcano in the fissure. Done.** `engine/volcano.js`: a cone
  (LatheGeometry, lava-streak emissive map) growing over the newest caldera,
  or at the edge with a quake; 60 s of lava bombs (10 reused meshes) that
  ignite buildings; frozen by the Blizzard; solid to Roger.
  - The lava grows into a cone.
  - Lava bombs set buildings on fire.
  - The Blizzard can freeze it.
- **PR 9 — Waterspout over the dam lake. Done.** `engine/waterspout.js`:
  its own column (three LatheGeometry layers) on flood.js's reservoir, a
  displaced wave ring, 5 boats, a spray pool, procedural whirl-and-surf
  sound; at random once in an Outbreak. (It used to break the dam if it
  lingered against it; since 2026-10-01 only the Dam Break button and
  Doomsday do.)
  Triggered by a button or at random in Outbreak.
- **PR 10 — Mr. Proper and Chuck Norris. Done**, as two original
  characters with their own names: **Hank Granite** (`engine/actionHero.js`,
  the action-hero scene) and **Captain Spotless** (`engine/cleaner.js`, a
  giant of light who cleans the town). Each has a panel button; Spotless
  also comes at random once a run (120-260 s). Hank used to (70-200 s) and
  **no longer does: only from his button** (2026-10-01, on request). The
  "altered physics" after the scene is now in (the comprehensive pass):
  10 s of 30% gravity, with the parked cars round him hopping off the
  ground (`physics.gravity.scale`, `actionHero.js AH.lowGravity`).
  - Chuck Norris: a cinematic scene with 5 NPCs and a different ending for
    each.
  - An original design, inspired by the unstoppable action-hero archetype,
    not a portrait of a real person.
  - **During the scene the simulation is slowed, and the player keeps
    control** (decided). It is a hold on the world's time group
    (`engine/time.js`), like Time Slow.

- **After the roadmap — the comprehensive pass (done).** Performance
  (hidden subtrees skipped in the matrix walk, the swirl loop tightened,
  shader-error checks off in production: heavy 7.2 → ~6.1 ms, see
  FINDINGS.md), three 0.160 → 0.186.1 (Clock → Timer), the files over ~800
  lines split (vortex/particles.js, ui/minimapDraw.js, chasm/config.js,
  engine/stormLife.js out of tornadoEngine.js), the low gravity after Hank,
  and three new bits of fun: **🐄 the cows** (`engine/cows.js`, a pasture
  the funnel can empty, with the AIR COWBOY mission), **🦈 the Sharkspout**
  (`engine/waterspout/sharks.js`) and the moon gravity.

### Open questions
- The energy costs are starting values, to be calibrated.
- The Chuck Norris scene:
  - "Altered physics" after it: kept, as 10 s of low gravity (decided in
    the comprehensive pass; easy to turn off with `AH.lowGravity.seconds = 0`).
  - How often does it happen, when, and how does it interact with the
    other enemies?
- Missions: they stay after PR 5 (only the NPC behaviour moved up to after
  PR 1b).

### Decided later
- Chuck Norris: the simulation slowed, the player keeps control
  (2026-09-30).
- NPC behaviour comes right after PR 1b (2026-09-30).

## Ideas for later

### Online, single player
- Deploy the Next.js app (it builds to a static page) to Vercel or any
  static host. The Vercel connector needs authorising first.
- Convert the big `.wav` files in `public/sounds` (about 44 MB in all) to
  `.mp3`/`.ogg` so new players load faster.

### Co-op
- **Architecture:** one player hosts. Their browser runs the whole
  simulation; the others send inputs only (move, aim, fire, switch weapon)
  and receive state.
- **What the host sends,** 10–20 times a second: players, tornado centres,
  Terminators, aliens, ships, vehicles.
- **What it does not send:** cosmetic destruction piece by piece. It sends
  events instead ("building #12 collapsed", "tanker exploded", "bolt at
  x, z") and each client draws the effects itself.
- **Seeded town:** the town is generated from a shared seed, so every player
  builds the same one. That means replacing `Math.random` with a seeded
  generator, at least in town generation.
- **Relay server:** a WebSocket relay with rooms (for example Colyseus,
  PartyKit or Cloudflare Durable Objects). It only passes messages; the host
  simulates.
- **Code work needed:**
  - `heroMode.js` assumes a single Roger; it becomes a list of players, each
    with their own HUD, weapon and camera.
  - Terminators go for the nearest player.
  - The W slow motion slows the world for everyone, so it becomes a shared
    ability with a cooldown, or goes.
  - New co-op mechanics: reviving a team-mate, everyone reaching the bunker,
    who drives.
- **Suggested order:**
  1. Online single player.
  2. A small prototype: two Rogers in the same town who can see each other.
  3. Then Hero Mode for several players.

  // increase the framerate - compact the game/ pwa 
