// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.10 — EMP-charged funnel hum
 * ===========================================================================
 * The low electrical hum of a funnel carrying a line's discharge
 * (engine/empCharge.js), layered under the storm: a 60Hz mains buzz and its
 * second harmonic (sawtooths through a lowpass, the sound of a transformer
 * under load) and a fizz of bandpassed noise that stutters, for the arcs.
 *
 * Built the first time it is needed, like the other procedural modules, and
 * left running at zero gain in between.
 */

const BUS_LEVEL = 0.8;
const BUZZ_LEVEL = 0.32;
const FIZZ_LEVEL = 0.22;
const TIME_CONSTANT = 0.12;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateEmpHum: (level: number) => void,
 *   disposeEmpHum: () => void
 * }}
 */
export function createEmpHumSoundSystem(engineCtx) {
  /** @type {{ctx: AudioContext, buzz: GainNode, fizz: GainNode, sources: AudioScheduledSourceNode[], bus: GainNode}|null} */
  let graph = null;
  let last = 0;

  /**
   * @returns {typeof graph} built on first use; null while there is no
   *   running AudioContext
   */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 420;
    const buzz = ctx.createGain();
    buzz.gain.value = 0;
    lowpass.connect(buzz);
    buzz.connect(bus);
    const sources = [60, 120.4].map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.connect(lowpass);
      osc.start();
      return osc;
    });

    const noise = ctx.createBufferSource();
    noise.buffer = createShortNoiseBuffer(ctx, 2);
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 0.8;
    const fizz = ctx.createGain();
    fizz.gain.value = 0;
    noise.connect(band);
    band.connect(fizz);
    fizz.connect(bus);
    noise.start();
    sources.push(noise);

    graph = { ctx, buzz, fizz, sources, bus };
    return graph;
  }

  /**
   * Per frame: how charged the most charged funnel is, 0..1.
   * @param {number} level
   * @returns {void}
   */
  function updateEmpHum(level) {
    if (level <= 0 && last <= 0) return;
    const g = ensureGraph();
    if (!g) return;
    last = level;
    const now = g.ctx.currentTime;
    g.buzz.gain.setTargetAtTime(BUZZ_LEVEL * level, now, TIME_CONSTANT);
    // The fizz stutters, the way an arc does.
    const crackle = soundRandom() < 0.35 ? 1 : 0.25;
    g.fizz.gain.setTargetAtTime(FIZZ_LEVEL * level * crackle, now, 0.03);
  }

  /** @returns {void} */
  function disposeEmpHum() {
    if (!graph) return;
    for (const source of graph.sources) {
      try { source.stop(); } catch { /* already */ }
    }
    try { graph.bus.disconnect(); } catch { /* already */ }
    graph = null;
  }

  return { updateEmpHum, disposeEmpHum };
}
