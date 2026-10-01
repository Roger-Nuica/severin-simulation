// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.6 — Earthquake rumble
 * ===========================================================================
 * A sustained tremor for the Earthquake event (engine/earthquake.js), built
 * the same procedural way as the Firenado's fire roar (sound/fire.js): looped
 * noise through filters and gains, no audio files.
 *
 * Four layers share one looped noise buffer, feeding one bus:
 *  - a deep sub rumble (lowpass ~70Hz), the felt-more-than-heard body of the
 *    tremor;
 *  - a mid grinding layer (bandpass ~220Hz) that swells with the rumble,
 *    reading as rock and foundations grinding against each other;
 *  - a crackle (highpass) gated by short random pops, the same technique as
 *    the fire roar's crackle, here standing in for masonry and debris
 *    settling;
 *  - separate from the loop: discrete sub-bass "booms" (a fast pitch-drop
 *    sine swept from ~100Hz down to ~25Hz with a sharp envelope), scheduled
 *    at random while the quake is at meaningful strength, giving the tremor
 *    a felt low-end punctuation rather than a flat continuous hum.
 *
 * Two more for the lava eruption (engine/fissure.js):
 *  - a rupture burst per fissure as it finishes tearing open: the shared
 *    noise played back pitched well down through a resonant low bandpass,
 *    stuttered into a few uneven cracks rather than one clean hit;
 *  - a lava hiss loop (bandpass ~1kHz, well above the rumble, kept quiet)
 *    that follows the vents' glow, its filter jumping about at random so it
 *    bubbles rather than holding a steady note.
 *
 * The graph is built the first time an earthquake starts rather than at
 * load, exactly like the fire roar: by then the AudioContext exists and is
 * running. Between events the loop sources keep looping at zero gain.
 */

const QUAKE_BUS_LEVEL = 0.95;
const RUMBLE_LEVEL = 0.6;
const GRIND_LEVEL = 0.24;
const CRACKLE_LEVEL = 0.3;
// Chance per second of a crackle pop at full strength.
const CRACKLE_RATE = 9;
// Discrete sub-bass booms per second at full strength.
const BOOM_RATE = 0.55;
// A narrow bandpass passes little of white noise's power, hence the high level.
const RUPTURE_LEVEL = 4;
const LAVA_LEVEL = 0.12;
// Filter jumps per second at full glow: the bubbling.
const BUBBLE_RATE = 7;
// Time constant for fading out on reset/dispose: ~0.2s to silence, no click.
const FADE_TIME_CONSTANT = 0.05;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateEarthquakeSound: (strength: number, dt: number) => void,
 *   playRupture: (severity: number) => void,
 *   updateLavaSound: (level: number, dt: number) => void,
 *   fadeOutEarthquakeSound: () => void,
 *   disposeEarthquakeSound: () => void
 * }}
 */
export function createEarthquakeSoundSystem(engineCtx) {
  /**
   * @typedef {Object} QuakeGraph
   * @property {AudioBufferSourceNode[]} sources
   * @property {AudioBuffer} buffer
   * @property {GainNode} bus
   * @property {GainNode} rumble
   * @property {GainNode} grind
   * @property {GainNode} crackle
   * @property {GainNode} lava
   * @property {BiquadFilterNode} lavaFilter
   */
  /** @type {QuakeGraph|null} */
  let graph = null;
  let time = 0;
  let boomTimer = 0;
  let lavaTime = 0;

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
    // Each layer starts at a different point of the loop, so the three are
    // not audibly the same noise.
    source.start(0, soundRandom() * buffer.duration);
    return { source, filter, gain };
  }

  /**
   * @returns {QuakeGraph|null} the graph, built on first use; null while
   *   there is no running AudioContext to build it in
   */
  function ensureGraph() {
    if (graph) return graph;
    const SoundSystem = engineCtx.SoundSystem;
    // See the same guard in thunder.js/fire.js: re-resumes after a Safari
    // tab-blur suspend, but never creates the context from outside a gesture.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    const buffer = createShortNoiseBuffer(ctx, 3);
    const bus = ctx.createGain();
    bus.gain.value = QUAKE_BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    const rumble = createLayer(ctx, buffer, 'lowpass', 70, 0.8, bus);
    const grind = createLayer(ctx, buffer, 'bandpass', 220, 0.9, bus);
    const crackle = createLayer(ctx, buffer, 'highpass', 3200, 0.6, bus);
    const lava = createLayer(ctx, buffer, 'bandpass', 1100, 0.9, bus);
    graph = {
      sources: [rumble.source, grind.source, crackle.source, lava.source],
      buffer, bus, rumble: rumble.gain, grind: grind.gain, crackle: crackle.gain,
      lava: lava.gain, lavaFilter: lava.filter
    };
    return graph;
  }

  /**
   * One discrete sub-bass boom: a sine swept fast from ~100Hz down to ~25Hz
   * under a sharp exponential envelope, the same "felt punch" shape as a
   * kick drum's pitch drop, scaled up to something you feel through the
   * ground rather than hear as a note.
   * @param {AudioContext} ctx
   * @param {GainNode} bus
   * @param {number} strength 0..1
   * @returns {void}
   */
  function playBoom(ctx, bus, strength) {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85 + soundRandom() * 25, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.35);
    const gain = ctx.createGain();
    const peak = (0.5 + strength * 0.6) * (0.7 + soundRandom() * 0.3);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.65);
    osc.onended = () => { gain.disconnect(); };
  }

  /**
   * Per frame: follows the earthquake's 0..1 strength envelope. Rumble and
   * grind roll slowly (two incommensurate sines, so the tremor never repeats
   * exactly); crackle pops fire at random, and booms are scheduled on their
   * own independent timer.
   * @param {number} strength 0..1 current shake strength
   * @param {number} dt
   * @returns {void}
   */
  function updateEarthquakeSound(strength, dt) {
    if (strength <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    time += dt;
    const tremor = 0.75 + 0.15 * Math.sin(time * 5.3) + 0.1 * Math.sin(time * 11.7 + 0.6);
    g.rumble.gain.setTargetAtTime(strength * RUMBLE_LEVEL * tremor, now, 0.12);
    g.grind.gain.setTargetAtTime(strength * GRIND_LEVEL * (0.6 + 0.5 * tremor), now, 0.15);
    if (strength > 0.02 && soundRandom() < CRACKLE_RATE * strength * dt) {
      const pop = CRACKLE_LEVEL * strength * (0.4 + soundRandom() * 0.6);
      g.crackle.gain.cancelScheduledValues(now);
      g.crackle.gain.setValueAtTime(pop, now);
      g.crackle.gain.setTargetAtTime(0, now + 0.01, 0.03 + soundRandom() * 0.05);
    }
    if (strength > 0.05) {
      boomTimer -= dt;
      if (boomTimer <= 0) {
        playBoom(ctx, g.bus, strength);
        boomTimer = (1 / BOOM_RATE) * (0.6 + soundRandom() * 0.8);
      }
    } else {
      boomTimer = 0;
    }
  }

  /**
   * One fissure tearing open: a short, stuttering run of cracks, each a hit
   * of noise pitched well down through a resonant low bandpass, layered on
   * top of whatever the rumble and booms are doing.
   * @param {number} severity 0..1
   * @returns {void}
   */
  function playRupture(severity) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = g.buffer;
    source.playbackRate.value = 0.4 + soundRandom() * 0.15;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 110 + soundRandom() * 60;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    const peak = RUPTURE_LEVEL * (0.6 + 0.4 * severity);
    gain.gain.setValueAtTime(0.0001, now);
    const cracks = 3 + Math.floor(soundRandom() * 3);
    let t = now;
    for (let k = 0; k < cracks; k++) {
      t += 0.02 + soundRandom() * 0.09;
      gain.gain.setValueAtTime(peak * (0.4 + soundRandom() * 0.6) * (1 - k * 0.15), t);
      gain.gain.setTargetAtTime(peak * 0.05, t + 0.005, 0.03);
    }
    gain.gain.setTargetAtTime(0.0001, t + 0.05, 0.15);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(g.bus);
    source.start(now, soundRandom() * (g.buffer.duration - 1));
    source.stop(t + 0.9);
    source.onended = () => { gain.disconnect(); };
  }

  /**
   * Per frame: the lava hiss follows the eruption's 0..1 glow level, with
   * its filter kicked to a new frequency at random for the bubbling.
   * @param {number} level 0..1
   * @param {number} dt
   * @returns {void}
   */
  function updateLavaSound(level, dt) {
    if (level <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const now = engineCtx.SoundSystem.context.currentTime;
    lavaTime += dt;
    const swell = 0.8 + 0.2 * Math.sin(lavaTime * 1.7);
    g.lava.gain.setTargetAtTime(level * LAVA_LEVEL * swell, now, 0.25);
    if (level > 0.02 && soundRandom() < BUBBLE_RATE * level * dt) {
      g.lavaFilter.frequency.setTargetAtTime(600 + soundRandom() * 1000, now, 0.04);
    }
  }

  /**
   * Fades every looped layer to silence over ~0.2s, for a reset mid-quake.
   * The loops keep running at zero gain, as between events.
   * @returns {void}
   */
  function fadeOutEarthquakeSound() {
    if (!graph) return;
    const now = graph.bus.context.currentTime;
    for (const gain of [graph.rumble, graph.grind, graph.crackle, graph.lava]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
    }
  }

  /**
   * Fades the bus out and stops the loops once it is silent, rather than
   * cutting them mid-waveform.
   * @returns {void}
   */
  function disposeEarthquakeSound() {
    if (!graph) return;
    const { sources, bus } = graph;
    try {
      const now = bus.context.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
      for (const source of sources) source.stop(now + 0.25);
      sources[0].onended = () => {
        for (const s of sources) {
          try { s.disconnect(); } catch { /* already disconnected */ }
        }
        try { bus.disconnect(); } catch { /* already disconnected */ }
      };
    } catch {
      // The context is already closed: nothing left to hear or free.
    }
    graph = null;
  }

  return {
    updateEarthquakeSound, playRupture, updateLavaSound, fadeOutEarthquakeSound, disposeEarthquakeSound
  };
}
