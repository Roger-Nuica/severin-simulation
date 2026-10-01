// @ts-check
import { PERF_BUDGET } from './budget.js';

/**
 * ===========================================================================
 * SECTION PX — The benchmark
 * ===========================================================================
 * `?bench=1` in the address plays a fixed scenario instead of the game and
 * ends with one result: what a frame cost, on average and at its worst,
 * section by section. Run it before and after a big change and compare --
 * the page keeps the previous result for the same scenario (in this
 * browser) and shows the difference next to each figure.
 *
 * Reproducible, so that two runs differ only by the code:
 *   - Math.random is seeded (seedRandom below, installed by tornadoEngine.js
 *     before the town is built), so the town, the storm and every decision
 *     in it are the same each run;
 *   - the game runs on a fixed step of BENCH.dt seconds, whatever the
 *     machine's frame rate, so the scenario reaches the same moments in the
 *     same number of frames;
 *   - the sound graph is built and every sample loaded before the first
 *     frame (both draw random numbers, at moments set by the network);
 *   - the adaptive quality is held at the top (engine/quality.js), unless
 *     `&quality=low` asks for the bottom;
 *   - the result carries a fingerprint of how the run ended (objects,
 *     damage, people, aliens): runs of the same code give the same one, so
 *     a refactor that only moves code must leave it unchanged.
 *
 * Options, after `?bench=1`:
 *   &scenario=heavy|normal|hero  heavy (the default): the tornado, then
 *                           doomsday, the aliens' second wave and a nuclear
 *                           meltdown; normal: the tornado and an ordinary
 *                           town; hero: Hero Mode, the tornado and a
 *                           Terminator sent after Roger; reset: a busy run
 *                           reset half way and started again; storm: the
 *                           Electric Tornado and an earthquake; landing:
 *                           Landing Support, the samurai and the T-Rex, then
 *                           a Rocket Strike; works: the chemical
 *                           works going up; giants: the cyber Yeti and the
 *                           T-Rex, their cold gun and flames, and their
 *                           15 s stalemate; hole: the dam break with a
 *                           black hole open in the flood's path.
 *   &seconds=60             game time to play.
 *   &render=0               no rendering: the CPU of the game alone, run as
 *                           fast as it will go (for a headless browser,
 *                           where rendering takes most of a second a frame).
 *   &seed=1                 another town.
 *   &trace=1                when the fingerprint differs between two runs of
 *                           the same code: counts the random numbers drawn in
 *                           every frame (window.__tornadoBenchTrace.counts);
 *                           compare two runs to find the first frame that
 *                           differs, then add &traceFrame=N to get where each
 *                           of that frame's draws came from (.sites).
 *
 * The result is shown on the page, logged to the console as
 * `[bench] {...}`, and left on window.__tornadoBench for a script to read.
 */

const BENCH = {
  dt: 1 / 60,
  seconds: 60,
  // Not measured: the town settling and the shaders compiling.
  warmupSeconds: 2,
  // Frames run back to back before yielding to the browser, with render=0.
  chunk: 30,
  seed: 1
};

/**
 * The scenarios: what happens at which second of game time, each beat
 * calling the same public triggers the panel's buttons call.
 * @type {Record<string, {at: number, run: (ctx: Object, api: Object) => void}[]>}
 */
const SCENARIOS = {
  heavy: [
    { at: 0, run: (ctx, api) => api.startSim() },
    { at: 2, run: (ctx) => ctx.systems.doomsday.setDoomsday(true) },
    { at: 8, run: (ctx) => ctx.systems.aliens.sendSecondWave() },
    { at: 20, run: (ctx) => ctx.systems.nuclear.meltdown(0) }
  ],
  normal: [
    { at: 0, run: (ctx, api) => api.startSim() }
  ],
  // The storm alone at its worst: the Electric Tornado (its bolts, EMP
  // waves and electrocutions), and an earthquake's fissures erupting.
  storm: [
    { at: 0, run: (ctx, api) => api.startSim() },
    { at: 1, run: () => document.getElementById('btn-electric').click() },
    { at: 3, run: (ctx) => ctx.systems.earthquake.triggerEarthquake() }
  ],
  // Landing Support (engine/spaceship.js), with the storm up: the samurai
  // called in near the middle, the T-Rex walking in on them, and a Rocket
  // Strike on the far side of town.
  landing: [
    { at: 0, run: (ctx, api) => api.startSim() },
    { at: 1, run: (ctx) => ctx.systems.spaceship.callSamurai(20, 20) },
    { at: 4, run: (ctx) => ctx.systems.trex.spawn() },
    { at: 20, run: (ctx) => ctx.systems.spaceship.fireRocket(-70, -40) }
  ],
  // The chemical works going up (engine/environment/factory.js), with the
  // storm running: the chain of barrels, the tank, the blast and what it
  // does to the buildings round it.
  works: [
    { at: 0, run: (ctx, api) => api.startSim() },
    { at: 1, run: (ctx) => ctx.systems.factory.ignite() }
  ],
  // Reset in the middle of a busy run, then a fresh one: every system's
  // reset (tornadoEngine.js resetSim) is in what the fingerprint sees.
  reset: [
    { at: 0, run: (ctx, api) => api.startSim() },
    { at: 1, run: (ctx) => ctx.systems.doomsday.setDoomsday(true) },
    { at: 4, run: (ctx) => ctx.systems.aliens.sendSecondWave() },
    { at: 8, run: (ctx) => ctx.systems.nuclear.meltdown(0) },
    { at: 14, run: () => document.getElementById('btn-reset').click() },
    { at: 15, run: (ctx, api) => api.startSim() },
    { at: 17, run: (ctx) => ctx.systems.meteors.callVolley(3) }
  ],
  // Hero Mode (engine/heroMode.js and engine/hero/): Roger, standing where
  // he comes in, the machines sent after him, and the tornado.
  // The two giants (engine/yeti.js, engine/trex.js) called in together:
  // they close on each other, then flame against frost for 15 s
  // (engine/giants/clash.js), then go their ways, with the storm up.
  giants: [
    { at: 0, run: (ctx, api) => api.startSim() },
    { at: 1, run: () => { document.getElementById('btn-yeti').click(); document.getElementById('btn-trex').click(); } }
  ],
  // The dam break's wave and flood with a black hole open in its path
  // (engine/flood.js, engine/player/blackHole.js): the water's sweep and
  // building damage, and the hole's wind, capture and dissolving, at once.
  hole: [
    { at: 0, run: () => document.getElementById('btn-flood').click() },
    { at: 6, run: (ctx) => ctx.systems.blackHole.fire(-40, 10) },
    { at: 14, run: (ctx) => ctx.systems.yeti.spawn() }
  ],
  hero: [
    { at: 0, run: () => document.getElementById('btn-hero').click() },
    { at: 1, run: (ctx, api) => api.startSim() },
    { at: 3, run: () => document.getElementById('btn-terminator').click() }
  ]
};

/**
 * mulberry32: a small, fast, good-enough 32-bit generator.
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @returns {URLSearchParams|null} the address's options, if this is a bench run
 */
function benchParams() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.has('bench') && params.get('bench') !== '0' ? params : null;
}

/**
 * On a bench run, replaces Math.random with a seeded generator. Called by
 * createSimulation before anything is built.
 * @returns {() => void} puts the original back (a no-op otherwise)
 */
export function seedRandom() {
  const params = benchParams();
  if (!params) return () => {};
  const original = Math.random;
  const random = mulberry32(Number(params.get('seed')) || BENCH.seed);
  if (params.has('trace')) {
    // Every draw counted, and in the frame asked for, where it came from.
    const trace = { draws: 0, frame: -1, traceFrame: params.has('traceFrame') ? Number(params.get('traceFrame')) : -2, counts: [], sites: [] };
    /** @type {any} */ (window).__tornadoBenchTrace = trace;
    Math.random = () => {
      trace.draws++;
      if (trace.frame === trace.traceFrame) trace.sites.push((new Error().stack || '').split('\n').slice(2, 5).join(' < '));
      return random();
    };
  } else {
    Math.random = random;
  }
  return () => {
    Math.random = original;
  };
}

/**
 * @param {Object} ctx
 * @param {{ frame: (rawDt: number, render?: boolean) => void, startSim: () => void, isCancelled: () => boolean, prepare: () => Promise<unknown> }} api
 * @returns {{ enabled: boolean, startBench: () => void, disposeBench: () => void }}
 */
export function createBenchSystem(ctx, api) {
  const { Sim } = ctx;
  const params = benchParams();
  const enabled = !!params;
  /** @type {HTMLDivElement|null} */
  let panel = null;
  let rafId = 0;
  let timer = 0;

  /**
   * @param {string} html
   * @returns {void}
   */
  function show(html) {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'bench-result';
      Object.assign(panel.style, {
        position: 'fixed', right: '8px', top: '8px', zIndex: '70',
        padding: '10px 12px', borderRadius: '8px', maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 16px)', overflow: 'auto',
        background: 'rgba(8, 20, 24, 0.9)', color: '#d8fff6',
        font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        whiteSpace: 'pre', boxShadow: '0 2px 12px rgba(0,0,0,0.5)'
      });
      document.body.appendChild(panel);
    }
    panel.innerHTML = html;
  }

  /**
   * @param {number[]} sorted ascending
   * @param {number} q 0..1
   * @returns {number}
   */
  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  }

  /**
   * How the run ended, as a short string: the same code and seed give the
   * same one.
   * @returns {string}
   */
  function fingerprint() {
    const s = Sim.stats;
    const env = ctx.Environment;
    const people = env ? env.people.filter(p => p.alive !== false && p.damageState !== 'destroyed').length : 0;
    const aliens = ctx.systems.aliens.markers().aliens.length;
    let x = 0;
    for (const o of Sim.objects) {
      const pos = o.pooled ? o.position : o.mesh.position;
      x += pos.x * 0.37 + pos.y * 1.3 + pos.z * 0.71;
    }
    const parts = [Sim.objects.length, s.damageScore | 0, s.buildingsCollapsed, s.buildingPiecesLost, people, aliens, x.toFixed(2)];
    // Landing Support: the rocket falling, the samurai where they are.
    const ship = ctx.systems.spaceship;
    const squad = ship.samuraiPositions();
    if (ship.isLanding() || squad.length) {
      parts.push(`support ${ship.isLanding() ? 'rocket' : ''} ${squad.length} ${squad.reduce((a, p) => a + p.x * 0.37 + p.z * 0.71, 0).toFixed(2)}`);
    }
    // Roger and whatever is after him, while Hero Mode is on.
    const hero = ctx.systems.heroMode.markers();
    if (hero) {
      let h = hero.roger.x * 0.37 + hero.roger.z * 0.71;
      for (const p of hero.pursuers) h += p.x * 0.53 + p.z * 0.29;
      parts.push(`hero ${hero.pursuers.length} ${h.toFixed(2)}`);
    }
    return parts.join('/');
  }

  /** @returns {void} */
  function startBench() {
    if (!enabled || !params) return;
    const scenarioName = SCENARIOS[params.get('scenario') || ''] ? /** @type {string} */ (params.get('scenario')) : 'heavy';
    const scenario = SCENARIOS[scenarioName];
    const seconds = Number(params.get('seconds')) || BENCH.seconds;
    const render = params.get('render') !== '0';
    const seed = Number(params.get('seed')) || BENCH.seed;
    const totalFrames = Math.round(seconds / BENCH.dt);
    // A run shorter than the warm-up measures its second half instead: with
    // no frame measured there would be no result at all.
    const warmupFrames = Math.min(Math.round(BENCH.warmupSeconds / BENCH.dt), Math.floor(totalFrames / 2));
    const monitor = ctx.systems.perfMonitor;
    const names = monitor.sectionNames();

    const cpu = [];
    const sections = new Float64Array(64);
    let renderSum = 0;
    let drawSum = 0;
    let drawMax = 0;
    let trianglesMax = 0;
    let physicsMax = 0;
    let lightsWantedMax = 0;
    let particlesMax = 0;
    // Heap growth: every rise of the heap between frames added up (a fall
    // is the garbage collector), i.e. what the game allocated.
    let heapLast = 0;
    let heapGrowth = 0;
    let wallStart = 0;
    let frameIndex = 0;
    let beat = 0;
    const memory = /** @type {any} */ (performance).memory;

    /** @returns {void} */
    function step() {
      const time = frameIndex * BENCH.dt;
      while (beat < scenario.length && scenario[beat].at <= time) {
        scenario[beat].run(ctx, api);
        beat++;
      }
      const trace = /** @type {any} */ (window).__tornadoBenchTrace;
      if (trace) trace.frame = frameIndex;
      api.frame(BENCH.dt, render);
      if (trace) {
        trace.counts.push(trace.draws);
        trace.draws = 0;
      }
      if (frameIndex === warmupFrames) wallStart = performance.now();
      if (frameIndex >= warmupFrames) {
        if (memory) {
          const heap = memory.usedJSHeapSize;
          if (heapLast && heap > heapLast) heapGrowth += heap - heapLast;
          heapLast = heap;
        }
        const f = monitor.frameStats();
        cpu.push(f.cpuMs);
        for (let i = 0; i < names.length; i++) sections[i] += f.sections[i];
        renderSum += f.renderMs;
        drawSum += f.drawCalls;
        if (f.drawCalls > drawMax) drawMax = f.drawCalls;
        if (f.triangles > trianglesMax) trianglesMax = f.triangles;
        if (f.physicsObjects > physicsMax) physicsMax = f.physicsObjects;
        if (f.lightsWanted > lightsWantedMax) lightsWantedMax = f.lightsWanted;
        const particles = ctx.systems.caps ? ctx.systems.caps.particlesInUse() : 0;
        if (particles > particlesMax) particlesMax = particles;
      }
      frameIndex++;
    }

    /** @returns {void} */
    function finish() {
      const n = Math.max(1, cpu.length);
      const sorted = cpu.slice().sort((a, b) => a - b);
      const mean = cpu.reduce((a, b) => a + b, 0) / n;
      const wall = (performance.now() - wallStart) / 1000;
      const bySection = {};
      for (let i = 0; i < names.length; i++) bySection[names[i]] = +(sections[i] / n).toFixed(3);
      const result = {
        scenario: scenarioName, seconds, seed, render, frames: cpu.length,
        cpuMeanMs: +mean.toFixed(3),
        cpuP50Ms: +quantile(sorted, 0.5).toFixed(3),
        cpuP95Ms: +quantile(sorted, 0.95).toFixed(3),
        cpuP99Ms: +quantile(sorted, 0.99).toFixed(3),
        cpuMaxMs: +(sorted.length ? sorted[sorted.length - 1] : 0).toFixed(3),
        renderCallMs: +(renderSum / n).toFixed(3),
        drawCallsMean: Math.round(drawSum / n),
        drawCallsMax: drawMax,
        trianglesMax,
        physicsObjectsMax: physicsMax,
        lightsWantedMax,
        particlesMax,
        heapMBps: memory ? +(heapGrowth / 1048576 / (n * BENCH.dt)).toFixed(2) : null,
        fps: render && wall > 0 ? +(cpu.length / wall).toFixed(1) : null,
        sections: bySection,
        fingerprint: fingerprint(),
        userAgent: navigator.userAgent
      };
      report(result);
    }

    /**
     * @param {Object} result
     * @returns {void}
     */
    function report(result) {
      const key = `tornado-bench:${result.scenario}:${result.seconds}:${result.seed}:${result.render ? 'render' : 'cpu'}`;
      let previous = null;
      try {
        previous = JSON.parse(window.localStorage.getItem(key) || 'null');
        window.localStorage.setItem(key, JSON.stringify(result));
      } catch {
        // No storage (a private window): nothing to compare against.
      }
      /** @type {any} */ (window).__tornadoBench = result;
      console.info(`[bench] ${JSON.stringify(result)}`);

      const cpuLimit = result.scenario === 'heavy' ? PERF_BUDGET.cpuHeavyMs : PERF_BUDGET.cpuNormalMs;
      const checks = [
        ['CPU mean', result.cpuMeanMs, cpuLimit, 'ms'],
        ['CPU p99', result.cpuP99Ms, PERF_BUDGET.cpuP99Ms, 'ms'],
        ['draw calls max', result.drawCallsMax, PERF_BUDGET.drawCalls, ''],
        ['heap growth', result.heapMBps, PERF_BUDGET.heapMBps, 'MB/s']
      ];
      /**
       * @param {number|null} now
       * @param {number|null|undefined} before
       * @returns {string}
       */
      const delta = (now, before) => {
        if (now === null || before === null || before === undefined || !before) return '';
        const pct = (now - before) / before * 100;
        const colour = pct > 5 ? '#ff6b6b' : pct < -5 ? '#6bffb0' : '#9fb8b2';
        return ` <span style="color:${colour}">${pct > 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
      };
      const lines = [`<b>BENCHMARK · ${result.scenario} · ${result.seconds}s · seed ${result.seed} · ${result.render ? 'rendered' : 'CPU only'}</b>`, ''];
      for (const [label, value, limit, unit] of checks) {
        if (value === null) continue;
        const ok = value <= limit;
        const before = previous ? previous[{ 'CPU mean': 'cpuMeanMs', 'CPU p99': 'cpuP99Ms', 'draw calls max': 'drawCallsMax', 'heap growth': 'heapMBps' }[label]] : null;
        lines.push(`${ok ? '<span style="color:#6bffb0">PASS</span>' : '<span style="color:#ff6b6b">FAIL</span>'} ${label.padEnd(15)} ${String(value).padStart(8)} ${unit.padEnd(4)} (budget ${limit})${delta(value, before)}`);
      }
      lines.push('');
      lines.push(`p50 ${result.cpuP50Ms} · p95 ${result.cpuP95Ms} · max ${result.cpuMaxMs} ms · render call ${result.renderCallMs} ms`);
      lines.push(`draws ${result.drawCallsMean} avg · tris ${(result.trianglesMax / 1000).toFixed(0)}k · physics ${result.physicsObjectsMax} · lights wanted ${result.lightsWantedMax}${result.fps ? ` · ${result.fps} fps` : ''}`);
      lines.push('');
      const order = Object.entries(result.sections).sort((a, b) => b[1] - a[1]);
      for (const [name, ms] of order) {
        if (ms < 0.005) continue;
        const before = previous && previous.sections ? previous.sections[name] : null;
        lines.push(`${name.padEnd(14)} ${ms.toFixed(3).padStart(7)} ms${delta(ms, before)}`);
      }
      lines.push('');
      const same = previous && previous.fingerprint === result.fingerprint;
      lines.push(`fingerprint ${result.fingerprint}${previous ? (same ? ' <span style="color:#6bffb0">(same as last run)</span>' : ' <span style="color:#ffd36b">(differs from last run)</span>') : ''}`);
      show(lines.join('\n'));
    }

    /**
     * A benchmark that throws must still end with something to read, or a
     * script waiting for window.__tornadoBench waits for ever.
     * @param {unknown} error
     * @returns {void}
     */
    function fail(error) {
      const message = String(/** @type {any} */ (error) && /** @type {any} */ (error).stack || error);
      /** @type {any} */ (window).__tornadoBench = { error: message, frames: frameIndex };
      console.error(`[bench] failed at frame ${frameIndex}: ${message}`);
      show(`<span style="color:#ff6b6b">BENCHMARK FAILED at frame ${frameIndex}</span>\n${message}`);
    }

    /** @returns {void} */
    function tick() {
      try {
        advance();
      } catch (error) {
        fail(error);
      }
    }

    /** @returns {void} */
    function advance() {
      if (api.isCancelled()) return;
      if (render) {
        step();
        if (frameIndex % 60 === 0) show(`BENCHMARK · ${scenarioName} · ${(frameIndex * BENCH.dt).toFixed(0)} / ${seconds} s`);
        if (frameIndex < totalFrames) rafId = requestAnimationFrame(tick);
        else finish();
        return;
      }
      for (let i = 0; i < BENCH.chunk && frameIndex < totalFrames; i++) step();
      show(`BENCHMARK · ${scenarioName} · CPU only · ${(frameIndex * BENCH.dt).toFixed(0)} / ${seconds} s`);
      if (frameIndex < totalFrames) timer = window.setTimeout(tick, 0);
      else finish();
    }

    show(`BENCHMARK · ${scenarioName} · loading sounds`);
    api.prepare().then(() => {
      if (api.isCancelled()) return;
      show(`BENCHMARK · ${scenarioName} · starting`);
      // One rendered frame first on a CPU-only run too, so the scene is on
      // screen and the shaders are compiled before anything is measured.
      api.frame(0, true);
      tick();
    }).catch(fail);
  }

  /** @returns {void} */
  function disposeBench() {
    if (rafId) cancelAnimationFrame(rafId);
    if (timer) clearTimeout(timer);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  return { enabled, startBench, disposeBench };
}
