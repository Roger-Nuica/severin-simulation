// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandFloat } from './random.js';

/**
 * ===========================================================================
 * SECTION S.21 — HAVOC, the heavy gunner (engine/gunner.js)
 * ===========================================================================
 * Procedural, like the rest of sound/:
 *  - **spin-up**: the barrels winding up, a whine rising with a rattle;
 *  - **burst**: the minigun's ripping buzz for as long as it fires;
 *  - **wind-down**: the whine falling away, a hiss of the hot barrels;
 *  - **whizz**: a round passing close by;
 *  - **catch**: Time Slow stopping the rounds round Roger, a deep
 *    pressure "whum" with a glassy shimmer;
 *  - **send back**: the caught rounds let go, a rising rush;
 *  - **ping**: a returned round striking his armour.
 * Callers pass a level (0..1), already scaled by distance. On the effects
 * bus; built on first use, when the AudioContext runs.
 */

const BUS_LEVEL = 0.8;
const SILENCE = 0.0001;

/**
 * @typedef {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer}} GunnerGraph
 */

/** @param {AudioScheduledSourceNode} source @param {AudioNode[]} nodes */
function disconnectOnEnd(source, nodes) {
  source.addEventListener('ended', () => {
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* already */ }
    }
  });
}

/**
 * @param {GunnerGraph} g @param {BiquadFilterType} type @param {number} from @param {number} to
 * @param {number} q @param {number} peak @param {number} attack @param {number} decay @param {number} [delay]
 */
function noiseSweep(g, type, from, to, q, peak, attack, decay, delay = 0) {
  if (peak <= SILENCE) return;
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
  source.start(start, soundRandFloat(0, 0.6));
  source.stop(end + 0.05);
  disconnectOnEnd(source, [filter, gain]);
}

/**
 * @param {GunnerGraph} g @param {OscillatorType} type @param {number} from @param {number} to
 * @param {number} peak @param {number} attack @param {number} decay @param {number} [delay]
 */
function tone(g, type, from, to, peak, attack, decay, delay = 0) {
  if (peak <= SILENCE) return;
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
 * @returns {{playSpinUp: (level: number, seconds: number) => void, playBurst: (level: number, seconds: number) => void,
 *   playWindDown: (level: number) => void, playWhizz: (level: number) => void, playCatch: () => void,
 *   playSendBack: () => void, playPing: (level: number) => void, disposeGunnerSound: () => void}}
 */
export function createGunnerSoundSystem(engineCtx) {
  /** @type {GunnerGraph|null} */
  let graph = null;

  /** @returns {GunnerGraph|null} */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    graph = { ctx, bus, noise: createShortNoiseBuffer(ctx, 1.5) };
    return graph;
  }

  /** @param {(g: GunnerGraph) => void} cue */
  function withGraph(cue) {
    const g = ensureGraph();
    if (g) cue(g);
  }

  return {
    playSpinUp: (level, seconds) => withGraph((g) => {
      tone(g, 'sawtooth', 90, 620, 0.08 * level, seconds * 0.9, 0.15);
      tone(g, 'sine', 300, 1900, 0.06 * level, seconds * 0.9, 0.15);
      noiseSweep(g, 'bandpass', 400, 2600, 3, 0.25 * level, seconds * 0.9, 0.15);
    }),
    playBurst: (level, seconds) => withGraph((g) => {
      const { ctx, bus } = g;
      const start = ctx.currentTime;
      const end = start + seconds;
      const buzz = ctx.createOscillator();
      buzz.type = 'square';
      buzz.frequency.value = 64;
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = 128;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1700;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(SILENCE, start);
      gain.gain.exponentialRampToValueAtTime(0.22 * level + SILENCE, start + 0.05);
      gain.gain.setValueAtTime(0.22 * level + SILENCE, end - 0.05);
      gain.gain.exponentialRampToValueAtTime(SILENCE, end + 0.2);
      buzz.connect(filter);
      saw.connect(filter);
      filter.connect(gain).connect(bus);
      buzz.start(start);
      saw.start(start);
      buzz.stop(end + 0.25);
      saw.stop(end + 0.25);
      disconnectOnEnd(buzz, [filter, gain]);
      noiseSweep(g, 'bandpass', 2200, 1600, 1, 0.45 * level, 0.04, seconds);
    }),
    playWindDown: (level) => withGraph((g) => {
      tone(g, 'sawtooth', 600, 70, 0.07 * level, 0.02, 1.4);
      noiseSweep(g, 'highpass', 5000, 2500, 0.7, 0.12 * level, 0.3, 1.8);
    }),
    playWhizz: (level) => withGraph((g) => {
      noiseSweep(g, 'bandpass', 4200, 900, 6, 0.5 * level, 0.02, 0.2);
    }),
    playCatch: () => withGraph((g) => {
      tone(g, 'sine', 140, 45, 0.6, 0.02, 0.9);
      tone(g, 'triangle', 1800, 2600, 0.08, 0.05, 1.2);
      tone(g, 'triangle', 2700, 3900, 0.05, 0.05, 1.2);
      noiseSweep(g, 'highpass', 6000, 9000, 0.5, 0.12, 0.3, 0.9);
    }),
    playSendBack: () => withGraph((g) => {
      noiseSweep(g, 'bandpass', 300, 5000, 1.2, 0.7, 0.05, 0.6);
      tone(g, 'sawtooth', 80, 420, 0.1, 0.05, 0.5);
    }),
    playPing: (level) => withGraph((g) => {
      const f = soundRandFloat(2400, 3600);
      tone(g, 'triangle', f, f * 0.8, 0.12 * level, 0.002, 0.25);
      noiseSweep(g, 'highpass', 3000, 2000, 0.7, 0.2 * level, 0.002, 0.08);
    }),
    disposeGunnerSound: () => {
      if (graph) {
        try { graph.bus.disconnect(); } catch { /* already */ }
      }
      graph = null;
    }
  };
}
