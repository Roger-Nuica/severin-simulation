// @ts-check
import { createShortNoiseBuffer } from './thunder.js';

/**
 * ===========================================================================
 * SECTION S.12 — The mothership's downwash
 * ===========================================================================
 * The wind blasting down from the mothership (engine/mothershipWind.js), as a
 * helicopter's rotor wash sounds standing under it, only bigger: a roar of
 * lowpassed noise that opens up as it strengthens, a hiss of grit on top,
 * and the slow whump of a rotor -- the whole of it beating at a few times a
 * second -- over a sub-bass thrum. Gusts swell it. Built on first use; one
 * loop, faded to nothing (and stopped) when the wind drops.
 */

const LEVEL = 0.9;
const WHUMP_HZ = 3.6;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateDownwash: (strength: number, gust: number, near: number) => void,
 *   disposeDownwashSound: () => void
 * }}
 */
export function createDownwashSoundSystem(engineCtx) {
  /** @type {{ctx: AudioContext, out: GainNode, roar: BiquadFilterNode, hiss: GainNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[]}|null} */
  let loop = null;
  let stopAt = 0;

  /** @param {AudioNode} node */
  function quietly(node) {
    try { node.disconnect(); } catch { /* already */ }
  }

  /** @returns {typeof loop} the loop, started if it is not running */
  function start() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (loop && loop.ctx === ctx) return loop;
    const noise = createShortNoiseBuffer(ctx, 1);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(SoundSystem.effectsGain);

    // The rotor's beat over everything: a gain swung by a slow sine.
    const beat = ctx.createGain();
    beat.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = WHUMP_HZ;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.32;
    lfo.connect(lfoDepth);
    lfoDepth.connect(beat.gain);
    beat.connect(out);

    const roarSource = ctx.createBufferSource();
    roarSource.buffer = noise;
    roarSource.loop = true;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.frequency.value = 300;
    roar.Q.value = 0.9;
    roarSource.connect(roar);
    roar.connect(beat);

    const hissSource = ctx.createBufferSource();
    hissSource.buffer = noise;
    hissSource.loop = true;
    hissSource.playbackRate.value = 1.3;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 2600;
    hissFilter.Q.value = 0.6;
    const hiss = ctx.createGain();
    hiss.gain.value = 0.1;
    hissSource.connect(hissFilter);
    hissFilter.connect(hiss);
    hiss.connect(out);

    const thrum = ctx.createOscillator();
    thrum.type = 'sine';
    thrum.frequency.value = 34;
    const thrumGain = ctx.createGain();
    thrumGain.gain.value = 0.45;
    thrum.connect(thrumGain);
    thrumGain.connect(beat);

    const sources = [lfo, roarSource, hissSource, thrum];
    for (const s of sources) s.start();
    loop = { ctx, out, roar, hiss, sources, nodes: [beat, lfoDepth, roar, hissFilter, hiss, thrumGain, out] };
    return loop;
  }

  /** @returns {void} */
  function stop() {
    if (!loop) return;
    for (const s of loop.sources) {
      try { s.stop(); } catch { /* already */ }
    }
    for (const n of loop.nodes) quietly(n);
    loop = null;
  }

  /**
   * @param {number} strength 0..1, the wind
   * @param {number} gust 0..1, a gust coming through
   * @param {number} near 0..1, how close the camera is to its middle
   * @returns {void}
   */
  function updateDownwash(strength, gust, near) {
    const level = strength * (0.35 + 0.65 * near) * (0.85 + 0.3 * gust);
    if (level <= 0.003) {
      if (loop) {
        const now = loop.ctx.currentTime;
        loop.out.gain.setTargetAtTime(0, now, 0.4);
        if (!stopAt) stopAt = now + 2.5;
        else if (now > stopAt) {
          stop();
          stopAt = 0;
        }
      }
      return;
    }
    stopAt = 0;
    const l = start();
    if (!l) return;
    const now = l.ctx.currentTime;
    l.out.gain.setTargetAtTime(LEVEL * level, now, 0.15);
    l.roar.frequency.setTargetAtTime(260 + 1100 * strength * (0.7 + 0.3 * gust), now, 0.2);
    l.hiss.gain.setTargetAtTime(0.05 + 0.2 * strength * (0.6 + 0.4 * gust), now, 0.2);
  }

  /** @returns {void} */
  function disposeDownwashSound() {
    stop();
  }

  return { updateDownwash, disposeDownwashSound };
}
