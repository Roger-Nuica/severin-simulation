// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.7 — Power-line arcing
 * ===========================================================================
 * The sound of a fault running through the power lines
 * (environment/powerLines.js), procedural like the earthquake rumble
 * (sound/earthquake.js): noise and oscillators through filters, no files.
 *
 *  - a zap per hop: a short burst of noise played back pitched up through a
 *    high bandpass (the crack), layered with a brief square-wave buzz whose
 *    pitch drops as it dies (the harsh, electrical part);
 *  - a faint hum and crackle while any arc is live anywhere in town, so
 *    several arcs overlapping read as one chaotic electrical event rather
 *    than a run of separate blips. The hum is a pair of detuned sawtooths
 *    through a lowpass (mains buzz); the crackle is highpassed noise gated
 *    by random pops, the same technique as the fire and quake crackles.
 *
 * Built lazily on the first arc, gated on a running AudioContext, exactly
 * like the earthquake graph; between events the loops run at zero gain.
 */

const ARC_BUS_LEVEL = 0.8;
const ZAP_NOISE_LEVEL = 0.9;
const ZAP_BUZZ_LEVEL = 0.14;
const HUM_LEVEL = 0.05;
const CRACKLE_LEVEL = 0.22;
// Chance per second of a crackle pop at full activity.
const CRACKLE_RATE = 14;
// Time constant for fading out on reset/dispose: ~0.2s to silence, no click.
const FADE_TIME_CONSTANT = 0.05;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playZap: (intensity: number) => void,
 *   updatePowerArcSound: (activity: number, dt: number) => void,
 *   fadeOutPowerArcSound: () => void,
 *   disposePowerArcSound: () => void
 * }}
 */
export function createPowerArcSoundSystem(engineCtx) {
  /**
   * @typedef {Object} ArcGraph
   * @property {(AudioBufferSourceNode|OscillatorNode)[]} sources
   * @property {AudioBuffer} buffer
   * @property {GainNode} bus
   * @property {GainNode} hum
   * @property {GainNode} crackle
   */
  /** @type {ArcGraph|null} */
  let graph = null;

  /**
   * @returns {ArcGraph|null} the graph, built on first use; null while there
   *   is no running AudioContext to build it in
   */
  function ensureGraph() {
    if (graph) return graph;
    const SoundSystem = engineCtx.SoundSystem;
    // Same guard as thunder.js/fire.js/earthquake.js.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;

    const buffer = createShortNoiseBuffer(ctx, 2);
    const bus = ctx.createGain();
    bus.gain.value = ARC_BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);

    const hum = ctx.createGain();
    hum.gain.value = 0;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 420;
    humFilter.connect(hum);
    hum.connect(bus);
    const humOscs = [120, 121.7].map((frequency) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;
      osc.connect(humFilter);
      osc.start();
      return osc;
    });

    const crackleSource = ctx.createBufferSource();
    crackleSource.buffer = buffer;
    crackleSource.loop = true;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 4200;
    const crackle = ctx.createGain();
    crackle.gain.value = 0;
    crackleSource.connect(crackleFilter);
    crackleFilter.connect(crackle);
    crackle.connect(bus);
    crackleSource.start(0, soundRandom() * buffer.duration);

    graph = { sources: [...humOscs, crackleSource], buffer, bus, hum, crackle };
    return graph;
  }

  /**
   * One hop's zap: a pitched-up crack of bandpassed noise and a square-wave
   * buzz dropping in pitch under it, both gone in a tenth of a second.
   * @param {number} intensity 0..1, louder for a hop into a building
   * @returns {void}
   */
  function playZap(intensity) {
    const g = ensureGraph();
    if (!g) return;
    const ctx = engineCtx.SoundSystem.context;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = g.buffer;
    noise.playbackRate.value = 1.4 + soundRandom() * 0.8;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2800 + soundRandom() * 2400;
    band.Q.value = 2.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(ZAP_NOISE_LEVEL * (0.5 + 0.5 * intensity), now);
    noiseGain.gain.setTargetAtTime(0.0001, now + 0.01, 0.025);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(g.bus);
    noise.start(now, soundRandom() * (g.buffer.duration - 0.3));
    noise.stop(now + 0.2);
    noise.onended = () => { noiseGain.disconnect(); };

    const buzz = ctx.createOscillator();
    buzz.type = 'square';
    buzz.frequency.setValueAtTime(180 + soundRandom() * 140, now);
    buzz.frequency.exponentialRampToValueAtTime(70, now + 0.12);
    const buzzGain = ctx.createGain();
    buzzGain.gain.setValueAtTime(0.0001, now);
    buzzGain.gain.exponentialRampToValueAtTime(ZAP_BUZZ_LEVEL * (0.5 + 0.5 * intensity), now + 0.005);
    buzzGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    buzz.connect(buzzGain);
    buzzGain.connect(g.bus);
    buzz.start(now);
    buzz.stop(now + 0.14);
    buzz.onended = () => { buzzGain.disconnect(); };
  }

  /**
   * Per frame: the hum and crackle follow how much arcing is going on.
   * @param {number} activity 0..1, from how many arcs are live
   * @param {number} dt
   * @returns {void}
   */
  function updatePowerArcSound(activity, dt) {
    if (activity <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const now = engineCtx.SoundSystem.context.currentTime;
    g.hum.gain.setTargetAtTime(activity * HUM_LEVEL, now, activity > 0 ? 0.05 : 0.3);
    if (activity > 0.02 && soundRandom() < CRACKLE_RATE * activity * dt) {
      g.crackle.gain.cancelScheduledValues(now);
      g.crackle.gain.setValueAtTime(CRACKLE_LEVEL * activity * (0.4 + soundRandom() * 0.6), now);
      g.crackle.gain.setTargetAtTime(0, now + 0.005, 0.02 + soundRandom() * 0.03);
    }
  }

  /**
   * Silences the loops over ~0.2s, for a reset mid-fault.
   * @returns {void}
   */
  function fadeOutPowerArcSound() {
    if (!graph) return;
    const now = graph.bus.context.currentTime;
    for (const gain of [graph.hum, graph.crackle]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
    }
  }

  /**
   * Fades the bus out and stops the loops once it is silent.
   * @returns {void}
   */
  function disposePowerArcSound() {
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

  return { playZap, updatePowerArcSound, fadeOutPowerArcSound, disposePowerArcSound };
}
