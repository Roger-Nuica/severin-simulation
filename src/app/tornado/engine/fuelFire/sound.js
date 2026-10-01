// @ts-check
import { createShortNoiseBuffer } from '../sound/thunder.js';
import { soundRandom } from '../sound/random.js';

/**
 * ===========================================================================
 * SECTION FF.3 — Fuel stations: the leak's sound
 * ===========================================================================
 * Procedural, like the power lines' arcing (sound/powerArc.js): no files.
 *  - the hiss of fuel spraying from a torn pump: looped noise through a
 *    high bandpass, a little unsteady;
 *  - the pump alarm: a two-tone square-wave beep, faster once the fuel is
 *    alight.
 * One graph for every station (the loudest leak drives it), built on the
 * first leak once there is a running AudioContext; between leaks the loops
 * run at zero gain. The blast itself is the shared large explosion
 * (sound/cues.js playLargeExplosion).
 */

const BUS_LEVEL = 0.7;
const HISS_LEVEL = 0.32;
const ALARM_LEVEL = 0.07;
const ALARM_TONES = [1320, 990];
// Beeps a second: leaking, then burning.
const ALARM_RATE = [2.2, 4.5];
const FADE_TIME_CONSTANT = 0.05;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateLeakSound: (hiss: number, alarm: number, burning: boolean, dt: number) => void,
 *   silenceLeakSound: () => void,
 *   releaseLeakSound: () => void
 * }}
 */
export function createFuelLeakSound(engineCtx) {
  /**
   * @typedef {Object} LeakGraph
   * @property {(AudioBufferSourceNode|OscillatorNode)[]} sources
   * @property {GainNode} bus
   * @property {GainNode} hiss
   * @property {GainNode} alarm
   * @property {OscillatorNode} tone
   */
  /** @type {LeakGraph|null} */
  let graph = null;
  let beepClock = 0;
  let beepIndex = 0;

  /**
   * @returns {LeakGraph|null} the graph, built on first use; null while there
   *   is no running AudioContext to build it in
   */
  function ensureGraph() {
    if (graph) return graph;
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;

    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);

    const buffer = createShortNoiseBuffer(ctx, 2);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 5200;
    band.Q.value = 0.8;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    noise.connect(band);
    band.connect(hiss);
    hiss.connect(bus);
    noise.start(0, soundRandom() * buffer.duration);

    const tone = ctx.createOscillator();
    tone.type = 'square';
    tone.frequency.value = ALARM_TONES[0];
    const alarm = ctx.createGain();
    alarm.gain.value = 0;
    tone.connect(alarm);
    alarm.connect(bus);
    tone.start();

    graph = { sources: [noise, tone], bus, hiss, alarm, tone };
    return graph;
  }

  /**
   * Per frame: the hiss follows the loudest leak, the alarm beeps.
   * @param {number} hiss 0..1
   * @param {number} alarm 0..1
   * @param {boolean} burning the alarm beeps faster
   * @param {number} dt real seconds
   * @returns {void}
   */
  function updateLeakSound(hiss, alarm, burning, dt) {
    if (hiss <= 0 && alarm <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const now = g.bus.context.currentTime;
    const wobble = 0.8 + soundRandom() * 0.2;
    g.hiss.gain.setTargetAtTime(hiss * HISS_LEVEL * wobble, now, 0.08);
    if (alarm <= 0) {
      g.alarm.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
      beepClock = 0;
      return;
    }
    beepClock -= dt;
    if (beepClock <= 0) {
      beepClock += 1 / ALARM_RATE[burning ? 1 : 0];
      beepIndex = (beepIndex + 1) % ALARM_TONES.length;
      const length = 0.45 / ALARM_RATE[burning ? 1 : 0];
      g.tone.frequency.setValueAtTime(ALARM_TONES[beepIndex], now);
      g.alarm.gain.cancelScheduledValues(now);
      g.alarm.gain.setValueAtTime(ALARM_LEVEL * alarm, now);
      g.alarm.gain.setValueAtTime(0, now + length);
    }
  }

  /**
   * Silences the loops over ~0.2 s (a reset, the last leak gone up).
   * @returns {void}
   */
  function silenceLeakSound() {
    if (!graph) return;
    const now = graph.bus.context.currentTime;
    for (const gain of [graph.hiss, graph.alarm]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
    }
  }

  /**
   * Fades the bus out and stops the loops once it is silent (on dispose).
   * @returns {void}
   */
  function releaseLeakSound() {
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

  return { updateLeakSound, silenceLeakSound, releaseLeakSound };
}
