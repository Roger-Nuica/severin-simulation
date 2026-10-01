// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.8 — Fujiwhara merge
 * ===========================================================================
 * The one-off cue for two tornadoes combining (engine/fujiwhara.js), built
 * the same procedural way as the earthquake and power-line sounds: noise
 * and oscillators through filters, no files.
 *
 * A single rising "combining" whoosh, timed to land on the moment the two
 * funnels become one:
 *  - noise through a bandpass swept up from a low roar to a hiss, its Q
 *    tightening as it climbs so it narrows into a scream;
 *  - a pair of slightly detuned sawtooths pitch-bending up two octaves
 *    underneath it, through a lowpass that opens as they rise;
 *  - on arrival, a short sub-bass thump (the same pitch-drop shape as the
 *    earthquake booms) as the two circulations lock together.
 *
 * Only the bus is kept between merges; it is built on the first merge,
 * gated on a running AudioContext exactly like the earthquake graph.
 */

const MERGE_BUS_LEVEL = 0.9;
const WHOOSH_LEVEL = 0.8;
const BEND_LEVEL = 0.07;
const THUMP_LEVEL = 0.9;
// Time constant for fading out on reset/dispose: ~0.2s to silence, no click.
const FADE_TIME_CONSTANT = 0.05;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playMergeWhoosh: (duration: number) => void,
 *   fadeOutMergeSound: () => void,
 *   disposeMergeSound: () => void
 * }}
 */
export function createFujiwharaSoundSystem(engineCtx) {
  /** @type {{bus: GainNode, buffer: AudioBuffer}|null} */
  let graph = null;

  /**
   * @returns {{bus: GainNode, buffer: AudioBuffer}|null} built on first use;
   *   null while there is no running AudioContext to build it in
   */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    // Same guard as thunder.js/fire.js/earthquake.js.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph) {
      // A reset may have faded the bus out; bring it back for this merge.
      graph.bus.gain.cancelScheduledValues(ctx.currentTime);
      graph.bus.gain.setValueAtTime(MERGE_BUS_LEVEL, ctx.currentTime);
      return graph;
    }
    const bus = ctx.createGain();
    bus.gain.value = MERGE_BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    graph = { bus, buffer: createShortNoiseBuffer(ctx, 3) };
    return graph;
  }

  /**
   * The whole cue, scheduled at once: a rise lasting `duration` seconds
   * that lands with a thump.
   * @param {number} duration seconds from now until the funnels become one
   * @returns {void}
   */
  function playMergeWhoosh(duration) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;
    const end = now + duration;

    const noise = ctx.createBufferSource();
    noise.buffer = g.buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(160, now);
    band.frequency.exponentialRampToValueAtTime(1600, end);
    band.Q.setValueAtTime(0.9, now);
    band.Q.linearRampToValueAtTime(4, end);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(WHOOSH_LEVEL, end - 0.05);
    noiseGain.gain.setTargetAtTime(0.0001, end, 0.12);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(g.bus);
    noise.start(now, soundRandom() * g.buffer.duration);
    noise.stop(end + 0.8);
    noise.onended = () => { noiseGain.disconnect(); };

    const bendFilter = ctx.createBiquadFilter();
    bendFilter.type = 'lowpass';
    bendFilter.frequency.setValueAtTime(300, now);
    bendFilter.frequency.exponentialRampToValueAtTime(2200, end);
    const bendGain = ctx.createGain();
    bendGain.gain.setValueAtTime(0.0001, now);
    bendGain.gain.exponentialRampToValueAtTime(BEND_LEVEL, end - 0.05);
    bendGain.gain.setTargetAtTime(0.0001, end, 0.1);
    bendFilter.connect(bendGain);
    bendGain.connect(g.bus);
    [55, 55.9].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * 4, end);
      osc.connect(bendFilter);
      osc.start(now);
      osc.stop(end + 0.6);
      if (i === 0) osc.onended = () => { bendGain.disconnect(); };
    });

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(95, end);
    thump.frequency.exponentialRampToValueAtTime(26, end + 0.45);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, end);
    thumpGain.gain.exponentialRampToValueAtTime(THUMP_LEVEL, end + 0.02);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, end + 0.8);
    thump.connect(thumpGain);
    thumpGain.connect(g.bus);
    thump.start(end);
    thump.stop(end + 0.85);
    thump.onended = () => { thumpGain.disconnect(); };
  }

  /**
   * Silences a cue in flight over ~0.2s, for a reset mid-merge. Everything
   * it scheduled stops on its own shortly after.
   * @returns {void}
   */
  function fadeOutMergeSound() {
    if (!graph) return;
    const now = graph.bus.context.currentTime;
    graph.bus.gain.cancelScheduledValues(now);
    graph.bus.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
  }

  /** @returns {void} */
  function disposeMergeSound() {
    if (!graph) return;
    const { bus } = graph;
    try {
      bus.gain.cancelScheduledValues(bus.context.currentTime);
      bus.gain.setTargetAtTime(0, bus.context.currentTime, FADE_TIME_CONSTANT);
      setTimeout(() => {
        try { bus.disconnect(); } catch { /* already disconnected */ }
      }, 250);
    } catch {
      // The context is already closed: nothing left to hear or free.
    }
    graph = null;
  }

  return { playMergeWhoosh, fadeOutMergeSound, disposeMergeSound };
}
