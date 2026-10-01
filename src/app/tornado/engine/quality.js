// @ts-check
/**
 * ===========================================================================
 * SECTION Q — Adaptive quality
 * ===========================================================================
 * On a machine that cannot hold the frame rate -- integrated Intel graphics,
 * a standard Mac -- the game gives up looks, a step at a time, until it
 * can. It watches the real frame time, and while the average over
 * QUALITY.window seconds stays under QUALITY.minFps it takes the next step
 * down, then waits QUALITY.settle seconds for the effect to show before
 * judging again:
 *   1. pixel ratio to 1 (from up to 1.5 -- scene.js MAX_PIXEL_RATIO);
 *   2. no ambient occlusion (post.js GTAO and its blur);
 *   3. no multisampling of the scene (post.js SCENE_SAMPLES to 0);
 *   4. the sun's shadow map to 512 (from 1024 -- scene.js SHADOW_MAP_SIZE).
 * It only ever steps down: stepping back up on a good patch made the
 * picture change back and forth. A fast machine never leaves the top step
 * and looks exactly as before. `?quality=low` in the address starts at the
 * bottom step at once; `?quality=high` switches the watching off, and so
 * does a benchmark (`?bench=1`, engine/perf/bench.js).
 *
 * The first QUALITY.warmup seconds are not judged (shaders compiling, the
 * town being built), nor are frames longer than QUALITY.maxFrame (a hidden
 * tab, a breakpoint, a hitch while something loads).
 */

const QUALITY = {
  minFps: 40,
  window: 3,        // seconds averaged
  settle: 2,        // after a step, before judging again
  warmup: 6,
  maxFrame: 1,      // longer is a hidden tab or a hitch, not a slow machine (which can run at 4 fps)
  lowShadowMap: 512,
  steps: 4
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initQuality: () => void,
 *   updateQuality: () => void,
 *   qualityStep: () => number,
 *   resetQuality: () => void,
 *   disposeQuality: () => void
 * }}
 */
export function createQualitySystem(ctx) {
  const { Sim } = ctx;

  const state = { step: 0, last: 0, frames: 0, time: 0, wait: QUALITY.warmup, locked: false };

  /** @returns {void} */
  function initQuality() {
    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const wanted = params ? params.get('quality') : null;
    if (wanted === 'low') {
      while (state.step < QUALITY.steps) stepDown();
    }
    // A benchmark (engine/perf/bench.js) is held where it starts, so two runs
    // are drawn the same way whatever the machine made of the first.
    const bench = !!params && params.has('bench') && params.get('bench') !== '0';
    if (wanted === 'high' || wanted === 'low' || bench) state.locked = true;
  }

  /**
   * The next step down (see the header).
   * @returns {void}
   */
  function stepDown() {
    const { renderer, scene } = Sim.three;
    const Post = ctx.systems.post.Post;
    state.step++;
    if (state.step === 1) {
      renderer.setPixelRatio(1);
      renderer.setSize(window.innerWidth, window.innerHeight);
      ctx.systems.post.resizePostProcessing();
    } else if (state.step === 2) {
      Post.enabled.ao = false;
    } else if (state.step === 3) {
      if (Post.sceneTarget) {
        Post.sceneTarget.samples = 0;
        // Reallocated with the new sample count on its next use.
        Post.sceneTarget.dispose();
      }
    } else if (state.step === 4) {
      scene.traverse((o) => {
        if (!o.isDirectionalLight || !o.castShadow) return;
        o.shadow.mapSize.set(QUALITY.lowShadowMap, QUALITY.lowShadowMap);
        if (o.shadow.map) {
          o.shadow.map.dispose();
          o.shadow.map = null;
        }
      });
    }
    console.info(`[quality] frame rate too low: step ${state.step}/${QUALITY.steps}`);
  }

  /**
   * Once a frame. Timed here with performance.now() rather than from the
   * loop's rawDt, which is clamped to 0.05 s and so could never show a frame
   * rate below 20.
   * @returns {void}
   */
  function updateQuality() {
    const now = performance.now();
    const rawDt = state.last ? (now - state.last) / 1000 : 0;
    state.last = now;
    if (state.locked || state.step >= QUALITY.steps) return;
    if (!(rawDt > 0) || rawDt > QUALITY.maxFrame) return;
    if (state.wait > 0) {
      state.wait -= rawDt;
      return;
    }
    state.frames++;
    state.time += rawDt;
    if (state.time < QUALITY.window) return;
    const fps = state.frames / state.time;
    state.frames = 0;
    state.time = 0;
    if (fps >= QUALITY.minFps) return;
    stepDown();
    state.wait = QUALITY.settle;
  }

  /** @returns {number} how many steps down it has gone */
  function qualityStep() {
    return state.step;
  }

  /** @returns {void} a Reset keeps the quality: the machine has not changed */
  function resetQuality() {}

  /** @returns {void} */
  function disposeQuality() {}

  return { initQuality, updateQuality, qualityStep, resetQuality, disposeQuality };
}
