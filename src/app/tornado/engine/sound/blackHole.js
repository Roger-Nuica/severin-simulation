// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.14 — The Black Hole Gun
 * ===========================================================================
 * The hole's own voice, layered on top of the shared shockwave cue
 * (sound/shockwave.js, already played on open by engine/player/blackHole.js):
 *
 *  - **hum**: the gravity well itself, for as long as it is open -- two
 *    detuned sub oscillators under a closing lowpass (the pull), and a
 *    bandpassed noise swirl that stutters like empHum's fizz (the wind).
 *    Driven every frame by `updateHum(level)`, the same 0..1 `hole.size`
 *    the visuals use, so it swells and fades with the opening/closing
 *    curve and never needs its own open/close bookkeeping -- the pattern
 *    sound/empHum.js and engine/empCharge.js already use for a level-driven
 *    ambience, rather than discrete start/stop events;
 *  - **tear**: one shot as it opens, under the shockwave -- a fast noise
 *    sweep and a sub rising then snapping, spacetime pulled open;
 *  - **collapse**: one shot as it finishes -- a short low implosion thump
 *    and a bright crack cut off hard, the opposite snap.
 *
 * No per-swallow one-shots: with up to HOLE.maxCaught things caught and
 * DISSOLVE.maxAtOnce dissolving at once, a cue on every capture would be a
 * noisy stutter rather than feedback, so the hum's level is the only thing
 * that answers "is it eating". Built the first time it is needed, like the
 * other procedural modules.
 */

const BUS_LEVEL = 0.85;
const HUM_LEVEL = 0.5;
const SWIRL_LEVEL = 0.22;
const TIME_CONSTANT = 0.15;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playOpen: () => void,
 *   updateHum: (level: number) => void,
 *   playClose: () => void,
 *   disposeBlackHoleSound: () => void
 * }}
 */
export function createBlackHoleSoundSystem(engineCtx) {
  /** @type {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer, hum: GainNode, swirl: GainNode, sources: AudioScheduledSourceNode[]}|null} */
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

    // The pull: two detuned subs through a lowpass that opens a little
    // wider the stronger the hole is.
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 160;
    lowpass.Q.value = 2;
    const hum = ctx.createGain();
    hum.gain.value = 0;
    lowpass.connect(hum);
    hum.connect(bus);
    const subs = [48, 48.7].map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(lowpass);
      osc.start();
      return osc;
    });

    // The wind: bandpassed noise, stuttering like an arc as it swirls.
    const noiseBuffer = createShortNoiseBuffer(ctx, 2);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 1.1;
    const swirl = ctx.createGain();
    swirl.gain.value = 0;
    noise.connect(band);
    band.connect(swirl);
    swirl.connect(bus);
    noise.start();

    graph = { ctx, bus, noise: noiseBuffer, hum, swirl, sources: [...subs, noise] };
    return graph;
  }

  /**
   * Per frame: `hole.size` (0..1), the same curve the visuals swell and
   * collapse on.
   * @param {number} level
   * @returns {void}
   */
  function updateHum(level) {
    if (level <= 0 && last <= 0) return;
    const g = ensureGraph();
    if (!g) return;
    last = level;
    const now = g.ctx.currentTime;
    g.hum.gain.setTargetAtTime(HUM_LEVEL * level, now, TIME_CONSTANT);
    const crackle = soundRandom() < 0.4 ? 1 : 0.3;
    g.swirl.gain.setTargetAtTime(SWIRL_LEVEL * level * crackle, now, 0.04);
  }

  /**
   * It opens: spacetime pulled apart.
   * @returns {void}
   */
  function playOpen() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus, noise } = g;
    const now = ctx.currentTime;
    const sweep = ctx.createBufferSource();
    sweep.buffer = noise;
    sweep.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(3200, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.6);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    sweep.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    sweep.start(now);
    sweep.stop(now + 0.75);
    sweep.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(30, now);
    sub.frequency.exponentialRampToValueAtTime(90, now + 0.45);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(1.1, now + 0.4);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    sub.connect(subGain);
    subGain.connect(bus);
    sub.start(now);
    sub.stop(now + 0.6);
    sub.onended = () => { try { subGain.disconnect(); } catch { /* already */ } };
  }

  /**
   * It finishes: the opposite snap, in on itself.
   * @returns {void}
   */
  function playClose() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.3);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(1.2, now + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    sub.connect(subGain);
    subGain.connect(bus);
    sub.start(now);
    sub.stop(now + 0.45);
    sub.onended = () => { try { subGain.disconnect(); } catch { /* already */ } };
    const crack = ctx.createBufferSource();
    crack.buffer = g.noise;
    crack.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    crack.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    crack.start(now);
    crack.stop(now + 0.08);
    crack.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
  }

  /** @returns {void} */
  function disposeBlackHoleSound() {
    if (graph) {
      for (const source of graph.sources) {
        try { source.stop(); } catch { /* already */ }
      }
      try { graph.bus.disconnect(); } catch { /* already */ }
    }
    graph = null;
    last = 0;
  }

  return { playOpen, updateHum, playClose, disposeBlackHoleSound };
}
