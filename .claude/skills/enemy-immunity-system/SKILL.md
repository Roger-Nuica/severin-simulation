---
name: enemy-immunity-system
description: Use when adding damage types, weapons, area effects, or enemies; follow the registered per-kind accepted-hit and damage-handler contract.
---

# Enemy Damage Acceptance

Route new area-effect damage through the enemy registry and preserve each enemy owner's explicit accepted hit types and hit semantics.

**SAVES:** Prevents invalid cross-weapon damage and keeps the shared 160-enemy ceiling and the 50-clone limit intact.

**SURSĂ:** `src/app/tornado/engine/enemies.js`; `src/app/tornado/engine/aliens.js`; `src/app/tornado/engine/terminator.js`; `src/app/tornado/engine/yeti.js`; `src/app/tornado/engine/perf/caps.js`; `GAME_DESIGN.md`, “Aliens and enemies”; `.claude/rules.md`, “Damage acceptance”.

## Cum funcționează

- An owner registers an `EnemyKind` with `kind`, `list()`, `position(e)`, `accepts`, and `damage(e, hit)` (`enemies.js:22-47, 59-60`). `registerKind()` stores the owner adapter by kind (`enemies.js:75-83`).
- `enemies.hit(e, kind, hit)` first checks `kind.accepts.includes(hit.type)`; rejected types never reach `damage`. Accepted means only that the owner's handler runs; it does not imply a kill (`enemies.js:114-124`).
- The current concrete contracts differ: aliens accept `plasma`, `bolt`, `fire` and `blade` (`aliens.js:297-306`); Terminators accept `plasma`, `bullet`, `bolt` and `emp` and branch on type/mega status (`terminator.js:148-164`); the Cyber Yeti accepts `fire` and `emp`, where fire deals damage and EMP stuns (`yeti.js:386-399`).
- Existing direct weapon hits may still call their owning systems directly. The registry is the shared adapter used by area effects and abilities; black-hole capture uses the separate `consume` callback where registered (`enemies.js:25-27, 35-37`). Do not force those distinct paths into a false universal damage route.
- `caps.canSpawn(kind)` enforces `CAPS.enemies = 160` across registered kinds and the per-kind Patient Zero clone limit of 50 (`perf/caps.js:24-27, 66-83`).

## Cum se extinde

1. Read the target enemy's `accepts` array and `damage` handler, plus its narrative context in `GAME_DESIGN.md` and its exact contract in `.claude/rules.md`.
2. For a new enemy kind, register once during that owner's initialization. Supply the actual live list, world position, explicit accepted damage types and a handler that implements each accepted type's real effect.
3. For a new area effect, use `ctx.systems.enemies.each()` / `hit()` rather than enumerating enemy modules independently; preserve direct owner calls used by existing weapons.
4. If the effect consumes an enemy rather than damaging it, use the existing consumable/`consume` contract and preserve the quiet-consumption semantics where specified.
5. Gate spawning through `ctx.systems.caps.canSpawn(kind)` and preserve the owning system's reset/dispose behavior.

## Capcane / Greșeli frecvente

- Do not add a hit type globally just because one enemy should accept it; update only the owner contract required by the approved task.
- Do not treat acceptance as lethal damage: Terminator plasma can knock down, Yeti EMP stuns without hurting, and the fire handler is the Yeti's damage path.
- Do not route every existing weapon through the registry when the code intentionally calls an owner directly.
- Do not implement black-hole swallowing as ordinary damage; capture/consumption is a separate path.
- Do not create a second enemy list or ignore the global spawn cap.
