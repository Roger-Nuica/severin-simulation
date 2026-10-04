// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandFloat } from './random.js';

/**
 * ===========================================================================
 * SECTION S.20 — GHOST flight (engine/airSupport.js)
 * ===========================================================================
 * The stealth fighters' voice, procedural like the rest of sound/:
 *
 *  - **hum**: a loop while the flight is up, set every frame from the
 *    nearest jet: the turbine whine (bandpassed noise round 2.6 kHz and a
 *    thin high sine) over the low roar of the engines;
 *  - **flyby**: a jet tearing past, a noise sweep falling from bright to
 *    dark like a Doppler pass, under a deep roar;
 *  - **sonic boom**: the double crack of an N-wave and a low thump, when
 *    the flight drops its cloak over the town;
 *  - **gun**: the rotary cannon's BRRRT, a buzz of sawtooth and square at
 *    the firing rate with a crackle of noise on top;
 *  - **rocket**: the launch hiss, rising; and the **blast** where it lands;
 *  - **flares**: a string of soft pops.
 *
 * Callers pass a level (0..1) already scaled by distance. On the effects
 * bus; built the first time it is needed, when the AudioContext runs.
 */

const BUS_LEVEL = 0.75;
const SILENCE = 0.0001;

/**
 * @typedef {Object} JetGraph
 * @property {AudioContext} ctx
 * @property {GainNode} bus
 * @property {AudioBuffer} noise
 * @property {GainNode} hum
 * @property {BiquadFilterNode} whine
 * @property {OscillatorNode} whistle
 * @property {AudioScheduledSourceNode[]} loops
 */

/**
 * @param {AudioScheduledSourceNode} source
 * @param {AudioNode[]} nodes
 */
function disconnectOnEnd(source, nodes) {
  source.addEventListener('ended', () => {
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* already */ }
    }
  });
}

/**
 * A burst of the shared noise through one filter that sweeps.
 * @param {JetGraph} g
 * @param {BiquadFilterType} type
 * @param {number} from
 * @param {number} to
 * @param {number} q
 * @param {number} peak
 * @param {number} attack
 * @param {number} decay
 * @param {number} [delay]
 */
function noiseSweep(g, type, from, to, q, peak, attack, decay, delay = 0) {
  if (peak <= SILENCE) return;
  const { ctx, bus, noise } = g;
  const start = ctx.currentTime + delay;
  const end = start + attack + decay;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.loopStart = soundRandFloat(0, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  if (to !== from) filter.frequency.exponentialRampToValueAtTime(to, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start(start, soundRandFloat(0, 0.5));
  source.stop(end + 0.05);
  disconnectOnEnd(source, [filter, gain]);
}

/**
 * One enveloped tone, gliding from `from` to `to`.
 * @param {JetGraph} g
 * @param {OscillatorType} type
 * @param {number} from
 * @param {number} to
 * @param {number} peak
 * @param {number} attack
 * @param {number} decay
 * @param {number} [delay]
 */
function tone(g, type, from, to, peak, attack, decay, delay = 0) {
  if (peak <= SILENCE) return;
  const { ctx, bus } = g;
  const start = ctx.currentTime + delay;
  const end = start + attack + decay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, end);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  osc.connect(gain);
  gain.connect(bus);
  osc.start(start);
  osc.stop(end + 0.05);
  disconnectOnEnd(osc, [gain]);
}

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateJetHum: (level: number, strain: number) => void,
 *   playFlyby: (level: number) => void,
 *   playSonicBoom: (level: number) => void,
 *   playGun: (level: number, seconds: number) => void,
 *   playRocketLaunch: (level: number) => void,
 *   playBlast: (level: number) => void,
 *   playFlares: (level: number) => void,
 *   disposeJetSound: () => void
 * }}
 */
export function createJetSoundSystem(engineCtx) {
  /** @type {JetGraph|null} */
  let graph = null;

  /** @returns {JetGraph|null} */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    const noise = createShortNoiseBuffer(ctx, 2);
    // The hum: always running, at zero until a jet is near.
    const hum = ctx.createGain();
    hum.gain.value = 0;
    hum.connect(bus);
    const roarSrc = ctx.createBufferSource();
    roarSrc.buffer = noise;
    roarSrc.loop = true;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.frequency.value = 320;
    const roarGain = ctx.createGain();
    roarGain.gain.value = 0.9;
    roarSrc.connect(roar).connect(roarGain).connect(hum);
    const whineSrc = ctx.createBufferSource();
    whineSrc.buffer = noise;
    whineSrc.loop = true;
    const whine = ctx.createBiquadFilter();
    whine.type = 'bandpass';
    whine.frequency.value = 2600;
    whine.Q.value = 6;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.5;
    whineSrc.connect(whine).connect(whineGain).connect(hum);
    const whistle = ctx.createOscillator();
    whistle.type = 'sine';
    whistle.frequency.value = 3900;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0.015;
    whistle.connect(whistleGain).connect(hum);
    roarSrc.start();
    whineSrc.start(0, 0.7);
    whistle.start();
    graph = { ctx, bus, noise, hum, whine, whistle, loops: [roarSrc, whineSrc, whistle] };
    return graph;
  }

  /** @param {(g: JetGraph) => void} cue */
  function withGraph(cue) {
    const g = ensureGraph();
    if (g) cue(g);
  }

  /**
   * @param {number} level 0..1, the nearest jet's loudness
   * @param {number} strain 0..1, how hard the engines work (afterburner)
   */
  function updateJetHum(level, strain) {
    if (!graph && level <= 0.001) return;
    const g = ensureGraph();
    if (!g) return;
    const t = g.ctx.currentTime;
    g.hum.gain.setTargetAtTime(Math.min(0.6, level * (0.35 + strain * 0.4)), t, 0.25);
    g.whine.frequency.setTargetAtTime(2300 + strain * 1300, t, 0.3);
    g.whistle.frequency.setTargetAtTime(3600 + strain * 900, t, 0.3);
  }

  /** @param {number} level */
  function playFlyby(level) {
    withGraph((g) => {
      noiseSweep(g, 'bandpass', 5200, 380, 1.1, 0.75 * level, 0.9, 2.2);
      noiseSweep(g, 'lowpass', 900, 140, 0.7, 0.9 * level, 0.6, 2.8);
      tone(g, 'sawtooth', 120, 62, 0.06 * level, 0.5, 2.4);
    });
  }

  /** @param {number} level */
  function playSonicBoom(level) {
    withGraph((g) => {
      // The N-wave: two cracks a beat apart, then the thump and the rumble.
      noiseSweep(g, 'lowpass', 5000, 600, 0.5, 1.1 * level, 0.004, 0.18);
      noiseSweep(g, 'lowpass', 5000, 500, 0.5, 0.95 * level, 0.004, 0.22, 0.13);
      tone(g, 'sine', 64, 26, 0.9 * level, 0.01, 0.9);
      noiseSweep(g, 'lowpass', 260, 60, 0.6, 0.55 * level, 0.05, 2.4, 0.1);
    });
  }

  /** @param {number} level @param {number} seconds */
  function playGun(level, seconds) {
    withGraph((g) => {
      const { ctx, bus } = g;
      const start = ctx.currentTime;
      const end = start + seconds;
      // The buzz: the barrels' firing rate as a pitch.
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(78, start);
      saw.frequency.linearRampToValueAtTime(92, start + 0.15);
      const square = ctx.createOscillator();
      square.type = 'square';
      square.frequency.setValueAtTime(156, start);
      square.frequency.linearRampToValueAtTime(184, start + 0.15);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      filter.Q.value = 1.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(SILENCE, start);
      gain.gain.exponentialRampToValueAtTime(0.32 * level + SILENCE, start + 0.04);
      gain.gain.setValueAtTime(0.32 * level + SILENCE, end - 0.08);
      gain.gain.exponentialRampToValueAtTime(SILENCE, end + 0.25);
      saw.connect(filter);
      square.connect(filter);
      filter.connect(gain).connect(bus);
      saw.start(start);
      square.start(start);
      saw.stop(end + 0.3);
      square.stop(end + 0.3);
      disconnectOnEnd(saw, [filter, gain]);
      noiseSweep(g, 'bandpass', 1800, 900, 0.9, 0.5 * level, 0.03, seconds + 0.2);
      // The rounds landing, a moment later.
      noiseSweep(g, 'highpass', 2400, 1200, 0.6, 0.3 * level, 0.02, seconds * 0.8, 0.2);
    });
  }

  /** @param {number} level */
  function playRocketLaunch(level) {
    withGraph((g) => {
      noiseSweep(g, 'bandpass', 900, 4200, 1.4, 0.55 * level, 0.03, 0.9);
      noiseSweep(g, 'lowpass', 600, 220, 0.6, 0.45 * level, 0.02, 1.2);
    });
  }

  /** @param {number} level */
  function playBlast(level) {
    withGraph((g) => {
      tone(g, 'sine', 90, 28, 0.85 * level, 0.01, 1.4);
      noiseSweep(g, 'lowpass', 4200, 180, 0.5, 1.0 * level, 0.005, 1.6);
    });
  }

  /** @param {number} level */
  function playFlares(level) {
    withGraph((g) => {
      for (let i = 0; i < 6; i++) {
        noiseSweep(g, 'bandpass', 1500, 700, 2, 0.25 * level, 0.003, 0.12, i * 0.09);
      }
    });
  }

  function disposeJetSound() {
    if (graph) {
      for (const s of graph.loops) {
        try { s.stop(); } catch { /* already */ }
      }
      try { graph.hum.disconnect(); } catch { /* already */ }
      try { graph.bus.disconnect(); } catch { /* already */ }
    }
    graph = null;
  }

  return { updateJetHum, playFlyby, playSonicBoom, playGun, playRocketLaunch, playBlast, playFlares, disposeJetSound };
}
