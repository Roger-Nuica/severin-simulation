// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandFloat } from './random.js';

/**
 * ===========================================================================
 * SECTION S.15 -- The Katana
 * ===========================================================================
 * The blade's voice (engine/hero/katana/*), procedural like the rest of
 * sound/: no files, no creature voices (R-046: the Katana owns its own bus
 * and never goes through creatureSounds.play).
 *
 *  - **draw** ("shing"): a bright metallic ring, a few inharmonic sines
 *    sliding up, over a highpassed noise scrape;
 *  - **swing**: the whoosh of one slash, a bandpassed noise sweep rising and
 *    falling, pitched a little differently each time so a chain of them does
 *    not machine-gun;
 *  - **slice**: the wet cut on a hit, a lowpassed noise squelch over a short
 *    falling sine, with a fast bright snick on the front;
 *  - **parry**: the clang when the blade meets something it must not cut,
 *    inharmonic metal partials with a sharp noise strike;
 *  - **holster**: a short, dry click and a quieter second one;
 *  - **blade mode enter / exit**: a rising shimmer when Blade Mode begins and
 *    a falling one when it ends.
 *
 * Built the first time any of them is asked for, when the AudioContext
 * exists and is running; nothing plays before then. Every cue is a handful
 * of short-lived nodes feeding the one bus, disconnected when they end (the
 * whoosh can fire every ~0.35 s). Sound is on real time: the world's time
 * scale does not affect it, and this module never touches Post or setMuffle.
 */

const BUS_LEVEL = 0.8;
const DRAW_LEVEL = 0.4;
const SWING_LEVEL = 0.5;
const SLICE_LEVEL = 0.7;
const PARRY_LEVEL = 0.6;
const CLICK_LEVEL = 0.45;
const MODE_LEVEL = 0.35;
const SILENCE = 0.0001;

/**
 * @typedef {Object} KatanaGraph
 * @property {AudioContext} ctx
 * @property {GainNode} bus
 * @property {AudioBuffer} noise
 */

/**
 * A scheduled source's own cleanup: once it ends, every node of the cue is
 * disconnected so nothing lingers on the bus.
 * @param {AudioScheduledSourceNode} source
 * @param {AudioNode[]} nodes
 * @returns {void}
 */
function disconnectOnEnd(source, nodes) {
  source.addEventListener('ended', () => {
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* already */ }
    }
  });
}

/**
 * A burst of the shared noise through one filter, with its own envelope. The
 * filter's frequency can sweep from `from` to `to` over the burst.
 * @param {KatanaGraph} g
 * @param {BiquadFilterType} type
 * @param {number} from
 * @param {number} to
 * @param {number} q
 * @param {number} peak
 * @param {number} attack
 * @param {number} decay
 * @param {number} [delay]
 * @returns {void}
 */
function noiseSweep(g, type, from, to, q, peak, attack, decay, delay = 0) {
  const { ctx, bus, noise } = g;
  const start = ctx.currentTime + delay;
  const end = start + attack + decay;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start(start);
  source.stop(end + 0.05);
  disconnectOnEnd(source, [filter, gain]);
}

/**
 * One enveloped tone, optionally gliding from `from` to `to`.
 * @param {KatanaGraph} g
 * @param {OscillatorType} type
 * @param {number} from
 * @param {number} to
 * @param {number} peak
 * @param {number} attack
 * @param {number} decay
 * @param {number} [delay]
 * @returns {void}
 */
function tone(g, type, from, to, peak, attack, decay, delay = 0) {
  const { ctx, bus } = g;
  const start = ctx.currentTime + delay;
  const end = start + attack + decay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  osc.connect(gain);
  gain.connect(bus);
  osc.start(start);
  osc.stop(end + 0.05);
  disconnectOnEnd(osc, [gain]);
}

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playDraw: () => void,
 *   playSwing: () => void,
 *   playSlice: () => void,
 *   playParry: () => void,
 *   playHolster: () => void,
 *   playBladeModeEnter: () => void,
 *   playBladeModeExit: () => void,
 *   disposeKatanaSound: () => void
 * }}
 */
export function createKatanaSoundSystem(engineCtx) {
  /** @type {KatanaGraph|null} */
  let graph = null;

  /**
   * @returns {KatanaGraph|null} the graph, built on first use; null while
   *   there is no running AudioContext
   */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    // Same guard as the other procedural modules: re-resumes after a Safari
    // tab-blur suspend, but never creates the context from outside a gesture.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    graph = { ctx, bus, noise: createShortNoiseBuffer(ctx, 1) };
    return graph;
  }

  /**
   * Runs one cue against the graph, or does nothing while there is none.
   * @param {(g: KatanaGraph) => void} cue
   * @returns {void}
   */
  function withGraph(cue) {
    const g = ensureGraph();
    if (g) cue(g);
  }

  /**
   * The draw: a metallic "shing".
   * @returns {void}
   */
  function playDraw() {
    withGraph((g) => {
      noiseSweep(g, 'highpass', 3000, 7000, 0.7, DRAW_LEVEL * 0.6, 0.01, 0.28);
      [2300, 3450, 5150].forEach((f, i) => {
        tone(g, 'sine', f * 0.9, f, DRAW_LEVEL * (0.5 - i * 0.12), 0.012, 0.5 - i * 0.1);
      });
    });
  }

  /**
   * One slash's whoosh, a little different every time.
   * @returns {void}
   */
  function playSwing() {
    withGraph((g) => {
      const base = soundRandFloat(900, 1500);
      noiseSweep(g, 'bandpass', base, base * 2.4, 1.3, SWING_LEVEL, 0.05, 0.16);
      noiseSweep(g, 'bandpass', base * 2.4, base * 0.8, 1.3, SWING_LEVEL * 0.5, 0.01, 0.1, 0.14);
    });
  }

  /**
   * The wet cut on a hit.
   * @returns {void}
   */
  function playSlice() {
    withGraph((g) => {
      noiseSweep(g, 'highpass', 5000, 5000, 0.7, SLICE_LEVEL * 0.5, 0.002, 0.04);
      noiseSweep(g, 'lowpass', 1800, 300, 1.2, SLICE_LEVEL, 0.008, 0.2);
      tone(g, 'sine', soundRandFloat(210, 260), 70, SLICE_LEVEL * 0.7, 0.005, 0.14);
    });
  }

  /**
   * The clang of the blade meeting something it will not cut.
   * @returns {void}
   */
  function playParry() {
    withGraph((g) => {
      noiseSweep(g, 'bandpass', 4200, 4200, 0.8, PARRY_LEVEL, 0.001, 0.05);
      const base = soundRandFloat(700, 820);
      [1, 2.76, 5.4, 8.93].forEach((ratio, i) => {
        tone(g, 'sine', base * ratio, base * ratio, PARRY_LEVEL * (0.6 - i * 0.12), 0.002, 0.55 - i * 0.1);
      });
    });
  }

  /**
   * The blade going home: a click, then a softer one.
   * @returns {void}
   */
  function playHolster() {
    withGraph((g) => {
      noiseSweep(g, 'highpass', 3800, 3800, 0.9, CLICK_LEVEL, 0.001, 0.025);
      tone(g, 'square', 1500, 900, CLICK_LEVEL * 0.3, 0.001, 0.02);
      noiseSweep(g, 'highpass', 3000, 3000, 0.9, CLICK_LEVEL * 0.6, 0.001, 0.02, 0.07);
    });
  }

  /**
   * Blade Mode begins: a rising shimmer.
   * @returns {void}
   */
  function playBladeModeEnter() {
    withGraph((g) => {
      tone(g, 'sine', 300, 1200, MODE_LEVEL, 0.05, 0.4);
      tone(g, 'triangle', 450, 1800, MODE_LEVEL * 0.5, 0.05, 0.4);
      noiseSweep(g, 'highpass', 2000, 6000, 0.7, MODE_LEVEL * 0.4, 0.05, 0.35);
    });
  }

  /**
   * Blade Mode ends: a falling shimmer.
   * @returns {void}
   */
  function playBladeModeExit() {
    withGraph((g) => {
      tone(g, 'sine', 1200, 260, MODE_LEVEL, 0.02, 0.45);
      tone(g, 'triangle', 1800, 390, MODE_LEVEL * 0.5, 0.02, 0.45);
      noiseSweep(g, 'highpass', 6000, 1800, 0.7, MODE_LEVEL * 0.3, 0.02, 0.3);
    });
  }

  /**
   * Drops the bus; the next cue rebuilds the graph. In-flight cues are short
   * and end on their own.
   * @returns {void}
   */
  function disposeKatanaSound() {
    if (graph) {
      try { graph.bus.disconnect(); } catch { /* already */ }
    }
    graph = null;
  }

  return {
    playDraw, playSwing, playSlice, playParry, playHolster,
    playBladeModeEnter, playBladeModeExit, disposeKatanaSound
  };
}
