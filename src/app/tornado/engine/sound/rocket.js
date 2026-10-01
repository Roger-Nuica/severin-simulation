// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.13 — The Rocket Strike
 * ===========================================================================
 * Landing Support's rocket (engine/spaceship/rocket.js), procedural like the
 * rest of sound/:
 *  - **the fall**, a loop while it comes down: a whistle (two sines a
 *    fifth apart, falling from ~2.4kHz towards ~600Hz as the ground comes
 *    up), a roar of bandpassed noise for the air tearing past, and a rumble
 *    (lowpassed noise) that climbs all the way down;
 *  - **the boom**, once, on impact, on top of the recorded large explosion
 *    (sound/cues.js): a deep sine dropping from 70Hz to 18Hz over three
 *    seconds, and a crack of noise whose lowpass closes behind it.
 * On the effects bus. Built the first time it is needed, when the
 * AudioContext is running.
 */

const BUS_LEVEL = 0.9;
const WHISTLE_LEVEL = 0.16;
const ROAR_LEVEL = 0.45;
const RUMBLE_LEVEL = 0.9;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateRocketSound: (level: number, progress: number) => void,
 *   playRocketBoom: () => void,
 *   disposeRocketSound: () => void
 * }}
 */
export function createRocketSoundSystem(engineCtx) {
  /** @type {null|{ctx: AudioContext, buffer: AudioBuffer, bus: GainNode, sources: AudioScheduledSourceNode[],
   *   whistles: OscillatorNode[], whistle: GainNode, roar: GainNode, roarFilter: BiquadFilterNode, rumble: GainNode}} */
  let graph = null;

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
    const whistle = ctx.createGain();
    whistle.gain.value = 0;
    whistle.connect(bus);
    const whistles = [1, 1.5].map((ratio) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2400 * ratio;
      const g = ctx.createGain();
      g.gain.value = ratio === 1 ? 1 : 0.35;
      osc.connect(g);
      g.connect(whistle);
      osc.start();
      return osc;
    });
    /**
     * @param {BiquadFilterType} type
     * @param {number} f
     * @param {number} q
     * @returns {{source: AudioBufferSourceNode, filter: BiquadFilterNode, gain: GainNode}}
     */
    const layer = (type, f, q) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = f;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      source.start(0, soundRandom() * buffer.duration);
      return { source, filter, gain };
    };
    const roar = layer('bandpass', 900, 0.8);
    const rumble = layer('lowpass', 140, 0.7);
    graph = {
      ctx, buffer, bus, sources: [...whistles, roar.source, rumble.source],
      whistles, whistle, roar: roar.gain, roarFilter: roar.filter, rumble: rumble.gain
    };
    return graph;
  }

  /**
   * Per frame of the fall (level 0 when there is none).
   * @param {number} level 0..1
   * @param {number} progress 0..1, how far down
   * @returns {void}
   */
  function updateRocketSound(level, progress) {
    if (level <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const now = g.ctx.currentTime;
    const f = 2400 * Math.pow(0.25, progress);
    g.whistles[0].frequency.setTargetAtTime(f, now, 0.05);
    g.whistles[1].frequency.setTargetAtTime(f * 1.5, now, 0.05);
    g.whistle.gain.setTargetAtTime(level * WHISTLE_LEVEL * (0.6 + 0.4 * progress), now, 0.08);
    g.roarFilter.frequency.setTargetAtTime(700 + 900 * progress, now, 0.1);
    g.roar.gain.setTargetAtTime(level * ROAR_LEVEL * (0.3 + 0.7 * progress), now, 0.1);
    g.rumble.gain.setTargetAtTime(level * RUMBLE_LEVEL * progress * progress, now, 0.1);
  }

  /** @returns {void} the impact */
  function playRocketBoom() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx } = g;
    const now = ctx.currentTime;
    updateRocketSound(0, 1);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(18, now + 3);
    const sub = ctx.createGain();
    sub.gain.setValueAtTime(0.0001, now);
    sub.gain.exponentialRampToValueAtTime(1.4, now + 0.03);
    sub.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
    osc.connect(sub);
    sub.connect(g.bus);
    osc.start(now);
    osc.stop(now + 3.3);
    osc.onended = () => { sub.disconnect(); };

    const source = ctx.createBufferSource();
    source.buffer = g.buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(7000, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 2.6);
    const crack = ctx.createGain();
    crack.gain.setValueAtTime(0.0001, now);
    crack.gain.exponentialRampToValueAtTime(1.1, now + 0.02);
    crack.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);
    source.connect(filter);
    filter.connect(crack);
    crack.connect(g.bus);
    source.start(now, soundRandom() * Math.max(0, g.buffer.duration - 3));
    source.stop(now + 2.9);
    source.onended = () => { crack.disconnect(); };
  }

  /** @returns {void} */
  function disposeRocketSound() {
    if (!graph) return;
    for (const source of graph.sources) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    graph.bus.disconnect();
    graph = null;
  }

  return { updateRocketSound, playRocketBoom, disposeRocketSound };
}
