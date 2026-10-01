# Tornado simulator — working notes for Claude

A Three.js disaster sandbox (tornadoes, earthquake chasm, dam break, meteors,
gas mains, a landing spaceship, Terminators, aliens, a playable Hero Mode…)
served by Next.js and embedded as a micro-frontend in the Luigi shell
(`../luigi-shell`). Almost all of the
code is the engine under `src/app/tornado/engine/`.

## 1. Stack and environment

- **Next.js 16.3.5 + React 19.2.8**, App Router, plain **JavaScript** (no
  TypeScript; types come from JSDoc). Node 22.
- **three ^0.186.1**, plus `three/examples/jsm` add-ons (OrbitControls,
  UnrealBloomPass, GTAO). No other runtime libraries; no physics engine, no
  asset pipeline — every mesh is built from primitives in code.
- **Audio**: Web Audio API. Procedural graphs in `engine/sound/*.js`; recorded
  one-shots and loops in `public/sounds/*.wav|mp3`, loaded by
  `engine/sound/index.js` via `samples.js`.
- **Luigi**: `@luigi-project/client`. The app runs inside the shell's
  `<iframe>` — read `next.config.mjs` before adding any `X-Frame-Options` or
  CSP header (it must keep allowing framing from `http://localhost:4200`).
- **Commands** (from `tornado-app/`):
  - `npm run dev` → http://localhost:3000 (the Luigi shell expects this
    port; 4004 is the reminder-app backend in the local setup)
  - `npm run lint` (ESLint 9, `eslint-config-next/core-web-vitals`)
  - `npm run build` (the only compile/type check there is)
  - There is no test suite: lint + build are the gate.
- **Entry points**: `src/app/page.js` (Server Component) →
  `tornado/TornadoSimulator.js` (`'use client'`; renders the panel DOM and
  mounts the engine) → `tornado/tornadoEngine.js` (`createSimulation`:
  constructs every system, runs the frame loop, owns Start/Pause/Reset).
- **Dev handle**: under `next dev` only, `window.__tornadoDebug = { Sim, ctx }`
  is the live instance (undefined under `next start`).

## 2. Coding conventions

**Module shape.** Every feature is a factory in its own file under `engine/`:

```js
export function createThingSystem(ctx) {
  const { Sim } = ctx;
  // per-instance state lives in this closure — never at module level
  function initThing() {}          // meshes, pools, DOM, button listener
  function updateThing(dt) {}      // per frame
  function resetThing() {}         // back to a fresh run (from resetSim)
  function disposeThing() {}       // GPU resources, listeners, DOM
  return { initThing, updateThing, resetThing, disposeThing /* , public API */ };
}
```

- Register it in `tornadoEngine.js` with `register('name', createThingSystem(ctx),
  { auto: true })` (`engine/lifecycle.js`): that puts it on `ctx.systems` and
  runs its `init*`/`reset*`/`dispose*` at the end of each phase. Then add
  its `update` to `frame()` where it belongs in the order. Only when its
  init, reset or dispose must run at a particular point relative to other
  systems, call it by hand at that point in the bootstrap, `resetSim()` or
  `dispose()` (and leave out `auto`). In development the registry warns
  in the console about any lifecycle function that did not run in its phase;
  a helper whose name only looks like one goes in `skip`. Look other
  systems up lazily (`ctx.systems.x` inside function bodies), so that
  construction order only matters for things read at construction time.
- **Files stay under ~800 lines.** A system that grows past that is split
  into a folder of modules by job, the way `engine/aliens/` and
  `engine/hero/` are: `config.js` for the tunables, one
  `createXPart(ctx, S, api)` factory per job, and the main file keeping
  init/update/reset/dispose, the shared state object `S` and the `api`
  object through which the modules call each other. Moving code must leave
  the `?bench=1` fingerprint unchanged (see `FINDINGS.md`).
- Tunables live in one `UPPER_CASE` object at the top of the file
  (`const FLOOD = { … }`), each with a comment saying what it is and, when
  it was changed, why.
- **Comments and docs**: British English (colour, behaviour, metres). Every
  function has a JSDoc block with `@param`/`@returns`. Each file opens with a
  `SECTION X — Title` banner explaining the design. Comments explain *why*
  (what went wrong before, what was measured), not what a line does.
- **DOM**: `TornadoSimulator.js` renders the panel; engine code finds it via
  `document.getElementById('btn-…')`. A new button = JSX there, style in
  `tornado.css`, listener wired in the system's `init`. Banners go through
  `bannerHost(container)` (`utils/banners.js`).
- **News between systems goes through `ctx.events`** (`engine/events.js`):
  the sender emits (`ctx.events.emit('announce', { title, sub })`) and
  whoever cares listens in its own init (`ctx.events.on(...)`). Add a new
  event type to the catalogue at the top of that file. A command that
  returns something stays a direct call on `ctx.systems.x`.
- **Hero abilities, enemies, area effects** (see `NOTES.md` "Roadmap"):
  - A new ability is one `ctx.systems.abilities.register({ id, name, keys,
    cost, seconds, cooldown, start, stop })` (`engine/player/abilities.js`);
    it pays in energy segments (`engine/player/energy.js`).
  - Slowing the world is a hold on its time group
    (`ctx.systems.time.hold(id, 'world', scale)`), never on the player's.
  - A new enemy kind registers with `ctx.systems.enemies.registerKind(...)`
    (the damage kinds it accepts, and how a hit lands).
  - Effects over an area go through `ctx.systems.area` (the player is
    excluded by default).
  - Before spawning, ask `ctx.systems.caps.canSpawn(kind)`; before
    emitting particles, ask `particleRoom()`, and `trackPool` any pool made
    after start-up.
  - Keys and the mouse are read only by `engine/player/input.js`; game code
    consumes its queue in the frame.
- **Reuse the shared machinery** rather than writing a second copy:
  - destruction: `damage.shockBuilding / damageFromImpact / addDamageScore /
    flattenTree`, `people.explodePerson`, `backdrop.damageAt`
  - feel: `gamefeel.event(kind, at)` (add the kind to `EVENTS`),
    `gamefeel.addShake`, `lightning.flashScreen`
  - effects: `particlePool.js`, `explosions.spawnImpactBurst`,
    `earthquake.kickDust`, `lightPool.requestLight`
  - sound: `cues.playLargeExplosion({ priority })`, the procedural modules in
    `sound/`
  - crowd: `hazards.addHazard` to make people avoid an area
  - a new explosion in town also emits `ctx.events.emit('explosion', { x, z,
    size, source })` (size from `player/energy.js` BLAST_SIZE, source the
    thing that blew): that is how the hero's energy is charged
- **Two clocks** in `animate()`: `dt` is scaled by slow motion and drives the
  simulation; `rawDt` is real time for camera, UI, audio and cutscenes.
  Gate simulation updates on `!Sim.state.paused`.
- **Camera writers** run in a fixed order in `animate()`; the game-feel
  shake and the kill-cam come last. Anything that places the camera runs
  before `applyGameFeelShake`.
- **Sizes** come from `engine/scale.js` (one unit = one metre; the table
  and its reasons in `docs/SCALE.md`). A new thing starts from its real
  size; anything sized against a person derives from `PERSON.height`.
- **Ground layers** have fixed heights: roads 0.01, path scars 0.015, grid
  0.02, craters 0.025–0.027, gas seams 0.05, chasm lid 0.07. New ground
  decals take a free slot or use `polygonOffset`.
- Anything physics/damage/the vortex should affect goes in `Sim.objects`;
  things meant to be immune (the backdrop, the Terminator) stay out of it.

## 3. Behavioural rules (what to do at each step)

1. **Before changing anything**: `git fetch` and check whether the working
   branch's PR has been merged into `main`; if so, restart the branch from
   `origin/main`. Read the header comment and the functions you will touch —
   other sessions edit these files, so re-read rather than trust memory.
   Read `NOTES.md` too: the behaviour agreed with Roger so far and the ideas
   saved for later. And `FINDINGS.md`: what has been measured, the
   performance budget and the traps to avoid. When a request changes agreed behaviour, or Roger asks
   for an idea to be kept, update it in the same commit.
2. **Find the existing pattern first**: grep for the nearest analogue
   (meteors for area impacts, earthquake for a manual event, killcam or
   spaceship for camera takeover) and follow it.
3. **While editing**: keep the change scoped to the request; update the JSDoc
   and the file's header when behaviour changes; wire all five lifecycle
   hooks for anything new; make every event button re-triggerable.
4. **Verify**: `npx eslint src/app/tornado`, `npx tsc -p jsconfig.json`
   (type check of every file marked `// @ts-check`) and `npx next build`
   must all pass before every commit. A new file starts with
   `// @ts-check`; shared JSDoc types (`SimObject`, `Alien`, ...) are global
   through `types.d.ts`. Only for genuinely visual or runtime-only
   changes, do one headless check (see Testing below).
5. **Commit and push**: a descriptive message listing each change; stage only
   `tornado-app/src` (plus this file, `GAME_RULES.md`, `NOTES.md`,
   `FINDINGS.md` and `docs/` when they change). Anything measured goes into
   `FINDINGS.md` (and its charts in `docs/perf/`) in the same commit; a
   performance change is measured with `?bench=1` before and after. `git push -u origin
   <branch>`. Don't open a PR unless asked.
6. **Report back**: what changed for each item asked, what was verified and
   how, and anything still missing (e.g. a sound file referenced but not
   committed). Reply in the language the user wrote in.

## 4. Anti-patterns (what to avoid)

- **Module-level mutable state** in engine files — breaks React StrictMode's
  double mount in dev.
- **`addEventListener` without `{ signal: ctx.signal }`**: the listener
  outlives the instance, and a remounted page answers every click twice.
- **Adding or removing lights mid-run** — every lit material recompiles.
  Create them at init with intensity 0, or use `lightPool`.
- **`pow()` of something that can go negative in GLSL** (e.g. `1.0 - x` on an
  interpolated `x`) — NaN pixels, which bloom smears into screen-sized black
  blocks. Clamp first.
- **Integrating velocity for scripted motion that must land on a fixed
  time** — use a pure function of time (`spaceship.js altitudeAt`).
- **Iterating `Sim.objects` while killing people** (`explodePerson` splices
  it) — iterate `Sim.objects.slice()`.
- **Clamping objects to the ground by their origin** — tipped cars sink in;
  use the lowest rotated corner (`physics.js lowestPointBelowOrigin`).
- **`renderOrder` below −10** — the sky dome draws at −10 with no depth test
  and paints over anything drawn earlier.
- **Thin geometry casting shadows** (poles, cables) — aliased, crawling
  shadow staircases.
- **Automatic camera moves** without the `SCRIPTED_CAMERAS` flag in
  `camera.js`, unless the user asked for that specific shot (then pass
  `{ always: true }` to `playCameraBeat`).
- **One-shot disasters** that can't be repeated, or buttons left enabled
  while their event is still running.
- **Hard-coded world sizes** where the scene has its own scale — measure it
  (tallest building, funnel radius × `sizeMul`).
- **Editing the `nextjs-agent-rules` block** at the bottom — `next dev`
  rewrites it.
- **Committing** `node_modules`, `.next`, driver scripts or screenshots.

## Testing & verification guidelines

- Keep automated visual verification (headless Chrome captures, CDP driver
  scripts, screenshot-based checks) minimal. Don't spin up a new headless
  browser instance or take a screenshot for every small change — only when
  a change is genuinely hard to verify from code alone (e.g. confirming a
  visual regression, checking a layout/scale issue reported with a screenshot).
- When verification is needed, prefer the `threejs-devtools-mcp` overlay
  (already connected — scene graph, FPS, object counts) over spinning up a
  separate headless Chrome tab, since it reuses the existing dev server
  connection instead of launching a new browser process.
- If a headless browser check is unavoidable, keep it to a low resolution
  (e.g. 800x600) and a single screenshot rather than multiple frames/timelapses,
  unless explicitly asked to verify animation/motion over time.
- Don't leave headless Chrome processes or scratchpad driver scripts running
  after a check completes — clean up (close the browser context) once done.
- Default to trusting a clear, well-scoped code change without a verification
  pass; ask before running a heavy visual test if you're unsure it's needed.
- In a cloud container there is no GPU: launch Chromium with
  `--use-gl=swiftshader --enable-unsafe-swiftshader`. It renders at a few fps
  and the engine clamps `dt` to 0.05, so simulation time runs well behind
  wall time — wait on a DOM or state condition, not a fixed timeout.

  <!-- lsof -tiTCP:4004 -sTCP:LISTEN | xargs -r kill -9 -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
