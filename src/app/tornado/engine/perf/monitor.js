// @ts-check
import { PERF_BUDGET } from './budget.js';
import { CAPS } from './caps.js';

/**
 * ===========================================================================
 * SECTION PM — The performance overlay
 * ===========================================================================
 * `?perf=1` in the address puts a panel in the corner of the game that says,
 * live, what a frame costs and where it goes:
 *   - CPU per frame, split into the loop's sections (physics, aliens, the
 *     funnels, the instancer, the render call...), heaviest first;
 *   - draw calls and triangles per frame (shadow pass, scene and post);
 *   - lights wanting to shine against the real ones they share
 *     (engine/lightPool.js), objects under physics and how many are asleep
 *     (engine/physics.js), the adaptive quality step (engine/quality.js),
 *     and the JavaScript heap and how fast it grows.
 * Figures over the budget (engine/perf/budget.js) are in red.
 *
 * How the time is split: the loop (tornadoEngine.js animate) calls
 * lap('name') before each section; a lap closes whatever section was open,
 * adding the time since the last lap to it. So the sections always add up
 * to the whole frame, and a new update dropped into the loop without a lap
 * of its own is simply counted in the section above it.
 *
 * Off (no `?perf`, no `?bench`), every call returns at once: the cost is a
 * few dozen empty function calls a frame.
 */

const MONITOR = {
  refreshSeconds: 0.5,
  maxSections: 48,
  shownSections: 16
};

/**
 * @param {Object} ctx
 * @returns {{
 *   enabled: boolean,
 *   initPerfMonitor: () => void,
 *   beginFrame: () => void,
 *   lap: (label: string) => void,
 *   endFrame: () => void,
 *   frameStats: () => Object,
 *   sectionNames: () => string[],
 *   disposePerfMonitor: () => void
 * }}
 */
export function createPerfMonitorSystem(ctx) {
  const { Sim } = ctx;
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const overlay = !!params && params.has('perf') && params.get('perf') !== '0';
  const enabled = overlay || (!!params && params.has('bench'));

  /** @type {Map<string, number>} */
  const ids = new Map();
  /** @type {string[]} */
  const names = [];
  // This frame's time per section, and the running sums for the overlay.
  const frame = new Float64Array(MONITOR.maxSections);
  const sums = new Float64Array(MONITOR.maxSections);
  let open = -1;
  let mark = 0;
  let frameStart = 0;

  // The last finished frame, read by the benchmark (engine/perf/bench.js).
  const last = {
    cpuMs: 0,
    renderMs: 0,
    drawCalls: 0,
    triangles: 0,
    lightsWanted: 0,
    lightsLit: 0,
    physicsObjects: 0,
    physicsAsleep: 0,
    quality: 0,
    sections: frame
  };

  // The overlay's window.
  let windowStart = 0;
  let frames = 0;
  let cpuSum = 0;
  let cpuMax = 0;
  let drawMax = 0;
  let heapLast = 0;
  let heapGrowth = 0;
  let heapTimeLast = 0;
  let wallLast = 0;
  let wallSum = 0;
  /** @type {HTMLDivElement|null} */
  let panel = null;

  /**
   * @param {string} label
   * @returns {number}
   */
  function idOf(label) {
    let id = ids.get(label);
    if (id === undefined) {
      id = names.length < MONITOR.maxSections ? names.length : MONITOR.maxSections - 1;
      if (names.length < MONITOR.maxSections) names.push(label);
      ids.set(label, id);
    }
    return id;
  }

  /** @returns {void} */
  function initPerfMonitor() {
    if (!enabled) return;
    // Counted over the whole frame (shadow pass, scene, AO, bloom and the
    // composite each call render) rather than reset by every one of them.
    Sim.three.renderer.info.autoReset = false;
    if (!overlay) return;
    panel = document.createElement('div');
    panel.id = 'perf-overlay';
    Object.assign(panel.style, {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '60',
      padding: '8px 10px', borderRadius: '8px',
      background: 'rgba(8, 20, 24, 0.82)', color: '#d8fff6',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      pointerEvents: 'none', whiteSpace: 'pre', maxWidth: 'calc(100vw - 16px)',
      overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.4)'
    });
    panel.textContent = 'perf: measuring...';
    document.body.appendChild(panel);
  }

  /** @returns {void} */
  function beginFrame() {
    if (!enabled) return;
    frame.fill(0);
    open = -1;
    frameStart = mark = performance.now();
    Sim.three.renderer.info.reset();
  }

  /**
   * Closes the section that is open and opens `label`.
   * @param {string} label
   * @returns {void}
   */
  function lap(label) {
    if (!enabled) return;
    const now = performance.now();
    if (open >= 0) frame[open] += now - mark;
    mark = now;
    open = idOf(label);
  }

  /** @returns {void} */
  function endFrame() {
    if (!enabled) return;
    const now = performance.now();
    if (open >= 0) frame[open] += now - mark;
    open = -1;
    const info = Sim.three.renderer.info;
    const systems = ctx.systems;
    last.cpuMs = now - frameStart;
    last.renderMs = frame[idOf('render')];
    last.drawCalls = info.render.calls;
    last.triangles = info.render.triangles;
    last.lightsWanted = systems.lightPool.LightStats.wanted;
    last.lightsLit = systems.lightPool.LightStats.lit;
    last.physicsObjects = systems.physics.PhysicsStats.objects;
    last.physicsAsleep = systems.physics.PhysicsStats.asleep;
    last.quality = systems.quality.qualityStep();
    if (panel) accumulate(now);
  }

  /**
   * Adds the frame to the overlay's window, and redraws the panel once the
   * window is MONITOR.refreshSeconds long.
   * @param {number} now
   * @returns {void}
   */
  function accumulate(now) {
    if (!windowStart) {
      windowStart = now;
      heapTimeLast = now;
    }
    if (wallLast) wallSum += now - wallLast;
    wallLast = now;
    frames++;
    cpuSum += last.cpuMs;
    if (last.cpuMs > cpuMax) cpuMax = last.cpuMs;
    if (last.drawCalls > drawMax) drawMax = last.drawCalls;
    for (let i = 0; i < names.length; i++) sums[i] += frame[i];
    // Chrome only: the heap size, sampled every frame; a fall is a garbage
    // collection, a rise is what the game allocated.
    const memory = /** @type {any} */ (performance).memory;
    if (memory) {
      const heap = memory.usedJSHeapSize;
      if (heapLast && heap > heapLast) heapGrowth += heap - heapLast;
      heapLast = heap;
    }
    if (now - windowStart < MONITOR.refreshSeconds * 1000) return;
    draw(now);
    windowStart = now;
    frames = 0;
    cpuSum = 0;
    cpuMax = 0;
    drawMax = 0;
    wallSum = 0;
    sums.fill(0);
  }

  /**
   * @param {number} value
   * @param {number} limit
   * @param {string} text
   * @returns {string}
   */
  function flag(value, limit, text) {
    return value > limit ? `<span style="color:#ff6b6b">${text}</span>` : text;
  }

  /**
   * @param {number} now
   * @returns {void}
   */
  function draw(now) {
    const n = Math.max(1, frames);
    const cpu = cpuSum / n;
    const fps = wallSum > 0 ? (frames - 1) * 1000 / wallSum : 0;
    const memory = /** @type {any} */ (performance).memory;
    const seconds = Math.max(0.001, (now - heapTimeLast) / 1000);
    const heapRate = heapGrowth / 1048576 / seconds;
    heapGrowth = 0;
    heapTimeLast = now;
    const order = [];
    for (let i = 0; i < names.length; i++) order.push(i);
    order.sort((a, b) => sums[b] - sums[a]);
    const lines = [];
    lines.push(`<b>PERF</b>  ${fps.toFixed(0)} fps   CPU ${flag(cpu, PERF_BUDGET.cpuHeavyMs, cpu.toFixed(2))} ms/frame (max ${cpuMax.toFixed(1)})`);
    lines.push(`draws ${flag(drawMax, PERF_BUDGET.drawCalls, String(last.drawCalls))}   tris ${(last.triangles / 1000).toFixed(0)}k   lights ${last.lightsLit}/${last.lightsWanted}   quality ${last.quality}/4`);
    const caps = ctx.systems.caps;
    if (caps) lines.push(`particles ${caps.particlesInUse()}/${CAPS.particles}   enemies ${ctx.systems.enemies.count()}/${CAPS.enemies}`);
    lines.push(`physics ${last.physicsObjects} (${last.physicsAsleep} asleep)   objects ${Sim.objects.length}`
      + (memory ? `   heap ${(memory.usedJSHeapSize / 1048576).toFixed(0)} MB ${flag(heapRate, PERF_BUDGET.heapMBps, `+${heapRate.toFixed(1)}`)} MB/s` : ''));
    lines.push('');
    for (const i of order.slice(0, MONITOR.shownSections)) {
      const ms = sums[i] / n;
      if (ms < 0.005) break;
      const bar = '█'.repeat(Math.min(24, Math.round(ms * 4)));
      lines.push(`${names[i].padEnd(14)} ${ms.toFixed(2).padStart(6)}  ${bar}`);
    }
    if (panel) panel.innerHTML = lines.join('\n');
  }

  /** @returns {Object} the last finished frame (see `last`) */
  function frameStats() {
    return last;
  }

  /** @returns {string[]} section names, by id */
  function sectionNames() {
    return names;
  }

  /** @returns {void} */
  function disposePerfMonitor() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null;
  }

  return { enabled, initPerfMonitor, beginFrame, lap, endFrame, frameStats, sectionNames, disposePerfMonitor };
}
