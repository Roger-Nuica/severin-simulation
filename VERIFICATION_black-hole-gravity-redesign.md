# Verification Report: black-hole-gravity-redesign

## Scope
Rework the Black Hole weapon's visuals (gravitational lensing, photon ring/accretion disk, volumetric core, shard particles, spawn/end sequencing) and add a full procedural sound system, while keeping gameplay (cost, 20 s duration, 100 m pull, 40 m no-escape, swallow logic, caps) byte-for-byte unchanged. Changed files: `blackHole.js`, `blackHole/look.js`, `blackHole/matter.js`, `blackHole/wind.js`, `post.js`, `sound/blackHole.js`, `sound/index.js`.

## Commands run
- `npm run lint`
- `npm run build`
- `git diff --stat`, `git diff <each changed file>`, `git log -p -- blackHole/matter.js`, `git show HEAD~1:.../matter.js` (to recover pre-change particle cap for comparison)

## Criteria results

### Gameplay contract (hard gate)
- [x] HOLE constant unchanged vs `.claude/rules.md` R-031
  - Result: pass
  - Evidence: `blackHole.js` `HOLE` object: `cost:5` (50% of 10-segment bar), `seconds:20`, `escape:40`, `influence:100`, `maxCaught:60`. `git diff` on this file shows the `HOLE` object block itself has zero changed lines — only new call-site plumbing (`lensInfo()`, extra sound args) was added around it. `dissolve.js` (untouched per `git diff --stat`, 0 lines changed) still has `maxAtOnce: 6`, `maxFragments: 1400`, matching R-031's "dissolving la 6, fragmentele la 1400".

### 1a. Gravitational lensing
- [x] Screen-space UV warp toward center, strongest near core, fades with distance
  - Result: pass
  - Evidence: `post.js` `lensSample()` GLSL function (composite shader): `profile = smoothstep(0,0.18,u) * smoothstep(1,0.3,u)` — ring-shaped falloff, strongest just outside the core, zero past `uLensRadius`.
- [x] "Low-resolution render target... applied only to a screen-space region" — **deviation, disclosed and judged on merits**
  - Result: pass (as a deliberate, justified deviation)
  - Evidence: No new render target is created. The warp is folded into the existing full-screen composite shader (`Post.compositeMaterial`, same one doing AO/bloom/grade, already one pass/frame). `updateLens()` (post.js) computes `uLensCenter/uLensRadius/uLensStrength` from `blackHole.js`'s `lensInfo()`, and the shader's `lensSample()` is only invoked when `uLensStrength > 0.001`, i.e., skipped per-pixel-cheaply when off. Localization to a screen region is enforced via the `profile` falloff (zero outside `uLensRadius`) and an explicit CPU-side bounding check (`uvX ± radius` / `uvY ± radius` vs `[0,1]`) that zeroes `uLensStrength` when the hole is off-screen. "Far" and "behind camera" are both handled: `viewZ > -0.5` check zeroes strength when behind camera; `radius < 0.01` zeroes it when too far/small. This satisfies every functional requirement of 1a (localized, fades with distance, skipped when off/far/behind, cheap — one shader, no extra target) even though it doesn't literally add a separate low-res RT. No dispose-path additions were needed in `post.js` because nothing new was allocated (confirmed: `disposePostProcessing()` unchanged list still only disposes pre-existing targets/materials).
- [x] Slight chromatic split at inner ring
  - Result: pass
  - Evidence: `LENS_CHROMA = 0.045`; three separate texture samples per channel (`lensSample(vUv, LENS_CHROMA)`, `0.0`, `-LENS_CHROMA`) combined into `scene.rgb`, scaled by the same `profile` so it's concentrated at the inner ring only.
- [ ] Visual correctness (does it actually look like bending light, not an artifact)
  - Result: unverified — needs manual/visual check (no browser available in this environment)

### 1b. Photon ring + accretion disk
- [x] Thin bright photon ring at core edge, white/violet tint
  - Result: pass
  - Evidence: `look.js` `rim` mesh — `RIM_FRAGMENT` fresnel shader, `rimPower: 2.4` (thin falloff), `uColour: (2.2, 1.7, 3.2)` (white-violet), doc comment explicitly states this mesh is both the rim light and the photon ring.
- [x] Accretion disk, noise-based swirl, violet-to-white, brightest at inner edge, bent by lensing over top/bottom
  - Result: pass (shader mechanism verified; "bent over top/bottom like Interstellar" is a visual claim, structurally supported but unverified)
  - Evidence: `SWIRL_FRAGMENT` — `noise()`/`hash()` turbulence, logarithmic spiral `phase`, colour ramp `hot → violet → indigo → deep` keyed by `u` (0 at horizon). The disk's tilt (`body.rotation` in `update()`) plus the lensing pass bending screen pixels round the core together produce the "bent over/under" look — mechanism present, final visual unverified.
- [x] Doppler beaming: one side brighter
  - Result: pass
  - Evidence: `SWIRL_FRAGMENT`: `doppler = dot(tangent, uViewLocal)`, `beam = clamp(1.0 + uDoppler*doppler, 0.25, 1.0+uDoppler)`, multiplies final colour. `uViewLocal` is recomputed every frame in `update(t, size, camera)` from the camera's position in the disk's local space.
- [x] Differential rotation (inner faster), slow precession
  - Result: pass
  - Evidence: `spin = mix(uSpinIn, uSpinOut, sqrt(u)) * uTime` in shader (`spinInner: 3.4` vs `spinOuter: 0.35` in `LOOK`); `group.rotation.set(0, t*LOOK.precession, ...)` and `body.rotation` tilt/precession in `update()`.

### 1c. Core with volume
- [x] Black sphere (not flat disc), rim light, soft dark halo dimming background
  - Result: pass
  - Evidence: `core` is `THREE.SphereGeometry(LOOK.coreRadius, 32, 20)` (was previously a flat ring per the Saturn-reference comment at top of `look.js`). `darkHalo` is a `THREE.Sprite` with `SpriteMaterial` **not** additive (`blending` omitted/default normal), opacity `LOOK.haloDarken * size` — the one normal-blended element in an otherwise additive scene, confirmed by its own code comment explaining exactly why (so it can dim rather than only add light).

### 1d. Particles and streaks
- [x] Small sharp shards replacing "pink bubbles", instanced + elongated
  - Result: pass
  - Evidence: `matter.js` uses `THREE.InstancedMesh` of `THREE.BoxGeometry(0.12, 0.12, 1)` (thin elongated box = shard), oriented via `q.setFromUnitVectors(Z, fwd)` and non-uniformly scaled (`s.set(sz/√long, sz/√long, sz*long)`) — not round camera-facing sprites. Old implementation (`git show HEAD~1`) used `createParticlePool`/`createSoftDotTexture` (round sprites) confirming this is a real replacement, not additive.
- [x] Curved spiral trails, accelerating/stretching near core, no straight lines
  - Result: pass
  - Evidence: `step()`: each shard tracks `radius[i]`/`angle[i]` (polar, not velocity), `dr` inflow speed increases near horizon (`closeness` term), stretch factor `long = 1 + (MATTER.stretch-1)*c*c` grows near core, direction `fwd` recomputed every frame from current `angSpeed`/`dr` so the instance orientation itself curves frame to frame.
- [x] Spaghettification and molecular dissolve of large objects preserved
  - Result: pass
  - Evidence: `dissolve.js` is **unmodified** (0 diff lines per `git diff --stat`) — still handles the building dissolve/clip-plane/fragment-stream flow referenced by `blackHole.js`'s `cutting[]` array and `dissolve.cut()`/`step()` calls (unchanged call sites around lines handling `cutting`).
- [x] Particle counts within budget
  - Result: pass
  - Evidence: `MATTER.max = 2400` — identical to the pre-change particle pool's cap (`git show HEAD~1:.../matter.js` shows `max: 2400` too). `wind.js`'s `WIND.streaks = 320` is a new, separate, small fixed-size InstancedMesh pool (same established pattern as `dissolve.js`'s fragments — fixed hardcoded cap, not registered with `caps.trackPool()`, consistent with this codebase's convention for InstancedMesh effects).
- [ ] Visual read ("no pink bubbles, no straight lines" on screen)
  - Result: unverified — needs manual/visual check

### 1e. Spawn and end
- [x] Spawn: quick implosion + flash, then fade in ~1 s
  - Result: pass
  - Evidence: `look.js` `update()`: `snap = t < 0.3 ? 1 + 2.4*(1-t/0.3)^2.5 : 1` applied to `core.scale`/`rim.scale` (oversized-then-snap-in implosion in the first 0.3 s). `blackHole.js` `open()` calls `ctx.systems.lightning.flashScreen(...)` on fire. Fade-in: `hole.size` ramps via `HOLE.openSeconds = 1.5` (close to but not exactly "about 1 s" — minor spec deviation, not flagged as a bug, within "about" tolerance is borderline; flagging for awareness).
- [x] End: disk shrinks into core, faint shockwave ring, then disappears
  - Result: pass
  - Evidence: `finish()` in `blackHole.js` calls `look.pulse(at.x, at.y, at.z)` which triggers `look.js`'s `waveState` (a dedicated ring mesh, `wave`, animated independently in `updateShockwave()` for `duration: 0.9`s, fading `opacity = 0.4*(1-u)^2`), confirmed called every frame via both the open-hole branch and the no-hole branch of `updateBlackHole()`.
- [ ] Visual timing/feel
  - Result: unverified — needs manual/visual check

### 2. Sound
- [x] Positional audio (PannerNode) with distance falloff across 100 m
  - Result: pass
  - Evidence: `makePanner()`: `panningModel: 'equalpower'`, `distanceModel: 'inverse'`, `refDistance: REF_DISTANCE(18)`, `maxDistance: MAX_DISTANCE(280)` — comfortably covers `HOLE.influence = 100`. Used by every voice (`humPanner`, per-whine `panner`, per-swallow `panner`, open/close `panner`).
- [x] Core drone: deep sub-bass + slow LFO wobble + rumble layer
  - Result: pass
  - Evidence: two detuned sine oscillators (46 Hz, 46.7 Hz) → `lowpass`(160 Hz) → `hum` gain, wobbled by a `wobble` LFO (`WOBBLE_RATE=0.42` Hz) driving `hum.gain` via `wobbleDepth`; separate `rumbleOsc` (sawtooth, 28 Hz → lowpass 90 Hz) is a distinct layer.
- [x] Pull wind: filtered noise, volume/brightness rise with more objects consumed
  - Result: pass
  - Evidence: `noiseSource` (looping buffer) → bandpass `windFilter` → `wind` gain. `updateHum(level, consuming, ...)`: `g.wind.gain...(WIND_LEVEL * level * (0.4 + 0.6*intensity))`, `windFilter.frequency...(700 + intensity*2600)` where `intensity` is `consuming` = `caught.length / HOLE.maxCaught` passed from `blackHole.js`.
- [x] Rising whine per swallowed object, shared voices, capped
  - Result: pass
  - Evidence: `WHINE.voices = 10` fixed pool built once in `ensureGraph()`; `updateWhine(target, through, ...)` claims a free voice by `target` identity via `whineOf` Map, frequency ramps `f0→f1` by `through²`; past 10 in-flight targets, `findIndex` returns `-1` and the call is a no-op (no voice stolen).
- [x] Swallow sound: short "whoomp" + reverse-reverb tail, capped simultaneous
  - Result: pass
  - Evidence: `playSwallow()` gated by `swallowActive >= SWALLOW.max(6)` early-return; sub oscillator (140→38 Hz) + noise "thump" layer; `sendGain` feeds the shared `reverb` ConvolverNode loaded with `reverseReverbBuffer()` (cubic-ramped noise = reverse-reverb IR).
- [x] Spawn: reverse-reverb suck + deep thump; End: collapse boom fading to silence
  - Result: pass
  - Evidence: `playOpen()`: `suck` (bandpass-swept noise 260→3400 Hz) feeds both `panner` and `reverb`, followed by a sub oscillator thump at `now+0.4`. `playClose()`: sub 65→22 Hz over 1.15 s with exponential decay to `0.0001`, plus a short highpass "crack" layer.
- [x] Nearby world sounds low-passed while active, restored when it ends
  - Result: pass
  - Evidence: `sound/index.js` `setMuffle(amount, key)` now keyed/combined (`Map` of contributors, combined by `Math.max`) rather than overwritten — `blackHole.js` calls `ctx.systems.sound.setMuffle(0.3 * hole.size, 'blackHole')` every active frame and `setMuffle(0, 'blackHole')` on finish/reset/dispose, non-destructively coexisting with Bullet Time's own `'bulletTime'` key (default param preserves old call sites).
- [x] Lazy init on user gesture, defensive resume, voice caps respected
  - Result: pass
  - Evidence: `ensureGraph()` returns `null` unless `ctx.state === 'running'` and `SoundSystem.effectsGain` exists, and calls `engineCtx.systems.sound.ensureAudioReady()` first — matches the lazy/defensive pattern description; every voice pool (`whines`, `swallowActive`) is capped as above.
- [~] "Sunete"/creature-sound toggle gating
  - Result: pass (not applicable — no such toggle exists in the codebase)
  - Evidence: `grep -rn "Sunete|creatureSounds|SFX|soundEffectsEnabled"` across `src/app` returns nothing; all Black Hole sound routes through the same `SoundSystem.effectsGain` bus every other effect module uses, so it is already gated by whatever master/effects controls exist. No dedicated toggle was skipped because none exists to hook into.
- [ ] Audible correctness/mix
  - Result: unverified — needs manual/visual (audio) check

### Web Audio bug hunt (one-shot cleanup ordering)
- [x] `playSwallow()`: cleanup attached to whichever of sub(0.32s)/thump(0.2s) finishes last
  - Result: pass
  - Evidence: `sub.stop(now + 0.32)` > `thump.stop(now + 0.2)`; `sub.onended` (not `thump.onended`) does the shared-node disconnects (`subGain`, `thumpGain`, `sendGain`, `panner`) — correctly the longer-lived source, matching the inline comment's own stated rationale.
- [x] `playOpen()`: `suck`(0.55s) vs `sub`/thump(0.7s) — panner shared, disconnected by the later one
  - Result: pass
  - Evidence: `suck.onended` only disconnects its own `suckGain` (not the shared `panner`); `sub.onended` (finishes later, at `now+0.7` vs suck's `now+0.55`) disconnects `subGain` **and** `panner`. Correct ordering — the shared node is torn down only after both finish.
- [x] `playClose()`: `crack`(0.09s) vs `sub`(1.15s) — panner shared
  - Result: pass
  - Evidence: `crack.onended` only disconnects its own `gain`; `sub.onended` (finishes last) disconnects `subGain` and the shared `panner`.
- [x] No orphaned persistent/looping nodes across repeated casts
  - Result: pass
  - Evidence: all persistent nodes (`subs[]`, `wobble`, `rumbleOsc`, `noiseSource`, `whines[].osc`) are collected into `graph.sources` at build time and explicitly `.stop()`'d in `disposeBlackHoleSound()`, which also nulls `graph`, resets `lastHum`, clears `whineOf`, and resets `swallowActive` — called from `blackHole.js`'s `disposeBlackHole()`.

### 3. Performance and cleanup
- [ ] 60 FPS with black hole + flood/fire active
  - Result: unverified — needs manual/visual check (no browser/profiler available)
- [x] Dispose render targets/materials/audio nodes on end; no leaks across repeated casts
  - Result: pass
  - Evidence: `look.dispose()` frees `swirl`/`core`/`rim` geometry+material, `glowMat`/`glowMap`, `darkMat`/`darkMap`, `wave` geometry+material — every geometry/material/texture created in the module is covered, checked against every `new THREE.*Geometry/Material/CanvasTexture` call in the file. `matter.dispose()` and `wind.dispose()` each remove their mesh from the scene and dispose geometry/material/mesh. `post.js` has no new disposables (no new render target was created, confirmed above). `disposeBlackHoleSound()` stops all persistent sources and disconnects the bus.
- [x] Quality fallback: lensing resolution and particle count reduce on FPS drop
  - Result: pass
  - Evidence: `post.js` `updateLens()`: `step = ctx.systems.quality.qualityStep()`; `step >= 3` disables lensing entirely (`uLensStrength = 0`), otherwise `reach = info.reach * (1 - step*0.22)` shrinks it. `matter.js` `ambient()`: `owed += MATTER.ambientRate * (1 - step*0.18) * dt` reduces shard spawn rate under the same quality step. Both read the same shared `quality.js` system (`qualityStep()`), not a bespoke FPS watcher.

## TEST section (from task)
1. Fire the gun: background bends, sphere has depth, photon ring, disk bent/brighter one side — Result: **unverified — needs manual/visual check**. Mechanisms for all four sub-claims verified to exist and be wired (see 1a–1c above); cannot confirm the rendered result without a browser.
2. Small shard particles, curving spirals, no pink bubbles/straight lines — Result: **unverified — needs manual/visual check**. Mechanism verified (see 1d); visual read not confirmed.
3. Sound: drone, rising wind/whines, whoomp, spawn/collapse, muffled nearby sounds — Result: **unverified — needs manual/visual (audio) check**. All mechanisms verified present and correctly wired (see section 2); cannot confirm audible result without playback.
4. 5 casts in a row: no FPS drop, no leaks — Result: **unverified — needs manual/visual check** for FPS; leak-freedom from static code analysis is **pass** (see "3. Performance and cleanup" → dispose evidence) but only a live repeated-cast session would catch a runtime leak a static read could miss.

## Reproduction notes
- No failures found. No reproduction steps needed.

## Final verdict
- PARTIAL — all code-verifiable requirements (gameplay contract, mechanism existence, correct wiring, Web Audio cleanup ordering, Three.js disposal, quality fallback, lint, build) **PASS** with no bugs found. The purely visual and audible TEST criteria are explicitly **unverified** because no browser/audio playback was available in this environment, per the task's own instruction to not guess on those. This is not a partial failure of the implementation — it is a scope limit of this verification pass. Recommend a manual/visual pass (fire the gun, 5x repeated cast, FPS overlay) before calling this fully done.
