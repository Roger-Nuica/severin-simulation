// @ts-check
/**
 * ===========================================================================
 * SECTION PB — The performance budget
 * ===========================================================================
 * What a frame is allowed to cost. Everything new has to fit inside it; the
 * overlay (`?perf=1`, engine/perf/monitor.js) shows a figure in red once it
 * goes over, and the benchmark (`?bench=1`, engine/perf/bench.js) marks
 * each line of its result pass or fail against it. The same numbers, and
 * why they are what they are, are in FINDINGS.md ("Performance budget").
 *
 * CPU figures are this game's own JavaScript per frame -- every system's
 * update, the instancer and the render call's own work -- not the GPU.
 */
export const PERF_BUDGET = {
  // Mean CPU per frame, ms, in the benchmark's heavy scenario (the tornado,
  // doomsday, the aliens' second wave, a nuclear meltdown) and its normal one
  // (the tornado alone). Set just above what the reference run measures
  // (headless Chromium in the cloud container, `?bench=1&render=0`: heavy
  // 11.4, normal 10.1 -- see FINDINGS.md), so they catch a regression; a
  // laptop runs well under them.
  cpuHeavyMs: 12,
  cpuNormalMs: 11,
  // The worst 1% of frames in the heavy scenario, ms: a hitch, not a trend.
  cpuP99Ms: 25,
  // Draw calls per frame: shadow pass, scene and post-processing together
  // (heavy scenario after the meltdown: 252).
  drawCalls: 400,
  // Real point lights (engine/lightPool.js LIGHT_POOL.size).
  lights: 6,
  // JavaScript heap growth, MB per second of play: what the garbage
  // collector has to clear up later. Chrome only (performance.memory).
  heapMBps: 2
};
