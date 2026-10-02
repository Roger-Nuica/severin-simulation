# Plan: complaints (dam column, hunter ships, samurai ship, first-person katana)

Source brief: `COMPLAINTS.md`. Rules: `.claude/rules.md`. Planning only; no production code is written here. Paths below are relative to `src/app/tornado/` unless they start with `docs/`, `tests/` or `.claude/`.

## Goal

Fix four reported problems while keeping every protected contract intact:

1. No tornado-like column over the dam unless the player or a scenario puts it there.
2. Hunter alien ships can be destroyed in a few hits by every weapon (rifle, minigun, railgun, fire gun, black hole, katana).
3. The samurai ship leaves and is disposed of once the samurai sequence has finished.
4. The katana plays from a first-person view and slashes toward the crosshair.

Non-goals: no change to the black hole numbers (R-031), the mothership (R-036), the 160/50/10,000 caps (R-048), the hunter hull of 4 or the rifle's 1 / 5 mega (R-015, R-034, R-036), or any `accepts` list other than the one deliberately added for the hunter kind (R-013, R-050). The katana never hits hunters and `blade` is never added to the hunter kind.

User decisions (all recorded, none left open): the waterspout stays but only by button or scenario; the katana now also cuts people (amends R-051) but not hunters; every other weapon, including the Lightning tile, hurts hunters (minigun 0.25 per round, railgun/bolt 2, fire gun 0.5 per tick); the samurai character stays, the ship leaves early after about 6 s all-clear with the 120 s cap kept (amends R-020); the katana is drawn automatically from the back sheath when selected and first person is entered by right-click.

## Root-cause findings (from the code)

### Issue 1: the column is the intended waterspout, auto-spawned in an Outbreak

- `engine/waterspout.js` builds a grey-white column plus a displaced ring of "waves" on the lake behind the dam (`flood.js` reservoir). That matches "vertical grey/white column with concentric rings on the water".
- It spawns in two ways: the `btn-waterspout` button (`spawn()`), and automatically in `updateWaterspout`: once per run, 20 to 60 s after `ctx.tornadoes.count() >= 2` first holds (`WS.outbreakDelay`, `spawnedThisRun`). R-041 and `GAME_DESIGN.md` describe this as intended ("once per run at 20-60 s after the Outbreak").
- A Fujiwhara merge only happens in an Outbreak (two or more funnels), so the "TORNADOES MERGED" toast and the waterspout appear together by coincidence of the same precondition. The merge does not leave a funnel over the dam: `fujiwhara.js` retires the absorbed funnel through the registry and `waterspout.js` has no link to it. Subtask 1 proves or disproves this by reproduction.
- Conclusion: it is neither a stray tornado nor a merge leftover; it is the automatic waterspout. The brief wants it gone unless deliberate, which contradicts R-041's "automatic appearance". Decided: stop the automatic spawn and keep the button and any scenario call to `spawn()`. R-041 and `GAME_DESIGN.md` are amended accordingly (approved by the user).

### Issue 2: hunter ships are not in the enemy registry, so only some weapons reach them

- `aliens.js` registers the hunter ships only with `ctx.systems.consumables` (`kind: 'hunterShip'`, black hole). It does not register them with `ctx.systems.enemies`.
- Plasma rifle: works. `hero/plasma.js` `traceAim` collects `aliens.shipTargets()` and `plasmaHit` calls `hit.obj.hit(SHIP_DAMAGE...)` which reaches `waves.js` `hitHunter` (hull 4, normal 1, mega 5; R-015, R-034, R-036).
- Minigun: `traceAim` returns kind `'ship'`, but `heroWeapons.js` `landRound` has no `'ship'` branch, so the round is discarded. The header comment (line 37) documents "ships ... shrug it off".
- Railgun: `strikeTargeting.js` `boltAt` affects people, trees, cars, `aliens.boltKill` (crew on the ground), Terminator EMP and explosives; nothing reaches an airborne ship.
- Fire gun: `hero/fireGun.js` visits only registry kinds that accept `'fire'`; hunters are absent.
- Katana: `hero/katana/targets.js` reaches only `aliens.eachCuttable` (crew on foot, reach about 3 m, R-051) and parries other registry kinds. Hunters hover at `ALIENS.hunterHeight` (26 m), unreachable on foot.
- Black hole: already works through the consumables registration (verify only).
- Hull (4) and the rifle's 1/5 values are protected (R-015, R-034, R-036), so the change is to route more weapon types to the existing `hitHunter`, not to alter health.

### Issue 3: a departure already exists, but is only triggered by timers

- `spaceship/descent.js` already runs `guarding` -> `boarding` -> `retracting` -> `leaving` -> `depart()`, which calls `clearSquad()`, `removeShip()` (disposes belt and `disposeShip` geometries and materials) and sets the cooldown. Reset and the black hole consumer also call `removeShip()`.
- The ship leaves only after `SUPPORT.stay` (120 s from the last samurai down the ramp; R-020) or when `standing() === 0`. If the aliens are already dead, the squad and ship idle for up to 120 s, then up to 30 s `boarding` (`S.state.timer > 30`), then 4.5 s `leaving`. This is the most likely reading of "stays in the sky after its job is done".
- Subtask 10 must still confirm no stuck-phase bug (for example a unit left in `exiting`/`climbing` that blocks `allAboard()` until the 30 s timeout, or `updateSupportWorld` being skipped while `paused`).
- Decided: keep 120 s as the maximum and add an early all-clear withdrawal after about 6 s (amends R-020; approved).

### Issue 4: the katana is a separate third-person "drawn" mode

- `hero/input.js` sends right-click on the katana to `weapons.katanaToggle()` (a follow-camera draw with its own virtual cursor and swipe), and explicitly never to `toggleAim`. `hero/plasma.js` `enterAim` returns early for the katana; `input.js` wheel handler forces `leaveAim()` when cycling onto it.
- First person for other weapons is `S.state.phase === 'aiming'`: `enterAim` hides Roger's mesh, locks the pointer, `placeAimCamera` (`hero/screen.js`) drives the camera from `S.state.yaw/pitch`, and `hero/movement.js` has an `aiming` branch (slow walking).
- The katana's quick slash (`hero/katana/slash.js`) reads mouse movement as a screen-space swipe and builds the cut plane from camera right/up and Roger's heading; Blade Mode (`bladeCut.js`, `bladeUi.js`) draws lines with the virtual cursor in screen space. Co-op guest katana (`net/system.js` line 627 onward) is host-side, based on the guest avatar's position and heading, and does not read Roger's camera.
- Decided: selecting the katana draws it automatically from a back sheath (no right-click draw); right-click then enters first-person aim. Today the right-click is the draw (`katanaToggle`), so the draw state and the aim phase are decoupled by Subtask 13.
- The katana model (`hero/katana/model.js`) is a rig on Roger's third-person body (`S.katanaRig`); there is no first-person viewmodel yet.

## Clarifications needed

None. The user has resolved every open question (see Goal). Remaining detail choices are inside the subtasks as stated defaults.

## Subtasks

### Issue 1: dam column

- [x] DONE Subtask 1: Reproduce and confirm the source of the column (read-only, then a short note in the plan or the PR).
  - Files read (no source edited): `engine/waterspout.js`, `engine/tornadoes.js`, `engine/fujiwhara.js`, `engine/vortex.js` and `vortex/config.js` (WANDER), `engine/hunt.js`, `engine/flood.js`, `engine/flood/config.js`, `TornadoSimulator.js`, `tornadoEngine.js`.
  - Finding: confirmed. The only creator of the column is `createWaterspoutSystem`: `spawn()` is reached from the `btn-waterspout` click and from the Outbreak block in `updateWaterspout` (`ctx.tornadoes.count() >= 2`, once per run, after `WS.outbreakDelay` 20 to 60 s, guarded by `spawnedThisRun`). There is no other caller of `ctx.systems.waterspout` (no doomsday or scenario call). `retire()`/`spawnExtra()` only toggle pre-built Vortex instances; Fujiwhara has no link to the waterspout. No funnel can reach the dam: the dam wall is at x = -148 (`FLOOD.damX`) with the lake further west, while a Vortex centre follows `WANDER` (radius 52 + meander 10, about +-62) or `hunt.js` targets (people in the town, about +-88), and merge points are midpoints of two such centres.
  - Method: code reading only. The app was not run and no Outbreak was observed with or without merges; runtime observation of `ctx.systems.waterspout.state()` remains for Subtask 2/19 manual checks.
  - Open concern: none for the dam; no funnel can appear over it. The merge toast and waterspout co-occur only because both need two or more funnels. Minor: Possess/Chase `controlTarget` was not traced; it is player-driven.
  - Objective: run Outbreak (two or more funnels) with and without a merge and note when `waterspout` becomes non-null (`ctx.systems.waterspout.state()`), and whether any `Vortex` centre ever enters the dam's x range. Confirms the findings above.
  - Likely files: `engine/waterspout.js`, `engine/tornadoes.js`, `engine/fujiwhara.js`, `engine/flood.js`, `engine/flood/basin.js`, `engine/environment/backdrop.js`.
  - Depends on: none.
  - Risks / edge cases: R-004 and R-006 (Fujiwhara timing and merge) must not be altered while observing. If a tornado funnel is also seen over the dam, add a bounds subtask and report it before editing (R-005 ranges are protected).
  - Rules: R-004, R-006, R-041. Skill: `.claude/skills/disaster-system-change/SKILL.md` (trace UI, registration, frame update, consumers, lifecycle).
  - Acceptance: a written confirmation that the column is the waterspout and that no funnel is over the dam; the cause is traceable to the automatic spawn block in `updateWaterspout`.

- [x] DONE Subtask 2: Stop the automatic Outbreak waterspout.
  - Objective: remove (or gate off) the Outbreak-triggered auto spawn so `spawn()` is reached only from the button or a scenario. Keep `spawnedThisRun` and `outbreakTimer` consistent in `resetWaterspout`, or delete them with the block; keep `spawn()`, boats, sharks and lifecycle (reset, dispose) unchanged.
  - Likely files: `engine/waterspout.js` (the `updateWaterspout` Outbreak block, `WS.outbreakDelay`, header comment), `TornadoSimulator.js` (the button tooltip text "Also comes at random in an Outbreak").
  - Depends on: 1.
  - Risks / edge cases: R-041 says "automatic appearance once per run"; this is an approved amendment, made in Subtask 3 (R-050). Do not touch `WS.seconds` 45, `WS.height` 110, sharks (6 at once, 3 s) or the 5 boats (R-041); the button and scenario spawns keep working. No module-level state (R-047). `WS.outbreakDelay` becomes dead if unused: remove it rather than leave an unused constant. Add JSDoc types to anything touched (global firm standard).
  - Rules: R-041, R-047, R-050.
  - Acceptance: over several full runs with and without Fujiwhara merges, no waterspout appears unless the button is pressed; the button still works; Reset clears it; lint and build pass.
  - Files changed: `src/app/tornado/engine/waterspout.js`, `src/app/tornado/TornadoSimulator.js`.
  - Implemented: removed the Outbreak auto-spawn block in `updateWaterspout`, the dead `WS.outbreakDelay`, `outbreakTimer` and `spawnedThisRun` (and their reset lines; grep shows no other consumer); header comment and button tooltip updated. `spawn()`, WS.seconds/height, sharks, boats, reset and dispose untouched.
  - Checks: `npm run lint` clean; `npm run build` succeeded. No manual run done.
  - Open concern: R-041 and `GAME_DESIGN.md` still claim the automatic appearance until Subtask 3 (user-approved amendment).

- [x] DONE Subtask 3: Record the waterspout amendment (may be done with Subtask 18).
  - Files changed: `.claude/rules.md` (R-041), `GAME_DESIGN.md` (disasters paragraph, changelog line).
  - Result: R-041 now says player-triggered only (button or scenario); no other R-041 number changed; `docs/` never mentioned the auto spawn.
  - Note: `GAME_DESIGN.md` had no Waterspout section (R-041's source cites one), so a sentence was added to the disasters section.
  - Objective: update R-041 and `GAME_DESIGN.md` (Waterspout and Doomsday/disaster text, and the changelog line about waterspouts) to say the waterspout is player-triggered only. The user has approved the amendment (R-050).
  - Likely files: `.claude/rules.md` (R-041), `GAME_DESIGN.md`, `docs/architecture.md` if it mentions the spawn.
  - Depends on: 2.
  - Risks / edge cases: do not change any other number in R-041; use British English; flag disagreements between the doc and the runtime rather than silently reconciling.
  - Rules: R-041, R-050.
  - Acceptance: no document still claims the automatic appearance; the rule text matches the runtime.

### Issue 2: hunter ships

- [x] DONE Subtask 4: Register the hunter ship in the shared enemy registry and map hits onto the existing hull.
  - Files changed: `engine/aliens.js`, `engine/aliens/config.js` (`hunterHit` table), `engine/aliens/waves.js` (`hitHunter` guard moved first).
  - Result: `hunterShip` registered with `accepts: ['plasma','bullet','bolt','fire']`; `damage` calls `hitHunter` once (plasma via `SHIP_DAMAGE`, others via `ALIENS.hunterHit`) and returns true only at hull 0.
  - Double-hit decision: no `hitbox`, so `traceAim` still sees a hunter once via `shipTargets`. The separate consumables `hunterShip` entry was removed (the registry kind carries `consume`/`object`), otherwise the black hole would hold each hunter twice.
  - Rocket Strike fix (user option a): `spaceship/rocket.js` registry walk now skips `hunterShip`, so hunters take only the existing `shipTargets`/`ROCKET.shipDamage` hit. Lint and build pass.
  - Objective: in `aliens.js` `initAliens`, register `kind: 'hunterShip'` with `ctx.systems.enemies.registerKind`: `list` (phases `arriving` and `hunting`, same filter as the consumables registration), `position`, `hitbox` (the same disc that `shipTargets()` uses: radius `15 * hunterScale`, `top` above the belly), `accepts: ['plasma', 'bullet', 'bolt', 'fire']` (no `emp`, no `freeze`, never `blade`), and `damage(h, hit)` that calls the existing `waves.js` `hitHunter(h, hullPoints, at)` once, where `hullPoints` comes from a small per-type table in `aliens/config.js`: plasma uses `SHIP_DAMAGE` (1, mega 5; never re-implemented), bullet 0.25 per round, bolt 2, fire 0.5 per tick (user-approved values). Return `true` when the hull reaches 0 (stopped), otherwise `false` (R-027: an accepted hit is not a kill).
  - Likely files: `engine/aliens.js` (registration beside `alienKind`), `engine/aliens/waves.js` (`hitHunter`), `engine/aliens/config.js` (a `hunterHit` table, next to `hunterHull`), `engine/hero/config.js` (`SHIP_DAMAGE` is read, not changed).
  - Depends on: none (values approved).
  - Risks / edge cases: do not raise `hunterHull` 4 (R-015, R-036) or `SHIP_DAMAGE` (R-034). `hitHunter` already returns -1 for `downed`/`dead`: guard so a downed ship is not hit again and does not double score or double play the explosion cue. Score: the crash score must flow once through the existing path and `damage.addDamageScore()` (R-027, R-049), not a new scorer. Entity cap: no new spawns, so `canSpawn` is unaffected (R-048). Adding `hitbox` makes the rifle's `traceAim` see the ship twice (registry `'enemy'` hit plus `shipTargets` `'ship'` hit): either omit `hitbox` and aim through `shipTargets`, or de-duplicate; pick one and document it. Other enemies keep their own `accepts` (R-013). The mothership and landing UFO are out of scope.
  - Rules: R-013, R-015, R-027, R-034, R-036, R-047, R-048, R-049. Skill: `.claude/skills/enemy-immunity-system/SKILL.md`.
  - Acceptance: `ctx.systems.enemies.each` lists hunters while they hover; a `{type: 'plasma'}` hit on one removes 1 hull and a mega hit 5; accepted hits that do not kill return `false`; a downed hunter is ignored; all other registered kinds are untouched.

- [x] DONE Subtask 5: Minigun reaches hunters.
  - Files changed: `engine/heroWeapons.js` (`landRound` `'ship'` branch, `roundVisit`, header comment), `engine/aliens/ship.js` (hunter `shipTargets` entry carries `hunter`), `engine/aliens/waves.js` (`hitHunter` light path).
  - Result: a round on a hunter is looked up by identity in the live `hunterShip` list at landing (downed or gone is not found) and sent as `{type:'bullet'}` through `enemies.hit`; `rogerKill` only when stopped. UFO and mothership carry no `hunter`, so they still shrug rounds off. Pools, ammunition and rate untouched.
  - `hitHunter`: full burst and large cue only for hits of 1 point or more, or the downing hit; lighter hits get a 0.4 spark on every fourth hit (only with `particleRoom()` above 0) and a quiet non-priority cue. `spawnImpactBurst` already copies the point (`origin.copy`, `position.copy`), so the `S.scratch` reuse is safe. Lint and build pass.
  - Objective: add a `'ship'` handling path in `heroWeapons.js` `landRound` that sends `{type: 'bullet'}` to the hunter through `enemies.hit` (not the UFO or mothership, whose contracts do not take bullets), with the usual `rogerKill` combo event only when it is stopped.
  - Likely files: `engine/heroWeapons.js` (`landRound`, the header comment on line 37), `engine/hero/plasma.js` (`traceAim`'s `'ship'` result).
  - Depends on: 4.
  - Risks / edge cases: rounds fly for travel time (`hero/bullets.js`), so the hunter may have moved or been downed on arrival: look the target up by identity and ignore it if it is gone. Bullet Time freezes rounds; hit landing must not double-fire on thaw. Keep the 300 bullets / 140 casings pools (R-029). The UFO (6 hull) and mothership must keep shrugging bullets off.
  - Rules: R-013, R-027, R-029, R-034, R-049. Skills: `.claude/skills/hero-weapons-combo/SKILL.md`, `.claude/skills/enemy-immunity-system/SKILL.md`.
  - Acceptance: with the minigun, sustained fire on a hover destroys a hunter within the agreed rounds; bullets on the UFO and mothership still do nothing; ammunition and fire rate unchanged.

- [x] DONE Subtask 6: Railgun and the Lightning tile (the shared `boltAt`) reach hunters.
  - Files changed: `engine/strikeTargeting.js` only (the loop sits in `strike()`, which every queued bolt, railgun and Lightning tile alike, reaches; `boltAt` only queues).
  - Result: each bolt hits every `hunterShip` whose horizontal distance to the bolt is under `15 * ALIENS.hunterScale` (9 m, the same disc as `shipTargets`) once via `enemies.hit({type:'bolt'})` (2 hull, full effect in `hitHunter`); score flows through `hitHunter` plus the bolt's existing `addDamageScore`. Lint and build pass.
  - T-Rex / Patient Zero accept `bolt` but nothing sends them one from `boltAt` today (Terminators get `empSweep`), so there was no mechanism to reuse and no double hit. Crew, Terminator, tanker handling, `minRange` and cooldown untouched.
  - Allocation: the `hunterShip` kind is looked up once per sim (cached in the closure, cleared on reset); per bolt only the hunter `list()` filter allocates a tiny array.
  - Objective: in `strikeTargeting.js` `boltAt`, add one registry loop for enemies that accept `'bolt'` and have no ground-crew handling yet, restricted to the hunter kind by its `accepts`, using the horizontal distance to the bolt point against a hunter radius; call `enemies.hit(..., {type: 'bolt'})` once per bolt per hunter and score through the existing `addDamageScore`.
  - Likely files: `engine/strikeTargeting.js`, `engine/heroWeapons.js` (`fireRail` already uses `boltAt`), `engine/lightning.js` only if the Lightning tile shares the path.
  - Depends on: 4. Decided: the Lightning tile also hurts hunters, because it shares `boltAt` (no split path).
  - Risks / edge cases: `railPoint` comes from `traceAim`, which for a ship returns the ship's x, z and the point at altitude: the bolt lands on the ground below the hunter, so the radius must be the hunter's disc, not the 5 m crew radius. `RAILGUN.minRange` 9 m and the 0.2 s cooldown (R-030) stay. The Terminators' bolt EMP and the T-Rex's handling stay unchanged. Do not duplicate the T-Rex or Patient Zero `'bolt'` handling: check how they receive it first and reuse it. Avoid per-frame allocations (R-048).
  - Rules: R-012, R-013, R-027, R-030, R-048. Skills: `.claude/skills/hero-weapons-combo/SKILL.md`, `.claude/skills/enemy-immunity-system/SKILL.md`.
  - Acceptance: two railgun bolts aimed at a hunter bring it down; a bolt at the ground nearby does not; crew, Terminators and tankers behave as before; the Lightning tile's bolts also damage hunters (2 hull each) and keep their score.

- [x] DONE Subtask 7: Fire gun reaches hunters.
  - Files changed: `engine/hero/fireGun.js` only.
  - Result: hunters are visited through `enemies.each` (accepts `fire`) once per 0.25 s tick for `ALIENS.hunterHit.fire` (0.5 hull); hull 4 / 0.5 = 8 ticks = 2 s of held fire. No new damage constant in the weapon; the 1.5x Firenado multiplier is not re-applied (score flows through `hitHunter` and the existing path).
  - The flat `inCone` ignored altitude, so a flame at the street would burn a hunter 26 m above. Added a small allocation-free 3D cone test (`inCone3D`), used only for `kind.kind === 'hunterShip'`; same range 42 m and half-angle 0.26, so FIRE_GUN range, 4 ticks/s, Yeti (1.2/tick) and Patient Zero are unchanged. The co-op guest path (`breathe`) shares `scorch`, so it gets the same test.
  - Follow-up: the hunter's cone radius is its disc (`15 * ALIENS.hunterScale`, 9 m, as `shipTargets`/`boltAt`), not the 1 m default, so the flame need only touch the ship. Origin is `rogerPosition()` (Roger's mesh position, ground-level, not eye height; guests pass their muzzle): about 1.7 m low, a few degrees at hunter range, absorbed by the 9 m radius.
  - Lint and build pass.
  - Objective: once the kind is registered with `'fire'`, `hero/fireGun.js` already visits it through `enemies.each`; verify the cone test (`inCone` is 2D and ignores altitude) is acceptable for a hunter overhead, and add a vertical limit only if the hunter can be hit from impossible angles. Do not raise `FIRE_GUN.range` 42 m or the 4 ticks/s (R-030).
  - Likely files: `engine/hero/fireGun.js`, `engine/hero/config.js` (read-only).
  - Depends on: 4.
  - Risks / edge cases: a hunter hovers 14 m from its target, so it is often inside the 42 m cone; the fire damage per tick must be the agreed table value, not a new constant in the weapon. Fire also feeds the Firenado scoring (R-017): do not apply the 1.5x multiplier a second time.
  - Rules: R-013, R-017, R-027, R-030. Skill: `.claude/skills/enemy-immunity-system/SKILL.md`.
  - Acceptance: holding the fire gun at a hunter destroys it in the agreed number of ticks; the Yeti (1.2 per tick, 30 HP) and Patient Zero are unchanged.

- [x] DONE Subtask 8: Black hole verification, and a guard that the katana never touches hunters.
  - Files changed: `engine/hero/katana/targets.js` (`IGNORED_KINDS` gains `hunterShip`, header comment corrected), `engine/strikeTargeting.js` (railgun `rogerKill`).
  - Verified by reading only (nothing run in a browser): the black hole lists each hunter once (the `area.js` 'enemy' walk; the consumables entry is gone and hunters are not in `Sim.objects`), `held` guards re-capture, `take` sets frozen/absorbed (the hunter AI ignores them, as before), `consume` calls `removeHunter` once (a second call after a crash is harmless), size still comes from `sizeOf(group)`; R-031 constants untouched. New effect: a hunter outside the 40 m line is now shoved inward like other enemies. Downed hunters are not listed.
  - Genuine gap fixed: `hunterShip` was in the register and not in the katana's `IGNORED_KINDS`, so a swing under a hunter parried (clang and sparks, no damage); now ignored. `blade` is not in its `accepts`; `targets.js` never sends `blade` to non-aliens; the guest path in `net/system.js` filters on `accepts.includes('blade')`, so a hunter is excluded with no change.
  - Railgun: `boltAt` queues a `roger` flag; `strike()` emits `rogerKill` only when a hunter's hull reaches 0 (lightning tile unaffected). `npm run lint` and `npm run build` pass; a manual swing and bolt are still to do (Subtask 19).
  - Objective: verify the black hole still consumes hunters (no code change expected). Confirm by reading and a manual swing that the katana (including the co-op guest path in `net/system.js`) never damages a hunter: `blade` is not in the hunter's `accepts`, and no leap or reach change is made. Because the guest path hits any registry kind that accepts `blade` by ground distance, this check must be repeated after Subtask 4.
  - Likely files: `engine/effects/consumables.js`, `engine/player/blackHole.js` (read-only), `engine/net/system.js` (read-only), `engine/aliens.js` (the hunter's `accepts`).
  - Depends on: 4.
  - Risks / edge cases: R-031 numbers fixed (60 pulled, 6 dissolving, 1400 fragments). The katana must not become a weapon vs hunters through the co-op path.
  - Rules: R-013, R-031, R-049, R-050.
  - Acceptance: black hole still consumes a hunter with no crash; a katana swing beneath a hunter does nothing to it, in single player and as a guest.

- [x] DONE Subtask 9: Record the hunter damage table (may be done with Subtask 18).
  - Files changed: `.claude/rules.md` (R-013, R-034, R-036), `docs/enemies.md`, `docs/combat.md`, `docs/weapons.md`, `GAME_DESIGN.md`.
  - Result: the `hunterShip` kind and the per-weapon table are recorded (rifle 1/5, minigun 0.25, railgun/bolt 2, fire 0.5 a tick; katana ignored; black hole pull accepted); the `heroWeapons.js` header was already correct.
  - Verified against `aliens.js`, `aliens/config.js` (`hunterHit`), `waves.js`, `fireGun.js`, `strikeTargeting.js`.
  - Objective: record the per-weapon hunter table and the new registry kind in `docs/enemies.md`, `docs/combat.md` and `docs/weapons.md` (the minigun comment in `heroWeapons.js` too); amend R-034 and R-036 text only to add the new rows (minigun 0.25 per round, railgun/Lightning bolt 2, fire gun 0.5 per tick; the katana does not hit hunters), never to change the rifle's.
  - Likely files: `docs/enemies.md`, `docs/combat.md`, `docs/weapons.md`, `.claude/rules.md` (R-013, R-034, R-036), `engine/heroWeapons.js` header.
  - Depends on: 4 to 8.
  - Risks / edge cases: R-050 (the user has approved these rule edits); British English; keep the doc line numbers honest.
  - Rules: R-013, R-034, R-036, R-050.
  - Acceptance: docs match the runtime for every weapon; no stale "ships shrug it off" wording remains.

### Issue 3: samurai ship

- [x] DONE Subtask 10: Reproduce the lingering ship and confirm the cause.
  - Files changed: PLAN_complaints.md only (diagnosis by code reading only; the app was not run).
  - Result: the ship lingers because of the timers alone; no stuck-phase bug exists. Timeline below.
  - Timeline (seconds from the call, world time `dt`): `descending` 6.0 (`SHIP.duration`) -> `deploying` 1.2 (`ALIENS.rampSeconds`) -> `unloading` about 10.0 (10 units x 0.5 s `exitEvery` + 4.99 s ramp walk) -> `guarding` up to 120 (`S.state.stay`, set at the call but decremented only in `guarding`, so the 120 s runs from the end of unloading, about t=17) or until `standing()===0` -> `recall()` and `boarding` (samurai run at most about 100 m at 8.5 m/s, about 12 s, plus a 5 s climb; hard timeout 30) -> `retracting` 1.2 -> `leaving` 4.5 (`SHIP.leaveSeconds`) -> `depart()` (`clearSquad`, `removeShip`, `idle`, cooldown 60 starts here only). Withdrawal begins about t=137 when any samurai lives; the ship is gone about t=160 (worst case) after the call.
  - Confirmed cause: when the aliens die early, `guarding` has no all-clear check, so the squad idles for the rest of the 120 s (then up to about 17 s of boarding plus 5.7 s of retract/leave). Not a bug in a unit phase: `allAboard()` accepts `aboard`/`dying`/`dead`/`caught`; `exiting` cannot overlap (last unit finishes at 9.5 s, `guarding` starts at about 10 s); `toRamp` cannot stall (`moveTo` walks through a fully boxed-in position); `climbing` is transient (5 s). `updateSupportWorld` is skipped while `paused` (correct, the timers freeze) and is not gated by a cutscene or hero death, but it runs on world `dt`, so Time Slow, slow-motion and Blade Mode (world scale 0.1) stretch every timer proportionally. All exits reach `depart()` (or reset/black-hole `removeShip()`); no path leaves the phase non-idle with the group present.
  - Recommendation for Subtask 11: add the all-clear in `descent.js` `guarding` only (accumulate `clearFor` while `ctx.systems.enemies.each` finds no `blade`-accepting, non-absorbed target within `SUPPORT.coverage` of `S.drop`; reset it on any target; at 6 s call the same `recall()` and set `boarding`; keep the 120 s cap and the banner). Reuse the `pickTarget` test, which is private to `samurai.js`, by exposing a small `hostilesInCoverage()` on the squad API. Zero grace is avoided so the wave spawning gap does not cause a premature leave; also consider cutting the 30 s boarding timeout to about 20 s, because the 100 m run plus climb is at most about 17 s. The squad stays on the ground until the all-clear, matching the user's wish. Count time on world `dt` to stay consistent with the rest. Note the check must run in `guarding` only (not during `unloading`, when spawned units could see no aliens yet).
  - Objective: call Samurai Support, let the squad clear (or kill the aliens first), and time `phase` transitions (`guarding`, `boarding`, `retracting`, `leaving`, `idle`) with `ctx.systems.spaceship` state; note any unit that blocks `allAboard()` (phases `exiting`, `climbing`, or stuck `toRamp` through `blocked()`), and whether `updateSupportWorld` is called while the game is paused or in a cutscene.
  - Likely files: `engine/spaceship.js`, `engine/spaceship/descent.js`, `engine/spaceship/samurai.js`, `engine/spaceship/config.js`, `tornadoEngine.js` (line 1051).
  - Depends on: none.
  - Risks / edge cases: R-020 (120 s stay, 60 s cooldown, 1 s glide, team of 10, 100 m ring) must not change in the diagnosis. Be wary of a cooldown that starts only in `depart()`.
  - Rules: R-020, R-047.
  - Acceptance: a written timeline showing where the ship remains and why (timers or a stuck unit).

- [x] DONE Subtask 11: The ship leaves once the last samurai is down the ramp; the squad stays on the ground and stands down by its own all-clear (AMENDED by user decision: the samurai stay, the spaceship leaves).
  - Objective: at the end of `unloading` (ramp empty) the ship goes straight to `retracting` -> `leaving` -> `depart()` (`removeShip`), with no boarding. The squad (team of 10, 100 m ring, strength and behaviour unchanged) carries on independently and ends through `clearSquad` when no hostile (the `pickTarget` filter, exposed as `hostilesInCoverage()` on the squad API) has been in the ring for `SUPPORT.clearGrace` (6 s, world `dt`), or `SUPPORT.stay` 120 s from the last unit down, or none is left (once the fallen have sunk). The 60 s cooldown starts when the squad has ended AND the ship has gone (`finishSupport`, called by whichever ends last), and `callSamurai` and the targeting HUD refuse while `S.state.squad` is live, so a second call can never overlap a living squad.
  - Files changed: `engine/spaceship/config.js`, `engine/spaceship/descent.js`, `engine/spaceship/samurai.js`, `engine/spaceship.js`, `engine/spaceship/targeting.js` (state flags and HUD gate).
  - Result:
    - `descent.js`: `guarding`/`boarding` ship phases removed; `unloading` calls `api.beginGuard()` and moves to `retracting`; `depart()` no longer clears the squad or starts the cooldown directly.
    - `samurai.js`: `updateSquad` runs without a ship (free when no units and not guarding); `updateGuard` holds the stay and all-clear clocks; `clearSquad` also resets `S.state.squad`/`guarding`; no fade exists, units simply despawn (including `dying`).
    - `spaceship.js`: new `S.state` fields `squad`, `guarding`, `clearFor`; the black-hole `samuraiShip` consumer clears the squad only while it is still unloading, otherwise it removes the ship alone; Reset and dispose still go through `clearSquad`.
    - Verification: `npm run lint` and `npm run build` pass; behaviour verified by reading only (the app was not run). No R-020 number changed (`clearGrace` is additive); docs and rules untouched (Subtask 18 amends R-020).
  - Depends on: 10.
  - Rules: R-020, R-047, R-048, R-050.

- [x] DONE Subtask 12: Audit disposal and re-trigger.
  - Objective: confirm that after `depart()` there are no leftover meshes, lights or sounds: `removeShip` (ship group, ramp belt), `clearSquad` (units, trail materials), thrust particles (`S.thrust` pool is kept and zeroed), `S.light.intensity`, `spaceshipSound` fade, and no per-frame cost (`updateShip` returns at `phase === 'idle'`). Confirm that a second `callSamurai` after the 60 s cooldown works and that Reset and dispose stay clean. Fix only gaps found.
  - Files changed: `engine/spaceship/samurai.js`, `engine/spaceship.js`, `engine/spaceship/config.js` (one comment).
  - Result (verified by reading only; the app was not run):
    - Ship gone: `removeShip` disposes the group once (`disposeShip` uses unique sets, the ramp's shared edge material deduped, belt texture disposed once, no kit geometry involved), zeroes `S.light`, `depart` fades the sound, `updateShip` returns at idle, thrust stops by itself when `thrustAlive` reaches 0. Squad gone: `clearSquad` removes each unit and its trail material, clears claims and the `squad`/`guarding` flags; `updateSquad` is free with no units and no guard.
    - Re-trigger and Reset: `callSamurai` is refused while the ship is non-idle or `squad` is live and re-initialises `stay`/`clearFor`/`spawned`/`exitTimer`; Reset mid-unloading, mid-guard or mid-leaving clears squad, ship, flags and both cooldowns; dispose frees the kit once (`disposeSquad`). The black-hole consumer clears the squad only while unloading, otherwise cooldown starts when both have ended (`finishSupport`).
    - Fixes: `removeUnit` now returns early for an already-dead unit (no double trail-material dispose after a black-hole take then a clear); dead boarding code removed (`allAboard`, `recall`, `toRamp`, `climbing`, `aboard`, the redundant `recall()` before `clearSquad` in the black-hole consumer; grep confirmed no other users). `perf/bench.js` `landing` still valid (calls only `callSamurai`/`fireRocket`).
    - Not changed: Rocket Strike and Samurai are independent (own cooldowns, own state; only the samurai call is single-instance); rocket key listeners are bound to `ctx.signal` and aborted on detach.
  - Likely files: `engine/spaceship.js` (`resetSpaceship`, `disposeSpaceship`, `disposeShip`), `engine/spaceship/descent.js`, `engine/spaceship/samurai.js` (`clearSquad`, `disposeSquad`), `engine/spaceship/effects.js`, `engine/spaceship/samuraiModel.js`.
  - Depends on: 11.
  - Risks / edge cases: shared geometries and materials disposed twice (`disposeShip` collects unique sets; do not dispose the kit's shared geometry); the black hole's `samuraiShip` consumer also calls `removeShip`; `ctx.signal` listeners must not leak (R-047); the Rocket Strike and Landing Support must remain mutually exclusive (one at a time).
  - Rules: R-020, R-021, R-047, R-048.
  - Acceptance: after the encounter, `scene` has no samurai-ship children (check through the Three.js devtools or a scene traversal), `phase` is `idle`, `S.ship` is null, the encounter can be triggered again after the cooldown, and a Reset mid-encounter leaves nothing behind.

### Issue 4: first-person katana

- [x] DONE Subtask 13: Auto-draw the katana on selection and enter first person with right-click.
  - Objective: selecting the katana on the wheel draws it automatically from the back sheath (`katana.drawn` becomes true on selection; sheathed on any other weapon, a daze, a car, death), and right-click enters the existing `'aiming'` phase (and leaves it again) (hide Roger's mesh and name tag, lock the pointer, crosshair, `placeAimCamera`, `S.state.yaw/pitch`, FOV save and restore) and make the wheel, right-click out, Esc, a daze, freezing, a car and death leave it with the previous camera restored. Reuse `enterAim`/`leaveAim` rather than a parallel camera path; remove the katana exclusions in `plasma.js` `enterAim` and the `input.js` wheel/right-click special cases.
  - Files changed: `engine/hero/input.js`, `engine/hero/plasma.js`, `engine/heroWeapons.js`.
  - Result: `katanaToggle` and the katana's own pointer lock are gone; new `katanaDraw()` is called each frame by `consumeInput` while the katana is in hand and Roger is `running`/`aiming` and unfrozen (otherwise `katanaCancel()`), so it draws on selection and redraws after a daze/car/freeze. Right-click calls `toggleAim` (the `enterAim` katana exclusion is removed), so aim mode is the single pointer-lock owner; leaving the katana by the wheel calls `leaveAim`; a freeze lowers first person; daze, car, death, win, Restart and co-op down already call `leaveAim`. Left-click with the katana routes to `katanaPress` even while aiming and `pullTrigger` ignores the katana (no rifle charge).
  - Verified by reading only: the daze/car/death/endHero exit paths and lock release in `leaveAim`; lint and build pass. Not run in a browser.
  - Known gap for Subtask 14: in first person mouse movement both turns the camera and moves the virtual cursor/swipe; the quick slash and Blade Mode still use `S.state.heading` (only synced to yaw on `leaveAim`) and the follow-camera cursor overlay.
  - Likely files: `engine/hero/plasma.js` (`enterAim`, `leaveAim`), `engine/hero/input.js` (mousedown, wheel, Esc, per-frame guard on line 83), `engine/heroWeapons.js` (`katanaToggle`, `katanaCancel`, `releaseKatanaLock`, `showView`), `engine/heroMode.js` (phase handling, lines 600 to 650), `engine/hero/screen.js` (`placeAimCamera`, `placeFollowCamera`), `engine/camera.js`.
  - Depends on: none.
  - Risks / edge cases: three pointer-lock owners today (aim in `plasma.js`, katana lock in `heroWeapons.js`): keep exactly one and release it on every exit path (blur, Esc, death, Restart, killcam). Restoring the camera: `leaveAim` restores `savedFov`; the katana path must not leave Roger hidden or the crosshair on. The first-five weapons' behaviour and the wheel order stay unchanged (R-049). Roger stays out of lethal states from the camera change (R-001, R-035 spawn shield). Keep the Katana costing no energy.
  - Rules: R-001, R-023 (camera glides), R-035, R-047, R-049, R-051. Skill: `.claude/skills/hero-weapons-combo/SKILL.md`.
  - Acceptance: selecting the katana draws it from the back sheath in the follow camera; right-click gives first person with a crosshair; right-click again, or switching to another weapon, restores the follow camera, FOV, Roger's visibility and the cursor; no stuck pointer lock after Esc or tab blur.

- [x] DONE Subtask 14: Rework the katana's input for first person (swipe versus look). Highest-risk subtask.
  - Files changed: `engine/hero/input.js`, `engine/heroWeapons.js`, `engine/heroMode.js` (`katanaBody.canAct`), `engine/hero/movement.js` (one condition; reported out-of-scope fix).
  - Result: in first person with the katana, left up = mouse looks (real time, unscaled); left down = look frozen and the movement accumulates as the swipe / Blade Mode line (pointer-lock spikes scaled to 400 px a frame, direction kept). The crosshair is the centre and the swipe and cut line start there (`katanaPress(true)`). `S.state.heading` is synced to yaw each frame while aiming with the katana, so slash, lunge (LUNGE_MAX 6 m) and cut plane follow the view. Wheeling onto the katana from a raised weapon now calls `leaveAim`; only right-click enters first person. `canAct` accepts `aiming` (else no cut could fire); the rig stays drawn while aiming with the katana (else `rig.slash` refused). Blade Mode constants, hold, damage, hit-stop and scoring untouched; `slash.js`, `bladeCut.js`, `bladeUi.js` unchanged.
  - Verified by reading only: lint and build pass; the swipe/look gating, centred cursor, heading sync and exit paths were traced in code. Not run in a browser.
  - Manual steps: see the implementation report (click, six swipes, Blade Mode hold and cut, right-click in/out, wheel in/out, Esc, tab blur, daze).
  - Change request (Q toggles Blade Mode): the 0.25 s hold is gone (`KATANA_BLADE.holdSeconds`, `katana.hold` removed); Q with the katana drawn toggles it (`hero/input.js`, `heroWeapons.katanaBladeToggle`, `hero/katana/blade.js`), no Time Slow or energy; a short drag in the mode does nothing; right-click in/out ends it (`hero/plasma.js`). Docs: `docs/weapons.md`, `GAME_DESIGN.md`, R-032, R-051.
  - Objective: while the left button is up, the mouse looks (reuse the aim look code); while it is down, look is frozen and the mouse movement accumulates as the swipe and Blade Mode cut line, so `slash.js` (`SWIPE_MIN_PX`, the six directions, the click chain) and `bladeCut.js`/`bladeUi.js` keep reading screen-space deltas. Decide where the virtual cursor and its overlay draw in first person (crosshair at the centre; the cut line from the centre).
  - Likely files: `engine/hero/input.js` (the mouse-move path, lines 158 to 190), `engine/heroWeapons.js` (`katanaLook`, `katanaState`, `katana.cursorX/Y`), `engine/hero/katana/slash.js`, `engine/hero/katana/blade.js`, `engine/hero/katana/bladeCut.js`, `engine/hero/katana/bladeUi.js`.
  - Depends on: 13.
  - Risks / edge cases: Blade Mode slows the world to 10 % through the `bladeMode` hold, not `Post.bulletTime`, and Roger is not slowed (R-051): look must stay in real time and must not be scaled by world time. The hold threshold 0.25 s and the cooldown 0.35 s run on the weapons' real-time clock. Mouse deltas can be large with pointer lock (clamp as before). A swipe that starts while the camera is still turning must not mis-read: look is frozen at press, so the cut plane is stable. At most 4 s and 3 cuts per Blade Mode window and 3 cuts per alien (R-051). Auto-targeting (the lunge) uses Roger's heading: set the heading to the first-person yaw so the lunge goes where the player looks, still within `LUNGE_MAX` 6 m. Dazed, frozen, driving and dying never act.
  - Rules: R-001, R-029, R-032, R-049, R-051. Skill: `.claude/skills/hero-weapons-combo/SKILL.md`.
  - Manual review gate (per `.claude/skills/full-autonomous-run/SKILL.md`): this introduces a new camera and input technique for a stateful weapon; do not continue to Subtasks 15 to 17 until the user has played a first-person slash and a Blade Mode cut and approved.
  - Acceptance: a click, a swipe in each of the six directions and a Blade Mode hold and cut all work from first person, toward the crosshair; the camera never drifts during a swipe; slash damage, hit-stop and score are the same as before.

- [x] DONE Subtask 15: First-person katana viewmodel.
  - Files changed: `engine/hero/katana/model.js`, `engine/hero/screen.js` (`placeAimCamera`), `engine/hero/plasma.js` (`leaveAim`), `engine/heroMode.js` (dispose).
  - Result: the rig builds a first-person blade (`view`) whose meshes share the katana's own geometry and materials (no new lights, materials or programs; the blade is drawn 2x thicker and turned to show its flat); it hangs in the scene, follows the camera and rests low-right (grip about 0.45 m ahead, tip right of and just below the crosshair, clear of the 0.1 near plane).
  - The pose is the rig's own pose (so a swing shares the slash timing, kind and direction: diagonal, horizontal, vertical, swipes, Blade Mode cuts) offset from the low ready and scaled to stay in frame; the existing breathing sway gives the idle movement. Third-person blade/rig hide with Roger's mesh while aiming and return when not; `leaveAim` and Restart/dispose (`disposeView`) clear it. No trail, no damage, scoring, reach or co-op changes.
  - Retuned after play-testing (blade not clear in first person): the blade now stands raised (pitch 0.75 instead of near-level and edge-on), the swing offsets are 1.0x and the blade is drawn 3x wider, 2.4x thicker (`model.js` `VIEW_IDLE`, `VIEW_HAND_SCALE`, `spin.scale`); still unseen in a browser. The blade trail hangs on Roger's hidden mesh, so there is none in first person.
  - Verified by reading only: lint and build pass; not run in a browser, so the framing constants (`VIEW_*` in `model.js`) are untuned.
  - Objective: show the blade in view during first person, reusing `model.js`'s blade geometry and the existing viewmodel mechanisms (`weapons.showView`, `S.viewRifle` pattern) with a small swing animation driven by the slash/strike timing; hide the third-person rig (`S.katanaRig`) while aiming.
  - Likely files: `engine/hero/katana/model.js`, `engine/heroWeapons.js` (`showView`, `view()`), `engine/hero/models.js` (viewmodel builders for reference), `engine/heroMode.js` (`S.katanaRig` reset on line 540).
  - Depends on: 14 (reviewed).
  - Risks / edge cases: reuse geometry and materials (no per-slash allocation; R-048); dispose with the simulation and clear on Restart (R-047); the model must not clip through the near plane or the crosshair; the third-person rig must reappear when the weapon is sheathed. No additional lights or a recompile of lit materials mid-run (see the note in `aliens.js` about lights).
  - Rules: R-047, R-048, R-051. Skill: `.claude/skills/vfx-particle-pool/SKILL.md` (only if blade trails or sparks use particles).
  - Acceptance: the blade is visible in first person and swings with each cut; sheathing returns the third-person view with the rig; no leaked meshes after Restart and dispose.

- [x] DONE Subtask 16: Align slash reach, targeting and co-op with first person; regression check.
  - Files changed: none (the existing code already satisfies the goal after Subtask 14's heading sync).
  - Verified by reading only: the eye is at Roger's x/z (`placeAimCamera`, `screen.js`), and `katanaBody.position/heading` (`heroMode.js`) feed `land()`/`aimLunge()` in `slash.js`; heading equals yaw each frame while aiming (`input.js` line 178, `movement.js` line 280), so the 3 m arc, 6 m lunge and `reachesStack` run from the eye's x/z along the crosshair: an alien in front at 3 m is in the arc, one behind is outside it. Height test unchanged (blade 1.1 m against alien samples 0 to 1.4 m); pitch deliberately not used, as the blade swings level and a pitched test would add misses.
  - Co-op: the guest katana (`net/system.js` `guestFire`, 3.6 m, 0.9 rad, any kind accepting `blade`) is untouched; `inputGate.accept` only takes relayed guest messages (host id '0' is rejected as a peer), so the host's first-person state is never sent as guest input. Lint and build pass; not run in a browser.
  - Objective: make the forward arc, reach (3 m) and the stacked height test (`reachesStack`) use the first-person eye position and facing so the cut lands on what the crosshair shows; keep damage, scoring and the pieces pool as is. Verify the co-op guest's katana (`net/system.js`) still works for aliens and that the host's first-person state is not sent as a guest input.
  - Likely files: `engine/hero/katana/slash.js`, `engine/hero/katana/targets.js`, `engine/heroMode.js` (`katanaBody`), `engine/net/system.js` (read-only), `engine/net/inputGate.js`.
  - Depends on: 14, 15.
  - Risks / edge cases: R-051 values reach 3 m, lunge up to 6 m, 4 s and 3 cuts per Blade Mode, 32 pieces, blood 600 particles and 48 decals with `particleRoom()` checks, hit-stop 0.065 s: none may change. Scoring only through `gamefeel.event('slice')` then one `damage.addDamageScore()` (R-049). Other kinds still parry (R-051 as amended); do not send `blade` to a non-alien registry kind. The co-op guest path hits any kind accepting `blade` by ground distance (3.6 m, 0.9 rad); it is only verified here and extended for people in Subtask 17.
  - Rules: R-024 (heights), R-048, R-049, R-051.
  - Acceptance: with the katana equipped the player slashes toward the crosshair and the cut plane follows the swipe; an alien in front at 3 m dies, one behind the player does not; guest katana still works for aliens in a two-player session (people are added in Subtask 17).

- [x] DONE Subtask 17: The katana also cuts people (civilians), single player and co-op guest.
  - Files changed: `engine/environment/people.js` (new `eachCuttable`, `slicePerson`), `engine/hero/katana/targets.js`, `engine/hero/katana/feel.js` (optional `people` argument), `engine/hero/katana/slash.js`, `engine/hero/katana/bladeCut.js`, `engine/net/system.js`.
  - Result: standing civilians (grounded, not abducted, statue or named extra) are found by an early box reject then the arc and a 0/0.9/1.8 m height test, cut through `people.slicePerson` (never sent `blade`, no `accepts` change, they do not parry) and scored once with `IMPACT_SCORE` (8) in `targets.js`; the slash's `feel.cut` adds hit-stop, `slice` event and shake but no multi-cut bonus for people. The alien pieces core is reused with no new geometry (the figure is baked from its own meshes), so a person falls in two with the existing goo/flash; without the core it falls back to `explodePerson`. Co-op guest also kills the nearest civilian in the 3.6 m / 0.9 rad arc via `explodePerson` and `credit(IMPACT_SCORE, p.id)`.
  - Verified by reading only: lint, build and `npm test` (46 pass) pass; chain limits are untouched (counted per cut and per piece depth, not per person) and result arrays are the preallocated `MAX_RESULTS` ones. Not run in a browser.
  - Fix after play-testing (people could not be killed): `slash.js` `aimLunge` read `a.root.position` on every found target, but a civilian has `mesh`, not `root`, so a release with a person within 6 m threw a TypeError and aborted the frame; it now reads `root` or `mesh`. Reproduced and confirmed fixed with a node harness (real people.js, pieces.js, slash.js, targets.js): the person is removed, scored 8 once, two pieces made. A person's goo and cut face are now red (`bake.human`, set when no alien skin is handed over; `goo.burst(..., human)`, `KATANA_GOO.bloodBright/bloodDark`, `KATANA_PIECES.bloodCapColour`; decals stay green).
  - Not verified: the baked person's look (head is drawn as a metallic detail part) and the green alien goo on a person are untuned.
  - Objective: extend `hero/katana/targets.js` so people in reach (`ctx.Environment.people`, standing, within the same reach, arc and stacked height test) are cuttable, killed through the existing person path (`damage.damageFromImpact` or `people.explodePerson`, as the minigun and fire gun do), with the goo effect and the `rogerKill` event (which breaks Smooth Criminal), and no second scorer. Check how the pieces core (`pieces.js`, built for alien skins) can be reused for a person; if it cannot without new geometry, kill the person with the existing path and goo only (stated default). Then make the co-op guest katana in `engine/net/system.js` (line 627 onward) cut people host-side too, consistent with the host: guests currently only hit registry kinds that accept `blade`, and people are not in the registry, so add a nearest-person test in the same 3.6 m / 0.9 rad arc using the same kill path, without adding `blade` to any `accepts` list.
  - Likely files: `engine/hero/katana/targets.js`, `engine/hero/katana/slash.js`, `engine/hero/katana/bladeCut.js` (Blade Mode's three cuts), `engine/hero/katana/feel.js`, `engine/hero/katana/pieces.js`, `engine/hero/katana/goo.js`, `engine/environment/people.js`, `engine/damage.js`, `engine/net/system.js`.
  - Depends on: 16.
  - Risks / edge cases: R-051 is amended here (aliens and people); other registered kinds still parry, samurai are ignored, hunters are never touched (Subtask 8), and `blade` is never sent to a non-alien registry kind. The score goes only through `gamefeel.event('slice')` and one `damage.addDamageScore()`, with the base `ALIENS.killScore` only in `sliceKill` (a person scores its existing person-kill value once, not an alien's; confirm the number from `damage.js`). Pieces cap 32 and 8 per alien, blood pool 600 within `particleRoom()` and 48 decals stay (R-048). Hot path: reuse the preallocated result arrays in `targets.js` (`MAX_RESULTS`) and do not scan `Sim.objects` per frame beyond what the alien query does; people are many (up to 420, R-003), so use the people list with an early distance reject. Chain: three cuts per Blade Mode window and 3 per alien must not become 3 per person. R-001 and R-035: the katana never harms Roger. Co-op: guest kills credit the guest via the existing `credit(...)` path.
  - Rules: R-003, R-013, R-020, R-026, R-027, R-048, R-049, R-051. Skill: `.claude/skills/hero-weapons-combo/SKILL.md`.
  - Acceptance: a slash through a civilian kills it with goo and one score event; Blade Mode can cut people; aliens still cut as before; other enemies still parry; hunters and samurai unaffected; a co-op guest katana kills people and aliens consistently with the host; no new per-frame allocation.

- [x] DONE Subtask 18: Documentation (rules and docs for every amended contract).
  - Files changed: `.claude/rules.md` (R-013, R-020, R-034, R-036, R-041, R-051), `GAME_DESIGN.md`, `docs/enemies.md`, `docs/combat.md`, `docs/weapons.md`, comments only in `engine/heroWeapons.js`, `engine/hero/input.js`, `engine/hero/plasma.js`.
  - Result: R-020 (ship leaves after unloading, squad stands down by 6 s all-clear or the 120 s cap, cooldown once both ended), R-051 (aliens and people, auto-draw, first person), hunters and waterspout recorded; the hint text in `heroWeapons.js` was already correct, stale 'third person' comments fixed; R-049 wheel order unchanged and accurate.
  - Conflict reported: no doc claimed Rocket Strike and Landing Support are mutually exclusive (only this plan did); in code only the samurai call is single-instance.
  - Objective: update, in British English, `.claude/rules.md` and `GAME_DESIGN.md`/`docs/` for: R-041 (waterspout by button or scenario only; Subtask 3), hunter damage rows in R-013, R-034, R-036 (Subtask 9), R-020 (early samurai withdrawal after about 6 s all-clear, 120 s cap kept), and R-051 (the katana cuts aliens and people; hunters, other kinds and samurai unchanged; auto-draw from the back sheath; first person by right-click; look frozen while the button is held). Also update `GAME_DESIGN.md` (weapons section, which says right-click draws it in the follow camera), `docs/weapons.md`, `docs/enemies.md`, `docs/combat.md`, the weapon hint text in `heroWeapons.js` (line 526), and code comments saying "third person" or "never raised into aim" (`engine/hero/input.js`, `engine/hero/plasma.js`).
  - Likely files: `.claude/rules.md`, `GAME_DESIGN.md`, `docs/weapons.md`, `docs/enemies.md`, `docs/combat.md`, `docs/architecture.md`, `engine/heroWeapons.js`, `engine/hero/input.js`, `engine/hero/plasma.js`.
  - Depends on: 2 to 17.
  - Risks / edge cases: change no number that the user did not approve; keep R-051's reach 3 m, lunge 6 m, cooldown 0.35 s, 0.25 s hold, 0.10 world scale, 4 s and 3 cuts per window, 8 pieces, 32 live, hit-stop 0.065 s, blood 600 and 48 decals. R-051's "every other registered kind parries" now reads "except aliens and people; hunters and samurai ignored". The runtime is the source of truth; report any code/doc conflict instead of reconciling silently.
  - Rules: R-013, R-020, R-034, R-036, R-041, R-050, R-051.
  - Acceptance: no document or hint claims the automatic waterspout, hunter immunity to non-rifle weapons, the 120 s unconditional stay, the katana's follow-camera draw or aliens-only cuts.

### Whole-plan validation

- [ ] Subtask 19: Validation across all four issues.
  - Objective: run `npm run lint`, `npm run build` and `npm test` (this repo's `npm test` is `node --test` over `tests/*.test.mjs`, which cover the co-op client, protocol, relay, room and RNG, not the engine); then manual browser runs: (1) several full runs with and without Fujiwhara merges, watching the dam; (2) each of the six weapons on the hunter ships (and a check that the UFO and mothership contracts are unchanged); (3) a full Samurai Support encounter to `idle`, then a second call; (4) katana: auto-draw on selection, right-click first person, click, swipe, Blade Mode, cutting aliens and people, switching weapons, Esc, co-op guest (including people).
  - Likely files: none (validation); `FINDINGS.md` if a measurement is worth recording.
  - Depends on: 1 to 18.
  - Risks / edge cases: there is no engine test suite; manual validation is required for stateful and visual changes (CLAUDE.md). Check the shared particle budget stays within 10,000 and the entity cap within 160 during the hunter fights (R-048).
  - Rules: R-048, R-050.
  - Acceptance: every acceptance line of Subtasks 2, 4 to 8, 11, 12 and 13 to 17 is observed; lint, build and test pass; an Implementation Summary in the format from `CLAUDE.md` is produced.

## Highest-risk subtask

Subtask 14 (reworking the katana's input for first person). It touches pointer lock, mouse look versus swipe input, Blade Mode's world-time slow, the cut-plane maths and the camera in one stateful flow that has no automated tests, and a mistake can strand the pointer lock, mis-read swipe directions, or leave Roger hidden. The manual review gate above applies before Subtasks 15 and 16 proceed.

Second most sensitive: Subtask 4, because it adds a registry kind and a score path that other weapons will reuse (R-013, R-027).

## Suggested order

1 -> 2; 4 -> (5, 6, 7 in any order) -> 8; 10 -> 11 -> 12; 13 -> 14 (review gate) -> 15 -> 16 -> 17; then 3, 9 and the rest of the documentation as Subtask 18; then 19. Subtasks 3 and 9 may be done with 18 or earlier. The four issue groups are independent and can be approved separately.
