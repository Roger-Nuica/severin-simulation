# Complaints — brief for planning

Please write an implementation plan (ordered subtasks, risks, acceptance criteria) for the four issues below. Do not write production code yet. Follow `CLAUDE.md` and `.claude/rules.md`; reuse the enemy registry and damage pipeline.

## 1. A tornado-like column sits in the dam (should not be there)

**Seen:** In the dam area there is a vertical grey/white column with concentric rings on the water, like a small tornado or waterspout. One screenshot shows it right after a "TORNADOES MERGED · FUJIWHARA EFFECT" toast, so it may be a spawned or merged tornado that ended up over the dam.

**Expected:** Nothing tornado-like should be in or over the dam unless the player or a scenario put it there on purpose.

**Where to look:** `engine/waterspout.js` and `engine/waterspout/`, the tornado spawn and merge logic, `engine/flood.js` and `flood/basin.js`, and `environment/backdrop.js` (the dam lake).

**To decide in the plan:** what spawns it (a waterspout system, a tornado that spawned by mistake, or a leftover from a merge), and whether the fix is to stop the spawn, constrain where it can spawn, or clean it up on merge.

**Acceptance:** over several full runs, with and without merges, no tornado or waterspout column appears over the dam. Intended waterspouts, if any remain, only appear where the design says they should.

## 2. Hunter alien ships are too hard to destroy

**Seen:** Hunter/alien ships hover over the town and shrug off the player's weapons.

**Expected:** Hunter alien ships should be easy to destroy with any weapon the player has (rifle, minigun, railgun, fire gun, black hole, katana).

**Where to look:** `engine/aliens.js` and `engine/aliens/`, `engine/spaceship.js` and `engine/spaceship/`, `engine/mothership.js`, `engine/enemies.js`, `engine/damage.js`, and `docs/enemies.md`.

**To decide in the plan:** why hits are rejected or too weak (the per-kind accepted-hit list, immunities, hit radius, health), and the smallest change that makes every weapon work. Use the registry's `accepts` rules rather than special cases. Do not raise any caps (R-048). Check `.claude/rules.md` for protected values before changing health or damage numbers.

**Acceptance:** each weapon can destroy a hunter ship in a few hits, with the usual score and effects. Other enemies keep their own immunities.

## 3. The samurai ship should disappear afterwards

**Seen:** The samurai ship stays in the sky after its job is done.

**Expected:** Once the samurai sequence has finished, the ship leaves (fly away or fade out) and is removed and disposed so it does not stay in the scene.

**Where to look:** `engine/spaceship/samurai.js`, `samuraiModel.js`, `descent.js`, `effects.js`.

**Acceptance:** after the samurai encounter ends, the ship is gone from the scene (no leftover meshes, no per-frame update cost). Reset and dispose stay clean, and the encounter can still trigger again.

## 4. Katana should use first-person aim

**Seen:** The katana currently plays from the third-person view, with the camera behind Roger.

**Expected:** While the katana is equipped, aiming and slashing use a first-person view, like the aimed weapons, so the player swings where they look.

**Where to look:** `engine/hero/katana/` (`slash.js`, `blade.js`, `model.js`, `targets.js`), `engine/heroWeapons.js`, `engine/heroMode.js`, `engine/camera.js`, `engine/hero/movement.js`.

**To decide in the plan:** whether first person is always on with the katana or only while holding aim, how the viewmodel is shown (the model currently exists for a third-person body), and how Blade Mode and auto-targeting behave from first person.

**Acceptance:** with the katana equipped the player sees a first-person view and slashes toward the crosshair. Switching to another weapon restores the previous camera. Existing katana damage and scoring are unchanged. Co-op guest katana (`engine/net/system.js`) keeps working.

## Validation for all four

- `npm run lint`, `npm run build`, `npm test`
- A manual run through each item above in the browser
