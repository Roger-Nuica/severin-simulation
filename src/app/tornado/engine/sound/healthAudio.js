// @ts-check

/**
 * ===========================================================================
 * SECTION S.16 -- Roger's health: hurt, heartbeat, recharge
 * ===========================================================================
 * The voice of the health bar (engine/health/system.js), procedural like the
 * rest of sound/: no files, and no creature voices (R-046: it owns its own
 * bus and never goes through creatureSounds.play).
 *
 *  - **hurt**: a short, dull thump with a sharp noise crack on the front;
 *  - **heartbeat**: a "lub-dub" pair of low sine thuds, scheduled one pair at
 *    a time while health is low, quicker the lower it is. There is no looping
 *    node to leak: each pair is two short-lived oscillators;
 *  - **muffle**: while the heartbeat runs the master low-pass is closed a
 *    little through `sound.setMuffle(amount, 'health')`, which already fades
 *    smoothly and combines with Bullet Time and the Black Hole by the loudest;
 *  - **recharge**: a soft rising shimmer when the fast refill begins.
 *
 * Built the first time a cue is asked for, when the AudioContext exists and
 * is running; nothing plays before then. Sound is on real time. `release`
 * opens the muffle and stops the beat, and is called on death, pause, Restart
 * and dispose so the filter is never left shut.
 */

import { createShortNoiseBuffer } from './thunder.js';

const BUS_LEVEL = 0.8;
const HURT_LEVEL = 0.6;
const BEAT_LEVEL = 0.7;
const RECHARGE_LEVEL = 0.3;
const SILENCE = 0.0001;
const MUFFLE_KEY = 'health';
const MUFFLE_AMOUNT = 0.45;
const SLOWEST_BEAT = 1.15;
const FASTEST_BEAT = 0.6;

/**
 * Seconds between heartbeats for a health fraction: `SLOWEST_BEAT` at the
 * low-health threshold, `FASTEST_BEAT` near zero.
 * @param {number} fraction Health as a fraction of the maximum, 0 to 1.
 * @param {number} threshold The low-health threshold fraction.
 * @returns {number} The beat period in seconds.
 */
export const beatPeriod = (fraction, threshold) => {
  const t = Math.min(1, Math.max(0, fraction / threshold));
  return FASTEST_BEAT + (SLOWEST_BEAT - FASTEST_BEAT) * t;
};

/**
 * @typedef {Object} HealthAudioGraph
 * @property {AudioContext} ctx
 * @property {GainNode} bus
 * @property {AudioBuffer} noise
 */

/**
 * Disconnects the nodes of a cue once its source ends.
 * @param {AudioScheduledSourceNode} source The cue's source.
 * @param {AudioNode[]} nodes Nodes to disconnect.
 * @returns {void}
 */
const disconnectOnEnd = (source, nodes) => {
  source.addEventListener('ended', () => {
    nodes.forEach((node) => {
      try { node.disconnect(); } catch { /* already */ }
    });
  });
};

/**
 * One enveloped tone gliding from `from` to `to`.
 * @param {HealthAudioGraph} g The graph.
 * @param {OscillatorType} type Wave shape.
 * @param {number} from Start frequency, Hz.
 * @param {number} to End frequency, Hz.
 * @param {number} peak Peak gain.
 * @param {number} attack Attack seconds.
 * @param {number} decay Decay seconds.
 * @param {number} [delay] Seconds from now.
 * @returns {void}
 */
const tone = (g, type, from, to, peak, attack, decay, delay = 0) => {
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
};

/**
 * A short burst of the shared noise through one filter.
 * @param {HealthAudioGraph} g The graph.
 * @param {BiquadFilterType} type Filter type.
 * @param {number} freq Filter frequency, Hz.
 * @param {number} peak Peak gain.
 * @param {number} decay Decay seconds.
 * @returns {void}
 */
const crack = (g, type, freq, peak, decay) => {
  const { ctx, bus, noise } = g;
  const start = ctx.currentTime;
  const end = start + 0.002 + decay;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENCE, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.002);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start(start);
  source.stop(end + 0.05);
  disconnectOnEnd(source, [filter, gain]);
};

/**
 * Creates the health audio for one simulation instance.
 * @param {any} engineCtx The simulation context.
 * @returns {{
 *   playHurt: () => void,
 *   playRecharge: () => void,
 *   updateHeartbeat: (active: boolean, fraction: number, threshold: number, dt: number) => void,
 *   release: () => void,
 *   disposeHealthAudio: () => void
 * }} The audio surface.
 */
export function createHealthAudio(engineCtx) {
  /** @type {HealthAudioGraph | null} */
  let graph = null;
  let beating = false;
  let untilBeat = 0;

  /** @returns {HealthAudioGraph | null} The graph, built on first use; null while no AudioContext is running. */
  const ensureGraph = () => {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    graph = { ctx, bus, noise: createShortNoiseBuffer(ctx, 1) };
    return graph;
  };

  /**
   * Runs one cue against the graph, or does nothing while there is none.
   * @param {(g: HealthAudioGraph) => void} cue The cue.
   * @returns {void}
   */
  const withGraph = (cue) => {
    const g = ensureGraph();
    if (g) cue(g);
  };

  /** @returns {void} The hurt cue: a dull thump under a sharp crack. */
  const playHurt = () => withGraph((g) => {
    crack(g, 'bandpass', 2400, HURT_LEVEL * 0.6, 0.06);
    tone(g, 'sine', 170, 55, HURT_LEVEL, 0.004, 0.22);
  });

  /** @returns {void} The recharge cue: a soft rising shimmer as the refill starts. */
  const playRecharge = () => withGraph((g) => {
    tone(g, 'sine', 330, 990, RECHARGE_LEVEL, 0.1, 0.9);
    tone(g, 'triangle', 495, 1485, RECHARGE_LEVEL * 0.4, 0.1, 0.9, 0.05);
  });

  /** @returns {void} One "lub-dub" pair. */
  const beat = () => withGraph((g) => {
    tone(g, 'sine', 62, 38, BEAT_LEVEL, 0.01, 0.16);
    tone(g, 'sine', 55, 34, BEAT_LEVEL * 0.75, 0.01, 0.14, 0.2);
  });

  /** @param {boolean} on Whether the muffle should be closed. @returns {void} */
  const setMuffled = (on) => {
    const sound = engineCtx.systems.sound;
    if (sound) sound.setMuffle(on ? MUFFLE_AMOUNT : 0, MUFFLE_KEY);
  };

  /**
   * Per frame: while `active` the beat is scheduled one pair at a time and
   * the master is muffled; otherwise both stop. Allocation-free until a pair
   * is due.
   * @param {boolean} active True while health is low, Roger is alive and the game runs.
   * @param {number} fraction Health as a fraction of the maximum.
   * @param {number} threshold The low-health threshold fraction.
   * @param {number} dt Real seconds since the last frame.
   * @returns {void}
   */
  const updateHeartbeat = (active, fraction, threshold, dt) => {
    if (!active) {
      if (beating) release();
      return;
    }
    if (!beating) {
      beating = true;
      untilBeat = 0;
      setMuffled(true);
    }
    untilBeat -= dt;
    if (untilBeat <= 0) {
      beat();
      untilBeat = beatPeriod(fraction, threshold);
    }
  };

  /** @returns {void} Stops the beat and opens the master filter again. */
  function release() {
    beating = false;
    untilBeat = 0;
    setMuffled(false);
  }

  /** @returns {void} Releases the muffle and drops the bus; the next cue rebuilds it. */
  const disposeHealthAudio = () => {
    release();
    if (graph) {
      try { graph.bus.disconnect(); } catch { /* already */ }
    }
    graph = null;
  };

  return { playHurt, playRecharge, updateHeartbeat, release, disposeHealthAudio };
}
