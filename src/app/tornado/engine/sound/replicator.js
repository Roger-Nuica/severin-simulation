// @ts-check
import { createShortNoiseBuffer } from './thunder.js';

/**
 * ===========================================================================
 * SECTION S.11 — The Replicator (Patient Zero)
 * ===========================================================================
 * Procedural, built on first use, quieter with distance from the camera:
 *
 *  - **assemble**: a clone building itself -- a glitching square wave
 *    stepping up through random notes, a storm of metallic ticks (the blocks
 *    landing), and a low whoomph as it stands up complete;
 *  - **shatter**: a clone falling apart -- ticks scattering down and a
 *    crunch of noise;
 *  - **swarm call**: the encirclement starting (patientZero/encircle.js): a
 *    deep pulsing drone under a rising, detuned screech, three seconds;
 *  - **shard**: a nanite shard thrown, a short falling whistle.
 */

const BUS_LEVEL = 0.85;
const HEAR = 160; // metres: silent beyond

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playAssemble: (x: number, z: number, big?: boolean) => void,
 *   playShatter: (x: number, z: number) => void,
 *   playSwarmCall: () => void,
 *   playShard: (x: number, z: number) => void,
 *   disposeReplicatorSound: () => void
 * }}
 */
export function createReplicatorSoundSystem(engineCtx) {
  /** @type {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer}|null} */
  let graph = null;

  /** @returns {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer}|null} */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
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
   * @param {number} x @param {number} z
   * @returns {number} 0..1, how loud a sound there is at the camera
   */
  function near(x, z) {
    const cam = engineCtx.Sim.three.camera.position;
    const d = Math.hypot(cam.x - x, cam.z - z);
    return Math.max(0, 1 - d / HEAR) ** 1.5;
  }

  /** @param {AudioNode} node */
  function quietly(node) {
    try { node.disconnect(); } catch { /* already */ }
  }

  /**
   * @param {NonNullable<typeof graph>} g
   * @param {BiquadFilterType} type
   * @param {number} frequency @param {number} q
   * @param {number} peak @param {number} attack @param {number} decay
   * @param {number} [delay]
   * @returns {void}
   */
  function noiseBurst(g, type, frequency, q, peak, attack, decay, delay = 0) {
    const { ctx, bus, noise } = g;
    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(t, Math.random() * 0.5);
    source.stop(t + attack + decay + 0.05);
    source.onended = () => quietly(gain);
  }

  /**
   * An oscillator through a filter, its own envelope; frequencies set by `shape`.
   * @param {NonNullable<typeof graph>} g
   * @param {OscillatorType} type
   * @param {number} peak @param {number} start @param {number} length
   * @param {(f: AudioParam, t: number) => void} shape
   * @param {number} [cutoff]
   * @returns {void}
   */
  function tone(g, type, peak, start, length, shape, cutoff = 4000) {
    const { ctx, bus } = g;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = type;
    shape(osc.frequency, t);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    gain.gain.setValueAtTime(peak, t + length * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + length + 0.05);
    osc.onended = () => quietly(gain);
  }

  /**
   * @param {number} x @param {number} z
   * @param {boolean} [big] the original's own coming
   * @returns {void}
   */
  function playAssemble(x, z, big = false) {
    const g = ensureGraph();
    const level = near(x, z) * (big ? 1.4 : 1);
    if (!g || level <= 0.01) return;
    const length = big ? 2 : 1.3;
    // The glitch: random notes stepping up.
    tone(g, 'square', 0.12 * level, 0, length, (f, t) => {
      const steps = big ? 22 : 14;
      for (let i = 0; i < steps; i++) {
        const u = i / steps;
        f.setValueAtTime(180 * Math.pow(2, u * 3 + (Math.random() - 0.5) * 0.6), t + u * length * 0.85);
      }
    }, 2600);
    // The blocks landing.
    const ticks = big ? 40 : 22;
    for (let i = 0; i < ticks; i++) {
      noiseBurst(g, 'bandpass', 3000 + Math.random() * 4000, 12, 0.22 * level, 0.002, 0.03, Math.random() * length * 0.9);
    }
    // Standing up, complete.
    tone(g, 'sine', 0.5 * level, length * 0.85, 0.5, (f, t) => {
      f.setValueAtTime(140, t);
      f.exponentialRampToValueAtTime(42, t + 0.45);
    }, 600);
  }

  /**
   * @param {number} x @param {number} z
   * @returns {void}
   */
  function playShatter(x, z) {
    const g = ensureGraph();
    const level = near(x, z);
    if (!g || level <= 0.01) return;
    noiseBurst(g, 'highpass', 1800, 0.7, 0.35 * level, 0.003, 0.25);
    for (let i = 0; i < 14; i++) {
      noiseBurst(g, 'bandpass', 2500 + Math.random() * 4500, 10, 0.2 * level, 0.002, 0.04, 0.05 + Math.random() * 0.7);
    }
    tone(g, 'sawtooth', 0.08 * level, 0, 0.35, (f, t) => {
      f.setValueAtTime(900, t);
      f.exponentialRampToValueAtTime(70, t + 0.33);
    }, 1500);
  }

  /** @returns {void} the swarm closing round Roger */
  function playSwarmCall() {
    const g = ensureGraph();
    if (!g) return;
    // The drone: two low saws beating, pulsed.
    for (const [freq, detune] of [[46, 0], [46.8, 0], [92, 3]]) {
      tone(g, 'sawtooth', 0.22, 0, 3.2, (f, t) => {
        f.setValueAtTime(freq + detune, t);
        f.linearRampToValueAtTime(freq * 0.9, t + 3.2);
      }, 380);
    }
    // The screech: a detuned pair rising and wavering.
    for (const k of [1, 1.013]) {
      tone(g, 'sawtooth', 0.07, 0.3, 2.6, (f, t) => {
        f.setValueAtTime(420 * k, t);
        f.exponentialRampToValueAtTime(1500 * k, t + 1.6);
        f.setValueAtTime(1500 * k, t + 1.6);
        f.linearRampToValueAtTime(1200 * k, t + 2.6);
      }, 3200);
    }
    for (let i = 0; i < 6; i++) noiseBurst(g, 'lowpass', 220, 1, 0.35, 0.01, 0.3, i * 0.5);
  }

  /**
   * @param {number} x @param {number} z
   * @returns {void}
   */
  function playShard(x, z) {
    const g = ensureGraph();
    const level = near(x, z);
    if (!g || level <= 0.01) return;
    tone(g, 'triangle', 0.18 * level, 0, 0.35, (f, t) => {
      f.setValueAtTime(2400, t);
      f.exponentialRampToValueAtTime(600, t + 0.33);
    }, 5000);
    noiseBurst(g, 'highpass', 4000, 0.7, 0.12 * level, 0.002, 0.08);
  }

  /** @returns {void} */
  function disposeReplicatorSound() {
    if (graph) quietly(graph.bus);
    graph = null;
  }

  return { playAssemble, playShatter, playSwarmCall, playShard, disposeReplicatorSound };
}
