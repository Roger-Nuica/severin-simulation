// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.5 — Firenado fire roar
 * ===========================================================================
 * A sustained fire roar for the Firenado (engine/firenado.js), built the
 * same procedural way as the wind and rumble layers: looped noise through
 * filters and gains, no audio files.
 *
 * Three layers share one looped noise buffer:
 *  - a low roar (lowpass), slowly rolling in level, the body of the blaze;
 *  - a mid "whoosh" (bandpass) that swells with the roar;
 *  - a crackle (highpass) gated by short random pops, scheduled per frame.
 * They meet on the fire bus, which feeds SoundSystem.masterGain, so mute
 * and volume apply exactly as to every other layer.
 *
 * The graph is built the first time a Firenado starts rather than at load:
 * by then the player has clicked Start, so the AudioContext exists and is
 * running. Between events the sources keep looping at zero gain.
 */

const FIRE_BUS_LEVEL = 0.9;
const ROAR_LEVEL = 0.55;
const WHOOSH_LEVEL = 0.22;
const CRACKLE_LEVEL = 0.35;
// Chance per second of a crackle pop at full burn.
const CRACKLE_RATE = 14;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateFireSound: (level: number, dt: number) => void,
 *   disposeFireSound: () => void
 * }}
 */
export function createFireSoundSystem(engineCtx) {
  /**
   * @typedef {Object} FireGraph
   * @property {AudioBufferSourceNode[]} sources
   * @property {GainNode} bus
   * @property {GainNode} roar
   * @property {GainNode} whoosh
   * @property {GainNode} crackle
   */
  /** @type {FireGraph|null} */
  let graph = null;
  let time = 0;

  /**
   * @param {AudioContext} ctx
   * @param {AudioBuffer} buffer
   * @param {BiquadFilterType} type
   * @param {number} frequency
   * @param {number} q
   * @param {GainNode} bus
   * @returns {{source: AudioBufferSourceNode, gain: GainNode}}
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
    // Each layer starts at a different point of the loop, so the three are
    // not audibly the same noise.
    source.start(0, soundRandom() * buffer.duration);
    return { source, gain };
  }

  /**
   * @returns {FireGraph|null} the graph, built on first use; null while
   *   there is no running AudioContext to build it in
   */
  function ensureGraph() {
    if (graph) return graph;
    const SoundSystem = engineCtx.SoundSystem;
    // See the same guard in thunder.js: re-resumes after a Safari tab-blur
    // suspend, but never creates the context from outside a gesture.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    const buffer = createShortNoiseBuffer(ctx, 3);
    const bus = ctx.createGain();
    bus.gain.value = FIRE_BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    const roar = createLayer(ctx, buffer, 'lowpass', 320, 0.7, bus);
    const whoosh = createLayer(ctx, buffer, 'bandpass', 900, 0.6, bus);
    const crackle = createLayer(ctx, buffer, 'highpass', 2600, 0.5, bus);
    graph = {
      sources: [roar.source, whoosh.source, crackle.source],
      bus, roar: roar.gain, whoosh: whoosh.gain, crackle: crackle.gain
    };
    return graph;
  }

  /**
   * Per frame: follows the Firenado's 0..1 burn level. The roar and whoosh
   * roll slowly (two incommensurate sines, so the swell never repeats
   * exactly); crackle pops are short gain spikes fired at random.
   * @param {number} level 0..1 current burn strength
   * @param {number} dt
   * @returns {void}
   */
  function updateFireSound(level, dt) {
    if (level <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    time += dt;
    const roll = 0.78 + 0.14 * Math.sin(time * 0.9) + 0.08 * Math.sin(time * 2.3 + 1.7);
    g.roar.gain.setTargetAtTime(level * ROAR_LEVEL * roll, now, 0.25);
    g.whoosh.gain.setTargetAtTime(level * WHOOSH_LEVEL * (0.6 + 0.5 * roll), now, 0.35);
    if (level > 0.02 && soundRandom() < CRACKLE_RATE * level * dt) {
      const pop = CRACKLE_LEVEL * level * (0.4 + soundRandom() * 0.6);
      g.crackle.gain.cancelScheduledValues(now);
      g.crackle.gain.setValueAtTime(pop, now);
      g.crackle.gain.setTargetAtTime(0, now + 0.01, 0.03 + soundRandom() * 0.05);
    }
  }

  /** @returns {void} */
  function disposeFireSound() {
    if (!graph) return;
    for (const source of graph.sources) {
      try { source.stop(); } catch { /* already stopped */ }
      try { source.disconnect(); } catch { /* already disconnected */ }
    }
    try { graph.bus.disconnect(); } catch { /* already disconnected */ }
    graph = null;
  }

  return { updateFireSound, disposeFireSound };
}
