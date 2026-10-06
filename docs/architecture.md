# Architecture

## High-level flow

```text
src/app/page.js
  -> TornadoSimulator.js
  -> createSimulation(container)
  -> createSim()
  -> register systems in tornadoEngine.js
  -> animation loop updates each system
```

`src/app/tornado/tornadoEngine.js` is the bootstrap point. It creates the context, registers systems on `ctx.systems`, and drives update order.

## Core state

- `createSim()` in `src/app/tornado/engine/context.js` creates the root state object.
- `Sim.objects` is the live list of physical objects the storm can affect.
- `Sim.stats` tracks destruction totals and score data.
- `ctx.systems` is the registry of engine subsystems.
- `ctx.events` is the shared cross-system event bus.

## Lifecycle

The lifecycle contract is enforced by `src/app/tornado/engine/lifecycle.js`.

- register with `register(name, system)`
- auto systems run `init*`, `reset*`, and `dispose*`
- non-auto systems must be invoked at the right phase
- dev mode warns when lifecycle hooks are missing or out of order

This matters because environment setup, damage, debris, and UI all depend on correct ordering.

## Subsystem groups

### Rendering and scene
- `scene.js` builds the renderer, camera, and scene
- `post.js` handles render passes
- `weather.js`, `clouds.js`, `dayNight.js`, `lightning.js` define atmosphere and FX

### Player and hero
- `engine/player/input.js` captures keyboard and mouse state
- `engine/player/abilities.js` handles slow-motion, teleport, EMP-style powers; `engine/player/grapple.js` is the grappling hook (G); `engine/hero/jetpack.js` is the jump and jetpack (Space), with roofs as ground; `engine/sound/grappleJet.js` voices both
- `engine/player/energy.js` stores energy and spend/restore logic
- `engine/heroMode.js` owns Roger’s state and movement
- `engine/heroWeapons.js` holds the weapon wheel and close-up models
- `engine/hero/touch.js` is Hero Mode on a touch screen: a floating joystick, look drags, FIRE / AIM / weapon / ability / car buttons and a gentle aim assist. It changes nothing in the game: it fills the same record as the keyboard and mouse (`player/input.js`: `held`, the analog `stick`, `addLook`, `addTurn`, `push`). The arithmetic (stick response, camera-relative steering, the assist's target pick) is pure in `hero/touchMath.js` and tested in `tests/touch-math.test.mjs`

### Co-op: who owns what (`engine/net/`)

Two players, each on their own computer. The host's browser runs the one authoritative simulation (the shared world); the guest's browser keeps its own simulation idle and draws the host's snapshots. `net/system.js` (`ctx.systems.net`) owns the room, the guest's figure on the host and the proxies on the guest.

- **Identity.** Every Roger is an entry in the player registry (`net/players.js`), keyed by room id: `'0'` is the host's Roger, `'1'` the guest. Each entry holds its own position, heading, state (up / down / dead), weapon, energy, seat, revive progress and Invincible. Health is per id in `ctx.systems.health`. The local player of a browser is `'0'` on the host and `S.myId` on the guest; every other entry is remote.
- **Local input → local player only.** Each browser has exactly one keyboard-and-mouse pipeline, `engine/player/input.js` (`ctx.systems.playerInput`): it only records keys, clicks, wheel and mouse movement. On the host, Hero Mode reads it for Roger (`hero/input.js consumeInput`). On the guest, `net/system.js readPeerInput` reads the same pipeline with the same bindings and turns it into an intent message (`input`, `net/protocol.js`). No player-control listener lives anywhere else; the host's only extra key is F held to revive.
- **Network state → remote player.** The host applies a guest's intent to that guest's entry only (`updateGuests`), through the input gate (sender id stamped by the relay). The guest never moves anything itself: its own Roger and the host's are both snapshot rows, interpolated.
- **Same walking rules.** Both Rogers walk by `hero/walk.js`: on foot A and D turn and W and S run with acceleration, the mouse does nothing; aiming (right-click, first person) the body faces the mouse look and A and D strafe. The host's Roger in `hero/movement.js`, the guest's in `net/system.js moveGuest`.
- **Local camera.** Each browser has one camera, placed for its local player only: the host's by Hero Mode, the guest's by `updatePeer` (behind its Roger's heading on foot, at the eyes and turned by the local mouse while aiming). OrbitControls and the W A S D camera pan stand down on a guest (`isPeerView`). A remote Roger is only a figure: it never drives a camera or reads input.
- **Down or dead.** A downed player's input moves, turns, aims and fires nothing: the host's Roger drops every input but V while `coopDown` (`hero/input.js`); a guest's intent is ignored by the host except V while it is not up, and the guest's own reader drops it too. The partner revives by holding F within reach (counted down on screen); the run goes on while one player is up.
- **The guest's screen.** Only what the guest can use is shown: the panel keeps Sounds (this computer's audio) and the Hero request; storm, disasters, presets, modes and the rest are the host's and are hidden (`setPeerUiLocked`).
- **Prediction (guest).** The guest moves its own Roger at once with the shared pure step `net/movement.js stepMove` (the host's `moveGuest` calls the same function) and keeps the unacknowledged inputs by `seq` in `net/prediction.js` (pure, immutable, state per instance in `S.pred`, cleared in `endSession` and on `welcome`). Each snapshot carries an additive `ack` (`[playerId, lastAcceptedSeq]`); the guest drops acknowledged inputs, replays the rest from the host's newest own row, fades small errors and snaps large ones. It is off while the guest is down, dead or seated. The host stays authoritative and the guest sends intent only. Other entities stay interpolated (`net/interp.js`, with a windowed-minimum clock-offset estimator). Values: R-060.
- **Held weapons and shot feedback.** `net/viewModel.js` places the guest's own first-person weapon (aim held) from the shared builders in `hero/weaponModels.js`; `net/heldWeapon.js` and `hero/heldWeapons.js` put the held weapon on both Roger proxies from the players row weapon column. Shot feedback is cosmetic (`net/shotFeedback.js`): a flash, kick and one existing cue on the guest; one tracer in the host's existing round pool (`guestTracer`) for a guest's rifle, minigun or railgun shot. Damage still goes only through `enemies.hit` (R-013, R-053).

### Combat and damage
- `engine/health/` is Roger's health: `system.js` registers `ctx.systems.health` (auto lifecycle: `initHealth`, `resetHealth`, `disposeHealth`, plus `updateHealth(rawDt)` called by `tornadoEngine.js` after `updateHero`, on real time). It exposes the one player-damage API `damagePlayer`, `health`, `state`, `glow` and `revivePlayer`. Pure helpers sit beside it: `state.js` (regeneration), `melee.js` (touch, wind-up), `dot.js` and `fire.js` (damage over time), `hazards.js` (lava, flood), `friendlyFire.js`, `enemyDamage.js` and `damageTable.js` (weapon x enemy), with every number in `config.js`. Co-op health rides the net snapshot (`hp` rows) and a `playerDamage` event
- `engine/enemies.js` is the shared registry for enemy kinds and hit acceptance
- `engine/damage.js` owns damage resolution, collapse logic, and score updates
- `engine/physics.js` applies force and object motion
- `engine/collisions.js`, `debris.js`, `debrisImpacts.js` handle contact and impact effects

### World actors
- `engine/environment/` contains the town, buildings, vehicles, roads, shelters, parks, and trains
- `engine/aliens.js`, `terminator.js`, `trex.js`, `yeti.js`, `patientZero.js` register hostile actors
- disaster systems include `earthquake.js`, `flood.js`, `meteors.js`, `chasm.js`, `sinkhole.js`, `firenado.js`, `volcano.js`, and similar modules
- the town's life (2026-10-04), auto-registered, each with init/reset/dispose and an update called from `frame()`:
  - `environment/streetTraffic.js`: up to eight cars come and go. Each drives in from a street's end to the first building on the road, parks, then U-turns and leaves. The open stretches are worked out from the building footprints (`openStretches`, pure, tested in `tests/street-traffic.test.mjs`). They are ordinary `createCar` cars on `Sim.objects` and `Environment.cars`, so they are instanced and the funnel can take them. They stop for people and leave once a tornado is down. Updated before physics, like the train.
  - `environment/birds.js`: three flocks of gulls, drawn as three instanced meshes. They flee a funnel within 120 m.
  - `environment/newsChopper.js`: the STORM 7 helicopter. It circles the town, then follows the tornado with a searchlight cone (a glowing mesh, not a light).
  These are visual only, except the traffic cars.

### UI and feedback
- `engine/ui.js` owns HUD and control-panel logic
- `engine/gamefeel.js` drives combos, shake, and slow-motion feel
- `engine/sound/` holds the procedural audio graph
- `engine/explosions/` and `groundFx.js` handle aftermath visuals
- `engine/ui/newsTicker.js` is the STORM 7 news line at the bottom: plain-words headlines read from `Sim.stats`, the tornado registry and `announce` events, twice a second, on real time. Its queue is pure, in `ui/headlines.js`, tested in `tests/headlines.test.mjs`. It is hidden in Hero Mode; `?news=0` turns it off.
- `engine/ui/explainer.js` holds the four first-visit cards and the **?** button (H). It is remembered in `localStorage`; `?explainer=1|0`.

## Rules to follow

- per-instance state, not module-level mutable state
- most calls go through `ctx.systems.*` or `ctx.events`
- lifecycle-managed systems respect `init` / `reset` / `dispose`
- keep the architecture local and system-oriented, not class-heavy

## Where to start

Start with the nearest subsystem analogue, then follow the correct lifecycle, damage, and effect chain.

Examples:
- new disaster -> inspect nearby disaster system in `engine/`
- new enemy behavior -> inspect `engine/enemies.js` and the owning enemy file
- new weapon -> inspect `engine/heroWeapons.js`, `engine/heroMode.js`, and the damage registry
- new destruction feedback -> inspect `engine/damage.js`, `explosions/`, and `gamefeel.js`
