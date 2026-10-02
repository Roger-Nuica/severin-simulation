// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.11 — Solar storm
 * ===========================================================================
 * The solar storm (engine/solarStorm.js), procedural like the rest, and
 * built on what a geomagnetic storm actually sounds like on a radio: the
 * VLF "natural radio" that the aurora sets off.
 *
 *  - a bed under it all: a low drone of two detuned sines beating slowly
 *    against each other, and a thin, high shimmer of filtered noise that
 *    swells with the aurora;
 *  - whistlers: pure tones falling from ~5kHz to under 1kHz in a second or
 *    so, the signature sound of lightning's energy dispersed along the
 *    Earth's magnetic field;
 *  - the dawn chorus: bursts of short rising chirps, like birdsong, which
 *    is the name it was given;
 *  - static: radio crackle, grains of highpassed noise;
 *  - the grid: the 60Hz mains hum winding down to nothing with a clunk when
 *    the power goes, and winding back up when it returns;
 *  - the flare: a bright rising sweep of noise as it goes off.
 *
 * Built the first time it is needed, when the AudioContext is running.
 */

const BUS_LEVEL = 0.85;
const DRONE_LEVEL = 0.16;
const SHIMMER_LEVEL = 0.07;
const TIME_CONSTANT = 0.4;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateSolarSound: (level: number) => void,
 *   playWhistler: (strength: number) => void,
 *   playChorus: (strength: number) => void,
 *   playStatic: (strength: number) => void,
 *   playPowerDown: () => void,
 *   playPowerUp: () => void,
 *   playFlare: () => void,
 *   fadeOutSolarSound: () => void,
 *   disposeSolarSound: () => void
 * }}
 */
export function createSolarStormSoundSystem(engineCtx) {
  /** @type {null|{ctx: AudioContext, bus: GainNode, drone: GainNode, shimmer: GainNode, buffer: AudioBuffer, sources: AudioScheduledSourceNode[]}} */
  let graph = null;
  let last = 0;

  /** @returns {typeof graph} */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);

    // The drone: two sines a fraction of a hertz apart, so it breathes.
    const drone = ctx.createGain();
    drone.gain.value = 0;
    drone.connect(bus);
    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];
    for (const f of [73.4, 73.9, 110.2]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(drone);
      osc.start();
      sources.push(osc);
    }

    // The shimmer: noise through a narrow band high up.
    const buffer = createShortNoiseBuffer(ctx, 3);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 6200;
    band.Q.value = 4;
    const shimmer = ctx.createGain();
    shimmer.gain.value = 0;
    noise.connect(band);
    band.connect(shimmer);
    shimmer.connect(bus);
    noise.start(0, soundRandom() * buffer.duration);
    sources.push(noise);

    graph = { ctx, bus, drone, shimmer, buffer, sources };
    return graph;
  }

  /**
   * Per frame: how strong the aurora is, 0..1.
   * @param {number} level
   * @returns {void}
   */
  function updateSolarSound(level) {
    if (level <= 0 && last <= 0) return;
    const g = ensureGraph();
    if (!g) return;
    last = level;
    const now = g.ctx.currentTime;
    g.drone.gain.setTargetAtTime(DRONE_LEVEL * level, now, TIME_CONSTANT);
    g.shimmer.gain.setTargetAtTime(SHIMMER_LEVEL * level * (0.6 + 0.4 * soundRandom()), now, 0.2);
  }

  /**
   * One tone gliding from `from` to `to` Hz over `length` seconds.
   * @param {NonNullable<typeof graph>} g
   * @param {number} from
   * @param {number} to
   * @param {number} length
   * @param {number} level
   * @param {number} [delay]
   * @returns {void}
   */
  function glide(g, from, to, length, level, delay = 0) {
    const t = g.ctx.currentTime + delay;
    const osc = g.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    const gain = g.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + Math.min(0.05, length * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain);
    gain.connect(g.bus);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  /**
   * A whistler: a tone falling from high to low.
   * @param {number} strength 0..1
   * @returns {void}
   */
  function playWhistler(strength) {
    const g = ensureGraph();
    if (!g) return;
    const from = 4200 + soundRandom() * 2400;
    glide(g, from, 500 + soundRandom() * 500, 0.9 + soundRandom() * 0.9, 0.05 + 0.06 * strength);
  }

  /**
   * The dawn chorus: a few short rising chirps.
   * @param {number} strength 0..1
   * @returns {void}
   */
  function playChorus(strength) {
    const g = ensureGraph();
    if (!g) return;
    const count = 3 + Math.floor(soundRandom() * 5);
    let delay = 0;
    for (let i = 0; i < count; i++) {
      const from = 1100 + soundRandom() * 900;
      glide(g, from, from * (1.6 + soundRandom() * 0.8), 0.1 + soundRandom() * 0.12, 0.025 + 0.035 * strength, delay);
      delay += 0.08 + soundRandom() * 0.18;
    }
  }

  /**
   * Radio crackle: a run of short noise grains.
   * @param {number} strength 0..1
   * @returns {void}
   */
  function playStatic(strength) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = g.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(g.bus);
    const t0 = ctx.currentTime;
    const length = 0.35 + soundRandom() * 0.5;
    for (let t = 0; t < length; t += 0.02 + soundRandom() * 0.05) {
      gain.gain.setValueAtTime((0.05 + 0.18 * strength) * soundRandom(), t0 + t);
      gain.gain.setValueAtTime(0, t0 + t + 0.012);
    }
    const src = ctx.createBufferSource();
    src.buffer = g.buffer;
    src.connect(filter);
    src.start(t0, soundRandom() * (g.buffer.duration - length - 0.1), length + 0.05);
  }

  /**
   * The mains hum gliding between `from` and `to` Hz, through a lowpass,
   * with a clunk at the start (a breaker, a transformer giving up).
   * @param {number} from
   * @param {number} to
   * @param {number} length
   * @returns {void}
   */
  function hum(from, to, length) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = g.ctx;
    const t = ctx.currentTime;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 520;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.32, t + 0.06);
    gain.gain.setValueAtTime(0.32, t + length * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    lowpass.connect(gain);
    gain.connect(g.bus);
    for (const k of [1, 2.004]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(from * k, t);
      osc.frequency.exponentialRampToValueAtTime(to * k, t + length);
      osc.connect(lowpass);
      osc.start(t);
      osc.stop(t + length + 0.05);
    }
    // The clunk: a short, low thud of noise.
    const thud = ctx.createBufferSource();
    thud.buffer = g.buffer;
    const thudFilter = ctx.createBiquadFilter();
    thudFilter.type = 'lowpass';
    thudFilter.frequency.value = 260;
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.9, t);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    thud.connect(thudFilter);
    thudFilter.connect(thudGain);
    thudGain.connect(g.bus);
    thud.start(t, soundRandom() * 2, 0.3);
  }

  /** @returns {void} the power going: the hum winding down */
  function playPowerDown() {
    hum(120, 18, 2.6);
  }

  /** @returns {void} the power back: the hum winding up */
  function playPowerUp() {
    hum(24, 120, 1.6);
  }

  /** @returns {void} the flare going off: a bright rising sweep */
  function playFlare() {
    const g = ensureGraph();
    if (!g) return;
    const ctx = g.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = g.buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(300, t);
    band.frequency.exponentialRampToValueAtTime(7000, t + 2.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 1.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(band);
    band.connect(gain);
    gain.connect(g.bus);
    src.start(t, 0, 2.7);
  }

  /** @returns {void} */
  function fadeOutSolarSound() {
    last = 0;
    if (!graph) return;
    const now = graph.ctx.currentTime;
    graph.drone.gain.setTargetAtTime(0, now, 0.3);
    graph.shimmer.gain.setTargetAtTime(0, now, 0.3);
  }

  /** @returns {void} */
  function disposeSolarSound() {
    if (!graph) return;
    for (const source of graph.sources) {
      try { source.stop(); } catch { /* already */ }
    }
    try { graph.bus.disconnect(); } catch { /* already */ }
    graph = null;
    last = 0;
  }

  return {
    updateSolarSound, playWhistler, playChorus, playStatic, playPowerDown, playPowerUp, playFlare,
    fadeOutSolarSound, disposeSolarSound
  };
}
