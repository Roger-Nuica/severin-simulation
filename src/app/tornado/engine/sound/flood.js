// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.12 — The flood
 * ===========================================================================
 * The dam break kept its own sounds (the concrete groaning and cracking
 * while the gate strains, the large explosion when it goes); this adds the
 * water, procedural like the downburst's wind (sound/downburst.js):
 *  - **rushing water**, a loop: a low roar (lowpass ~320Hz) for the weight
 *    of it, a hiss over it (bandpass ~2.2kHz) for the surface tearing, and a
 *    gurgle (a narrow bandpass wandering 500-900Hz). Its level follows how
 *    close the camera is to the water and how much of it there is: loud
 *    while the wave goes by, a steady rush from the flood behind it, fading
 *    as it drains;
 *  - **wave crash**, a one-off: a sub thump under a wide burst of noise
 *    whose lowpass closes over two seconds -- the gate going, and a
 *    building the water brings down (rate-limited).
 * On the effects bus. Built the first time it is needed, when the
 * AudioContext is running.
 */

const BUS_LEVEL = 0.85;
const ROAR_LEVEL = 0.75;
const HISS_LEVEL = 0.22;
const GURGLE_LEVEL = 0.12;
const CRASH_GAP = 0.6;       // seconds between two crashes
// Metres from the water at which the rush is at full level, and where it is gone.
const NEAR = 25;
const FAR = 260;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateFloodSound: (level: number, distance: number, wave: number, dt: number) => void,
 *   playCrash: (strength: number) => void,
 *   disposeFloodSound: () => void
 * }}
 */
export function createFloodSoundSystem(engineCtx) {
  /** @type {null|{sources: AudioBufferSourceNode[], buffer: AudioBuffer, bus: GainNode,
   *   roar: GainNode, roarFilter: BiquadFilterNode, hiss: GainNode, gurgle: GainNode,
   *   gurgleFilter: BiquadFilterNode}} */
  let graph = null;
  let time = 0;
  let lastCrash = -Infinity;

  /**
   * @param {AudioContext} ctx
   * @param {AudioBuffer} buffer
   * @param {BiquadFilterType} type
   * @param {number} frequency
   * @param {number} q
   * @param {GainNode} bus
   * @returns {{source: AudioBufferSourceNode, filter: BiquadFilterNode, gain: GainNode}}
   */
  function createLayer(ctx, buffer, type, frequency, q, bus) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(0, soundRandom() * buffer.duration);
    return { source, filter, gain };
  }

  /** @returns {typeof graph} */
  function ensureGraph() {
    if (graph) return graph;
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    const buffer = createShortNoiseBuffer(ctx, 3);
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    const roar = createLayer(ctx, buffer, 'lowpass', 320, 0.7, bus);
    const hiss = createLayer(ctx, buffer, 'bandpass', 2200, 0.9, bus);
    const gurgle = createLayer(ctx, buffer, 'bandpass', 700, 9, bus);
    graph = {
      sources: [roar.source, hiss.source, gurgle.source],
      buffer, bus,
      roar: roar.gain, roarFilter: roar.filter,
      hiss: hiss.gain,
      gurgle: gurgle.gain, gurgleFilter: gurgle.filter
    };
    return graph;
  }

  /**
   * Per frame.
   * @param {number} level 0..1 how much water there is (0 when there is none)
   * @param {number} distance metres from the camera to the nearest water
   * @param {number} wave 0..1 how near the wave itself is (1 alongside it)
   * @param {number} dt
   * @returns {void}
   */
  function updateFloodSound(level, distance, wave, dt) {
    if (level <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    time += dt;
    const near = level * (1 - Math.min(1, Math.max(0, (distance - NEAR) / (FAR - NEAR))));
    const surge = 0.85 + 0.1 * Math.sin(time * 1.3) + 0.05 * Math.sin(time * 3.7 + 0.8);
    g.roarFilter.frequency.setTargetAtTime(260 + 220 * wave, now, 0.3);
    g.roar.gain.setTargetAtTime(near * ROAR_LEVEL * (0.55 + 0.45 * wave) * surge, now, 0.2);
    g.hiss.gain.setTargetAtTime(near * HISS_LEVEL * (0.4 + 0.6 * wave) * surge, now, 0.2);
    g.gurgleFilter.frequency.setTargetAtTime(600 + 300 * Math.sin(time * 0.9) * Math.sin(time * 2.3), now, 0.1);
    g.gurgle.gain.setTargetAtTime(near * GURGLE_LEVEL * (1 - 0.5 * wave), now, 0.25);
  }

  /**
   * The wave crashing: a sub thump under a burst of noise whose lowpass
   * closes as it dies away.
   * @param {number} strength 0..1
   * @returns {void}
   */
  function playCrash(strength) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    if (now - lastCrash < CRASH_GAP) return;
    lastCrash = now;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.9);
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(0.0001, now);
    thump.gain.exponentialRampToValueAtTime(1.1 * strength, now + 0.04);
    thump.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    osc.connect(thump);
    thump.connect(g.bus);
    osc.start(now);
    osc.stop(now + 1.3);
    osc.onended = () => { thump.disconnect(); };

    const source = ctx.createBufferSource();
    source.buffer = g.buffer;
    source.playbackRate.value = 0.8 + soundRandom() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5200, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 2.2);
    const wash = ctx.createGain();
    wash.gain.setValueAtTime(0.0001, now);
    wash.gain.exponentialRampToValueAtTime(1.0 * strength, now + 0.05);
    wash.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
    source.connect(filter);
    filter.connect(wash);
    wash.connect(g.bus);
    source.start(now, soundRandom() * Math.max(0, g.buffer.duration - 2.5));
    source.stop(now + 2.5);
    source.onended = () => { wash.disconnect(); };
  }

  /** @returns {void} */
  function disposeFloodSound() {
    if (!graph) return;
    for (const source of graph.sources) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    graph.bus.disconnect();
    graph = null;
  }

  return { updateFloodSound, playCrash, disposeFloodSound };
}
