// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.7 — Downburst
 * ===========================================================================
 * The Downburst (engine/downburst.js), procedural like the earthquake's
 * rumble (sound/earthquake.js): looped noise through filters, no files.
 *
 * What it has to say is "from above", so the weight is up top where the
 * tornado's roar sits low:
 *  - a high roar (bandpass ~2.4kHz) whose centre sweeps down from ~5kHz
 *    while the column is still falling, the pitch dropping as it comes
 *    down on you;
 *  - a thin whistle over it (narrow bandpass ~5kHz), the wind across every
 *    edge in town at once;
 *  - a body under both (lowpass ~180Hz), so it still has weight;
 *  - one-offs: the slam as the column hits the ground, a whoosh per gust,
 *    and the buildings under load -- long groaning creaks (a sawtooth
 *    gliding through a resonant bandpass) and short shear cracks.
 *
 * Built the first time it is needed, when the AudioContext is running.
 */

const BUS_LEVEL = 0.9;
const ROAR_LEVEL = 0.55;
const WHISTLE_LEVEL = 0.16;
const BODY_LEVEL = 0.5;
// Building stress sounds per second at full strength.
const CREAK_RATE = 1.1;
const SHEAR_RATE = 1.6;
const FADE_TIME_CONSTANT = 0.05;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateDownburstSound: (strength: number, descent: number, dt: number) => void,
 *   playSlam: () => void,
 *   playGust: (strength: number) => void,
 *   fadeOutDownburstSound: () => void,
 *   disposeDownburstSound: () => void
 * }}
 */
export function createDownburstSoundSystem(engineCtx) {
  /** @type {null|{sources: AudioBufferSourceNode[], buffer: AudioBuffer, bus: GainNode,
   *   roar: GainNode, roarFilter: BiquadFilterNode, whistle: GainNode,
   *   whistleFilter: BiquadFilterNode, body: GainNode}} */
  let graph = null;
  let time = 0;

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
    const roar = createLayer(ctx, buffer, 'bandpass', 2400, 0.7, bus);
    const whistle = createLayer(ctx, buffer, 'bandpass', 5200, 7, bus);
    const body = createLayer(ctx, buffer, 'lowpass', 180, 0.8, bus);
    graph = {
      sources: [roar.source, whistle.source, body.source],
      buffer, bus,
      roar: roar.gain, roarFilter: roar.filter,
      whistle: whistle.gain, whistleFilter: whistle.filter,
      body: body.gain
    };
    return graph;
  }

  /**
   * A timber-and-steel groan: a sawtooth sliding in pitch through a narrow
   * bandpass, swelling and dying over a second or so.
   * @param {AudioContext} ctx
   * @param {GainNode} bus
   * @param {number} strength
   * @returns {void}
   */
  function playCreak(ctx, bus, strength) {
    const now = ctx.currentTime;
    const length = 0.6 + soundRandom() * 0.9;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = 55 + soundRandom() * 70;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.linearRampToValueAtTime(f0 * (0.7 + soundRandom() * 0.7), now + length);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(350 + soundRandom() * 500, now);
    filter.frequency.linearRampToValueAtTime(250 + soundRandom() * 700, now + length);
    filter.Q.value = 9;
    const gain = ctx.createGain();
    const peak = 0.22 * (0.5 + 0.5 * strength);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + length + 0.05);
    osc.onended = () => { gain.disconnect(); };
  }

  /**
   * Something giving way under the load: a short, bright crack of noise.
   * @param {AudioContext} ctx
   * @param {GainNode} bus
   * @param {AudioBuffer} buffer
   * @param {number} strength
   * @returns {void}
   */
  function playShear(ctx, bus, buffer, strength) {
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.7 + soundRandom() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 + soundRandom() * 1800;
    filter.Q.value = 2.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9 * strength, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + soundRandom() * 0.15);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(now, soundRandom() * (buffer.duration - 0.5));
    source.stop(now + 0.35);
    source.onended = () => { gain.disconnect(); };
  }

  /**
   * Per frame.
   * @param {number} strength 0..1 how hard it is blowing (0 while falling)
   * @param {number} descent 0..1 how far down the column has come, while it
   *   is still falling; 1 once it has hit
   * @param {number} dt
   * @returns {void}
   */
  function updateDownburstSound(strength, descent, dt) {
    const level = Math.max(strength, descent * 0.55);
    if (level <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    time += dt;
    const gust = 0.8 + 0.12 * Math.sin(time * 1.9) + 0.08 * Math.sin(time * 4.7 + 1.3);
    // Coming down: the roar's centre falls from ~5kHz to its resting ~2.4kHz.
    const centre = strength > 0
      ? 2100 + 700 * (gust - 0.8) * 5
      : 5000 - 2600 * descent;
    g.roarFilter.frequency.setTargetAtTime(centre, now, 0.15);
    g.roar.gain.setTargetAtTime(level * ROAR_LEVEL * gust, now, 0.12);
    g.whistleFilter.frequency.setTargetAtTime(4600 + 1400 * Math.sin(time * 0.7), now, 0.3);
    g.whistle.gain.setTargetAtTime(level * WHISTLE_LEVEL * gust, now, 0.2);
    g.body.gain.setTargetAtTime(strength * BODY_LEVEL * gust, now, 0.2);
    if (strength > 0.05) {
      if (soundRandom() < CREAK_RATE * strength * dt) playCreak(ctx, g.bus, strength);
      if (soundRandom() < SHEAR_RATE * strength * dt) playShear(ctx, g.bus, g.buffer, strength);
    }
  }

  /**
   * The column hitting the ground: a sub drop under a wide burst of noise.
   * @returns {void}
   */
  function playSlam() {
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.8);
    const boom = ctx.createGain();
    boom.gain.setValueAtTime(0.0001, now);
    boom.gain.exponentialRampToValueAtTime(1.3, now + 0.03);
    boom.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    osc.connect(boom);
    boom.connect(g.bus);
    osc.start(now);
    osc.stop(now + 1.5);
    osc.onended = () => { boom.disconnect(); };

    const source = ctx.createBufferSource();
    source.buffer = g.buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(6000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 1.6);
    const blast = ctx.createGain();
    blast.gain.setValueAtTime(0.0001, now);
    blast.gain.exponentialRampToValueAtTime(1.1, now + 0.02);
    blast.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    source.connect(filter);
    filter.connect(blast);
    blast.connect(g.bus);
    source.start(now, soundRandom() * (g.buffer.duration - 2));
    source.stop(now + 1.9);
    source.onended = () => { blast.disconnect(); };
  }

  /**
   * One gust going over: a band of noise swept up and back down.
   * @param {number} strength 0..1
   * @returns {void}
   */
  function playGust(strength) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    const length = 1.6 + soundRandom() * 1.2;
    const source = ctx.createBufferSource();
    source.buffer = g.buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(3800, now + length * 0.4);
    filter.frequency.exponentialRampToValueAtTime(1200, now + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7 * strength, now + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(g.bus);
    source.start(now, soundRandom() * g.buffer.duration);
    source.stop(now + length + 0.05);
    source.onended = () => { gain.disconnect(); };
  }

  /** @returns {void} */
  function fadeOutDownburstSound() {
    if (!graph) return;
    const now = graph.bus.context.currentTime;
    for (const gain of [graph.roar, graph.whistle, graph.body]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
    }
  }

  /** @returns {void} */
  function disposeDownburstSound() {
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
      // The context is already closed.
    }
    graph = null;
  }

  return {
    updateDownburstSound, playSlam, playGust, fadeOutDownburstSound, disposeDownburstSound
  };
}
