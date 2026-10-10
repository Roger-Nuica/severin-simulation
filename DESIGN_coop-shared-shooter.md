# Design note: the shared shooter (Subtask C1 of PLAN_coop-guest-visibility.md)

Research only, read at `ba2c134`, 2026-10-10. **Decision gate:** the owner approves this note (and answers section 5) before Subtask C2.

Terms: the **resolve half** is what a shot does to the world (trace, hit dispatch, blast, people, damage, score, kill events, flame ticks, hole placement). The **feedback half** is the viewmodel, HUD, flash, charge UI, cue and camera shake; it stays Roger-bound.

## 0. Findings that change the plan
1. **The Katana is not shared in effect** (the plan says it is). The host lands through `targets.strike` (`hero/katana/targets.js:323`, from `slash.js:250-280`); the guest has its own arc test and `explodePerson` (`net/system.js:1305-1349`). Numbers differ: host reach 6.0 m, cos 0.5, cooldown 0.35 s (`slash.js:50,52,64`); guest 3.6 m, 0.9 rad, 0.5 s (`net/guestWeapons.js:40,44`).
2. **The guest rifle auto-repeats while the trigger is held** (`system.js:2836`, `1260-1262`); the host fires on release at a charge level (`hero/plasma.js:49` `releaseCharge`, `:389` `firePlasma`). Decision 13 needs the release model.
3. **`charge` is validated but never sent** (`protocol.js:170,177` accept it; `system.js:2834-2837` never sets it).
4. **Wheel mismatch:** `protocol.js:74` lists 6 weapons, `heroWeapons.js:72` lists 7 (Gravitron last); the guest cannot reach Gravitron.
5. **`rogerKill` is inconsistent:** only Smooth Criminal listens (`smoothCriminal.js:234`); no guest kill emits it except the Fire Gun's (`fireGun.js:176`).
6. **Kill scoring is inconsistent:** `damageFromImpact` on a person scores IMPACT (`damage/impact.js:45-49`); a bare `explodePerson` scores nothing (`people.js:172`), so Fire Gun people kills score nothing for either player (`fireGun.js:121`); blast kills add 20 each (`plasma.js:594`).
7. **The hole is already replicated** (Subtask 7): C4 is now rules and placement only.
8. **`guestTracer` is dead code** (`heroWeapons.js:1046`, `heroMode.js:900`).
9. **EMP is nearly shooter-free already:** `pulse` (`player/emp.js:111-132`) only reads Roger for the centre (`emp.js:163,177`).

## 1. Roger dependencies of the resolve half
| Weapon | Trace | Roger reads in resolve | Guest today |
|---|---|---|---|
| Rifle, charge, MEGA | `cam.position`, `S.aimDir` (`plasma.js:401`) | `hurtRay('0')` (`:405`); `hurtRogerInBlast` hardcodes `'0'` and reads `S.roger.mesh.position` (`:488-489`); `splashGuests` hardcodes `'0'` (`system.js:744-760`); knockback from `S.roger` (`:551`, `pursuers.js:140`); `flashMessage`/`showBanner` (`:516-544`, `:687`); `rogerKill` (`:553`); `addDamageScore(20*k)` (`:594`) | `scan`, no blast, no charge, auto-repeat, range 140 m |
| Minigun | `cam.position` + spread (`heroWeapons.js:602-611`) | `hurtRay('0')` (`:613`); `landRound` person branch via `damageFromImpact` (`:657`), `rogerKill` (`:659-681`) | `scan`, no person kill, no ammo |
| Railgun | `traceAim(cam, aimDir)` (`:907`) | min range 9 m from `rogerPosition()` (`:716-719`); 5 m victims (`:725-728`); `boltAt` (`:729`); `hurtArea('0')` (`:731`); `rogerKill` (`:732`) | `scan` on enemies; `hurtRay` not `hurtArea`; no min range |
| Fire Gun | `scorch(dir, origin, shooter)` (`fireGun.js:106`) | origin falls back to `rogerPosition()` (`:107`); `hurtSector(shooter)` already shooter-aware (`:109`); `rogerKill` (`:176`); `chipTornado` (`plasma.js:672`) | `breathe` with its own clock (`system.js:1279`); closest to shared |
| Katana | `env.position()`, `env.heading()` (`slash.js:251-252`) | `hurtSector('0')` (`:262`); `targets.strike` (`targets.js:323`); `rogerKill` (`slash.js:276`); the lunge moves Roger (`:291-300`) | own code (`system.js:1305-1349`) |
| Black Hole Gun | `traceAim` (`heroWeapons.js:907`); min 12 m from `rogerPosition()` (`:755-757`) | `energy.hero` (`:760`); `blackHole.fire(x,z)` has no caster; `consumeCaster` swallows any player in the zone (`blackHole.js:253-268`) | `scan` 200 m, else ground; clamped to `HERO.bound` (`system.js:1364`) |

Shared ports already present: `hero().traceAim` is origin-parametric (`heroMode.js:910`); `hurtRay`, `hurtSector`, `hurtArea` take `shooterId` (`system.js:781,814,843`); `enemies.hit` and `damageFromImpact` take the world, not Roger.

## 2. The shooter and its ports
```
Shooter = { id, isHost, eye, dir, feet: {x, z}, alt, heading, muzzle?, cd }
```
`eye` (camera on the host, `eyeAt(alt)` on the guest) and `feet` stay separate. The host's `fireBullet`, `firePlasma`, `fireRail`, `fireHole` and the host-side `guestFire` each build one per shot and call the same `resolveX(shooter, hit)`. Ports: `trace` (`traceAim`), `hitEnemy` (`enemies.hit`), `hitPerson` (`damageFromImpact` or `explodePerson`, one per weapon), `hurt` (`hurtRay`/`hurtSector`/`hurtArea`/`splashGuests` with the id), `score` (`addDamageScore` plus the guest `score` event), `notify` (`flashMessage` or a guest `notice`), `kill` (`rogerKill`, policy open), `energy`, `fx` (one `weaponFx.announce` with the shooter id; today it hardcodes `'0'`, `weaponFx.js:33`). Presentation (shake, flash, cue) only when `isHost`.

## 3. Stages
| Stage | Change | Size | Risk | Single-player check |
|---|---|---|---|---|
| C2 hitscan | guest rifle, minigun, railgun through `traceAim` then `landRound` (exported) and `plasmaHit` with the shooter; `scan` kept for the hole until C4 | ~120 lines (`system.js`, `heroWeapons.js`, `plasma.js`) | medium-high (protected hit path; host byte-identical with the default shooter) | host weapons vs person, car, tree, building, T-Rex, ship, samurai, pursuer, terminator: same damage and score; manual two-browser stop |
| C3 blast, rail circle, charge, MEGA | shooter in `hurtRogerInBlast` and `splashGuests`; guest sends `charge` on release; guest rifle becomes release-fire; rail `hurtArea` 5 m and min 9 m | ~200 lines | high (guest rifle semantics, a charge pump) | charge 0/1/2 s, blast falloff (15/40, guard 1.5 m); two browsers |
| C4 Black Hole | placement from `traceAim`; one min-range constant (duplicated at `system.js:104` and `heroWeapons.js:95`); rule option (i)/(ii)/(iii) | ~25-35 lines | medium (rule) | hole at 12, 20, 39, 41 m; queue; energy |
| C7 retire the table | `GUEST_WEAPONS` keeps gating and pacing only; the guest takes the host's numbers | ~30 lines + protocol wheel (relay redeploy) | medium-high (raises the guest's reach) | parity test over `WEAPONS` |

## 4. Ability actors (Subtask 17)
`actor = {id, feet, eye, dir, alt, energy}` wherever an ability reads `rogerTarget()` or the camera:
- **Time Slow (Q):** energy (`abilities.js:118-124`), minigun check (`:206-207`), world scale is shared; the guest's Q is ignored today (`system.js:977`).
- **EMP (R):** cheapest; only the centre (`emp.js:163,177`) and the fx shooter id; per-actor charge state (`:155-183`).
- **Grapple (G):** heavy (`grapple.js:163,196,285,289,339`); the zip moves Roger's body; the guest's body moves through `moveGuest` (`system.js:1068`).
- **Telekinesis (C):** camera aim (`telekinesis.js:190,240`), kills through `enemies.hit('throw')` and `rogerKill` (`:315,358`); one hold per actor.

## 5. Questions for the owner
1. Gravitron in the guest's wheel (a protocol WEAPONS change)?
2. Guest rifle: release-fire at a charge level, replacing auto-repeat?
3. Should guest kills emit `rogerKill` (break Smooth Criminal's peace)? One rule for all weapons.
4. Uniform kill scoring (Fire Gun people kills score nothing today, on the host too)?
5. The guest takes the host's numbers in C7 (rifle range 140 to 420 m, minigun 100 to 420 m and cooldown 0.09 to 0.056 s, Katana reach 3.6 to 6.0 m and cooldown 0.5 to 0.35 s)?
6. Katana: the guest uses `targets.strike`, including the lunge? Blade Mode stays host-only until Subtask 17?
7. A guest's own rifle blast hurts the guest (as for the host, `friendlyFire.js:29-31`)?
8. Black Hole: option (i) warn, (ii) refuse, (iii) raise the minimum for both? Keep or drop the guest's clamp to `HERO.bound`?
9. Does a player's own shot shake its own screen (decision 10 covers only the other player's)?
10. Bullet Time: does a guest's Q with the minigun freeze its own rounds?
11. Pursuers are the host's world, hit by either player's weapons?

---

# Power parity audit (Subtask 17, research step, 2026-10-10)

| Power | Guest today | Gap | Work |
|---|---|---|---|
| Rifle tap | `scan` ray (enemies only), cooldown 0.45 vs host 0.35; repeats while held | no walls, people, ground, blast | C2, C3, C7 |
| Rifle charge, MEGA | none (`charge` validated, never sent or read) | whole power | C3 + release edge |
| Minigun | ray, about 11/s vs 18/s; no ammo or spread | rate, people, walls | C2, C7 |
| Bullet Time (Q + minigun) | none | reads Roger's weapon | 17 |
| Railgun | ray 220 m, 0.2 s (matches) | no 9 m minimum, no 5 m circle, repeats while held | C2, C3, press edge |
| Fire Gun | through the host's `breathe`/`scorch` with the guest id | none found | done |
| Black Hole Gun | same `blackHole.fire`; swallow works; hole drawn | repeats every 0.6 s while held (host once per press) | C4 + press edge |
| Katana | own arc test, 3.6 m / 0.5 s / 0.9 rad, people exploded | no six slashes, lunge, parry; numbers break R-051 (0.35 s, ~6 m) | owner call + C7 |
| Blade Mode | none | unreachable for the host too since 2026-10-02 (R-051) | none |
| Time Slow (Q) | bit 1 sent, ignored (`system.js:977`) | whole power; shared world | 17 |
| Teleport (E) | done | host may teleport while dazed, guest has no daze | none |
| EMP (R) | bit 4 sent, ignored | whole power | 17 (cheapest) |
| Grapple (G) | none, no bit | whole power | 17 (`ability` bit, per-actor zip) |
| Telekinesis (C) | none, no bit | whole power | 17 (`ability` bit, per-actor hold) |
| Jetpack, Invincible, passenger, revive | done | none | none |
| Energy | infinite for both | per-actor bars if costs return | none now |
| Gravitron (7th weapon) | not in the protocol wheel (6 entries) | cannot select | owner call (R-049 wheel order) |
| Daze / freeze on the player | no code for guests | hits do not stun guests | report |

Input: `abil` bits 1 Q, 2 E, 4 R, 8 V, 16 Space; G and C have no bit; `ability` (0-255) and `charge` are validated but never sent. `fire` is a held level, so rifle, railgun, Black Hole and Katana need a per-guest press/release edge (as `abilEdges` does).

Rules to report (not changed): R-061 is still "proposed, awaiting approval"; R-060 (1) is superseded by C7; R-051's guest Katana numbers (0.35 s, ~6 m) disagree with the code (0.5 s, 3.6 m); R-032's jetpack fuel text is stale (the jetpack is free); R-061 (6) "a second Q is refused" disagrees with `abilities.js:107` (a second press ends the slow); `GAME_DESIGN.md:39` lists six weapons, the code has seven.
