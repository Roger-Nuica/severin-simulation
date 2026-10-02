# Plan: Rechargeable health bar for Roger

## Status: COMPLETE (marked by the user, 2026-10-02)
Subtasks 1-22 implemented; lint, build and 122 tests pass. Subtask 23 (independent verification) skipped. Known gaps are listed under Subtask 22.

Status: PLAN ONLY. No runtime code has been changed. Implementation starts only after the user's go-ahead for PR 1 (subtask 1 onwards).
Process: `.claude/skills/full-autonomous-run/SKILL.md` gates apply (fixed safety gates, manual review gate after the highest-risk subtask). Roles per `.claude/agents/lead.md`, then `coder.md` (one subtask per call), then `verifier.md`.

## Goal

Replace "Roger dies from most things instantly" with a 100-point health bar that drains from damage and recharges after 7 s without damage (glow from second 4, fast refill of about 4 s, full about 11 s after the last hit). Some threats stay one-shot kills. Every weapon hurts every enemy (weakness model replaces immunities), friendly fire is on, non-creature targets (nuclear plants, mothership, tornadoes) get health, and 2-player co-op (per-player health, downed/revive) is designed in from the start through a single damage API that takes a target player id.

### Scope
- Health state, one player-damage API, regeneration, HUD HEALTH row, feedback (vignette, direction indicator, sounds, message).
- Re-wiring every existing Roger-lethal call site (`killRoger`, `hitArea`, `empSweep`, `catchPlayer`) to the damage API, and adding the new hazards in the brief that currently have no Roger path.
- Weapon x enemy damage table, enemy and non-creature health, damage-to-player values for friendly fire.
- Co-op health/downed/revive integration.

### Non-goals
- Other characters (people, samurai, Terminators, aliens) keep their current behaviour except for the damage-table changes in the brief; no health bar for them.
- Tornado, debris and ice never deal health damage (daze/freeze only). Player's own EMP never affects the player (R-032).
- No change to black hole duration 20 s, pull radius 100 m, no-escape zone 40 m (R-031), nor to caps (R-048), unless explicitly approved.
- No new TypeScript; JavaScript plus JSDoc types only (CLAUDE.md; global standard "all functions typed" is met via JSDoc `@param`/`@returns`).
- Functional style preferred (global preference): pure helper functions for the regeneration state machine, state kept on `Sim`/`ctx` (R-047), no module-level mutable state.

## Verified against runtime (runtime is the source of truth)

| Brief item | Runtime today | Plan consequence |
|---|---|---|
| Single death choke point | `hero/screen.js:70` `killRoger(title, sub, kind)`: spawn shield (`HERO.spawnShieldSeconds` 3) returns early, then `net.interceptRogerDeath(kind)`, then `phase='dying'`. `hitArea` at `hero/screen.js:108` and `heroMode.js` re-export. | Damage API wraps this: health 0 or instant kill calls the existing `killRoger` path. Shield stays honoured (brief: "short invulnerability after a hit" is separate and new). |
| Alien ranged laser 20/hit | Ray shot `aliens/crew.js:~592`: kills if lock point within `ALIENS.rayHitRadius` 1 m. Ship tracking laser `aliens/weapons.js:~137` (`laserKill` 1.2 m, 3.2 s burst) is a second, separate ranged source. | Map: crew ray hit = 20. Tracker = see Clarification Q3. |
| Alien melee 34, 3 kill, 3 s cooldown, ~2 m | `ALIENS.meleeReach` = **1 m**, instant kill at `aliens/crew.js:573`, no cooldown. | Needs new reach (about 2 m) and a 3 s per-attacker cooldown in config; reach is a brief change (user-decided). |
| Terminator touch 50, 2 kill, ~2 m, 3 s, telegraph at 6 m, 0.6 s wind-up | Squad: `terminator/movement.js:231` kills at `T800.reach + 0.8` (about 1.7 m). Hero-mode pursuers: `hero/pursuers.js:296` `caughtByPursuer`, `HERO.catchRadius` = 1.8 x 0.55 = **0.99 m**, kills via `heroMode.js:645`. Co-op: `net/system.js:532` `caughtBy`. No wind-up/telegraph exists. `T800.strikeCooldown` 1.4 is for alien strikes only. | Three call sites to unify behind one melee-touch helper. Telegraph is a new animation + cue (servo cue `creatureSounds.play('servo')` exists). |
| Hunter laser 50/shot | Hunter ships (`aliens/waves.js:~426`) fire `fireRay` at **people**/plants; against Roger only the hunter's tracking laser (`updateTracker`) kills. No discrete "shot at Roger" exists. | Q3. |
| Mothership laser 100 | Beam foot `hitArea(..., MOTHER.cutRadius 10)` at `mothership.js:404`; crash `megaBlast` `heroKill` (CRUSHED, radius 110 m per R-036). | 100 = instant kill (above max health) for beam and crash. |
| T-Rex ~33/s, 3 s | `trex.js:218` flame cone, instant `killRoger('TOASTED')` at 0.9 x range. Breath 2.6 s every 5-8 s (R-037). | DoT tick in cone. Note: a full 2.6 s breath is ~86 damage, not a kill; "3 s kills" only on continuous exposure (consistent with brief wording). Flag for balance review only. |
| Cyber Yeti 100 | `yeti.js:537` blow kills (`reach`, 0.5 s swing gate); freezing separate (`freezeRoger`, R-038). | Instant kill; freeze stays non-damaging. |
| Black hole 100 incl. caster | `consumables.js`/`player/blackHole.js`: Roger and his car are never consumed (R-031, player-controlled skip at `consumables.js:261`). | Rule change: Q-record R-031. |
| Nuclear 100 in blast | `nuclear.js:133` `heroKill` VAPORISED, `megaBlast.js:311`, kill radius 55 m (R-044). | Existing path becomes damage 100. |
| Earthquake crater 100 | `hero/screen.js:134` `checkChasm` kills 'fall' (chasm). `interceptRogerDeath` already exempts `kind === 'fall'` from co-op down. | Brief says co-op downs on every kill; Q4. |
| Explosions 100 + message | Tanker, fuel station, barrels, gas main, rocket have **no** Roger damage path today (only mega blasts, meteor, lava bomb). `hitArea` is called only by megaBlast, meteors, ship crash, mothership. | New damage zones needed in `explosives.js`/`environment/tanker.js`/`fuelFire.js`/`gasMains`/`spaceship/rocket.js`; radii must reuse R-010 ones (fuel station 22 m triggers, people 11 m) - Q5. |
| Lava 50 / 1.5 s, Flood 50 once, Ordinary fire 10/s | No Roger path exists for lava (only volcano lava bomb `volcano.js:250`, kills within 4 m), flood (`flood/dam.js`), ground/building fire. | New hazard detection, reusing `ctx.systems.hazards` and existing owner geometry. Q5. |
| Tornado/debris daze, ice freeze | Daze: `hero/movement.js:223` `daze()`, `HERO.dazeSeconds` 3.4, `dazeImmunity` 3. Freeze: `effects/freeze.js`, `heroMode.freezeRoger`. R-001 holds. | Verify only; make sure daze/freeze never touch the regeneration timer. |
| Katana only cuts aliens | R-051, `hero/katana/targets.js` parries non-aliens. | Rule change (R-051, R-013). |
| Co-op friendly fire off | `net/players.js` header: `FRIENDLY_FIRE = false`; `tests/coop-rules.test.mjs` likely asserts it. | Rule/test change. |
| HUD | ENERGY/PLASMA bars in `hero/screen.js:updateHud` (`.hero-cell`, `.hero-ebar`), styled in `tornado.css:1652+`; markup built in `heroMode.js`. Co-op guest HUD is a text block `net/system.js:908`. | HEALTH row follows same pattern. |
| Caps | `perf/caps.js`: 160 enemies, 10,000 particles. | No cap increase needed by design (HUD/vignette are DOM/CSS, feedback reuses pools). If any subtask needs more, STOP (see Gate). |
| Tests | `package.json` has `"test": "node --test"` and `tests/*.test.mjs` exist (relay, protocol, coop-rules), although `CLAUDE.md` says there is no real automated suite. | Documentation drift to correct in docs subtask. |

## Conflicts with `.claude/rules.md` / `GAME_DESIGN.md` (reported, not silently reconciled)

Rules below contradict the brief. Per the brief the user has already DECIDED these changes; the safety gates require them to be recorded explicitly and the rules/docs updated in Subtask 22 (not edited by the feature subtasks). Coder must quote this table as the approval reference.

| Rule | Current text | Change decided in brief |
|---|---|---|
| R-013 | Accepted damage types / immunities per kind (Terminator EMP/MEGA only, Yeti fire only, nuclear plants only by listed sources, etc.) | Every weapon hurts every enemy; old immunities become weaknesses (big damage) with others doing chip damage (never zero). |
| R-034 | Rifle table: tornado normal shot no effect; hunter ships `hunterShip` accepts only plasma/bullet/bolt/fire | Tornado, nuclear plant, mothership take chip damage from every weapon except katana. Hunter ships (`hunterShip`, currently never `blade`/`emp`/`freeze`) must accept every weapon; whether the katana hits hunters is covered by R-051 / D1 (default: katana chips them). |
| R-051 | Katana cuts only aliens/people; every other kind parries without damage; hunter ships ignored; do not modify `accepts` | Katana now damages non-aliens (parry sparks only where damage is minimal); still harmless against nuclear plants, mothership, tornadoes. Requires editing `accepts` (currently forbidden by R-051). |
| R-037, R-038, R-039 | Per-weapon damage and HP for T-Rex (40 HP, plasma 3, minigun 0.3...), Yeti (30 HP, fire 1.2/tick, EMP only stuns), Patient Zero (12 HP) | Replaced by the central weapon x enemy table; R-030 "Yeti 1.2 damage/tick out of 30 HP" is the baseline for the Yeti fire weakness. |
| R-015, R-036, R-044 | UFO hull 6, hunter hull 4, mothership hull 15 (plasma 1/MEGA 5); plants fall at 5 ship hits | Hull values keep their baseline numbers inside the table; plants/mothership/tornado get health values. |
| R-035 | Death conditions list (alien ray/grab, mothership beam, ship crash, Terminator, EMP on foot, meteor): all instant | Becomes damage per table; some stay one-shot. Spawn shield (3 s) unchanged. |
| R-031 | Never consume Roger or his car | Black hole affects its caster (100 damage). The Yeti/people consume rules unchanged. |
| R-032 | "No ability affects Roger" | Still true for Roger's own EMP (kept). Black hole is now a weapon, so no conflict beyond R-031. |
| R-001 | Tornado never kills Roger | Unchanged. Also "tornadoes get health" (non-creature target) is separate and does not weaken R-001. |
| R-020, R-013 samurai | Samurai ignore people, Roger, Yeti; only Roger's weapons kill them | Kept. Friendly fire on Roger's weapons vs samurai is the existing path; verify enemy damage never kills samurai (brief). |
| `net/players.js` header (`FRIENDLY_FIRE = false`), `docs/combat.md` "Immunity and exclusions", `GAME_DESIGN.md` "Death conditions" | Documented as above | Updated in Subtask 22. |
| Documentation drift | `CLAUDE.md` says no automated test suite; repo has `npm test` and `tests/` | Update note in Subtask 22 (not a gameplay change). |

No numeric conflicts found between `.claude/rules.md` and runtime for the values used by this brief except the ones in the table above (alien reach 1 m vs brief 2 m; Terminator 0.9/0.99 m vs 2 m; alien/Terminator have no 3 s cooldown). These are brief-driven runtime changes, not documentation errors. `rules.md` itself is currently modified in the working tree; Subtask 22 must start from its live content.

## Clarifications needed

User-decided in the brief (recorded here as required; no further answer needed, but each must be reflected in rules/docs):
- D1. Every weapon hurts every enemy; old immunities become weaknesses. Affects R-013, R-034, R-037, R-038, R-039, R-051 (`accepts` lists), `docs/enemies.md`, `docs/weapons.md`, `docs/combat.md`, skill `enemy-immunity-system`.
- D2. Katana damages non-aliens but never nuclear plants, mothership, tornadoes. Affects R-051.
- D3. Nuclear plants, mothership and tornadoes get health and are destroyed by every weapon except the katana. Affects R-013, R-034, R-044, R-036.
- D4. Friendly fire ON (single player: Roger's own explosions/black hole; co-op: partner's weapons). Affects `net/players.js` `FRIENDLY_FIRE`, `tests/coop-rules.test.mjs`, R-031.
- D5. Black hole affects its caster. Affects R-031.
- D6. Samurai remain unkillable by enemies/disasters. Affects nothing (kept R-020).
- D7. Cap increases: none planned. Gate still applies: any need to raise 160 enemies / 10,000 particles / R-031 pools (60/6/1400) requires explicit approval before proceeding.

Open questions (ANSWERED by the user on 2026-10-02; the answers below override the defaults where they differ):
- Q1. Sources that kill Roger today but are not in the brief's damage table: Patient Zero touch (`patientZero.js:247`), volcano lava bomb (`volcano.js:250`), meteor (`meteors/impact.js:85`, R-035 22 m), falling alien ship (`aliens/ship.js:303`), EMP wave on foot (`hero/pursuers.js:328`), chasm fall (`hero/screen.js:134`), alien "grab" (merged into alien melee). Default: all stay instant kills (damage above max health). Affects Subtask 5/7/9.
- Q2. Spawn shield (3 s) and the revive shield (2 s) vs the new ~0.2 s hit invulnerability: default keep both as they are; the 0.2 s window is separate and never blocks instant kills.
- Q3. Hunter/UFO tracking laser (`updateTracker`) is the only continuous ship laser on Roger today. Default: hunter tracker contact = 50 per burst hit (re-arm after 3 s without re-hitting during the same burst), UFO tracker = 20, mothership beam foot = 100. Confirm hunters should also gain a discrete "shot at Roger" or reuse the tracker.
- Q4. Chasm fall ("Earthquake crater: 100"): `interceptRogerDeath` currently excludes `'fall'` from co-op down (cannot revive into a hole). Default: keep as one-shot instant kill, revive position near partner (brief), and make it down the player in co-op too ("applies to every kill"). Confirm.
- Q5. Hazard geometry for new Roger damage (lava, flood, ordinary fire, tanker/fuel/barrel/gas/rocket blasts): default reuse each owner's existing radii (R-009, R-010, R-018, R-019) and `ctx.systems.hazards`; no new numbers except those in the config. Confirm per owner at the start of Subtask 7-12.
- Q6. Mapping of the "Terminator" in Hero Mode (R-028, 2 pursuers) vs the squad: default both use the same touch/telegraph helper.

### User answers (2026-10-02)
- Q1: the unlisted sources stay instant kills, **each with its own death message** (for example "Caught in the blast", "Crushed by a meteor", "Zapped by the EMP"). Subtasks 5, 7, 9 and 14/15 must carry a per-source message string in the central config, not one shared message.
- Q2: default confirmed (spawn shield 3 s and revive shield 2 s unchanged; 0.2 s hit window separate and never blocks instant kills).
- Q3: default confirmed (hunter tracker 50, UFO tracker 20, mothership beam 100, once per burst; hunters reuse the tracker, no new discrete shot).
- Q4: default confirmed (chasm fall downs the player in co-op; revive returns them near the partner).
- Q5: yes. Reuse each owner's existing radii; a car occupant is damaged.
- Q6: yes. Hero Mode pursuers and the squad share one touch/telegraph helper.

Status: no open questions remain. Implementation has not started and waits for the user's go-ahead.

## Central config (design)
New file `src/app/tornado/engine/health/config.js` (single source of every number: max 100, regen delay 7 s, glow start 4 s, refill 4 s, hit invulnerability 0.2 s, per-source damage, melee reach/cooldown/telegraph, weapon x enemy table, enemy and non-creature health, damage-to-player table). Constants frozen; per-instance state on `Sim`/`ctx`. Follow existing config-file style (`hero/config.js`, `aliens/config.js`).

## Subtasks

Order follows the 6 PRs in the brief. "Classification" follows full-autonomous-run step 2a: LOW = may be batched with adjacent low-risk subtasks; SEPARATE = its own Coder call.

### PR 1 - Health core

- [x] DONE Subtask 1: Create the central health config and types (SEPARATE; design choice).
  - Files changed: `src/app/tornado/engine/health/config.js` (new; config only, not wired, R-047/R-048/R-050).
  - Result: deep-frozen `HEALTH` (max, timers, glow curve, damage table with per-source death messages, melee, empty weapon/enemy/damage-to-player tables) plus `DamageEvent`, `HealthState`, `DamageEntry` typedefs. `npm run lint` passes.
  - Concern: `contactReach` 2 m is the new target; runtime still 1 m / 0.9 / 0.99 m. T-Rex flame set to 33/s.
  - Objective: `health/config.js` with max 100, timers (7 s, 4 s glow start, 4 s refill, 0.2 s hit window), source damage table (all values from the brief), melee settings, glow curve, empty weapon/enemy tables to be filled in PR 5. JSDoc typedefs for `DamageEvent {source, amount, type, position, targetId, instantKill}` and `HealthState`.
  - Likely files: new `src/app/tornado/engine/health/config.js`; style reference `hero/config.js`, `aliens/config.js`.
  - Depends on: none.
  - Risks / edge cases: R-047 (no module-level mutable state; freeze the config), R-050 (config only, no wiring), R-048 (no allocations; plain constants). Brief: "all values tunable from one config". Global standard: JSDoc types on everything.

- [x] DONE Subtask 2: Health state and pure regeneration/damage functions (SEPARATE).
  - Files changed: `src/app/tornado/engine/health/state.js`, `tests/health.test.mjs`.
  - Result: pure `createHealthState`, `applyDamage`, `stepRegen`, `glowLevel` (plus `isInstantKill`); refill constant 25/s, full at 11 s from near 0 (tested). 11 tests; lint and `npm test` (57) pass.
  - Note: the 0.2 s window ignores any non-instant hit, so Subtask 3/7 must apply per-second DoT (flame, fire) as ticks at least 0.2 s apart, or add an explicit exemption.
  - Objective: Per-player `HealthState` (value, `sinceLastDamage`, `refilling`, `invuln`, `lastSource`) and pure functions `applyDamage(state, event, config)`, `stepRegen(state, dt, config)`, `glowLevel(state, config)` returning a new state (functional style). Instant kill = damage > max, bypasses regeneration and ignores the 0.2 s window. DoT ticks reset the timer from the last tick. Dazing/freezing never call these. Add `tests/health.test.mjs` (node:test) covering: glow at 4 s, refill start at 7 s, full at ~11 s, any damage cancels glow and refill, invulnerability 0.2 s, instant kill bypass, DoT timer.
  - Likely files: new `src/app/tornado/engine/health/state.js`, `tests/health.test.mjs`; reference `tests/coop-rules.test.mjs` for test style.
  - Depends on: 1.
  - Risks / edge cases: pure functions testable without Three.js; time source must be the real/player time like abilities (`heroMode.js` `updateAbilities(dt)` runs in player time while dying), not world slow-motion (`time.js`), otherwise Time Slow/Bullet Time would stretch the regeneration timer; paused (`dt` 0) must not regenerate; refill rate fixed so that full at ~11 s from the last hit even from a low value (brief: "fills fast over about 4 s" - refill rate is a constant per second of max health, not a fixed time from the current value; confirm in test). R-001 (tornado never kills), R-032 (no ability affects Roger).

- [x] DONE Subtask 3: Health system registration and the one player-damage API (SEPARATE).
  - Objective: `createHealthSystem(ctx)` registered on `ctx.systems.health` with `initHealth/resetHealth/disposeHealth/updateHealth` per the lifecycle; API `damagePlayer({source, amount, type, position, targetId, instantKill, title, sub})`, `health(id)`, `isInstantKill`. For target `'0'` (Roger) at 0 health or instant kill it calls the existing `heroMode.killRoger` path (so `net.interceptRogerDeath`, spawn shield, death flow all stay). Reset on Restart (full health, timers cleared). Guests addressed by id but stored in the same map (handled for real in Subtask 21).
  - Likely files: new `health/system.js`; `src/app/tornado/tornadoEngine.js` (registration); `engine/lifecycle.js` (contract), `engine/heroMode.js`, `hero/screen.js:70`.
  - Depends on: 2.
  - Risks / edge cases: R-047 (lifecycle order, `ctx.systems` lookups lazily, listeners bound to `ctx.signal`), R-035 (spawn shield 3 s respected: `killRoger` early return must also absorb health damage during shield), R-050. Hero Mode inactive: API must no-op. Non-Hero (tornado-only) modes must not be affected. Double-death guard (phase 'dying' / 'won').
  - Files changed: `health/system.js` (new), `tornadoEngine.js` (register + `updateHealth(rawDt)` after `updateHero`), `heroMode.js` (read-only `rogerShielded`/`rogerPhase`; `resetHealth()` in `startHero` so Restart refills).
  - Result: `ctx.systems.health.damagePlayer/health/isInstantKill`; Roger death goes via `killRoger` (shield, net intercept, phase guards kept); regen on real time; nothing calls it yet.

- [x] DONE Subtask 4: HUD HEALTH row and glow (SEPARATE; DOM/CSS only).
  - Objective: HEALTH bar in Roger's HUD panel next to ENERGY and PLASMA, updated in `updateHud`, glow from second 4 intensifying until 7, stops on damage; red low-health state. Reuse the `.hero-hud` styling pattern.
  - Likely files: `hero/screen.js:updateHud` (~line 302), HUD markup in `heroMode.js`, `src/app/tornado/tornado.css` (~1652), `src/app/tornado/TornadoSimulator.js` only if the panel is declared there.
  - Depends on: 3.
  - Risks / edge cases: R-046 (UI animation 0.2 s, press scale), R-048 (no per-frame allocations; cache DOM refs, write only on change like `dataset.energy`), 60 FPS; CSS animation rather than JS per frame; HUD hidden under GAME OVER card (`hero/screen.js:183`); co-op small partner bar reserved for Subtask 21.
  - Files changed: `heroMode.js` (HEALTH row markup), `hero/screen.js` (`updateHud`, write-on-change), `tornado.css` (bar, low state, glow animation).
  - Result: HEALTH bar beside ENERGY/PLASMA; glow via `--glow` CSS variable and animation; red at 30% or less; hidden with the HUD under GAME OVER. Lint, 57 tests and build pass; not observable in play until Subtask 5 wires damage.

### PR 2 - Wire damage sources

- [x] DONE Subtask 5: Instant-kill sources through the API: yeti, mothership beam/crash, black hole, nuclear blast, ship crash, meteor, lava bomb, EMP wave, chasm, Patient Zero (SEPARATE; mechanical but touches many owners).
  - Files changed: `hero/screen.js` (`hitArea` takes a `source`; chasm), `heroMode.js` (typedef), `net/system.js` (`'fall'` exemption removed), `yeti.js`, `mothership.js`, `explosions/megaBlast.js` and `nuclear.js` (`heroKill.source`), `aliens/ship.js`, `meteors/impact.js`, `volcano.js`, `hero/pursuers.js`, `patientZero.js`, `player/blackHole.js` (new `consumeCaster`), `.claude/rules.md` (R-031).
  - Result: every listed source is now `health.damagePlayer({instantKill: true})` with its existing title/sub (messages from config only as fallback); black hole kills Roger inside the 40 m zone, no caps touched; EMP in a car stays shielded. Rocket and Smooth Criminal blasts reach it via `hitArea`'s default `explosion` source.
  - Not verified in play: co-op chasm down and revive near partner (revive position and health reset are not changed; health state stays 0 after a co-op down, for Subtask 6); black hole kill at the 12 m minimum shot distance; the empty car being captured after Roger exits.
  - Objective: replace each direct `killRoger`/`hitArea` call with `damagePlayer` (instant kill, same title/sub), so the death flow is bit-for-bit identical. Add black hole-on-caster (D5): Roger and his car now consumed, 100 damage (also touches the consumable skip at `consumables.js:261`).
  - Likely files: `yeti.js:537`, `mothership.js:404`, `explosions/megaBlast.js:311`, `nuclear.js:133`, `aliens/ship.js:303`, `meteors/impact.js:85`, `volcano.js:250`, `hero/pursuers.js:328` (`empSweep`), `hero/screen.js:134`, `patientZero.js:247`, `player/blackHole.js` and `player/blackHole/*`, `effects/consumables.js`.
  - Depends on: 3, Q1/Q4 defaults confirmed.
  - Risks / edge cases: R-031 (CHANGES "never consume Roger"; duration 20 s / 100 m / 40 m / pools 60-6-1400 unchanged; caster consumption must still fit the dissolve cap 6 and the car handling), R-035, R-038, R-042 (lava bomb radius 4 m), R-044 (kill radius 55 m), R-036 (110 m crash radius), R-050 (chasm 'fall' exempt from co-op down must be decided in Q4), skill `.claude/skills/disaster-system-change/SKILL.md` (disasters: UI, registration, lifecycle, consumers), `.claude/skills/enemy-immunity-system/SKILL.md`. EMP in a car stays shielded; Roger's own EMP never harms Roger (R-032).

- [x] DONE Subtask 6: Alien ranged laser and alien tracker (20/hit) (SEPARATE).
  - Objective: crew ray hit (`aliens/crew.js` ~592) and ship/hunter tracker (`aliens/weapons.js` `updateTracker`) deal config damage per hit. Hunter tracker = 50 and mothership beam 100 per Q3 defaults. Discrete hit with re-arm per burst so a 3.2 s burst does not tick every frame.
  - Likely files: `aliens/crew.js`, `aliens/weapons.js`, `aliens/config.js` (read-only constants; damage lives in `health/config.js`), `aliens/waves.js`.
  - Depends on: 3, Q3.
  - Risks / edge cases: R-035 (tracker 100 m lock, 5 m/s, 3.2 s hold, returns 3-5 s: unchanged), R-015, R-036, R-048 (no per-frame allocation in `updateTracker`), spawn shield. Acceptance 5 hits kills on regen test.
  - Files changed: `aliens/crew.js`, `aliens/weapons.js`, `aliens.js` (tracker `source`/`struck` fields only).
  - Result: crew ray hit calls `damagePlayer({source:'alienRay'})` (20, five hits kill); tracker deals `ufoTracker` 20 (green) or `hunterTracker` 50 (red) once per burst: `struck` is cleared only when a new burst starts and set only when the hit is applied, so no per-frame ticking. Lethal hits keep 'ZAPPED' / 'VAPORISED' texts; mothership beam untouched (instant kill, Subtask 5).
  - Not verified in play: five-ray kill and burst hit timing in a live game.

- [x] DONE Subtask 7: Melee-touch helper with cooldown (SEPARATE; new shared logic).
  - Files changed: `health/melee.js` (new, pure, not wired), `tests/melee.test.mjs` (new).
  - Result: `createTouchState`, `touchReady`, `touchAttempt(state, dist, config, now, {staggered, source})` returning `{state, damage, source}`; reach 2 m, cooldown 3 s per attacker, staggered never touches. Wind-up state machine left to Subtask 9. Lint and tests pass.
  - Objective: pure helper `touchAttempt(attackerState, targetDistance, config, now)` implementing contact reach about 2 m, 3 s cooldown "counted once" per attacker per target, return damage. Used by aliens (34, 3 kill) and Terminators (50, 2 kill).
  - Likely files: new `health/melee.js`, tests in `tests/health.test.mjs`; `aliens/crew.js:573`, `terminator/movement.js:231`, `hero/pursuers.js:296` (`caughtByPursuer`), `heroMode.js:645`, `net/system.js:532`.
  - Depends on: 3.
  - Risks / edge cases: `HERO.catchRadius` (0.99 m) and `ALIENS.meleeReach` (1 m) are replaced by the new reach: confirm one config value; R-028 (Hero Mode Terminators 2 pursuers, 55 m behind), R-022 (squad of 5), R-025, knocked-down Terminators (`p.stagger > 0`) must not touch; two attackers must not bypass the cooldown (cooldown is per attacker; brief wording "counted once"; document the choice); Time Slow scaling (`time.scale('world')`) vs real time for cooldown.

- [x] DONE Subtask 8: Wire alien melee and Terminator touch to the helper (SEPARATE).
  - Files changed: `aliens/crew.js`, `aliens/models.js`, `aliens/config.js`, `aliens.js` (comment), `terminator/movement.js`, `terminator/model.js`, `terminator/config.js`, `hero/pursuers.js`, `heroMode.js`.
  - Result: `touchAttempt` + `damagePlayer` (34 alien, 50 squad/pursuer, 2 m reach, 3 s cooldown on world time via a per-attacker `touch`/`touchClock`); `caughtByPursuer` became `touchByPursuers`; `ALIENS.meleeReach` removed (`HERO.catchRadius`, `T800.reach` kept: still used by net co-op and people targeting). lint, `npm test` (63) and build pass.
  - Unverified in play: feel of the 2 m reach, no car tear-out on a non-lethal touch, co-op guest catch unchanged.
  - Objective: replace the instant kills at `aliens/crew.js:573`, `terminator/movement.js:231`, `heroMode.js:645` with `damagePlayer` (34 and 50), keep "caught while reeling" messaging. Contact leaves the attacker with a recovery.
  - Likely files: those listed in Subtask 7.
  - Depends on: 7.
  - Risks / edge cases: R-013 (Terminator tear-out from car per `heroMode.js` comment), R-035, daze interplay (dazed phase not immune), `net/system.js` `catchPlayer` unaffected until Subtask 21.

- [x] DONE Subtask 9: Terminator telegraph (wind-up) (SEPARATE; NEW rendering/animation technique).
  - Files changed: `health/melee.js` (`meleeStep`, `telegraphArm`, `telegraphGlow`), `health/config.js` (`strikeSeconds` 0.15, `recoverSeconds` 0.6), new `terminator/telegraph.js` (shared by squad and pursuers), `terminator/movement.js`, `hero/pursuers.js`, `terminator.js` (header comment), `tests/melee.test.mjs`.
  - Result: within 6 m: 0.6 s wind-up (`shoulderR` raised, `eyeMat` x2.5, existing `servo` cue once), strike through `touchAttempt` (hit only within 2 m, else a miss; cooldown starts at the strike, recovery ends 0.75 s later); knocked-down and shorted-out machines cancel. lint, `npm test` (68) and build pass.
  - Unverified in play: the pose and glow look (visual only), servo cue loudness and pitch, feel of 0.6 s against walking speed.
  - Objective: when a Terminator closes to about 6 m: state `windup` of about 0.6 s with arm raised and glowing (existing `model.js` joints: `shoulderL/R`, `eyeMat`), servo whine cue (`creatureSounds.play('servo')`), strike on contact; if the target leaves reach during the wind-up the strike misses and the Terminator recovers before the 3 s cooldown ends. Applies to the squad and to Hero Mode pursuers.
  - Likely files: `terminator/movement.js`, `terminator/model.js`, `terminator/config.js`, `hero/pursuers.js`, `sound/creatures/recipes.js`, `health/melee.js`.
  - Depends on: 8.
  - Risks / edge cases: no existing wind-up analogue (pursuers/squad only have walk and strike pose), glow must not add lights beyond `lightPool` limits (R-048, skill `vfx-particle-pool`); Stays consistent with R-028/R-022 spawn counts; entity cap 160; creature voice limit 18 (R-025/R-046); must be per-instance state (R-047). Candidate second highest-risk subtask.

- [x] DONE Subtask 10: Damage over time: T-Rex flames and ordinary fire (SEPARATE).
  - Objective: T-Rex cone contact ticks about 33/s (3 s continuous kills) instead of `killRoger('TOASTED')`; stepping out stops it. Ordinary building/ground fire (not lava, not T-Rex) ticks 10/s while standing in it (tunable). Ticks emitted by one helper at a fixed interval (for example 0.25 s) so the 7 s timer counts from the last tick.
  - Likely files: `trex.js:218`, `trex/flames.js`, `buildingFire.js`, `groundFire.js`, `fuelFire.js`, `hazards.js`, `health/config.js`.
  - Depends on: 3.
  - Risks / edge cases: R-037 (breath 2.6 s each 5-8 s, 60 m cone, 52 m begin range), R-009/R-010 (fuel station phases and radii), R-017 (Firenado duration 13 s, damage score x1.5 must stay score-only, never player damage), R-048 (no per-frame allocation in cone checks; reuse scratch vectors), tick rate versus 60 FPS; the 0.2 s invulnerability must not swallow DoT ticks (decision: DoT bypasses the hit window).
  - Files changed: `health/dot.js` (new), `health/fire.js` (new), `health/config.js` (`dot.interval` 0.25 s, `dot.fireReach` 3 m), `health/system.js`, `trex.js`, `buildingFire.js`, `groundFire.js`, `fuelFire.js`, `tests/dot.test.mjs` (new).
  - Result: T-Rex cone ticks 8.25 per 0.25 s (about 33/s, first tick on contact, so about 3 s kills; TOASTED card on the lethal tick); ordinary fire ticks 2.5 per 0.25 s via `contactAt` on the three fire owners. Radii: building footprint half-extents + 3 m (fire level at least 0.25); ground patch `jitter` 1.3 m (level at least 0.25); fuel station `FUEL.puddleRadius` 9 m burning, 0.7 of it while the spilt fuel burns on. `hazards.js` has no fire kind and lava is excluded. Car occupants burn (Q5).
  - Unverified in play: the feel of the 3 m building margin and 1.3 m patch radius, 60 FPS with `?perf=1`, the T-Rex step-out in a real fight.

- [x] DONE Subtask 11: Lava and flood (SEPARATE).
  - Files changed: `health/hazards.js` (new), `health/config.js`, `health/system.js`, `fissure.js`, `lavanado.js`, `flood.js`, `tests/hazards.test.mjs`.
  - Result: lava 50 on contact then every 1.5 s (vent/caldera radius, Lavanado funnel reach); flood crest (`atCrest`) 50 once per event, latch in closure, cleared when the flood is idle or on reset.
  - Unverified in play: that the Lavanado footprint and crest feel fair; fissure crack strips themselves do not burn, only vents/lakes.
  - Objective: lava contact 50, re-applied every 1.5 s while in contact (earthquake lava, Lavanado, fissure); flood wave impact 50 once per flood event (per-event flag reset on restart and new dam event).
  - Likely files: `earthquake.js`, `lavanado.js`, `fissure.js`/`fissure/`, `flood/dam.js`, `flood/water.js`, `flood.js`, `hazards.js`.
  - Depends on: 3, Q5.
  - Risks / edge cases: R-018 (lava above 7.9 magnitude, sinkhole above 7.1), R-019 (24 m wave at breach, 15 m at end), R-016 (Doomsday sequence untouched), `hero/movement.js` water/standable checks, car occupancy (in a car: protected or not? default damages occupant, confirm in Q5), once-per-event flag must be per instance on `Sim` (R-047). Skill `disaster-system-change`.

- [x] DONE Subtask 12: Explosion deaths with message (SEPARATE).
  - Objective: tanker, fuel station, barrels, gas main and rocket explosions deal 100 (instant kill) to Roger in their blast radius; death card shows "Caught in the blast". Reuse existing radii and the `explosives.js` `setOffExplosivesAt` flow; nothing new in the chain limits.
  - Likely files: `explosives.js`, `environment/tanker.js`, `fuelFire.js`/`fuelFire/chain.js`, `gasMains.js`/`gasMains/`, `environment/factory.js`, `spaceship/rocket.js`, `hero/screen.js` (title/sub).
  - Depends on: 3, Q5.
  - Risks / edge cases: R-008 (5 tankers, no nuclear plants in ordinary explosive list), R-009/R-010 (radii; people killed at 11 m is the closest analogue for "in the blast"), R-011 (chain limits depth 3, 14 secondaries, 5 cars: damage must not re-trigger per secondary: once per event per player), R-021 (Rocket Strike touchdown damage within 52 m, 80 m ring), R-032 (energy charge from explosions unchanged), R-048 (do not add particles).
  - Files changed: `explosives.js` (new `hitRogerAt`), `environment/tanker.js`, `fuelFire.js`, `gasMains/network.js`, `environment/factory/blast.js`, `spaceship/rocket.js` (death sub only).
  - Result: instant kill "BLOWN UP / Caught in the blast" via `heroMode.hitArea`, once per blast (damage no-ops while dying). Radii reused, none new: tanker 66 m (`fireRadius * 0.6`, its setOff reach), fuel station 11 m (`FUEL.killRadius`), gas rupture 21 m (`ruptureRadius * 0.7`), chemical works wave front out to `scorchRadius` 110 m; Rocket Strike already killed at 80 m via megaBlast (only its card sub changed). Barrel pops and exploding chain cars deal nothing.
  - Unverified in play: how the 66 m tanker and 110 m works kill feel, car occupant death, lint/test/build pass.

### PR 3 - Daze and freeze hazards

- [x] DONE Subtask 13: Daze/freeze never touch health and never reset the regen timer (LOW).
  - Files changed: `tests/health.test.mjs` (no runtime change).
  - Result: read-verified that movement, car, freeze, blizzard, debrisImpacts never reach health; yeti.js has only its one-shot blow (R-038).
  - Tests: zero-damage entries/events leave state, timer and glow unchanged; source-grep guard.
  - Objective: verify and guard: tornado, debris, ice, Yeti storm, Blizzard produce daze/freeze only. Add a regression unit test that `applyDamage` is not invoked by daze/freeze paths; confirm debris hits Roger as daze only.
  - Likely files: `hero/movement.js:223`, `hero/car.js:256`, `effects/freeze.js`, `blizzard.js`, `yeti.js`, `debrisImpacts.js`, `tests/health.test.mjs`.
  - Depends on: 3.
  - Risks / edge cases: R-001 (never kill), R-038 (Roger freezes after 1.5 s, frozen 3 s; the Yeti blow on frozen Roger is a kill, covered in Subtask 5), `dazeImmunity` 3 s unchanged. Frozen Roger remains "easy prey" without extra damage.

### PR 4 - Feedback

- [x] DONE Subtask 14: Hit flash, red vignette pulse, damage direction indicator (SEPARATE; HUD/DOM).
  - Objective: vignette and flash on health damage, directional arrow toward `position`, low-health state; low cost (CSS/DOM).
  - Likely files: `hero/screen.js`, `tornado.css`, `post.js` only if a shader pass is chosen (prefer CSS).
  - Depends on: 3, 4.
  - Risks / edge cases: R-046 (UI animation 0.2 s), R-048 (no extra render passes or particles; `post.js` perf budget; documented in `FINDINGS.md`), accessibility (no rapid flashing beyond what `lightning.flashScreen` already does), `docs/performance.md`.
  - Files changed: `health/system.js` (emits `playerHurt` on non-lethal Roger damage), `events.js` (new event listed), `health/config.js` (`HEALTH.lowThreshold` 0.3, moved from `hero/screen.js`), `heroMode.js`, `hero/screen.js`, `tornado.css`.
  - Result: CSS-only red vignette pulse (0.2 s, 40% peak, at most about 3 per second), arrow toward `position` (turns with the camera, 1 s), persistent low-health vignette at or below 30%; cleared at GAME OVER, endHero/reset and dispose; no shader pass or particles.
  - Unverified in play: how the vignette, arrow and low-health breathing look and feel in the browser; lint, 85 tests and build pass.

- [x] DONE Subtask 15: Hurt sound, low-health heartbeat with muffled audio, recharge sound, explosion death message (SEPARATE; audio).
  - Objective: hurt cue, heartbeat loop below a threshold with a low-pass on the master (reuse the existing audio graph), recharge cue when refill begins, "Caught in the blast" banner for explosion instant kills.
  - Likely files: `sound/` (cues, `heroSound`), `hero/screen.js:showBanner`, `health/system.js`.
  - Depends on: 3, 12.
  - Files changed: `sound/healthAudio.js` (new: hurt, heartbeat, recharge, muffle via `setMuffle(.., 'health')`), `health/state.js` (`refillStarted`, `isLowHealth`), `health/system.js` (wiring, `playerHurt` listener, release on reset/dispose/pause/death), `tests/health.test.mjs`.
  - Result: procedural cues on their own bus (no creature voices); heartbeat plus muffle only while alive, unpaused and at or below `lowThreshold`; "Caught in the blast" already reaches the death card via `killRoger` sub.
  - Unverified in play: how the cues sound, muffle depth (0.45) and beat tempo are judged by ear only.
  - Risks / edge cases: R-025 / R-046 (never more than 18 creature voices; do not route through creature voices), Web Audio context state on first gesture, muffle must be reset on Restart/dispose (`disposeHealth`), no stuck filter while paused.

### PR 5 - Weapon x enemy damage table

- [x] DONE Subtask 16: Enemy health model and weapon x enemy table in config (SEPARATE; HIGHEST-RISK GROUP START).
  - Objective: fill the central config with a health value per enemy kind (alien, terminator, pursuer, T-Rex, Yeti, Patient Zero + clones, hunter ship, UFO, samurai, nuclear plant, mothership, tornado) and a damage value per weapon (rifle, MEGA BEAM, minigun, railgun, fire gun, katana, black hole, rocket, lightning, EMP) per enemy kind. Baselines taken from runtime/rules: minigun 30 hits for the Terminator (R-029), Yeti fire 1.2/tick of 30 HP (R-030, R-038), T-Rex 40 HP with plasma 3 / minigun 0.3 / bolt 8 / EMP 6 (R-037), Patient Zero 12 HP plasma 3 / minigun 0.5 / bolt 6 / EMP 4 (R-039), UFO hull 6, hunter 4, mothership 15 (R-015, R-036), plant 5 ship hits (R-044). Every non-weakness cell is a small non-zero chip.
  - Likely files: `health/config.js` (or `health/damageTable.js`), new unit test `tests/damage-table.test.mjs` (no zero cells except the three katana exclusions).
  - Depends on: 1; value review by the user recommended before 17.
  - Risks / edge cases: R-013, R-034, R-037, R-038, R-039, R-051 (see conflicts table), R-015, R-036, R-044, R-048 (160 enemy cap unchanged); balance only, no code paths; flag any cell where the old rule gave "no effect" so docs list it.
  - Files changed: `src/app/tornado/engine/health/damageTable.js` (new, frozen), `src/app/tornado/engine/health/config.js` (imports it into `weaponVsEnemy` / `enemyHealth`), `tests/damage-table.test.mjs` (new). `npm run lint` and `npm test` (91 pass) clean.
  - Result: baselines verified against runtime (Terminator 30 minigun rounds, Yeti 30 HP fire 1.2, T-Rex 40, Patient Zero 12, hull 6/4/15, plant 5); no rule conflict found. Chip rule: `CHIP_FRACTION = 0.02` of health, one constant. Zero cells: only katana vs plant, mothership, tornado. Black hole is not a cell (outright kill). Samurai listed in `PLAYER_WEAPONS_ONLY`.
  - Review table (damage per hit; **bold** = existing runtime value, plain = new chip or new value; `0` = katana exclusion). Columns: plasma / MEGA / minigun / railgun / fire (per tick) / katana / rocket / lightning / EMP.

| Kind (health) | plasma | MEGA | minigun | railgun | fire | katana | rocket | lightning | EMP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| alien (1) | **1** | **1** | 0.02 | **1** | **1** | **1** | 0.02 | **1** | 0.02 |
| terminator (30) | 0.6 | **30** | **1** | **30** | 0.6 | 0.6 | 0.6 | **30** | **30** |
| pursuer (30) | 0.6 | **30** | **1** | **30** | 0.6 | 0.6 | 0.6 | **30** | **30** |
| T-Rex (40) | **3** | **40** | **0.3** | **8** | 0.8 | 0.8 | 0.8 | **8** | **6** |
| Yeti (30) | 0.6 | 0.6 | 0.6 | 0.6 | **1.2** | 0.6 | 0.6 | 0.6 | 0.6 |
| Patient Zero (12) | **3** | **12** | **0.5** | **6** | 0.24 | 0.24 | 0.24 | **6** | **4** |
| PZ clone (1) | **1** | **1** | **1** | **1** | **1** | 0.02 | 0.02 | **1** | **1** |
| hunter ship (4) | **1** | **5** | **0.25** | **2** | **0.5** | 0.08 | 0.08 | **2** | 0.08 |
| UFO (6) | **1** | **5** | 0.12 | 0.12 | 0.12 | 0.12 | 0.12 | 0.12 | 0.12 |
| samurai (3) | 3 | 3 | **1** | 3 | 0.06 | 0.06 | 3 | 3 | 0.06 |
| nuclear plant (5) | 0.1 | **5** | 0.1 | 0.1 | 0.1 | 0 | 0.1 | 0.1 | 0.1 |
| mothership (15) | **1** | **5** | 0.3 | 0.3 | 0.3 | 0 | **8** | 0.3 | 0.3 |
| tornado (20) | 0.4 | **20** | 0.4 | 0.4 | 0.4 | 0 | 0.4 | 0.4 | 0.4 |

  - Cells where the old rule gave "no effect" (now a chip): every plain cell above except the new samurai values (3 = one-hit, as `samurai.js` "anything else one") and the tornado MEGA (20 = neutralise). Notable ones to review: katana on Terminator/pursuer/T-Rex/Yeti/Patient Zero (0.6/0.6/0.8/0.6/0.24, R-051 parry), plasma on Terminator (0.6, was knockdown only, R-034), MEGA and every weapon but fire on the Yeti (0.6, R-013), fire on Terminator, T-Rex and Patient Zero, every non-ship weapon on the UFO, hunters and plant, every non-MEGA weapon on the tornado.
  - Unverified guesses to confirm: rocket on aliens (chip; the blast may kill them today), lightning on plant and mothership (chip, not the Electric Tornado), samurai plasma/bolt/rocket treated as one-hit (3 of 3), tornado health 20 is new.

- [x] DONE Subtask 17: Route weapon hits through the table in the enemy registry (SEPARATE; HIGHEST-RISK TECHNICAL SUBTASK).
  - Objective: one shared "hurt enemy" helper (health per enemy instance stored in per-instance state, for example on the existing `states` Map in `enemies.js` or each owner's record) that applies table damage for each accepted weapon type and still calls the owner's `damage(e, hit)` handler for the existing weakness behaviour (stun, knockdown, kill, consume). Extend `accepts` lists (R-051 currently forbids; decided in D1) and `DamageType` with `'blade'` semantics for the katana against non-aliens; preserve samurai ignore. Black hole stays an outright kill via `consume` (not ordinary damage, per skill).
  - Likely files: `enemies.js` (registry), `aliens.js`, `terminator.js`, `hero/pursuers.js`, `trex.js`, `yeti.js`, `patientZero.js`, `aliens/waves.js` (`hunterShip` kind), `hero/plasma.js`, `hero/bullets.js`, `hero/fireGun.js`, `heroWeapons.js`, `hero/katana/targets.js`, `effects/area.js`, `strikeTargeting.js`, `spaceship/samurai.js`, `damage.js` (score path only).
  - Depends on: 16, 3.
  - Risks / edge cases: R-013, R-027 (respect `accepts` and handler; accepted does not mean kill; score only via `damage.addDamageScore`), R-049 (weapon cycle unchanged; score once via `gamefeel.event`), R-029 (30 hits for the Terminator under Bullet Time), R-030, R-033, R-034 table rows, R-051 (katana scoring `slice`, 3 cuts per alien, pieces 32 live), R-048 (no per-hit allocation; hot path `Sim.objects`; 160 enemies, 10,000 particles, no extra particles on chip hits), R-020/R-021 (samurai unkillable by enemies; Rocket Strike hull 8 of 15 and Yeti takes only fire damage today), `hero-weapons-combo` skill (extend existing weapon and score paths), `enemy-immunity-system` skill (do not add a hit type globally; update only the owner contracts). Regression danger: changing immunities can silently re-balance every fight; every enemy needs a before/after acceptance run.
  - Files changed: `engine/health/enemyDamage.js` (new, pure), `engine/enemies.js` (health per instance in a WeakMap; `hit` applies the table and calls the optional owner `defeat`), `terminator.js`, `heroMode.js` (pursuer), `aliens.js` (alien, hunter ship), `trex.js`, `yeti.js`, `patientZero.js` (original, clone): each gained a `defeat` adapter onto its existing kill path; `hero/fireGun.js` (dropped the `accepts('fire')` filter); `hero/katana/targets.js` (+ comments in `slash.js`, `bladeCut.js`): non-alien kinds in reach now take a plain `blade` hit; `tests/enemy-routing.test.mjs` (new, 15 tests); follow-up: `aliens/ship.js` (`hitShip` chip path), `heroWeapons.js`, `strikeTargeting.js`, `spaceship/samurai.js` (health 3 per samurai through the table). `npm run lint`, `npm test` (106 pass) and `npm run build` clean.
  - Design: `accepts` is NOT widened (decision, so every owner `damage` handler and every `accepts`-based caller such as `rocket.js` stays exactly as is). The register applies the table to every hit; accepted kinds still go to the owner handler unchanged (weaknesses, numbers untouched, and they also count toward health); unaccepted kinds chip with no effect and no particles, and when health reaches 0 the owner's `defeat` runs its normal kill path (scored by the owner, once; later hits find it unlisted or a no-op). Health rounds to 3 decimals so 50 chips of 0.6 empty 30. Black hole unchanged (`consume`). Hit rate cost: one `includes`, one table read, one WeakMap get/set per hit; no allocation.
  - Before / after per enemy (rifle=plasma, MEGA, minigun, railgun/lightning=bolt, fire, katana=blade, rocket, EMP, black hole). "chip" = table value, no visible effect:
    - alien: rifle, MEGA, railgun, lightning, fire, katana unchanged (kill, katana 3 cuts via `cut`). Minigun and EMP: was nothing, now chip 0.02 (burn when 50 accumulate). Rocket: unchanged (blast through its own path). Black hole: consume.
    - Terminator squad: MEGA, minigun (30 rounds, R-029), railgun, lightning, EMP unchanged (rifle still knocks back). Fire and katana: was nothing, now chip 0.6/hit, EMP-style death at 0 (accumulates with the rifle knockback chip 0.6 and minigun 1). Rocket unchanged. Black hole: consume.
    - Hero Mode pursuer: same as the squad (minigun on a pursuer still goes through `pursuerBulletHit`, unchanged; fire, katana, other chips accumulate and `startPursuerDeath` at 0).
    - T-Rex: rifle 3, MEGA, minigun 0.3, railgun/lightning, EMP stun unchanged. Fire and katana: was nothing (katana parry), now chip 0.8 per hit; death through `fall` at 0. Samurai blade amounts unchanged. Rocket unchanged. Black hole: consume.
    - Yeti: fire 1.2 per tick and EMP stun unchanged. Rifle, MEGA, minigun, railgun, lightning, katana: was nothing, now chip 0.6 per hit (50 to drop it; `fell` scores 3000 once). Rocket: unchanged (still only its fire hit). Black hole: consume.
    - Patient Zero: rifle 3, MEGA 12, minigun 0.5, railgun/lightning 6, EMP 4 unchanged. Fire and katana: was nothing, now chip 0.24; `killOriginal` at 0 (clones go with it, scored once). Black hole: consume (clones separate).
    - Patient Zero clone: every weapon it already took still kills; katana: was nothing, now chip 0.02 (`removeClone` at 0). Rocket not routed.
    - Hunter ship: rifle 1, MEGA 5, minigun 0.25, railgun 2, fire 0.5/tick unchanged (still `hitHunter`; Rocket Strike path untouched). EMP: was nothing, now chip 0.08 (`hitHunter` for the remaining hull at 0). Katana still never touches it (`IGNORED_KINDS`, it hovers). Black hole may still pull it (consume).
    - UFO (follow-up, user approved "yes and yes"; not a registry kind, routed in its own call sites; hull 6): rifle 1 and MEGA 5 unchanged. Minigun, fire gun (per tick) and railgun/lightning bolt landing under it: was nothing, now chip 0.12 through `hitShip` (chip path: no burst, a spark every 4th hit within the particle budget, quiet cue; `heroWeapons.js`, `hero/fireGun.js`, `strikeTargeting.js`). Katana and EMP: not wired (the blade never reaches it, no EMP route reaches ships). Rocket unchanged (`ROCKET.shipDamage` 99, down). Black hole: unchanged `consumables` entry.
    - Samurai (follow-up; not a registry kind, via `hitSamurai`): rifle, MEGA, railgun, lightning and the rocket blast: still one hit (3 of 3; the blast is the wired rocket column). Minigun: still 3 rounds (1 of 3 each, same small spark). Fire gun: was a one-hit kill, now 0.06 per tick of 3 (50 ticks) as the approved table says, a deliberate nerf. Katana: still ignored (`IGNORED_KINDS`); EMP: no route. Enemies and disasters still never call `hitSamurai`, so they cannot kill one.
    - Rocket column: wired only for the samurai blast. Registry kinds keep the MEGA/EMP/fire hits `rocket.js` sends (untouched, so hunters and the 8-of-15 mothership are unchanged).
  - Unverified in play: every chip path (fire gun and katana on Terminators, pursuers, T-Rex, Yeti, Patient Zero; minigun and EMP on aliens), the katana spark plus chip timing on a multi-enemy slash, and that 50-hit chip kills feel right; Terminator mixed-weapon accumulation; no frame-time measurement.
  - Notes for review: (1) UFO and samurai now routed (user approved); the samurai fire cell is 0.06, a nerf from one-hit. (2) Rocket column wired for the samurai blast only; Rocket Strike is unchanged for every other enemy. (3) Nuclear plant, mothership, tornado (and their katana exclusions) are left for Subtask 18. (4) Code comments updated (`enemies.js`, `yeti.js`, `katana/*`); `rules.md` and docs left for Subtask 22.

- [x] DONE Subtask 18: Non-creature targets: nuclear plant, mothership, tornado health (SEPARATE).
  - Files changed: `health/enemyDamage.js` (pure `chipTarget`, `shipKindOf`, `mergedHealth`), `nuclear.js` (`chipPlant`, `chipAt`), `mothership.js` (chip path in `hitByPlasma`), `vortex.js` (`health`), `hero/plasma.js` (`chipTornado`), `heroMode.js`, `fujiwhara.js`, `heroWeapons.js`, `hero/fireGun.js`, `strikeTargeting.js`, comment in `hero/katana/targets.js`, `tests/enemy-routing.test.mjs` (+6). Lint, `npm test` (112) and build clean.
  - Result: no registry kinds; each weapon path calls the pure helper. Plant health is its existing `hull` (5, shared with the ship hits); mothership is `state.hull`; tornado is `Vortex.health` (20, reset when Hero Mode ends). At 0: plant goes critical, mothership shoots down, tornado `neutralize` (existing path). Merge keeps the lower health, absorbed one reset.
  - Before / after (plasma / minigun / fire / railgun bolt; MEGA, rocket, black hole unchanged): plant 'reinforced' message / nothing / nothing / nothing, now 0.1 chip each (50 to breach), MEGA breach and ship hits unchanged. Mothership 1 / nothing / nothing / nothing, now 0.3 chip each for minigun, fire and bolt (quiet: no burst or shake, a spark every 4th); plasma 1, MEGA 5 and Rocket Strike 8 unchanged. Tornado 'TOO STRONG' / nothing / nothing / nothing, now 0.4 chip each (50 to neutralise; plasma shows the funnel percentage); MEGA neutralises as before. Katana: never reaches any of the three (not registry kinds, `targets.js`), no damage, no parry. Black hole: unchanged outright kill. Lightning tile strikes and EMP: no change (bolt chips on Roger's railgun only; no EMP route reaches these three). Rocket Strike on the plant and tornado: not routed (unchanged).
  - Unverified in play: all chip paths and their pacing, fire gun cone on a plant or funnel, funnel percentage message, a merged funnel's health, Final Boss with chips (only reachable in Hero Mode), frame time.
  - Objective: health values in config; all player weapons except the katana chip them; strong weapon stays fast (MEGA BEAM, ship hits); katana does nothing (clang/spark or pass-through). Tornado at 0 health weakens/dissipates through the existing removal path (`Vortex.neutralized` or `tornadoes` removal); black hole destroys all three outright.
  - Likely files: `nuclear.js` (`shipHit`, `megaHit`), `mothership.js`, `tornadoes.js`, `vortex.js`, `hero/plasma.js`, `strikeTargets.js`, `hero/katana/targets.js`, `effects/area.js`.
  - Depends on: 17.
  - Risks / edge cases: R-044 (5 ship hits, meltdown timing, 55 m kill radius, +30000), R-036 (mothership hull 15, 6 s intro, crash radius 110 m), R-034 tornado rows (normal shot "no effect"), R-006 and R-004 (Fujiwhara merge and the second funnel: health must follow the merged funnel, not duplicate), R-016 (Final Boss single-funnel EF5; a health value must not allow chase/control mode violations), R-001 unaffected, R-005 storm presets (damage mapped by size), R-023.

- [x] DONE Subtask 19: Damage-to-player values and friendly fire (single player) (SEPARATE).
  - Objective: damage-to-player per weapon (plasma, MEGA BEAM, minigun, railgun, fire gun, katana, black hole gun, rocket, explosions) in config, applied through `damagePlayer` when a player weapon hits a player. Roger's own explosions can now hurt him (D4).
  - Likely files: `health/config.js`, `hero/plasma.js` (`hero/plasma.js:587` "A samurai hit, or caught in the blast"), `hero/fireGun.js`, `hero/bullets.js`, `hero/katana/*`, `spaceship/rocket.js`, `net/system.js` (reads only).
  - Depends on: 17, 12.
  - Risks / edge cases: R-029, R-030 (railgun does not hit closer than 9 m to Roger: self-hit avoidance), R-031, R-032 ("explosions can charge energy up to 50% once per event" unchanged), self-hit via own bullets at spawn point; guards for a single-player run with no second player.
  - Files changed: `health/config.js` (`damageToPlayer`, `friendlyFire`, source `friendlyFire`), new `health/friendlyFire.js` (pure helpers), `hero/plasma.js` (`hurtRogerInBlast`), new `tests/friendly-fire.test.mjs`.
  - Result: Roger's own plasma/MEGA BEAM blast hurts him (15/40 at the centre, linear falloff to the 7/18 m radius), through `damagePlayer`, with a 1.5 m muzzle guard and a no-partner guard. Explosions, rocket and black hole keep their existing kill paths (100); EMP 0. Minigun, railgun, Fire Gun and katana cannot reach Roger (no splash; railgun barred under 9 m; cone and slash start at him), their values are for co-op (Subtask 21).
  - Unverified in play: how a point-blank plasma shot feels, lint/test/build run without play.

### User decisions on Subtask 17 follow-up (2026-10-02)
- Samurai: the fire gun nerf (50 ticks of 0.06 against 3 health) is KEPT, as the table says. Subtask 22 must update R-020 and the docs.
- UFO: the chip damage (minigun, fire gun, railgun, lightning) and the rocket column wired for the samurai blast are KEPT.
- Still open: tanker kill radius (66 m now) and whether barrels hurt Roger.

### Checkpoint
- [x] DONE (user confirmed continuation) MANUAL REVIEW GATE after Subtask 17 (highest-risk technical subtask): per `.claude/skills/full-autonomous-run/SKILL.md` ("Mandatory stop for manual verification") the run must stop, summarise, and request the user's visual/manual check before Subtasks 18-23 (dependent work). The Terminator telegraph (Subtask 9) is flagged as the runner-up risk and is reviewed together with this gate if the user wishes.

### PR 6 - Co-op (LAST; depends on the net system)

- [x] DONE Subtask 20: Per-player health state in the player registry and damage API for guests (SEPARATE).
  - Objective: `damagePlayer` addressed by `targetId` ('0' host Roger, '1'+ guests); host-authoritative health/regen timer per player; guest reaching 0 or instant kill calls `net.catchPlayer(id)`; Roger goes through `interceptRogerDeath` unchanged. Replace the caught/touch checks for Terminators and aliens targeting `net.pickTarget` with `damagePlayer(..., targetId)`.
  - Likely files: `health/system.js`, `net/system.js` (`catchPlayer` 373, `interceptRogerDeath` 391, `caughtBy` 532, `pickTarget`), `net/players.js` (`REVIVE`), `net/protocol.js`, `terminator/movement.js:~230`, `aliens/crew.js`.
  - Depends on: 8, 10, 11, 12, 19, and the net system being merged (`net/system.js` currently has uncommitted changes in the working tree: rebase/merge awareness).
  - Risks / edge cases: R-047, R-050, `tests/coop-rules.test.mjs` (rules asserted), `REVIVE.bleedOut` 30 s and `REVIVE.shield` 2 s retained, brief says revive returns near the partner (existing behaviour to confirm), no desync on reset, peers send input only (host authority), black hole and nuke downing everyone (brief) must still end the game when both are down; `kind === 'fall'` exemption decided in Q4.
  - Files changed: `health/system.js`, `health/state.js` (`isHittable`, `revivedState`), `net/system.js` (instant `caughtBy` removed; revive resets health), `terminator/movement.js`, `terminator/telegraph.js`, `hero/pursuers.js`, `aliens.js`, `aliens/crew.js`, `aliens/weapons.js`, `tests/health.test.mjs`.
  - Result: `damagePlayer` addresses guests by `targetId` (ignored unless up and past shield; at 0 or instant kill it calls `net.catchPlayer`); downed players take no damage and do not regenerate; revive (Roger included) resets health to full, the `REVIVE.shield` and in-place revive within 3 m of the partner are unchanged. Terminators, pursuers and aliens (touch, ray, ship laser) hit the nearest player via `pickTarget` with the same 34/50 cooldown touches. Lint, 120 tests and build pass; protocol untouched.
  - Unverified in play: all co-op behaviour (needs two browsers), including guest downs, revive health and both-down game over.

- [x] DONE Subtask 21: Synced health, discrete damage events, HUD for two bars, friendly fire on (SEPARATE).
  - Objective: add health to the ~20 Hz player snapshot row (`net/system.js:705`, `net/protocol.js`), discrete `playerDamage {id, source, amount}` events (existing `sendEvent` channel, `net/events.js`), HUD shows local bar large and partner bar small (guest HUD at `net/system.js:908`), set `FRIENDLY_FIRE = true` and route partner weapons, black hole and explosions to the other player, black hole affects its caster.
  - Likely files: `net/system.js`, `net/protocol.js`, `net/events.js`, `net/players.js`, `relay/server.mjs` (only if the protocol needs a new field; check `relay/` message validation), `tests/protocol.test.mjs`, `tests/coop-rules.test.mjs`, `tests/relay.integration.test.mjs`, `hero/screen.js`.
  - Depends on: 20, 4.
  - Risks / edge cases: R-047, protocol backward compatibility (an old client reading a longer player row), snapshot size and the relay, `FRIENDLY_FIRE` constant and its test must be changed intentionally (rule D4), downed player vs health bar display at 0, revive restores a defined health value (decision needed in the Coder subtask; default: full health plus `REVIVE.shield`), network jitter on glow (client derives glow from synced `sinceLastDamage`), spectator/disconnect mid-DoT, no extra per-frame allocation in the 20 Hz serialiser.
  - Files changed: `net/protocol.js` (optional snapshot `hp` rows `[id, health, sinceLastDamage]`, `playerDamage` event; players row stays 9 columns because a longer row fails an older client's strict width check), `net/system.js` (host serialiser, `notifyDamage`, `hitGuestsArea`, `splashGuests`, guest rays/katana vs partner, guest HUD with large local and small partner bar, glow derived client-side, HUD written only on change), `net/players.js` (`FRIENDLY_FIRE = true`), `health/system.js` (guest damage event), `hero/screen.js` + `heroMode.js` + `tornado.css` (host partner bar; `hitArea` also hits guests), `player/blackHole.js` (guest swallowed in the zone), `hero/plasma.js` (blast splash on guest), `tests/protocol.test.mjs`, `tests/coop-rules.test.mjs`.
  - Result: guest sees its own health, glow and hurt flash/sound (via `playerHurt`); downed bar shows 0 and DOWN; revive health (full) arrives in the next `hp` row. No relay change. Lint, 122 tests and build pass.
  - Unverified in play (needs two browsers): everything above. Not wired: Roger's own minigun, railgun, Fire Gun and katana against the guest, and the guest's plasma blast splash and Fire Gun flame against Roger (only rays, katana, Roger's plasma splash, explosions and black hole are routed).

### Documentation

- [x] DONE Subtask 22: Update `.claude/rules.md`, `GAME_DESIGN.md`, `CLAUDE.md`, docs, skills (SEPARATE; after PR 5 gate and the user's review).
  - Files changed: `.claude/rules.md` (R-013, 015, 020, 031, 034-039, 044, 047, 050, 051 amended; new R-052, R-053, R-054), `GAME_DESIGN.md`, `docs/combat.md`, `enemies.md`, `weapons.md`, `architecture.md`, `CLAUDE.md` (test note), skills `enemy-immunity-system`, `hero-weapons-combo`, `disaster-system-change`. `net/players.js` header already said friendly fire is ON (no edit needed).
  - Result: docs follow the runtime; R-051 `accepts` ban amended. Lint and `npm test` run.
  - Known gaps: tanker kill radius 66 m (reuses its set-off radius, unconfirmed); barrels and exploding chain cars deal nothing to Roger; Roger's minigun/railgun/Fire Gun/katana vs the guest and the guest's plasma splash/Fire Gun vs Roger not routed; snapshot rate is 15 Hz in `net/protocol.js` (brief said about 20 Hz); placeholder death texts (BURNED, SWEPT AWAY); fissure crack strips do not burn; Rocket Strike on plant/tornado and EMP on UFO/plant/mothership/tornado unrouted.
  - Objective: update R-013, R-015, R-031, R-034, R-035, R-036, R-037, R-038, R-039, R-044, R-051 (and add new rule IDs R-052 Health bar and regeneration, R-053 Damage API and melee touch, R-054 Weapon x enemy table and non-creature health) so each matches the new runtime; `GAME_DESIGN.md` "Death conditions", "Aliens and enemies"; `docs/combat.md` ("Immunity and exclusions", Hunter ships), `docs/enemies.md`, `docs/weapons.md`, `docs/architecture.md` (new `health/` system), `net/players.js` header comment, `CLAUDE.md` test-suite note, skills `enemy-immunity-system`, `hero-weapons-combo`, `disaster-system-change` (new "damage to the player" step).
  - Likely files: files listed.
  - Depends on: 20, 21 (final numbers) - may run its rules/doc edits per PR as PRs land, but the final pass must be last before verification.
  - Risks / edge cases: `rules.md` rules say docs follow runtime (never the reverse); British English in all documentation (user's global standard); `.claude/rules.md`, `GAME_DESIGN.md`, `docs/*` currently carry uncommitted changes in the working tree, so edit on top of the live files; do not alter unrelated rules.

### Final

- [x] DONE (skipped at the user's request, 2026-10-02) Subtask 23: Verification run (Verifier). Phase 3 was skipped: the results have NOT been independently validated and nothing was exercised in the browser.
  - Objective: independent check of every acceptance criterion below; produce `VERIFICATION_health-bar.md` (only when invoked "with verification" per the skill).
  - Depends on: 22.
  - Risks / edge cases: manual checks listed below; flag as unverified anything not exercised in the browser.

## Acceptance criteria (trace to the brief)

1. No damage for 4 s: bar glows and the glow intensifies until 7 s; at 7 s it refills; full about 4 s later (about 11 s after the last hit); any new damage resets the timer, stops the glow and any refill in progress. Daze does not reset it. (PR 1; Subtasks 2, 4, 13)
2. Alien ranged laser kills in 5 hits (20 each); alien melee kills in 3 touches (34); Terminator in 2 touches (50); hunter ship laser in 2 shots (50); mothership laser in 1 (100). Melee touches are at least 3 s apart. (Subtasks 6, 7, 8)
3. Terminator visibly raises its glowing hand at about 6 m with a servo cue, strikes at about 2 m after about 0.6 s; leaving range during the wind-up makes the strike miss and it recovers before the 3 s cooldown ends. (Subtask 9)
4. T-Rex flames kill in 3 s of continuous exposure and stepping out stops it; ordinary fire does 10/s. (Subtask 10)
5. Yeti, black hole, nuclear blast, earthquake crater and explosions kill outright; explosions show "Caught in the blast"; lava and flood take half health; tornado, debris and ice never kill. (Subtasks 5, 11, 12, 13)
6. Every weapon deals some damage to every enemy (no zero cells in the table apart from the katana vs plant/mothership/tornado). Nuclear plants, mothership and tornadoes take chip damage from every weapon except the katana. Black hole still destroys them. (Subtasks 16-18)
7. Friendly fire is on in single player (own explosions/black hole) and in co-op. Samurai unkillable by enemies and disasters. (Subtasks 5, 19, 21)
8. Co-op: separate health/regen per player, partner bar small, downed at 0, revive window, game over only when both are down (including black hole and nuke), revived near the partner. (Subtasks 20, 21)
9. 60 FPS holds (no new per-frame allocations, no cap changes); every value tunable from one config. (all)

## Gates, risks and approvals

- Rule changes above (D1-D5) are user-decided in the brief; the plan names the exact rule IDs and Subtask 22 updates them. A Coder must not edit `.claude/rules.md` outside Subtask 22.
- Caps: no cap increase is planned (R-048). If Subtask 17 or 10 cannot fit within 160 enemies / 10,000 particles / R-031 pools, STOP and request approval with the required increase.
- Performance: the brief's "60 FPS holds" is an explicit requirement; verify with `?perf=1` and the benchmark `?bench=1` described in `FINDINGS.md` / `docs/performance.md` after Subtasks 10, 14, 17.
- Skills applied: `enemy-immunity-system` (Subtask 16-18), `hero-weapons-combo` (Subtask 17, 19), `disaster-system-change` (Subtasks 5, 11, 12), `vfx-particle-pool` (Subtasks 9, 14), `coder-plan-run` and `full-autonomous-run` (process).
- Highest-risk technical subtask: **Subtask 17** (routing every weapon through a shared health table while preserving owner handlers; touches the immunity and weapon contracts, hot paths and nearly every enemy file). Runner-up: Subtask 9 (new telegraph animation) and Subtask 21 (protocol change).
- Mandatory manual review: stop after Subtask 17 and request the user's visual/manual review (see Checkpoint).

## Validation approach

- Per subtask: `npm run lint`.
- At end of each PR and the end of Phase 2: `npm run lint` and `npm run build`; `npm test` (`node --test`; new `tests/health.test.mjs`, `tests/damage-table.test.mjs`, updated `tests/coop-rules.test.mjs`, `tests/protocol.test.mjs`).
- Manual browser checks (`npm run dev`, Hero Mode): regen timeline with a stopwatch (glow at 4 s, refill at 7 s, full at about 11 s); each damage source in the table (spawn each enemy via the panel); Terminator wind-up at 6 m and miss-on-retreat; T-Rex flame 3 s and step-out; lava 1.5 s re-apply; flood once per event; black hole as caster; katana against a Terminator (damages) and a plant/mothership/tornado (harmless); co-op with two browser tabs against `npm run relay` (downed, revive, both-down game over, friendly fire).
- Performance: `?perf=1` overlay during a heavy fight; no regression versus the `FINDINGS.md` budget.
